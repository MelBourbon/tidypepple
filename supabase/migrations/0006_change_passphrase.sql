-- TidyPepple – Passphrase ändern.
--
-- Der Schlüsselbund liegt auf dem Server, damit ein neues Gerät nur die Passphrase braucht.
-- Bisher ließ er sich dort nicht ändern: Wer seine Passphrase für kompromittiert hielt,
-- konnte sie nicht wechseln. Der Client verpackt den Vault-Key neu (`changePassphrase` in
-- src/crypto/keyring.ts), kein Record muss dafür angefasst werden.
--
-- Der Server kann nicht prüfen, ob die neue Verpackung stimmt – er kennt die Passphrase
-- nicht. Er lässt deshalb nur den Teil `passphrase` ändern. Alles andere muss gleich bleiben,
-- vor allem `recovery`: Wer mit einer gestohlenen Sitzung, aber ohne Passphrase, Unsinn als
-- Schlüsselbund hochlädt, sperrt damit höchstens den Weg über die Passphrase. Der
-- Wiederherstellungsschlüssel öffnet den Vault weiterhin.
--
-- Nur der Eigentümer des Vaults. Ein Abo braucht es nicht: Die eigene Passphrase zu ändern
-- ist keine Sync-Funktion.

create or replace function public.update_keyring(p_vault_id uuid, p_keyring jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = 'TP002';
  end if;

  select v.keyring into v_old
  from public.vaults v
  where v.id = p_vault_id and v.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;

  if p_keyring is null
    or jsonb_typeof(p_keyring->'passphrase'->'kdf') is distinct from 'object'
    or jsonb_typeof(p_keyring->'passphrase'->'wrapped') is distinct from 'object'
    or (p_keyring - 'passphrase') is distinct from (v_old - 'passphrase')
  then
    raise exception 'Nur die Passphrase darf sich ändern.' using errcode = '22023';
  end if;

  update public.vaults set keyring = p_keyring where id = p_vault_id;
end;
$$;

revoke execute on function public.update_keyring(uuid, jsonb) from public, anon;
grant execute on function public.update_keyring(uuid, jsonb) to authenticated;
