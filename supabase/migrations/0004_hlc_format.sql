-- TidyPepple – nur gültige HLC-Zeitstempel annehmen.
--
-- `write_records` entscheidet Konflikte mit `excluded.hlc > r.hlc` auf einer Textspalte. Das
-- Format hat bisher niemand geprüft: Ein Wert wie 'zzz' ist größer als jeder echte Stempel
-- (die beginnen mit einer Ziffer) und gewänne jeden Vergleich für immer. Der Record wäre
-- eingefroren – jede spätere Änderung verwürfe der Server, während die Geräte sie für
-- hochgeladen hielten. Dazu reicht ein fehlerhaftes Skript mit einem Schreib-Token.
--
-- Das Format ist das aus `src/domain/hlc.ts`: 15 Ziffern Millisekunden, 4 Hex-Ziffern
-- Zähler, Geräte-ID. Ein Verstoß bricht den ganzen Push mit einem Fehler ab, statt den Record
-- still zu übergehen: der Aufrufer soll es merken.
--
-- `not valid`: geprüft wird ab jetzt jedes Einfügen und Ändern, vorhandene Zeilen bleiben
-- unangetastet. So scheitert die Migration nicht an einem Altbestand; die App hat nie etwas
-- anderes geschrieben. Wer es wissen will: `alter table public.records validate constraint
-- records_hlc_format;`
--
-- Nicht abgedeckt: ein gültig geformter Stempel weit in der Zukunft (Gerät mit falscher
-- Systemuhr). Den abzulehnen hieße, dieses Gerät vom Sync auszuschließen, bis seine
-- gespeicherte Uhr von der echten Zeit eingeholt ist.

alter table public.records
  add constraint records_hlc_format
  check (hlc ~ '^[0-9]{15}:[0-9a-f]{4}:[^:]+$') not valid;
