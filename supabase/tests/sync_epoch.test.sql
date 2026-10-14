-- Prüft die Server-Epoche: wer sie lesen und wer sie wechseln darf.

\set ON_ERROR_STOP on

do $$
begin
  assert not has_function_privilege('anon', 'public.sync_epoch()', 'execute'),
    'anon darf sync_epoch nicht ausfuehren';
  assert has_function_privilege('authenticated', 'public.sync_epoch()', 'execute'),
    'authenticated muss sync_epoch ausfuehren duerfen';
  assert not has_function_privilege('authenticated', 'private.rotate_sync_epoch()', 'execute'),
    'authenticated darf die Epoche nicht wechseln';
  assert not has_function_privilege('anon', 'private.rotate_sync_epoch()', 'execute'),
    'anon darf die Epoche nicht wechseln';
  assert not has_table_privilege('authenticated', 'private.sync_epoch', 'update'),
    'authenticated darf die Tabelle nicht aendern';
  raise notice 'sync_epoch: Rechte - bestanden';
end $$;

do $$
declare
  vorher uuid;
  gelesen uuid;
  nachher uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  set local role authenticated;
  vorher := public.sync_epoch();
  reset role;
  assert vorher is not null, 'Epoche muss gesetzt sein';

  nachher := private.rotate_sync_epoch();
  assert nachher <> vorher, 'Wechsel muss eine neue Epoche liefern';

  set local role authenticated;
  gelesen := public.sync_epoch();
  reset role;
  assert gelesen = nachher, 'Geraete muessen die neue Epoche sehen';

  assert (select count(*) from private.sync_epoch) = 1, 'Es gibt genau eine Epoche';
  raise notice 'sync_epoch: Wechsel - bestanden';
end $$;
