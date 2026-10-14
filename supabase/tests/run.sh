#!/usr/bin/env bash
# Führt die SQL-Tests gegen ein echtes Postgres in einem Container aus.
#
# Getestet wird die Migration selbst, nicht ein Nachbau ihrer Logik: ein Nachbau
# könnte grün bleiben, während die Migration falsch ist.
set -euo pipefail

IMAGE=postgres:16-alpine
NAME=tidypepple-sqltest
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
# Über TCP fragen: Das Image startet beim ersten Mal einen Init-Server nur auf dem Socket
# und danach neu. Ein Socket-`pg_isready` meldet schon den Init-Server, `psql` landet dann
# im Neustart.
ready=false
for _ in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || { echo "Postgres ist nach 30 s nicht bereit" >&2; docker logs "$NAME" >&2; exit 1; }

run() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -q "$@"; }

echo "→ Supabase-Umgebung nachbauen"
run < "$ROOT/supabase/tests/_harness.sql"

echo "→ Migrationen einspielen"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  run < "$f"
done

echo "→ Tests"
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "   $(basename "$f")"
  run < "$f"
done

echo "✓ SQL-Tests bestanden"
