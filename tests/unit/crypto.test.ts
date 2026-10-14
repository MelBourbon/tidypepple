import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64, utf8 } from '@/crypto/bytes';
import { open, seal } from '@/crypto/envelope';
import {
  changePassphrase,
  createVault,
  openIdentityPrivateKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from '@/crypto/keyring';
import { generateRecoveryKey, normalizeRecoveryKey } from '@/crypto/recovery';

describe('Base64', () => {
  it('überlebt einen Roundtrip für alle Längen und Bytewerte', () => {
    for (const length of [0, 1, 2, 3, 16, 31, 32]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37) % 256);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
    expect(fromBase64(toBase64(utf8('Grüße, Welt! 🎉')))).toEqual(utf8('Grüße, Welt! 🎉'));
  });
});

describe('Recovery-Key', () => {
  it('hat sechs Vierergruppen aus eindeutigen Zeichen', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  });

  it('verzeiht Schreibweise, Trennzeichen und verwechselbare Zeichen', () => {
    const key = generateRecoveryKey();
    const messy = key.toLowerCase().replace(/-/g, ' ');
    expect(normalizeRecoveryKey(messy)).toBe(normalizeRecoveryKey(key));
    expect(normalizeRecoveryKey('ILOU-0000-0000-0000-0000-0000')).toBe('110V00000000000000000000');
  });

  it('lehnt zu kurze Eingaben ab, statt einen falschen Schlüssel abzuleiten', () => {
    expect(() => normalizeRecoveryKey('ABC')).toThrow();
  });
});

describe('Vault', () => {
  it('sperrt mit der richtigen Passphrase auf und mit einer falschen nicht', async () => {
    const { keyring } = await createVault('korrekt-pferd-batterie');
    await expect(unlockWithPassphrase(keyring, 'korrekt-pferd-batterie')).resolves.toBeDefined();
    await expect(unlockWithPassphrase(keyring, 'falsch')).rejects.toThrow();
  });

  it('liefert über den Recovery-Key denselben Schlüssel wie über die Passphrase', async () => {
    const { keyring, recoveryKey } = await createVault('geheim');
    const viaPassphrase = await unlockWithPassphrase(keyring, 'geheim');
    const viaRecovery = await unlockWithRecoveryKey(keyring, recoveryKey);

    const sealed = await seal(viaPassphrase, 'record-1', 1, { titel: 'Milch kaufen' });
    await expect(open(viaRecovery, 'record-1', sealed)).resolves.toEqual({ titel: 'Milch kaufen' });
  });

  it('wechselt die Passphrase, ohne Daten neu zu verschlüsseln', async () => {
    const { keyring, vaultKey } = await createVault('alt');
    const sealed = await seal(vaultKey, 'record-1', 1, { wert: 42 });

    const updated = await changePassphrase(keyring, 'alt', 'neu');
    await expect(unlockWithPassphrase(updated, 'alt')).rejects.toThrow();

    const key = await unlockWithPassphrase(updated, 'neu');
    // Derselbe Ciphertext wie vorher – nur die Verpackung des Schlüssels hat sich geändert.
    await expect(open(key, 'record-1', sealed)).resolves.toEqual({ wert: 42 });
  });

  it('macht den privaten Identity-Schlüssel nur mit dem Vault-Key zugänglich', async () => {
    const { keyring, vaultKey } = await createVault('geheim');
    await expect(openIdentityPrivateKey(keyring, vaultKey)).resolves.toBeDefined();
  });
});

describe('Envelope', () => {
  it('verschlüsselt und entschlüsselt beliebige Werte', async () => {
    const { vaultKey } = await createVault('geheim');
    const value = { titel: 'Grüße 🎉', tags: ['a', 'b'], fällig: null };
    expect(await open(vaultKey, 'id-1', await seal(vaultKey, 'id-1', 1, value))).toEqual(value);
  });

  it('nutzt für jeden Schreibvorgang einen neuen IV', async () => {
    const { vaultKey } = await createVault('geheim');
    const a = await seal(vaultKey, 'id-1', 1, { x: 1 });
    const b = await seal(vaultKey, 'id-1', 1, { x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('verweigert Ciphertext, der auf einen anderen Record umgehängt wurde', async () => {
    const { vaultKey } = await createVault('geheim');
    const sealed = await seal(vaultKey, 'record-a', 1, { geheim: true });
    // Genau das würde ein neugieriger Server versuchen – die AAD verhindert es.
    await expect(open(vaultKey, 'record-b', sealed)).rejects.toThrow();
  });

  it('verweigert manipulierten Ciphertext', async () => {
    const { vaultKey } = await createVault('geheim');
    const sealed = await seal(vaultKey, 'record-a', 1, { betrag: 100 });
    const bytes = fromBase64(sealed.ct);
    bytes[0] = bytes[0]! ^ 0xff;
    await expect(open(vaultKey, 'record-a', { ...sealed, ct: toBase64(bytes) })).rejects.toThrow();
  });
});
