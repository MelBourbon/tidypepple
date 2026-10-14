import { useState } from 'react';
import { useOutboxCount } from '@/data/hooks';
import { useSync } from '@/sync/SyncProvider';
import type { Checkout, PurchaseResult } from '@/billing';
import { manageUrl, type SubscriptionInfo } from '@/billing/subscription';
import { markCheckoutStarted } from '@/billing/checkoutReturn';
import { platform } from '@/platform';
import { t } from '@/i18n';

/**
 * Die Einrichtung folgt dem Zustandsautomaten aus dem SyncProvider: pro Zustand genau
 * ein Formular, keine verschachtelten Bedingungen in der Ansicht.
 */
export function SyncSettings(): React.ReactNode {
  const sync = useSync();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      {sync.error !== null && (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {sync.error}
        </p>
      )}

      {recoveryKey !== null ? (
        <RecoveryKeyPanel value={recoveryKey} onDone={() => setRecoveryKey(null)} />
      ) : (
        <>
          {sync.state === 'unconfigured' && <Unconfigured />}
          {sync.state === 'signed-out' && <SignIn />}
          {sync.state === 'needs-vault' && <CreateVault onCreated={setRecoveryKey} />}
          {sync.state === 'locked' && <Unlock />}
          {sync.state === 'needs-subscription' && <Premium />}
          {sync.state === 'ready' && <Ready />}
          {sync.state === 'loading' && <p className="text-sm text-muted">…</p>}
        </>
      )}
    </div>
  );
}

export const Row = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <div className="mt-3 flex flex-wrap gap-2">{children}</div>
);

export const Primary = (props: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactNode => (
  <button
    {...props}
    className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
  />
);

export const Secondary = (props: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactNode => (
  <button {...props} className="min-h-11 rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40" />
);

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactNode => (
  <input
    {...props}
    className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none hover:border-line-strong focus:border-accent"
  />
);

function Unconfigured(): React.ReactNode {
  return (
    <>
      <p className="text-sm">{t.sync.unconfigured}</p>
      <p className="mt-1 text-xs text-muted">{t.sync.unconfiguredHint}</p>
    </>
  );
}

/**
 * Kauf-Knopf. Im Web ein Link auf die gehostete Checkout-Seite – bewusst ein Link und
 * kein Overlay (CSP). Die Android-App öffnet denselben Link im Custom Tab, eine App aus
 * Google Play den Kaufdialog von Google Play.
 */
function BuyButton({ checkout }: { checkout: Checkout }): React.ReactNode {
  if (checkout.kind === 'in-app') return <InAppBuyButton purchase={checkout.purchase} />;
  return (
    <a
      href={checkout.href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={() => markCheckoutStarted()}
      className="flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
    >
      {t.sync.premiumBuy}
    </a>
  );
}

const PURCHASE_MESSAGES: Partial<Record<PurchaseResult, string>> = {
  conflict: t.sync.purchaseConflict,
  error: t.sync.purchaseFailed,
};

function InAppBuyButton({ purchase }: { purchase: () => Promise<PurchaseResult> }): React.ReactNode {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <Primary
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage(null);
          void purchase()
            .then((result) => setMessage(PURCHASE_MESSAGES[result] ?? null))
            .finally(() => setBusy(false));
        }}
      >
        {t.sync.premiumBuy}
      </Primary>
      {message !== null && (
        <p role="alert" className="basis-full text-xs text-danger">
          {message}
        </p>
      )}
    </>
  );
}

/**
 * Nicht angemeldet: zuerst das Kaufangebot, darunter die Anmeldung. Wer neu ist, soll
 * bezahlen können, ohne vorher ein Konto anzulegen – der Webhook schickt danach selbst
 * den Anmeldelink. Die Anmeldung darunter ist für Käufer auf weiteren Geräten.
 */
function SignIn(): React.ReactNode {
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo !== null) return <VerifyCode email={sentTo} onOtherEmail={() => setSentTo(null)} />;
  const buyFirst = sync.purchaseWithoutAccount ? sync.checkout : null;

  return (
    <>
      {buyFirst !== null && (
        <div className="mb-4 border-b border-line pb-4">
          <h3 className="text-heading-14">{t.sync.buyTitle}</h3>
          <p className="mt-1 text-sm text-muted">{t.sync.buyBody}</p>
          <Row>
            <BuyButton checkout={buyFirst} />
          </Row>
          <p className="mt-2 text-xs text-muted">{t.sync.buyAfter}</p>
        </div>
      )}
      <SignInForm
        email={email}
        onChange={setEmail}
        onSent={() => setSentTo(email)}
        hint={buyFirst !== null ? t.sync.haveAccess : null}
      />
    </>
  );
}

function SignInForm({
  email,
  onChange,
  onSent,
  hint,
}: {
  email: string;
  onChange: (value: string) => void;
  onSent: () => void;
  hint: string | null;
}): React.ReactNode {
  const sync = useSync();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void sync.signIn(email).then(onSent).catch(() => undefined);
      }}
    >
      {hint !== null && <p className="mb-3 text-sm text-muted">{hint}</p>}
      <label className="mb-1 block text-overline" htmlFor="sync-email">
        {t.sync.email}
      </label>
      <Input id="sync-email" type="email" required value={email} onChange={(e) => onChange(e.target.value)} />
      <Row>
        <Primary type="submit" disabled={email === ''}>
          {t.sync.signIn}
        </Primary>
      </Row>
    </form>
  );
}

/**
 * Nach dem Versand: Link in der Mail öffnen oder den Code daraus eingeben. Der Code hilft,
 * wenn der Link in einem anderen Browser aufgeht als die installierte App.
 */
function VerifyCode({ email, onOtherEmail }: { email: string; onOtherEmail: () => void }): React.ReactNode {
  const sync = useSync();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void sync
          .verifyCode(email, code)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm">{t.sync.signInSent(email)}</p>
      <p className="mt-1 mb-3 text-xs text-muted">{t.sync.signInSentHint}</p>
      <label className="mb-1 block text-overline" htmlFor="sync-code">
        {t.sync.code}
      </label>
      <Input
        id="sync-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
      />
      <Row>
        <Primary type="submit" disabled={busy || code.trim().length < 6}>
          {t.sync.verifyCode}
        </Primary>
        <Secondary type="button" onClick={onOtherEmail}>
          {t.sync.otherEmail}
        </Secondary>
      </Row>
    </form>
  );
}

function CreateVault({ onCreated }: { onCreated: (key: string) => void }): React.ReactNode {
  const sync = useSync();
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = passphrase.length > 0 && passphrase.length < 10;
  const mismatch = repeat.length > 0 && passphrase !== repeat;
  const valid = passphrase.length >= 10 && passphrase === repeat;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void sync
          .createVault(passphrase)
          .then(onCreated)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="text-heading-14">{t.sync.setupTitle}</h3>
      <p className="mt-1 mb-3 text-xs text-muted">{t.sync.setupHint}</p>

      <label className="mb-1 block text-overline" htmlFor="pp">
        {t.sync.passphrase}
      </label>
      <Input id="pp" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />

      <label className="mt-3 mb-1 block text-overline" htmlFor="pp2">
        {t.sync.passphraseRepeat}
      </label>
      <Input id="pp2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />

      {tooShort && <p className="mt-1 text-xs text-danger">{t.sync.passphraseTooShort}</p>}
      {mismatch && <p className="mt-1 text-xs text-danger">{t.sync.passphraseMismatch}</p>}

      <Row>
        <Primary type="submit" disabled={!valid || busy}>
          {t.sync.create}
        </Primary>
      </Row>
    </form>
  );
}

/**
 * Der Wiederherstellungsschlüssel wird genau einmal angezeigt. Deshalb blockiert dieses
 * Panel alles andere, bis der Nutzer bestätigt hat – ein Toast wäre hier zu beiläufig.
 */
function RecoveryKeyPanel({ value, onDone }: { value: string; onDone: () => void }): React.ReactNode {
  return (
    <div>
      <h3 className="text-heading-14">{t.sync.recoveryTitle}</h3>
      <p className="mt-1 text-xs text-muted">{t.sync.recoveryHint}</p>
      <p className="my-3 rounded-md border border-line bg-raised px-3 py-3 text-center font-mono text-base tracking-wider tabular-nums select-all">
        {value}
      </p>
      <Row>
        <Primary type="button" onClick={onDone}>
          {t.sync.recoveryConfirm}
        </Primary>
        <Secondary type="button" onClick={() => void navigator.clipboard?.writeText(value)}>
          {t.sync.recoveryCopy}
        </Secondary>
      </Row>
    </div>
  );
}

function Unlock(): React.ReactNode {
  const sync = useSync();
  const [secret, setSecret] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const action = useRecovery ? sync.unlockWithRecovery : sync.unlock;
        void action(secret)
          .then(() => setSecret(''))
          .catch(() => undefined);
      }}
    >
      <h3 className="mb-3 text-heading-14">{t.sync.unlockTitle}</h3>
      <label className="mb-1 block text-overline" htmlFor="unlock-secret">
        {useRecovery ? t.sync.recoveryKeyLabel : t.sync.passphrase}
      </label>
      <Input
        id="unlock-secret"
        type={useRecovery ? 'text' : 'password'}
        autoComplete={useRecovery ? 'off' : 'current-password'}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <Row>
        <Primary type="submit" disabled={secret === ''}>
          {t.sync.unlock}
        </Primary>
      </Row>
      <button
        type="button"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setSecret('');
        }}
        className="mt-3 text-xs text-accent hover:underline"
      >
        {useRecovery ? t.sync.usePassphrase : t.sync.useRecovery}
      </button>
    </form>
  );
}

/**
 * Kaufaufforderung im Zustand `needs-subscription`.
 *
 * Der Ton ist bewusst nicht drängend: die Gratis-Version ist vollwertig, und wer schon
 * gezahlt hat, soll sehen, dass seine Daten erreichbar bleiben. Panikmache wäre hier
 * auch sachlich falsch – lokal geht nichts verloren.
 */
function Premium(): React.ReactNode {
  const sync = useSync();
  const pending = useOutboxCount();
  const [checking, setChecking] = useState(false);

  return (
    <div>
      <h3 className="text-heading-14">{t.sync.premiumTitle}</h3>
      <p className="mt-1 text-sm text-muted">{t.sync.premiumBody}</p>
      <p className="mt-2 text-sm text-muted">{t.sync.premiumReadOnly}</p>
      {pending > 0 && <p className="mt-2 text-sm">{t.sync.premiumPending(pending)}</p>}

      <Row>
        {sync.checkout === null ? (
          <p className="text-xs text-danger">
            {platform() === 'twa' ? t.sync.purchaseUnavailableApp : t.sync.premiumNotConfigured}
          </p>
        ) : (
          <BuyButton checkout={sync.checkout} />
        )}
        {/* Webhooks brauchen Sekunden, und der Kauf passiert in einem anderen Tab.
            Ein sichtbarer Knopf ist ehrlicher als ein Spinner, der im Zweifel ewig dreht. */}
        <Secondary
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void sync.syncNow().catch(() => undefined).finally(() => setChecking(false));
          }}
        >
          {t.sync.premiumRefresh}
        </Secondary>
      </Row>

      {/* Wer vor der Anmeldung gekauft hat, hat das Abo an der Bestell-E-Mail. Mit einer
          anderen Adresse angemeldet, landet er hier – und soll nicht ein zweites Mal kaufen. */}
      {sync.email !== null && <p className="mt-3 text-xs text-muted">{t.sync.premiumOtherEmail(sync.email)}</p>}
      <Row>
        <Secondary type="button" onClick={() => void sync.signOut()}>
          {t.sync.signOut}
        </Secondary>
      </Row>
    </div>
  );
}

function Ready(): React.ReactNode {
  const sync = useSync();
  return (
    <>
      <p className="text-sm">{sync.email}</p>
      {sync.subscription !== null && <SubscriptionLine info={sync.subscription} />}
      {sync.lastResult !== null && (
        <p className="mt-1 text-xs text-muted">{t.sync.lastResult(sync.lastResult)}</p>
      )}
      {sync.lastResult?.filesBlocked === 'quota' && <p className="mt-1 text-xs text-danger">{t.sync.filesQuota}</p>}
      <Row>
        <Secondary type="button" onClick={() => void sync.syncNow()}>
          {t.sync.syncNow}
        </Secondary>
        <Secondary type="button" onClick={sync.lock}>
          {t.sync.lockNow}
        </Secondary>
      </Row>
      {/* Abmelden als Link darunter: Mit Geist passen drei Knöpfe auf dem Handy nicht in
          eine Zeile, und Abmelden braucht man selten. */}
      <button
        type="button"
        onClick={() => void sync.signOut()}
        className="mt-3 block text-xs text-accent hover:underline"
      >
        {t.sync.signOut}
      </button>
    </>
  );
}

const PROVIDER_NAMES: Record<SubscriptionInfo['provider'], string> = {
  google_play: 'Google Play',
  lemonsqueezy: 'LemonSqueezy',
  other: '',
};

/**
 * Über wen das Abo läuft und wo man es verwaltet. Ersetzt den Kauf-Knopf, der bei aktivem
 * Abo ohnehin nicht erscheint – so kauft niemand versehentlich ein zweites Mal woanders.
 */
function SubscriptionLine({ info }: { info: SubscriptionInfo }): React.ReactNode {
  const href = manageUrl(info, platform());
  return (
    <p className="mt-1 text-xs text-muted">
      {t.sync.subscriptionActive(PROVIDER_NAMES[info.provider])}
      {!info.renews && info.until !== null && <> · {t.sync.subscriptionEnds(info.until.toLocaleDateString(t.dateLocale))}</>}
      {href !== null && (
        <>
          {' · '}
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
            {t.sync.subscriptionManage}
          </a>
        </>
      )}
    </p>
  );
}
