#!/usr/bin/env bash
# End-to-end run: local Postgres + test-only mini Supabase + production build
# of the app + Playwright scenario (tests/e2e/run.cjs). Screenshots → $E2E_OUT.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"; PORT=55433
export E2E_OUT="${E2E_OUT:-$PWD/.e2e-out}"; mkdir -p "$E2E_OUT"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; pkill -f "next start -p 3100" 2>/dev/null || true; pkill -f next-server 2>/dev/null || true; pkill -f mini-supabase.mjs 2>/dev/null || true; sudo -u postgres "$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
chown -R postgres "$DIR"
sudo -u postgres "$PGBIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
sudo -u postgres "$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp -c listen_addresses='' -c wal_level=logical" -l "$DIR/log" start >/dev/null
PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/00_supabase_stub.sql 2>/dev/null
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f tests/e2e/seed.sql

export PGURL="postgres://postgres@/postgres?host=/tmp&port=$PORT"
node tests/e2e/mini-supabase.mjs > "$E2E_OUT/mini-supabase.log" 2>&1 & PIDS+=($!)

VAPID=$(npx web-push generate-vapid-keys --json)
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-test-key
export SUPABASE_SERVICE_ROLE_KEY=service-role-test-key
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
export ADMIN_EMAIL=admin@example.com
export CRON_SECRET=test-cron-secret
export NEXT_PUBLIC_VAPID_PUBLIC_KEY=$(node -e "console.log(JSON.parse(process.argv[1]).publicKey)" "$VAPID")
export VAPID_PRIVATE_KEY=$(node -e "console.log(JSON.parse(process.argv[1]).privateKey)" "$VAPID")
export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
npx next build > "$E2E_OUT/build.log" 2>&1
npx next start -p 3100 > "$E2E_OUT/next.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3100/login && break; sleep 1; done
NODE_PATH="$(npm root -g)" node tests/e2e/run.cjs
