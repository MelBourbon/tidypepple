-- Prüft, dass Nutzer ihr Profil nur lesen, nicht ändern können.
-- Sonst könnte sich jeder über `plan = 'premium'` selbst freischalten.

\set ON_ERROR_STOP on

insert into auth.users (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.profiles (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

do $$
declare
  nutzer constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  anzahl integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;

  select count(*) into anzahl from public.profiles where id = nutzer;
  assert anzahl = 1, 'Eigenes Profil muss lesbar sein';

  begin
    update public.profiles set plan = 'premium' where id = nutzer;
    assert false, 'Nutzer darf sein Profil nicht aendern';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.profiles where id = nutzer;
    assert false, 'Nutzer darf sein Profil nicht loeschen';
  exception when insufficient_privilege then null;
  end;

  -- Ohne Profil: auch kein Anlegen mit `plan = 'premium'`.
  reset role;
  delete from public.profiles where id = nutzer;
  set local role authenticated;
  begin
    insert into public.profiles (id, plan) values (nutzer, 'premium');
    assert false, 'Nutzer darf kein Profil anlegen';
  exception when insufficient_privilege then null;
  end;

  -- ensure_vault legt das Profil weiterhin an.
  perform public.ensure_vault('ffffffff-ffff-4fff-8fff-ffffffffffff', '{}'::jsonb);
  reset role;
  select count(*) into anzahl from public.profiles where id = nutzer and plan = 'free';
  assert anzahl = 1, 'ensure_vault muss das Profil anlegen';
  assert not private.has_active_sync(nutzer), 'Kein Premium ohne Abo';

  raise notice 'profiles: nur lesbar, ensure_vault legt an - bestanden';
end;
$$;
