#!/usr/bin/env bash
# Aplica stub de Supabase + migraciones + seed + pruebas en una base nueva.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-erp_javier_test}"

dropdb --if-exists "$DB"
createdb "$DB"
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

run -f tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "-> $f"
  run -f "$f"
done
echo "-> supabase/seed.sql"
run -f supabase/seed.sql
run -o /dev/null -f tests/10_schema_tests.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
