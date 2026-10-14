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
