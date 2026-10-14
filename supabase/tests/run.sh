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
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

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
