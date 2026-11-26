#!/usr/bin/env bash
# Spins up a throwaway Postgres, loads a Supabase stub + all migrations, then
# runs the RLS / logic assertions in supabase/tests. Requires Postgres binaries.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
trap '"$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
RUNAS=""
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUNAS="sudo -u postgres"; fi
$RUNAS "$PGBIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp -c listen_addresses='' -c wal_level=logical" -l "$DIR/log" start >/dev/null
PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "migrate: $f"; "${PSQL[@]}" -f "$f"; done
for f in supabase/tests/[1-9]*.sql; do echo "test: $f"; "${PSQL[@]}" -f "$f"; done
echo "DB tests passed"
