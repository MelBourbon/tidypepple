# Encryption

The server never sees plain text. Key hierarchy (`src/crypto/keyring.ts`):

```
Passphrase ───Argon2id──▶ KEK ────┐
                                  ├─▶ Vault key (AES-256-GCM) ──▶ every record
Recovery key ─Argon2id──▶ KEK ────┘
```

The vault key is not derived *from* the passphrase, only wrapped *with* it. That is why
changing the passphrase requires no re-encryption at all, and why there can be a second way
in without the server being able to read anything.

**Changing the passphrase** (*Settings → Sync*) rewraps the vault key and uploads the new
keyring (`update_keyring`, `0006_change_passphrase.sql`). The server accepts a change to the
passphrase part only; the recovery key keeps working, so a stolen session cannot lock anyone
out. It protects against someone who learns the old passphrase *later*. It does not help
against someone who already unlocked the vault with it, or who holds a revoked API token:
they have the vault key itself. For that, renew the key.

**Renewing the key** (*Settings → Sync → Renew key*, `0007_key_rotation.sql`) creates a new
vault key and re-encrypts everything on the server with it:

1. The device builds a new keyring (`rotateKeyring` in `src/crypto/keyring.ts`): the new key
   wrapped with the passphrase and with a **new recovery key**, the identity's private key
   rewrapped, and all earlier keys in `previousKeys`, wrapped with the new one – so anything
   not yet re-encrypted stays readable.
2. `rotate_vault_key` stores it and deletes every API token of the vault (each wraps the old key).
   It requires a proof that the caller holds the current key: an HKDF value derived from it, of
   which the server stores only the SHA-256 (`key_check`). A stolen session alone cannot rotate.
   Vaults from before 0007 get their proof on the next unlock with passphrase or recovery key;
   until then the first rotation is accepted without one.
3. The sync engine re-encrypts every record the server holds under an older version
   (`reencrypt_records`), keeping its HLC and `server_seq`: no device has to pull again, and an
   edit another device made offline does not lose against the rotation. Then every attachment
   is replaced. If this is interrupted, the next sync run continues (`reencryptPending`).

From step 2 on, `write_records` accepts only the current key version (TP007). A device with
the old key learns about the rotation on its next push, or when it pulls a record with a newer
version. It stops there – outbox and pull cursor untouched – fetches the new keyring, and asks
for the passphrase once.

What rotation cannot undo: copies someone already pulled with the old key, and database
backups made before it.

Every record is encrypted with its own IV; record ID and key version go in as AAD, so the
server cannot swap ciphertext between records.

**Attachments** (`src/crypto/attachment.ts`) are encrypted with the same vault key, but in
binary instead of Base64 – at 5 MB, a 33 % overhead would be noticeable. They live in the
private storage bucket `attachments` under `<vault>/<task>/<attachment>`, always as
`application/octet-stream`. The server can therefore see how many attachments a task has and
how big they are, but not their names, types or content. Uploads happen after the task
sync (`src/sync/blobs.ts`), downloads only on demand. A file is deleted from the server once
its attachment is removed, or when its task's tombstone is purged locally – until then, undo
can still bring it back.

**On the device**, the vault stays unlocked after unlocking, even across app restarts
(`src/crypto/vault.ts`). For this, IndexedDB stores the `CryptoKey` object, not its bytes: it
is non-extractable, so the browser can compute with it but no script can read it. Asking for
the passphrase on every start would add no protection, because the tasks themselves are
stored locally in plain text. The encryption protects against the server, not against
someone holding the unlocked device. *Lock* and *Sign out* remove the stored key.

**What this costs:** no server-side search, no content-based push reminders, no support
insight. If both the passphrase *and* the recovery key are lost, the data is lost – nobody
can recover it.

The recovery key is Crockford Base32 (24 characters, 120 bits) instead of a BIP39 word list:
a 2048-word list would be English-only and considerably longer, while this alphabet leaves
out easily confused characters (I, L, O, U) and input is tolerant of typos.
