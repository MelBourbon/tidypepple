#!/usr/bin/env bash
# Nächtliche Sicherung der Supabase-Datenbank (siehe docs/restore.md, „Was ist überhaupt gesichert?“).
#
# Zieht Rollen, Schema und Daten mit `supabase db dump` in ein Verzeichnis pro Lauf,
# komprimiert sie und löscht Sicherungen, die älter als KEEP_DAYS sind. Anhang-Dateien
# aus dem Storage sind wie bei Supabase-Backups nicht enthalten.
#
# `supabase db dump` startet pg_dump in Docker, passend zur Postgres-Version des Projekts;
# das pg_dump des Servers ist dafür zu alt. Docker muss also laufen.
#
# Konfiguration in einer Env-Datei (Standard: /etc/tidypepple/backup.env, Rechte 600):
#
#   DB_URL='postgresql://postgres.<projekt-ref>:<db-passwort>@<pooler-host>:5432/postgres'
#   # oder ohne Passwort in der URL, dafür:  PGPASSWORD='<db-passwort>'
#   BACKUP_DIR=/var/backups/tidypepple   # optional
#   KEEP_DAYS=14                         # optional
#   KUMA_PUSH_URL=https://kuma.example.com/api/push/XXXXXXXX   # optional
#
# Cron (crontab -e als root), täglich um 3:15:
#
#   15 3 * * * /var/www/tidypepple/deploy/backup/supabase-backup.sh >> /var/log/tidypepple/backup.log 2>&1
#
# Die Dumps enthalten E-Mail-Adressen und Abos: so ablegen wie jedes personenbezogene Backup.

set -Eeuo pipefail

ENV_FILE="${1:-/etc/tidypepple/backup.env}"
SUPABASE_CLI_VERSION=2.120.0

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Env-Datei $ENV_FILE fehlt oder ist nicht lesbar" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${DB_URL:?DB_URL fehlt in $ENV_FILE}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tidypepple}"
KEEP_DAYS="${KEEP_DAYS:-14}"
KUMA_PUSH_URL="${KUMA_PUSH_URL:-}"

# Cron hat ein knappes PATH; node per nvm liegt dann nicht darin.
if ! command -v npx >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh" >/dev/null
fi

log() { echo "$(date '+%F %T') $*"; }

push_kuma() {
  [[ -n "$KUMA_PUSH_URL" ]] || return 0
  curl -fsS -m 10 -o /dev/null --get "$KUMA_PUSH_URL" \
    --data-urlencode "status=$1" --data-urlencode "msg=$2" || true
}

umask 077
stamp="$(date '+%Y-%m-%d_%H%M%S')"
target="$BACKUP_DIR/$stamp"
partial="$target.partial"

fail() {
  log "Sicherung fehlgeschlagen: $1"
  rm -rf "$partial"
  push_kuma down "$1"
  exit 1
}
trap 'fail "Abbruch in Zeile $LINENO"' ERR

mkdir -p "$partial"
log "Sicherung nach $target"

# Das Passwort nicht auf die Kommandozeile: `--db-url` ist während des Dumps für jeden
# lokalen Nutzer über `ps` lesbar. Steht es in der URL, wandert es nach PGPASSWORD, und die
# CLI bekommt die URL ohne. Sie liest die Variable selbst (pgx), wenn die URL keins enthält.
if [[ "$DB_URL" =~ ^([a-z]+://[^:/@]+):([^@]+)@(.*)$ ]]; then
  pw="${BASH_REMATCH[2]}"
  # Prozentkodierung der URL auflösen, etwa %40 für @.
  PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
  DB_URL="${BASH_REMATCH[1]}@${BASH_REMATCH[3]}"
  unset pw
fi
export PGPASSWORD

supabase() { npx --yes "supabase@$SUPABASE_CLI_VERSION" "$@"; }

supabase db dump --db-url "$DB_URL" -f "$partial/roles.sql" --role-only
supabase db dump --db-url "$DB_URL" -f "$partial/schema.sql"
supabase db dump --db-url "$DB_URL" -f "$partial/data.sql" --use-copy --data-only

# Ein leerer Dump hieße: Verbindung stand, aber nichts gesichert.
for f in roles schema data; do
  [[ -s "$partial/$f.sql" ]] || fail "$f.sql ist leer"
done

gzip -9 "$partial"/*.sql
mv "$partial" "$target"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" \
  -exec rm -rf {} +

size="$(du -sh "$target" | cut -f1)"
log "Fertig ($size)"
push_kuma up "OK $size"
