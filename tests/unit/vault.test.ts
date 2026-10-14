import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open, seal } from '@/crypto/envelope';

/**
 * Ein Neustart der App heißt: Modulzustand weg, IndexedDB bleibt. `resetModules` bildet
 * genau das nach – das frisch geladene Vault-Modul kennt nur, was in der Datenbank liegt.
 */
const restart = async (): Promise<typeof import('@/crypto/vault')> => {
  vi.resetModules();
  return import('@/crypto/vault');
};

beforeEach(async () => {
  const vault = await restart();
  await vault.destroyVault();
});

describe('Vault über einen Neustart', () => {
  it('bleibt entsperrt, ohne dass die Passphrase erneut nötig ist', async () => {
    const before = await restart();
    await before.setupVault('korrekt-pferd-batterie');
    const sealed = await seal(before.currentKey(), 'r1', before.currentKeyVersion(), { title: 'geheim' });

    const after = await restart();
    expect(after.isUnlocked()).toBe(false);
    expect(await after.restore()).toBe(true);
    expect(await open(after.currentKey(), 'r1', sealed)).toEqual({ title: 'geheim' });
  });

  it('speichert den Schlüssel nicht exportierbar', async () => {
    const vault = await restart();
    await vault.setupVault('korrekt-pferd-batterie');
    const after = await restart();
    await after.restore();
    expect(after.currentKey().extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', after.currentKey())).rejects.toThrow();
  });

  it('bleibt nach "Sperren" auch über einen Neustart gesperrt', async () => {
    const vault = await restart();
    await vault.setupVault('korrekt-pferd-batterie');
    await vault.lock();

    const after = await restart();
    expect(await after.restore()).toBe(false);
    expect(after.isUnlocked()).toBe(false);

    await after.unlock('korrekt-pferd-batterie');
    expect(await (await restart()).restore()).toBe(true);
  });

  it('verwirft den Schlüssel, wenn der Schlüsselbund zu einem anderen Vault gehört', async () => {
    const vault = await restart();
    await vault.setupVault('korrekt-pferd-batterie');
    const { setMeta } = await import('@/data/db');
    const keyring = (await vault.loadKeyring())!;
    await setMeta('keyring', { ...keyring, vaultId: 'anderer-vault' });

    const after = await restart();
    expect(await after.restore()).toBe(false);
    // Auch das bereits entsperrte Modul darf mit dem falschen Schlüssel nicht weiterarbeiten.
    expect(await vault.restore()).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });
});
