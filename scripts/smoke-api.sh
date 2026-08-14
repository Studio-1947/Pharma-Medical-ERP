#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PharmERP API smoke test
#
# Exercises the critical surface end to end against a RUNNING API:
#   • health + login (super admin, shop manager)
#   • billing-flow setting: default is "new", RBAC on the switch (403 for
#     shop managers), switch round-trip old -> new
#   • OTC supply without billing: decrement, ledger, oversupply guard
#   • core module endpoints respond 200
#
# If nothing is listening on BASE_URL, the script starts the built backend
# (backend/dist) itself, waits for it, and shuts it down afterwards.
#
# Usage:
#   scripts/smoke-api.sh
#   BASE_URL=http://localhost:4000/api/v1 scripts/smoke-api.sh
#   ADMIN_EMAIL=... ADMIN_PASSWORD=... scripts/smoke-api.sh
#
# NOTE: exercises a REAL database (stock is decremented by one unit on the
# OTC supply check). Intended for dev/staging, never production.
# ─────────────────────────────────────────────────────────────────────────────

set -u
BASE_URL="${BASE_URL:-http://localhost:4000/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@mederp.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123}"
API_ROOT="${BASE_URL%/api/v1}" # /health is NOT under the api/v1 prefix

PASS=0
FAIL=0
FAILED_NAMES=()
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  FAIL  $1  $2"; }

# jq_field <js expression> — reads JSON from stdin, prints the expression result
jq_field() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log($1)}catch(e){console.log('')}})"
}

STOPPED_BACKEND=0
if ! curl -s -m 2 -o /dev/null "$API_ROOT/health"; then
  echo "No API on $BASE_URL — starting backend/dist..."
  if [ ! -f backend/dist/main.js ]; then
    echo "backend/dist/main.js missing — run 'pnpm --filter backend build' first."
    exit 2
  fi
  (cd backend && PORT=4000 node dist/main.js > /tmp/pharmerp-smoke-api.log 2>&1 & echo $! > /tmp/pharmerp-smoke-api.pid)
  STOPPED_BACKEND=1
  for i in $(seq 1 20); do
    sleep 2
    curl -s -m 2 -o /dev/null "$API_ROOT/health" && break
  done
fi

echo "== health & auth =="
curl -s -m 3 -o /dev/null "$API_ROOT/health" && ok "GET /health" || bad "GET /health" "no response"

ADMIN_TOKEN=$(curl -s -m 5 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq_field "j.data?.accessToken ?? j.accessToken ?? ''")
[ -n "$ADMIN_TOKEN" ] && ok "admin login" || bad "admin login" "no token for $ADMIN_EMAIL"

echo "== billing-flow setting =="
SET=$(curl -s -m 5 "$BASE_URL/settings" -H "Authorization: Bearer $ADMIN_TOKEN")
[ "$(echo "$SET" | jq_field "j.data?.billingFlow")" = "new" ] && ok "GET /settings defaults to new" || bad "GET /settings defaults to new" "$SET"

BRANCH_ID=$(curl -s -m 5 "$BASE_URL/branches" -H "Authorization: Bearer $ADMIN_TOKEN" | jq_field "j.data?.[0]?.id ?? j.data?.data?.[0]?.id ?? ''")
[ -n "$BRANCH_ID" ] && ok "GET /branches (for test user)" || bad "GET /branches" "no branch found"

SHOP_EMAIL="smoke.shop.$(date +%s)@mederp.com"
REG=$(curl -s -m 5 -X POST "$BASE_URL/auth/register" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"email\":\"$SHOP_EMAIL\",\"password\":\"SmokePass@123\",\"firstName\":\"Smoke\",\"lastName\":\"Shop\",\"role\":\"shop_manager\",\"branchId\":\"$BRANCH_ID\"}")
echo "$REG" | grep -q '"success":true' && ok "register shop manager" || bad "register shop manager" "$(echo "$REG" | head -c 120)"
SHOP_TOKEN=$(curl -s -m 5 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$SHOP_EMAIL\",\"password\":\"SmokePass@123\"}" | jq_field "j.data?.accessToken ?? j.accessToken ?? ''")
[ -n "$SHOP_TOKEN" ] && ok "shop manager login" || bad "shop manager login" "no token"

RC=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/settings/billing-flow" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d '{"flow":"old"}')
[ "$RC" = "403" ] && ok "shop manager cannot switch flow (403)" || bad "shop manager cannot switch flow" "got $RC"

RC=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/settings/billing-flow" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"flow":"old"}')
[ "$RC" = "200" ] && ok "admin switches to old (200)" || bad "admin switches to old" "got $RC"
SET=$(curl -s -m 5 "$BASE_URL/settings" -H "Authorization: Bearer $ADMIN_TOKEN")
[ "$(echo "$SET" | jq_field "j.data?.billingFlow")" = "old" ] && ok "flow is now old" || bad "flow is now old" "$SET"
curl -s -m 5 -X PUT "$BASE_URL/settings/billing-flow" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"flow":"new"}' > /dev/null
SET=$(curl -s -m 5 "$BASE_URL/settings" -H "Authorization: Bearer $ADMIN_TOKEN")
[ "$(echo "$SET" | jq_field "j.data?.billingFlow")" = "new" ] && ok "flow restored to new" || bad "flow restored to new" "$SET"

echo "== OTC supply without billing =="
MID=""
MED=$(curl -s -m 8 "$BASE_URL/inventory/medicines?search=paracetamol&limit=3" -H "Authorization: Bearer $SHOP_TOKEN")
MID=$(echo "$MED" | jq_field "j.data?.data?.[0]?.id ?? j.data?.[0]?.id ?? ''")
if [ -n "$MID" ]; then
  ok "medicine found for OTC"
  BATCHES=$(curl -s -m 8 "$BASE_URL/inventory/medicines/$MID/batches" -H "Authorization: Bearer $SHOP_TOKEN")
  BID=$(echo "$BATCHES" | jq_field "(j.data?.data ?? j.data ?? []).find(b=>Number(b.quantity)>0)?.id ?? ''")
  QTY=$(echo "$BATCHES" | jq_field "Number((j.data?.data ?? j.data ?? []).find(b=>Number(b.quantity)>0)?.quantity ?? 0)")
  if [ -n "$BID" ] && [ "$QTY" -gt 0 ] 2>/dev/null; then
    RES=$(curl -s -m 8 -X POST "$BASE_URL/inventory/batches/$BID/otc-supply" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "{\"quantity\":1,\"branchId\":\"$BRANCH_ID\",\"notes\":\"api smoke test\"}")
    echo "$RES" | grep -q '"quantitySupplied"' && ok "OTC supply recorded (stock decremented)" || bad "OTC supply recorded" "$(echo "$RES" | head -c 150)"
    RC=$(curl -s -m 8 -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/inventory/batches/$BID/otc-supply" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "{\"quantity\":999999,\"branchId\":\"$BRANCH_ID\"}")
    [ "$RC" = "422" ] && ok "oversupply guarded (422)" || bad "oversupply guarded" "got $RC"
    TODAY=$(node -e "console.log(new Date().toISOString().slice(0,10))")
    OT=$(curl -s -m 8 "$BASE_URL/inventory/medicines/otc-supplies?date=$TODAY&branchId=$BRANCH_ID" -H "Authorization: Bearer $SHOP_TOKEN")
    N=$(echo "$OT" | jq_field "j.data?.supplies ?? 0")
    [ "$N" -ge 1 ] 2>/dev/null && ok "GET otc-supplies ledger (supplies=$N)" || bad "GET otc-supplies ledger" "$(echo "$OT" | head -c 120)"
  else
    bad "OTC supply" "no batch with stock for $MID"
  fi
else
  bad "OTC supply" "no medicine found for search"
fi

echo "== core module endpoints =="
TODAY=$(node -e "console.log(new Date().toISOString().slice(0,10))")
for ep in "/patients?limit=5" "/prescriptions?limit=5" "/billing/invoices?limit=5" "/clinic/tokens?date=$TODAY&limit=5" "/billing/reports/end-of-day?date=$TODAY" "/inventory/medicines/low-stock" "/inventory/medicines/$MID/batches"; do
  RC=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE_URL$ep" -H "Authorization: Bearer $SHOP_TOKEN")
  [ "$RC" = "200" ] && ok "GET $ep" || bad "GET $ep" "got $RC"
done

if [ "$STOPPED_BACKEND" = "1" ]; then
  kill "$(cat /tmp/pharmerp-smoke-api.pid)" 2>/dev/null
  echo "(stopped the backend started for the smoke run)"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  printf 'failed checks: %s\n' "${FAILED_NAMES[*]}"
  exit 1
fi
exit 0
