#!/usr/bin/env bash
# Creates a throwaway database on the local Postgres cluster, applies the
# real migrations, and runs the checklist assertions
# (supabase/tests/checklist_2_3.sql) against it. This is what actually
# proves checklist items 2 & 3 hold at the database level -- not a
# description of intent.
set -euo pipefail

cd "$(dirname "$0")/../.."

DB_NAME="fanboss_sql_test_$$"
PSQL_ADMIN=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q)
PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME")

cleanup() {
  "${PSQL_ADMIN[@]}" -c "drop database if exists $DB_NAME;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating throwaway database $DB_NAME..."
"${PSQL_ADMIN[@]}" -c "create database $DB_NAME;"

echo "Applying auth stub..."
"${PSQL[@]}" -f supabase/tests/stub_auth.sql

for migration in supabase/migrations/*.sql; do
  echo "Applying $migration..."
  "${PSQL[@]}" -f "$migration"
done

echo "Running checklist SQL tests..."
"${PSQL[@]}" -f supabase/tests/checklist_2_3.sql
