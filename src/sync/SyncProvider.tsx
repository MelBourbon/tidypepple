import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createApiToken, listApiTokens, revokeApiToken, type ApiTokenInfo } from './apiTokens';
import { BlobSync, type FetchResult } from './blobs';
import { SyncEngine, type SyncResult } from './engine';
import {
  createSupabaseClient,
  ensureVault,
  hasSupabaseConfig,
  SupabaseBlobAdapter,
  SupabaseSyncAdapter,
} from './supabase';
import type { Attachment } from '@/domain/types';
import { t } from '@/i18n';
import { setMeta } from '@/data/db';
import type { ApiTokenScope } from '@/crypto/apiToken';
import type { Keyring } from '@/crypto/keyring';
import * as vault from '@/crypto/vault';
import { PLAY_BILLING_ENABLED, selectBilling, type BillingProvider, type Checkout } from '@/billing';
import {
  connectPlay,
  playBilling,
  restorePlayPurchases,
  type DigitalGoodsService,
  type VerifyResult,
} from '@/billing/googleplay';
import { currentSubscription, type SubscriptionInfo, type SubscriptionRow } from '@/billing/subscription';
import { consumeCheckoutReturn, onReturnFromCheckout } from '@/billing/checkoutReturn';
import { platform } from '@/platform';

/**
 * Bindet Konto, Vault und Sync-Engine zusammen. Bewusst als Zustandsautomat: jeder
 * Zustand hat genau eine sinnvolle nächste Handlung, und die Einstellungen müssen
 * keine Fallunterscheidungen nachbauen.
 *
 * Ohne Supabase-Konfiguration bleibt alles im Zustand `unconfigured` – die App ist
 * dann rein lokal, und das sagt sie auch.
 */

export type SyncState =
  | 'loading'
  | 'unconfigured'
  | 'signed-out'
  | 'needs-vault'
  | 'locked'
  /** Angemeldet und entsperrt, aber ohne aktives Abo: Pull läuft, Push ist gesperrt. */
  | 'needs-subscription'
  | 'ready'
  | 'error';

interface SyncContextValue {
  state: SyncState;
  email: string | null;
  error: string | null;
  pending: number | null;
  lastResult: SyncResult | null;
  /** Wie hier gekauft wird, oder `null`, wenn gerade nicht (siehe `src/billing/`). */
  checkout: Checkout | null;
  /** Kaufen ohne Konto („erst bezahlen, dann anmelden“) – nur im Web. */
  purchaseWithoutAccount: boolean;
  /** Eigenes, berechtigendes Abo für die Anzeige, oder `null` (keins oder nicht lesbar). */
  subscription: SubscriptionInfo | null;
  signIn: (email: string) => Promise<void>;
  /** Meldet mit dem Code aus der Anmeldemail an – Alternative zum Link. */
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  createVault: (passphrase: string) => Promise<string>;
  unlock: (passphrase: string) => Promise<void>;
  unlockWithRecovery: (recoveryKey: string) => Promise<void>;
  lock: () => void;
  syncNow: () => Promise<void>;
  /**
   * Holt eine Anhang-Datei vom Server. `unavailable`: gerade wird nicht
   * synchronisiert (kein Konto, gesperrt, nicht eingerichtet).
   */
  fetchAttachment: (taskId: string, attachment: Attachment) => Promise<FetchResult | 'unavailable'>;
  /** Ob `fetchAttachment` gerade den Server erreichen kann – Ansichten versuchen es dann erneut. */
  canFetchAttachments: boolean;
  /** API-Tokens für den MCP-Server; nur mit aktivem Abo und entsperrtem Vault. */
  apiTokens: ApiTokenAccess | null;
}

export interface ApiTokenAccess {
  list: () => Promise<ApiTokenInfo[]>;
  /** Liefert das Token als Text – nur dieses eine Mal. */
  create: (passphrase: string, name: string, scope: ApiTokenScope) => Promise<string>;
  revoke: (id: string) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Zustände, in denen die Engine laufen darf. `needs-subscription` gehört dazu:
 * Herunterladen bleibt erlaubt, nur das Hochladen ist gesperrt.
 */
const SYNCING_STATES = new Set<SyncState>(['ready', 'needs-subscription']);

/** Nachfragen nach der Rückkehr aus dem Checkout: 3 Versuche im Abstand von 5 Sekunden. */
const CHECKOUT_RETRIES = 3;
const CHECKOUT_RETRY_MS = 5_000;

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (value === null) throw new Error('useSync() braucht einen <SyncProvider>.');
  return value;
}

/** Fehlertexte sollen erklären, was zu tun ist – nicht, welche Exception geflogen ist. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : t.sync.unknownError;

export function SyncProvider({ children }: { children: ReactNode }): ReactNode {
  // `null` = keine Konfiguration, `undefined` = wird noch geladen.
  const [client, setClient] = useState<SupabaseClient | null | undefined>(
    hasSupabaseConfig() ? undefined : null,
  );
  const [state, setState] = useState<SyncState>(hasSupabaseConfig() ? 'loading' : 'unconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const engine = useRef<SyncEngine | null>(null);
  const blobs = useRef<BlobSync | null>(null);
  const [canFetchAttachments, setCanFetchAttachments] = useState(false);
  const stopEngine = useRef<(() => void) | null>(null);
  const [billing, setBilling] = useState<BillingProvider | null>(() => selectBilling(platform(), null));
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const playService = useRef<DigitalGoodsService | null>(null);
  /** Für welches Konto die Play-Käufe schon nachgemeldet wurden – einmal pro Konto und Start. */
  const restoredPlayFor = useRef<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    void createSupabaseClient().then(setClient);
  }, []);

  // Anmeldezustand verfolgen.
  useEffect(() => {
    if (client === null || client === undefined) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  /**
   * Meldet ein Play-Token an `play-verify`. Die Funktion prüft es bei Google, bestätigt es
   * und ordnet das Abo dem angemeldeten Konto zu; 409 heißt: gehört schon einem anderen.
   */
  const verifyPlayPurchase = useCallback(
    async (purchaseToken: string): Promise<VerifyResult> => {
      if (client === null || client === undefined) return 'error';
      const { error: invokeError } = await client.functions.invoke('play-verify', { body: { purchaseToken } });
      if (invokeError === null) return 'ok';
      const status = (invokeError as { context?: { status?: number } }).context?.status;
      return status === 409 ? 'conflict' : 'error';
    },
    [client],
  );

  // Nur in der Android-App und nur mit Schalter: Play gilt erst, wenn es wirklich antwortet.
  useEffect(() => {
    if (platform() !== 'twa' || !PLAY_BILLING_ENABLED || client === null || client === undefined) return;
    let cancelled = false;
    void connectPlay().then((service) => {
      if (cancelled || service === null) return;
      playService.current = service;
      setBilling(selectBilling('twa', playBilling(verifyPlayPurchase)));
    });
    return () => {
      cancelled = true;
    };
  }, [client, verifyPlayPurchase]);

  /**
   * Entscheidet nach dem Login, ob dieses Gerät einen Vault anlegen oder einen
   * bestehenden übernehmen muss. Der Schlüsselbund vom Server enthält nur verpacktes
   * Material – er hilft ohne Passphrase niemandem.
   */
  useEffect(() => {
    if (client === null || client === undefined) return;
    if (session === null) {
      setState('signed-out');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { data, error: queryError } = await client.from('vaults').select('id, keyring').limit(1);
        if (queryError !== null) throw new Error(queryError.message);
        if (cancelled) return;

        const remote = data?.[0] as { id: string; keyring: Keyring } | undefined;
        if (remote !== undefined) {
          await setMeta('keyring', remote.keyring);
          // Erst nach dem Schlüsselbund vom Server: `restore` prüft gegen genau diesen.
          const unlocked = await vault.restore();
          if (!cancelled) setState(unlocked ? 'ready' : 'locked');
          return;
        }
        if (!(await vault.hasVault())) {
          setState('needs-vault');
          return;
        }
        // Vault auf dem Gerät, aber nicht auf dem Server: Nach einem Restore (docs/restore.md)
        // fehlt ein Vault, der nach dem Backup angelegt wurde, und jeder Push scheiterte an
        // „Kein Zugriff“. Der Schlüsselbund des Geräts legt ihn wieder an; die neue Epoche
        // lässt die Engine danach alles hochladen.
        const local = await vault.loadKeyring();
        if (local !== undefined) {
          const created = await ensureVault(client, local.vaultId, local);
          if (cancelled) return;
          // Ein anderes Gerät war schneller – dessen Vault gilt, wie bei `createVault`.
          if (created.keyring.vaultId !== local.vaultId) {
            await setMeta('keyring', created.keyring);
            await vault.lock();
            setState('locked');
            return;
          }
        }
        const unlocked = await vault.restore();
        if (!cancelled) setState(unlocked ? 'ready' : 'locked');
      } catch (cause) {
        if (cancelled) return;
        setError(messageOf(cause));
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, session]);

  /**
   * Ergebnis eines Laufs auswerten. `pushBlocked` ist die einzige Quelle für den
   * Abo-Zustand – der Server entscheidet, nicht der Client.
   */
  const applyResult = useCallback((result: SyncResult) => {
    setLastResult(result);
    setState((current) =>
      // Ein spät eintreffendes Ergebnis darf einen inzwischen gesperrten Vault
      // oder eine Abmeldung nicht überschreiben.
      SYNCING_STATES.has(current) ? (result.pushBlocked ? 'needs-subscription' : 'ready') : current,
    );
  }, []);

  // Engine läuft, sobald Konto und Vault bereit sind. Die Abhängigkeit ist bewusst das
  // abgeleitete Flag und nicht `state`: sonst würde der Wechsel zwischen `ready` und
  // `needs-subscription` die Engine bei jedem Lauf neu aufsetzen.
  const canSync = SYNCING_STATES.has(state);
  useEffect(() => {
    if (client === null || client === undefined || !canSync) return;
    let cancelled = false;

    void (async () => {
      const keyring = await vault.loadKeyring();
      if (keyring === undefined || cancelled) return;
      const adapter = new SupabaseSyncAdapter(client, keyring.vaultId);
      const access = { key: vault.currentKey, keyVersion: vault.currentKeyVersion, vaultId: () => keyring.vaultId };
      const files = new BlobSync(new SupabaseBlobAdapter(client, keyring.vaultId), access);
      const next = new SyncEngine(adapter, access, files);
      engine.current = next;
      blobs.current = files;
      setCanFetchAttachments(true);
      stopEngine.current = next.start(applyResult, (cause) => setError(messageOf(cause)));
    })();

    return () => {
      cancelled = true;
      stopEngine.current?.();
      stopEngine.current = null;
      engine.current = null;
      blobs.current = null;
      setCanFetchAttachments(false);
    };
  }, [client, canSync, applyResult]);

  const loadSubscription = useCallback(async () => {
    if (client === null || client === undefined) return;
    const { data, error: queryError } = await client.from('subscriptions').select('provider, status, current_period_end');
    // Nur Anzeige: schlägt das Lesen fehl, steht eben kein Anbieter da.
    setSubscription(queryError === null ? currentSubscription((data ?? []) as SubscriptionRow[]) : null);
  }, [client]);

  useEffect(() => {
    if (session === null || !SYNCING_STATES.has(state)) {
      setSubscription(null);
      return;
    }
    void loadSubscription();
  }, [session, state, loadSubscription]);

  /**
   * Zurück aus dem LemonSqueezy-Checkout. Der Webhook kann ein paar Sekunden nach der
   * Weiterleitung kommen, deshalb wird mehrmals nachgefragt, bis der Server Sync erlaubt.
   */
  const refreshAfterCheckout = useCallback(async () => {
    for (let attempt = 0; attempt < CHECKOUT_RETRIES; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CHECKOUT_RETRY_MS));
      // Direkt nach dem Start läuft die Engine eventuell noch nicht; dann im nächsten Versuch.
      const next = await engine.current?.syncOnce().catch(() => undefined);
      if (next === undefined) continue;
      applyResult(next);
      if (!next.pushBlocked) {
        await loadSubscription();
        return;
      }
    }
  }, [applyResult, loadSubscription]);

  useEffect(() => {
    if (!canSync) return;
    if (consumeCheckoutReturn()) void refreshAfterCheckout();
    return onReturnFromCheckout(() => void refreshAfterCheckout());
  }, [canSync, refreshAfterCheckout]);

  // Ein Play-Kauf, dessen Bestätigung nicht ankam, wird beim nächsten Start nachgemeldet.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (state !== 'needs-subscription' || playService.current === null || userId === null) return;
    if (restoredPlayFor.current === userId) return;
    restoredPlayFor.current = userId;
    void restorePlayPurchases(playService.current, verifyPlayPurchase).then(async (result) => {
      if (result !== 'ok') return;
      const next = await engine.current?.syncOnce().catch(() => undefined);
      if (next !== undefined) applyResult(next);
    });
  }, [state, billing, userId, verifyPlayPurchase, applyResult]);

  const guard = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    }
  }, []);

  /** Nach einem Kauf in der App sofort neu prüfen, statt auf den nächsten Lauf zu warten. */
  const withRefresh = (checkout: Checkout | null): Checkout | null =>
    checkout?.kind !== 'in-app'
      ? checkout
      : {
          kind: 'in-app',
          purchase: async () => {
            const result = await checkout.purchase();
            if (result === 'ok') {
              const next = await engine.current?.syncOnce().catch(() => undefined);
              if (next !== undefined) applyResult(next);
              await loadSubscription();
            }
            return result;
          },
        };

  const value: SyncContextValue = {
    state,
    checkout: withRefresh(billing?.checkout(session) ?? null),
    purchaseWithoutAccount: billing?.allowsPurchaseWithoutAccount ?? false,
    subscription,
    email: session?.user.email ?? null,
    error,
    pending: null,
    lastResult,

    signIn: (address) =>
      guard(async () => {
        if (client === null || client === undefined) throw new Error('Kein Supabase-Projekt konfiguriert.');
        const { error: authError } = await client.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: window.location.origin },
        });
        if (authError !== null) throw new Error(authError.message);
      }),

    // Code aus der Mail statt Link: nötig, wenn der Link in einem anderen Browser aufgeht
    // als die installierte App (z. B. iOS-Homescreen-App vs. Safari) – deren Speicher sind getrennt.
    verifyCode: (address, code) =>
      guard(async () => {
        if (client === null || client === undefined) throw new Error('Kein Supabase-Projekt konfiguriert.');
        const { error: authError } = await client.auth.verifyOtp({
          email: address,
          token: code.trim(),
          type: 'email',
        });
        if (authError !== null) throw new Error(authError.message);
      }),

    signOut: () =>
      guard(async () => {
        await vault.lock();
        await client?.auth.signOut();
      }),

    createVault: async (passphrase) => {
      if (client === null || client === undefined) throw new Error('Kein Supabase-Projekt konfiguriert.');
      setError(null);
      try {
        const { recoveryKey } = await vault.setupVault(passphrase);
        const keyring = await vault.loadKeyring();
        if (keyring === undefined) throw new Error('Schlüsselbund konnte nicht gespeichert werden.');
        const remote = await ensureVault(client, keyring.vaultId, keyring);
        // Der Server hat das letzte Wort: ein bereits vorhandener Vault gewinnt. Sein Schlüssel
        // ist nicht der eben erzeugte – entsperrt bliebe, würde mit dem falschen verschlüsselt,
        // und die anderen Geräte könnten nichts davon lesen. Also sperren und nach dessen
        // Passphrase fragen; der Wiederherstellungsschlüssel des verworfenen Vaults ist wertlos.
        if (remote.keyring.vaultId !== keyring.vaultId) {
          await setMeta('keyring', remote.keyring);
          await vault.lock();
          setState('locked');
          throw new Error(t.sync.vaultExists);
        }
        setState('ready');
        return recoveryKey;
      } catch (cause) {
        setError(messageOf(cause));
        throw cause;
      }
    },

    unlock: (passphrase) =>
      guard(async () => {
        await vault.unlock(passphrase);
        setState('ready');
      }),

    unlockWithRecovery: (recoveryKey) =>
      guard(async () => {
        await vault.unlockWithRecovery(recoveryKey);
        setState('ready');
      }),

    lock: () => {
      setState('locked');
      void vault.lock();
    },

    canFetchAttachments,
    apiTokens:
      state !== 'ready' || client === null || client === undefined
        ? null
        : {
            list: () => listApiTokens(client),
            create: async (passphrase, name, scope) => {
              const keyring = await vault.loadKeyring();
              if (keyring === undefined) throw new Error('Auf diesem Gerät ist kein Vault eingerichtet.');
              return createApiToken(client, keyring, passphrase, name, scope);
            },
            revoke: (id) => revokeApiToken(client, id),
          },
    fetchAttachment: async (taskId, attachment) =>
      blobs.current === null ? 'unavailable' : blobs.current.fetch(taskId, attachment),

    syncNow: () =>
      guard(async () => {
        // „Status aktualisieren“ in der App: einen nicht bestätigten Play-Kauf erneut melden.
        if (state === 'needs-subscription' && playService.current !== null) {
          await restorePlayPurchases(playService.current, verifyPlayPurchase);
        }
        const result = await engine.current?.syncOnce();
        if (result !== undefined) applyResult(result);
      }),
  };

  return <SyncContext value={value}>{children}</SyncContext>;
}
