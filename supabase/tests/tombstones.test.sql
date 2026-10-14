-- Prüft, dass es keinen Aufräumjob für Tombstones gibt.
--
-- Er leerte den Ciphertext alter Löschungen. Gäbe es ihn noch, würden gültige,
-- verschlüsselte Löschungen unlesbar, denn der Client wendet leeren Ciphertext nicht mehr an.

\set ON_ERROR_STOP on

do $$
begin
  assert to_regprocedure('public.compact_tombstones(interval)') is null,
    'compact_tombstones darf es nicht mehr geben';
  assert to_regclass('public.records_compaction_idx') is null,
    'Der Index fuer den Aufraeumjob ist ueberfluessig';
  raise notice 'compact_tombstones: entfernt - bestanden';
end $$;
