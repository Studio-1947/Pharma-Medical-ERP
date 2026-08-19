#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PharmERP API smoke test
#
# Exercises the critical surface end to end against a RUNNING API:
#   • health + login (super admin, shop manager)
#   • billing-flow setting: default is "new", RBAC on the switch (403 for
#     shop managers), switch round-trip old -> new
#   • OTC free hand-out (no bill): decrement, ledger, oversupply guard
#   • OTC counter sale (billed): amount tendered, idempotent retry, over-payment
#     guard, and that the sale and its line discount reach the day-end tally
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
# NOTE: exercises a REAL database — it hands out stock AND writes a real
# invoice for the billed OTC check. Intended for dev/staging, never production.
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

echo "== OTC free hand-out (no bill) =="
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

echo "== OTC counter sale (billed) =="
# The counter's OTC button bills through the normal invoice route, so a paid
# hand-out reaches the day-end tally and the GST return. The modal tenders the
# amount it displays, and the invoice route rejects both over-payment and an
# under-paid walk-in — so this checks the amount as well as the 200.
if [ -n "${MID:-}" ]; then
  MEDONE=$(curl -s -m 8 "$BASE_URL/inventory/medicines/$MID" -H "Authorization: Bearer $SHOP_TOKEN")
  BATCHES2=$(curl -s -m 8 "$BASE_URL/inventory/medicines/$MID/batches?branchId=$BRANCH_ID" -H "Authorization: Bearer $SHOP_TOKEN")
  OTC_TOTAL=$(MEDJSON="$MEDONE" BATCHJSON="$BATCHES2" node -e '
    const med = (()=>{const j=JSON.parse(process.env.MEDJSON);return j.data?.data ?? j.data ?? j})();
    const batches = (()=>{const j=JSON.parse(process.env.BATCHJSON);return j.data?.data ?? j.data ?? j})();
    const strip = Math.max(1, Number(med.stripSize ?? 1) || 1);
    const taxPct = Number(med.taxPercent ?? 0) || 0;
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const b = (Array.isArray(batches)?batches:[]).find(x => Number(x.quantity) > 0);
    if (!b) { console.log(""); process.exit(0) }
    const taxable = Number(b.mrpAtEntry) / strip;      // one loose unit
    console.log(r2(r2(taxable) + r2(taxable * taxPct / 100)).toFixed(2));
  ')
  if [ -n "$OTC_TOTAL" ]; then
    REF="SMOKE-$(date +%s)"
    BODY="{\"branchId\":\"$BRANCH_ID\",\"items\":[{\"medicineId\":\"$MID\",\"quantity\":1,\"discountPct\":\"0.00\"}],\"payments\":[{\"mode\":\"cash\",\"amount\":\"$OTC_TOTAL\"}],\"discountAmount\":\"0\",\"notes\":\"OTC counter sale — no prescription (api smoke test)\",\"clientRef\":\"$REF\"}"
    SALE=$(curl -s -m 10 -X POST "$BASE_URL/billing/invoices" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "$BODY")
    INVID=$(echo "$SALE" | jq_field "j.data?.invoice?.id ?? j.data?.id ?? ''")
    INVNO=$(echo "$SALE" | jq_field "j.data?.invoice?.invoiceNo ?? j.data?.invoiceNo ?? ''")
    [ -n "$INVID" ] && ok "billed OTC sale created ($INVNO, ₹$OTC_TOTAL)" || bad "billed OTC sale" "$(echo "$SALE" | head -c 200)"

    # A replay of the same clientRef must return the same invoice, not bill twice.
    SALE2=$(curl -s -m 10 -X POST "$BASE_URL/billing/invoices" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "$BODY")
    INVID2=$(echo "$SALE2" | jq_field "j.data?.invoice?.id ?? j.data?.id ?? ''")
    [ -n "$INVID" ] && [ "$INVID2" = "$INVID" ] && ok "billed OTC retry is idempotent" || bad "billed OTC retry is idempotent" "first=$INVID retry=$INVID2"

    # Tendering more than the bill is always a counter error, never an invoice.
    OVER=$(node -e "console.log((Number(process.argv[1])+50).toFixed(2))" "$OTC_TOTAL")
    RC2=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/billing/invoices" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "{\"branchId\":\"$BRANCH_ID\",\"items\":[{\"medicineId\":\"$MID\",\"quantity\":1,\"discountPct\":\"0.00\"}],\"payments\":[{\"mode\":\"cash\",\"amount\":\"$OVER\"}],\"discountAmount\":\"0\",\"clientRef\":\"$REF-OVER\"}")
    [ "$RC2" = "422" ] && ok "over-payment refused (422)" || bad "over-payment refused" "got $RC2"

    TODAY2=$(node -e "console.log(new Date().toISOString().slice(0,10))")
    DAY=$(curl -s -m 8 "$BASE_URL/billing/invoices?from=$TODAY2&to=$TODAY2&branchId=$BRANCH_ID&limit=100" -H "Authorization: Bearer $SHOP_TOKEN")
    SEEN=$(INVID="$INVID" DAYJSON="$DAY" node -e '
      const j = JSON.parse(process.env.DAYJSON);
      const rows = Array.isArray(j.data) ? j.data : (j.data?.data ?? []);
      console.log(rows.some(r => r.id === process.env.INVID) ? "yes" : "no");
    ')
    [ "$SEEN" = "yes" ] && ok "billed OTC sale appears in the day-end tally" || bad "billed OTC sale in day-end tally" "invoice $INVID not in today's list"
    # A per-line discount must reach the day-end "discounts given" figure. It
    # lives on the invoice LINE (discount_pct), not on sales_invoices, so the
    # summary has to reconstruct it — summing the invoice column alone reported
    # zero discounts on a day full of discounted sales.
    EOD_BEFORE=$(curl -s -m 8 "$BASE_URL/billing/reports/end-of-day?date=$TODAY2&branchId=$BRANCH_ID" -H "Authorization: Bearer $SHOP_TOKEN" | jq_field "Number(j.data?.totalDiscounts ?? 0)")
    DISC_TOTAL=$(node -e '
      const t = Number(process.argv[1]);      // full price of one unit, incl. GST
      const taxPct = Number(process.argv[2]);
      const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
      const gross = t / (1 + taxPct / 100);   // back out the pre-tax value
      const taxable = gross * 0.9;            // 10% off before GST
      console.log(r2(r2(taxable) + r2(taxable * taxPct / 100)).toFixed(2));
    ' "$OTC_TOTAL" "$(echo "$MEDONE" | jq_field "Number((j.data?.data ?? j.data ?? j).taxPercent ?? 0)")")
    DBODY="{\"branchId\":\"$BRANCH_ID\",\"items\":[{\"medicineId\":\"$MID\",\"quantity\":1,\"discountPct\":\"10.00\"}],\"payments\":[{\"mode\":\"cash\",\"amount\":\"$DISC_TOTAL\"}],\"discountAmount\":\"0\",\"clientRef\":\"$REF-DISC\"}"
    DSALE=$(curl -s -m 10 -X POST "$BASE_URL/billing/invoices" -H "Authorization: Bearer $SHOP_TOKEN" -H "Content-Type: application/json" -d "$DBODY")
    DID=$(echo "$DSALE" | jq_field "j.data?.invoice?.id ?? j.data?.id ?? ''")
    [ -n "$DID" ] && ok "discounted OTC sale created (₹$DISC_TOTAL)" || bad "discounted OTC sale" "$(echo "$DSALE" | head -c 200)"
    if [ -n "$DID" ]; then
      EOD_AFTER=$(curl -s -m 8 "$BASE_URL/billing/reports/end-of-day?date=$TODAY2&branchId=$BRANCH_ID" -H "Authorization: Bearer $SHOP_TOKEN" | jq_field "Number(j.data?.totalDiscounts ?? 0)")
      MOVED=$(node -e "console.log(Number(process.argv[2]) - Number(process.argv[1]) > 0.001 ? 'yes' : 'no')" "$EOD_BEFORE" "$EOD_AFTER")
      [ "$MOVED" = "yes" ] && ok "line discount reaches the day-end tally ($EOD_BEFORE -> $EOD_AFTER)" || bad "line discount in day-end tally" "unchanged at $EOD_BEFORE"
    fi
  else
    bad "billed OTC sale" "could not price a batch for $MID"
  fi
else
  bad "billed OTC sale" "no medicine id from the search above"
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
