#!/usr/bin/env bash
# reserver_stock_produit()'s whole point is a row lock (select ... for
# update on offres) that serializes concurrent reservation attempts on the
# SAME offer -- per the brief, this is "le point le plus critique de tout
# ce lot" and must be verified empirically, not assumed. checklist_2_3.sql
# runs as a single sequential psql connection and structurally cannot
# exercise real concurrency, so this is a separate script: it fires
# several genuinely concurrent psql connections (real OS processes, not a
# single script) against the same throwaway database and asserts on the
# real outcome -- no oversell under contention, no spurious rejection
# when stock is sufficient.
set -euo pipefail

cd "$(dirname "$0")/../.."

DB_NAME="fanboss_concurrency_test_$$"
PSQL_ADMIN=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q)
PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME")

cleanup() {
  "${PSQL_ADMIN[@]}" -c "drop database if exists $DB_NAME;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating throwaway database $DB_NAME..."
"${PSQL_ADMIN[@]}" -c "create database $DB_NAME;"

"${PSQL[@]}" -f supabase/tests/stub_auth.sql >/dev/null
for migration in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$migration" >/dev/null
done

CREATEUR="c0000000-0000-0000-0000-000000000001"
OFFRE_SCARCE="c0000000-0000-0000-0000-000000000002"
OFFRE_AMPLE="c0000000-0000-0000-0000-000000000003"

"${PSQL[@]}" -v ON_ERROR_STOP=1 -q <<SQL
insert into users (id) values ('$CREATEUR');
insert into offres (id, createur_id, type, prix, stock_total, libelle) values
  ('$OFFRE_SCARCE', '$CREATEUR', 'produit', 10, 1, 'Scarce'),
  ('$OFFRE_AMPLE', '$CREATEUR', 'produit', 10, 5, 'Ample');
SQL

reserve_attempt() {
  local fan_id="$1"
  local offre_id="$2"
  local out_file="$3"
  "${PSQL[@]}" <<SQL > "$out_file" 2>&1
select set_config('app.current_user_id', '$fan_id', false);
set role authenticated;
select * from reserver_stock_produit('$offre_id', 1);
SQL
}

echo ""
echo "=== Test 1: 8 concurrent callers racing for the LAST unit (stock_total=1) ==="
FAN_PREFIX="d0000000-0000-0000-0000-00000000000"
FAN_IDS=()
for i in 1 2 3 4 5 6 7 8; do
  FAN_IDS+=("${FAN_PREFIX}${i}")
done

INSERT_USERS="insert into users (id) values "
for i in "${!FAN_IDS[@]}"; do
  [ "$i" -gt 0 ] && INSERT_USERS+=", "
  INSERT_USERS+="('${FAN_IDS[$i]}')"
done
INSERT_USERS+=";"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -q -c "$INSERT_USERS"

OUT_DIR=$(mktemp -d)
PIDS=()
for fan_id in "${FAN_IDS[@]}"; do
  reserve_attempt "$fan_id" "$OFFRE_SCARCE" "$OUT_DIR/$fan_id.log" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

SUCCESS_COUNT=0
FAILURE_COUNT=0
for fan_id in "${FAN_IDS[@]}"; do
  if grep -q "reservation_id" "$OUT_DIR/$fan_id.log"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  elif grep -q "stock insuffisant" "$OUT_DIR/$fan_id.log"; then
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
  else
    echo "UNEXPECTED OUTPUT for $fan_id:"
    cat "$OUT_DIR/$fan_id.log"
    exit 1
  fi
done

echo "Successes: $SUCCESS_COUNT, rejections: $FAILURE_COUNT"
if [ "$SUCCESS_COUNT" -ne 1 ] || [ "$FAILURE_COUNT" -ne 7 ]; then
  echo "TEST FAILED: expected exactly 1 success and 7 rejections out of 8 concurrent callers on 1 unit of stock (oversold or under-sold)"
  exit 1
fi

ROW_COUNT=$("${PSQL[@]}" -t -A -c "select count(*) from reservations_stock where offre_id = '$OFFRE_SCARCE';")
if [ "$ROW_COUNT" -ne 1 ]; then
  echo "TEST FAILED: expected exactly 1 reservations_stock row for the scarce offre, found $ROW_COUNT"
  exit 1
fi
echo "PASS: exactly 1 of 8 truly concurrent callers reserved the last unit, no oversell, no spurious rejection"

echo ""
echo "=== Test 2: 5 concurrent callers, stock_total=5 (all should succeed, no unnecessary serialization failure) ==="
FAN_PREFIX2="e0000000-0000-0000-0000-00000000000"
FAN_IDS2=()
for i in 1 2 3 4 5; do
  FAN_IDS2+=("${FAN_PREFIX2}${i}")
done

INSERT_USERS2="insert into users (id) values "
for i in "${!FAN_IDS2[@]}"; do
  [ "$i" -gt 0 ] && INSERT_USERS2+=", "
  INSERT_USERS2+="('${FAN_IDS2[$i]}')"
done
INSERT_USERS2+=";"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -q -c "$INSERT_USERS2"

OUT_DIR2=$(mktemp -d)
PIDS2=()
for fan_id in "${FAN_IDS2[@]}"; do
  reserve_attempt "$fan_id" "$OFFRE_AMPLE" "$OUT_DIR2/$fan_id.log" &
  PIDS2+=($!)
done
for pid in "${PIDS2[@]}"; do
  wait "$pid" || true
done

SUCCESS_COUNT2=0
for fan_id in "${FAN_IDS2[@]}"; do
  if grep -q "reservation_id" "$OUT_DIR2/$fan_id.log"; then
    SUCCESS_COUNT2=$((SUCCESS_COUNT2 + 1))
  else
    echo "UNEXPECTED FAILURE for $fan_id (stock was sufficient for everyone):"
    cat "$OUT_DIR2/$fan_id.log"
  fi
done

if [ "$SUCCESS_COUNT2" -ne 5 ]; then
  echo "TEST FAILED: expected all 5 concurrent callers to succeed with sufficient stock, got $SUCCESS_COUNT2"
  exit 1
fi
echo "PASS: 5 truly concurrent callers with sufficient stock (5 units) all succeeded -- the row lock serializes without over-rejecting"

rm -rf "$OUT_DIR" "$OUT_DIR2"
echo ""
echo "ALL CONCURRENCY TESTS PASSED"
