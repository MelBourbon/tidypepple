/**
 * Fehler, die der Sync unterscheiden muss.
 *
 * "Kein Abo" ist kein Netzwerkfehler und darf nicht wie einer behandelt werden: der eine
 * Fall verlangt eine Kaufaufforderung, der andere einen Wiederholungsversuch. Ohne eigenen
 * Typ landet beides in derselben Fehlermeldung.
 */

/** SQLSTATE aus `push_records()` – siehe `supabase/migrations/0001_schema.sql`. */
export const ENTITLEMENT_REQUIRED_CODE = 'TP001';
export const VAULT_FORBIDDEN_CODE = 'TP002';
/** Der Speicher für Records des Vaults ist voll (0005_records_write_path.sql). */
export const RECORD_QUOTA_CODE = 'TP006';

/** SQLSTATE aus den API-Funktionen – siehe `supabase/migrations/0001_schema.sql`. */
export const API_TOKEN_INVALID_CODE = 'TP004';
export const API_TOKEN_READ_ONLY_CODE = 'TP005';

export class EntitlementRequiredError extends Error {
  readonly name = 'EntitlementRequiredError';

  constructor(message = 'Synchronisation erfordert ein aktives Abo.') {
    super(message);
  }
}

export class VaultForbiddenError extends Error {
  readonly name = 'VaultForbiddenError';

  constructor(message = 'Kein Zugriff auf diesen Vault.') {
    super(message);
  }
}

/**
 * Der Server nimmt keine weiteren Records an: das Kontingent des Vaults ist belegt. Anders
 * als "kein Abo" hilft hier kein Kauf, sondern nur Aufräumen; die Outbox bleibt erhalten.
 */
export class RecordQuotaError extends Error {
  readonly name = 'RecordQuotaError';

  constructor(message = 'Der Speicher für Aufgaben ist voll.') {
    super(message);
  }
}

export class ApiTokenInvalidError extends Error {
  readonly name = 'ApiTokenInvalidError';

  constructor(message = 'API-Token ungültig oder widerrufen.') {
    super(message);
  }
}

/**
 * Auf dem Gerät liegen noch nicht hochgeladene Änderungen eines anderen Vaults. Der Wechsel
 * verwürfe sie – das entscheidet der Nutzer, nicht der Sync.
 */
export class VaultSwitchError extends Error {
  readonly name = 'VaultSwitchError';

  constructor(
    /** Wie viele Änderungen und Dateien verloren gingen. */
    readonly unsynced: number,
  ) {
    super('Auf diesem Gerät liegen nicht hochgeladene Änderungen eines anderen Kontos.');
  }
}

export const isEntitlementRequired =(error: unknown): boolean =>
  error instanceof EntitlementRequiredError;
