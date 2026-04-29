# Domain Pitfalls: Indian Pharmacy ERP

**Domain:** Multi-branch pharmacy management — Indian GST compliance, Schedule H/X drug dispensing, FEFO inventory, concurrent POS billing
**Researched:** 2026-04-28
**Confidence:** HIGH — all findings derived from direct codebase inspection of this repository, not from general knowledge alone.

---

## Critical Pitfalls

Mistakes that cause data corruption, legal liability, or mandatory rewrites.

---

### Pitfall 1: Floating-Point Arithmetic in Financial Calculations

**What goes wrong:**
`TaxService.calculateLineTax` uses native JavaScript `number` multiplication and division throughout:
```ts
const totalTax = (taxableAmount * taxPct) / 100;
// cgst: totalTax / 2, sgst: totalTax / 2
```
JavaScript IEEE-754 doubles produce results like `0.1 + 0.2 = 0.30000000000000004`. On a 12% GST invoice for ₹833.33, `totalTax = 99.99959...` and `cgst = 49.9997...`. These values are then stored in the database via `.toFixed(2)` in `billing.service.ts`, which rounds each field independently. Rounding five fields separately instead of rounding once produces cumulative error: `cgst + sgst != totalGst` by ±₹0.01 on a meaningful fraction of invoices.

**Why it happens:**
The initial implementation used JS math operators because they work in unit tests with clean numbers (10, 100, 12%). The error only manifests with real-world prices like ₹247.50.

**Consequences:**
- Printed invoice shows `CGST: 14.85, SGST: 14.85, Total GST: 29.71` — the sum is off by ₹0.01.
- GSTR-1 uploaded to the GST portal will have mismatched line totals vs. header totals. The portal rejects filings where the sum of taxable values across B2C invoices does not match the declared aggregate.
- Statutory audits flag rounding discrepancies as potential tax evasion indicators.
- Financial reports show a small but non-zero variance between sum-of-taxes and invoice total-tax columns.

**Prevention:**
Replace all monetary arithmetic with a decimal library. The standard choice for Node.js is `decimal.js` or `big.js`. All intermediate values must stay as `Decimal` objects until the final `.toFixed(2)` write to the database. Never convert to `number` mid-calculation.

```ts
import Decimal from 'decimal.js';
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const gross = new Decimal(unitPrice).times(quantity);
const discount = gross.times(discountPct).dividedBy(100);
const taxableAmount = gross.minus(discount);
const totalTax = taxableAmount.times(taxPct).dividedBy(100);
const cgst = totalTax.dividedBy(2).toDecimalPlaces(2);
const sgst = totalTax.minus(cgst); // sgst absorbs the residual penny
```

**Detection:**
Write a unit test: `calculateLineTax(247.50, 3, 0, 12)` — assert `cgst + sgst === totalTax` exactly.

**Phase:** Phase 1-G (billing module completion) — must be fixed before any invoice is written to DB.

---

### Pitfall 2: IGST Never Calculated — Inter-State Sales Silently Mis-Taxed

**What goes wrong:**
`TaxService.calculateLineTax` accepts `interState = false` as a default parameter. In `BillingService.create`, the call is:
```ts
this.taxService.calculateLineTax(
  parseFloat(item.unitPrice),
  item.quantity,
  parseFloat(item.discountPct ?? "0"),
  parseFloat(item.taxPct ?? "0"),
  // interState not passed — always false
);
```
Every invoice in the system applies CGST + SGST, even for sales to patients in a different state (e.g., a Delhi branch sells to a patient registered in UP). Under Indian GST law, inter-state supply must attract IGST only — applying CGST+SGST instead is an illegal tax treatment.

**Why it happens:**
The tax split logic was implemented but the flag was never wired to the invoice creation flow. The field for determining intra/inter state (`patient.state` vs `branch.state`) is not stored on the invoice schema.

**Consequences:**
- All inter-state invoices in the system will have incorrect CGST/SGST amounts and zero IGST.
- GSTR-1 B2C inter-state supplies are reported under the wrong tax head.
- If the pharmacy has branches in multiple states (the system supports multi-branch), the tax liability is systematically misstated.
- No automatic detection — the pharmacy discovers this only during a GST audit.

**Prevention:**
1. Store `patientState` and `branchState` on the invoice (or derive at query time).
2. Pass `interState = (patientState !== branchState)` into `calculateLineTax` for each line.
3. For walk-in patients (no state on record), default to intra-state (conservative, same as current behavior).
4. Add `cgstAmount`, `sgstAmount`, `igstAmount` columns to `salesInvoiceItems` — currently the schema stores only `taxPct` per line with no split breakdown, making GSTR-1 reconstruction impossible at line level.

**Detection:**
Query: any invoice with `patientId != null` where patient's state differs from branch state, and `igst = 0` — all such rows are mis-taxed.

**Phase:** Phase 1-G (billing schema must be extended before first real invoice).

---

### Pitfall 3: Schedule H/X Enforcement Not Wired to Billing

**What goes wrong:**
`medicines.requiresPrescription = true` and `medicines.isControlled = true` are stored in the schema but `BillingService.create` performs no check against either field before creating the invoice. The `prescriptionId` on `salesInvoices` is nullable. A cashier can create an invoice for any Schedule H or Schedule X drug by omitting `prescriptionId` — the API will accept it.

This is confirmed in `CONCERNS.md`: "Schedule H Enforcement Not Wired to Billing — requiresRx check exists in service but prescription link validation is incomplete."

**Why it happens:**
The billing service was scaffolded to create invoices; the compliance check was planned but deferred.

**Consequences:**
- **Legal liability**: Under the Drugs and Cosmetics Act (India), dispensing Schedule H drugs without a valid prescription is a criminal offense. The pharmacy's drug license can be revoked.
- **Audit trail failure**: A Schedule H dispensing register (Form 17) must record the Rx number, doctor name, patient name, quantity dispensed. If the prescription link is missing on the invoice, the register cannot be reconstructed.
- **Schedule X (psychotropics/narcotics)**: Dispensing without Rx and without pharmacist countersignature carries the highest legal penalty. The current system has no pharmacist-override flow for Schedule X at all.

**Prevention:**
In `BillingService.create`, before creating the invoice:
1. For each item, fetch `medicines.requiresPrescription` and `medicines.scheduleClass`.
2. If any item has `requiresPrescription = true`, `dto.prescriptionId` must be present and the prescription must have `status = 'verified'` and `expiryDate >= today`.
3. If any item has `scheduleClass = 'X'`, additionally require `performedBy` to hold a `pharmacist` or `admin` role — throw 403 otherwise.
4. This check must happen inside the transaction, after a `SELECT FOR UPDATE` on the prescription row to prevent concurrent double-dispensing.

**Detection:**
Query: `SELECT * FROM sales_invoice_items sii JOIN medicines m ON sii.medicine_id = m.id JOIN sales_invoices si ON sii.invoice_id = si.id WHERE m.requires_prescription = true AND si.prescription_id IS NULL` — any result is a compliance failure.

**Phase:** Phase 1-G (hard blocker — must be in place before POS goes live).

---

### Pitfall 4: Client-Supplied Unit Price Accepted Without Server Re-Validation

**What goes wrong:**
`CreateInvoiceDto` includes `unitPrice` per item, and `BillingService.create` uses `parseFloat(item.unitPrice)` directly in the GST calculation without re-fetching the price from the database. An authenticated cashier (or a compromised session) can submit `unitPrice: "0.01"` for any medicine and create a valid invoice at near-zero price.

**Why it happens:**
Passing price from the client simplifies the POS flow (client already shows the price), but the server must treat all client-supplied financial values as untrusted.

**Consequences:**
- Revenue loss through intentional or accidental price manipulation.
- Impossible to detect from invoice records alone because `unitPrice` on the invoice item will simply match whatever was submitted.
- Affects GSTR-1 declared turnover (under-declared sales value).

**Prevention:**
On invoice finalization, re-fetch `medicines.priceMrp` (and the configured selling price) from the database and use that as the authoritative price. The client-supplied price may be used for UI display only. If a discount was legitimately applied (manager-approved), it should come through a separate discount field with role validation, not through a manipulated unit price.

**Detection:**
Alert: any `invoice_item.unit_price < medicine.price_mrp * 0.5` for non-discounted invoices.

**Phase:** Phase 1-G.

---

### Pitfall 5: Invoice Numbering Race Condition Produces Duplicates

**What goes wrong:**
`BillingRepository.nextInvoiceNumber` executes:
```ts
SELECT count(*)::int FROM sales_invoices
WHERE branch_id = $1 AND DATE(created_at) = CURRENT_DATE
```
then constructs `seq = count + 1`. Two concurrent requests reading the same count both produce the same sequence number. Because `invoiceNo` has a `UNIQUE` constraint, one of them will fail with a PostgreSQL unique violation, resulting in a 500 error rather than a gracefully recovered duplicate.

**Why it happens:**
Confirmed known issue in `CONCERNS.md`. The fix (Redis INCR) was planned but not implemented.

**Consequences:**
- Under moderate concurrent load (2+ simultaneous checkouts at a branch), one transaction crashes.
- The crashed transaction leaves the stock already decremented (because stock decrement runs before invoice insert in the transaction) — actually this is safe because it is inside a single `db.transaction()` call, so the entire transaction rolls back on unique constraint violation. But the cashier sees a 500 error and must retry manually, creating confusion at the POS counter.
- Invoice number sequences can have gaps (the rolled-back count slot is never reused), which is a minor audit concern.

**Prevention:**
Replace the `SELECT COUNT + 1` with a PostgreSQL sequence per branch:
```sql
CREATE SEQUENCE invoice_seq_brn01 START 1;
SELECT nextval('invoice_seq_brn01');
```
Or use Redis INCR (as planned): `INCR invoice_seq:{branchId}:{YYYYMMDD}` with a 25-hour TTL. Redis INCR is atomic and fast. The sequence resets naturally at midnight when the TTL expires (set TTL to exactly midnight + buffer). If Redis is unavailable, fall back to a DB advisory lock: `SELECT pg_advisory_xact_lock(hashtext(branchId || date))`.

**Phase:** Phase 1-G (fix before load testing).

---

### Pitfall 6: No Stock Reservation — Concurrent POS Sales Oversell

**What goes wrong:**
The current FEFO flow is:
1. POS client calls `GET /inventory/batches?medicineId=X` — gets available batches.
2. POS client selects `batchId` and includes it in `POST /billing/invoices` body.
3. Server decrements batch quantity inside the invoice transaction.

Between steps 1 and 3, another concurrent checkout can select the same batch and decrement it first. When the second transaction runs `adjustQuantity(batchId, -qty)`, the guard `gt(quantity, abs(delta) - 1)` may still pass if the batch had more stock than either sale alone needed, producing a correct result. But if the batch had exactly enough for one sale, both transactions succeed in reading stock but only one decrement guard fires — the second returns `undefined` from `adjustQuantity`, `BillingService` throws `UnprocessableEntityException`, and the user gets an error after entering payment details.

There is no `reservedQty` column on `inventoryBatches`. There is no reservation step.

**Why it happens:**
Confirmed known issue in `CONCERNS.md`. The reservation system was not implemented.

**Consequences:**
- At low traffic (one cashier per branch): effectively no problem.
- At moderate traffic (2-3 cashiers per branch on a busy day): occasional checkout failures, user frustration.
- For slow-moving controlled drugs with low batch quantities (Schedule H items are often ordered in small quantities): higher collision probability, even at low transaction rates.

**Prevention:**
Add `reserved_qty INTEGER NOT NULL DEFAULT 0` to `inventory_batches`. Reservation flow:
1. On "add item to cart" (or on checkout initiation): `UPDATE inventory_batches SET reserved_qty = reserved_qty + ? WHERE id = ? AND (quantity - reserved_qty) >= ?` — atomic, returns 0 rows if insufficient.
2. On finalize: `UPDATE inventory_batches SET quantity = quantity - ?, reserved_qty = reserved_qty - ? WHERE id = ?`.
3. On cart abandonment / session timeout (BullMQ delayed job): release reservation.
4. Available stock for display = `quantity - reserved_qty`.

If the reservation table approach is too complex for v1, a simpler mitigation is to use `SELECT FOR UPDATE` on the batch row inside the invoice transaction, converting the TOCTOU to a serialization failure with a clear error message.

**Phase:** Phase 1-G (reservation) + Phase 1-F (add column migration).

---

## Moderate Pitfalls

---

### Pitfall 7: Batch Status Not Checked During Dispense

**What goes wrong:**
`BatchRepository.adjustQuantity` only guards against negative quantity:
```ts
delta < 0 ? gt(schema.inventoryBatches.quantity, Math.abs(delta) - 1) : sql`true`
```
It does not check `status = 'active'`. An expired, quarantined, or recalled batch with `quantity > 0` can be sold if the client passes its `batchId`. The nightly expiry scan marks batches as `expired` but runs once per day — batches that expire at 00:01 are dispensable all day until the job runs the following morning.

**Why it happens:**
The quantity guard was added as a simple optimization; status was assumed to be enforced upstream (it is not).

**Prevention:**
Add `eq(schema.inventoryBatches.status, 'active')` to the `adjustQuantity` WHERE clause. Also add it to `getActiveBatchesForDispense` (it already has it, but the server-side finalization does not use this query — it uses the client-supplied `batchId` directly).

**Phase:** Phase 1-G.

---

### Pitfall 8: GSTR-1 Export Requires Line-Level GST Split — Schema Cannot Support It

**What goes wrong:**
`salesInvoiceItems` stores only `taxPct` (a single percentage) and `lineTotal`. There are no `cgstAmount`, `sgstAmount`, `igstAmount` columns on the line item. GSTR-1 (the monthly outward supply return filed on the GST portal) requires itemized reporting:
- B2C (unregistered) sales aggregate: taxable value, CGST, SGST, IGST by tax rate slab.
- B2B (registered buyer) invoices: per-invoice GSTIN, taxable value, CGST, SGST, IGST, invoice date, invoice number.

Without per-line CGST/SGST/IGST stored in the DB, the reports module must re-calculate them from `taxPct` and the invoice's `interState` status at export time. This is fragile: if the GST rate on a product changes, re-calculating historical invoices with the new rate produces wrong tax amounts.

**Prevention:**
Extend `salesInvoiceItems` to store `cgstAmt`, `sgstAmt`, `igstAmt` as `numeric(12,2)` columns. Populate them at invoice creation time (not at report time). The authoritative tax amounts are the ones actually charged — store them permanently.

Also store `customerGstin` on `salesInvoices` (currently absent) — needed for B2B invoice reporting in GSTR-1.

**Phase:** Phase 1-G (schema migration before first production invoice).

---

### Pitfall 9: Prescription Refill Count Not Enforced — Unlimited Dispensing Possible

**What goes wrong:**
`prescriptions` has `isControlled: boolean` and `expiryDate`, but has no `maxRefills` or `refillCount` columns. The `prescriptionItems` table has `quantityPrescribed` and `quantityDispensed` but the dispensing logic in `BillingService` never updates `quantityDispensed` or checks `quantityPrescribed`. A Schedule H prescription can be used to dispense the same drug indefinitely.

**Why it happens:**
The prescription schema covers verification workflow but the dispensing lifecycle was not completed.

**Consequences:**
- Regulatory: Schedule H drugs dispensed beyond prescribed quantity without a new Rx is a Drugs and Cosmetics Act violation.
- For Schedule H1 drugs (e.g., antibiotics in the H1 list): regulators specifically audit prescription reuse.
- Practical: patients can stockpile controlled medications.

**Prevention:**
On invoice finalization: for each item linked to a prescription, check `prescriptionItems.quantityDispensed + qty <= prescriptionItems.quantityPrescribed`. Increment `quantityDispensed` atomically within the billing transaction. If fully dispensed, mark `isFullyDispensed = true`.

**Phase:** Phase 1-G/1-H.

---

### Pitfall 10: HSN Code Not Validated — Silent GSTR-1 Filing Errors

**What goes wrong:**
`medicines.hsnCode` is `varchar(20)` with no validation. Medicines in India typically use 6-digit or 8-digit HSN codes (Chapter 30 = pharmaceutical products). The field is nullable and has no format constraint. Products entered without HSN, or with wrong codes (e.g., 4-digit truncated codes), will produce GSTR-1 files that the portal rejects.

**Prevention:**
Validate HSN code format at API boundary: must match `/^\d{4}(\d{2}(\d{2})?)?$/` (4, 6, or 8 digits). For pharmaceutical products, the first 2 digits should be `30`. Add a DB check constraint. The GST rate should be looked up from a seeded `hsn_gst_rates` table rather than entered manually per product — manual entry allows inconsistent rates on the same HSN code across products.

**Phase:** Phase 1-F (medicine create/update validation) and seed data (HSN rate table).

---

### Pitfall 11: Expiry Scan Write-Off Has a Race Condition and an Off-By-One

**What goes wrong:**
In `ExpiryScanProcessor.handleScan`:
```ts
const full = await this.batchRepo.findBatchById(b.id);  // reads quantity
if (full && full.quantity > 0) {
  await this.movementRepo.log({ quantity: -full.quantity, ... });
  await this.batchRepo.adjustQuantity(b.id, -full.quantity); // writes
}
```
Between the `findBatchById` read and the `adjustQuantity` write, a concurrent sale can decrement the batch quantity. The `adjustQuantity` call will then attempt to reduce by more than the current stock, but the guard `gt(quantity, abs(delta) - 1)` will fail silently (returns `undefined`). The stock movement log records `-full.quantity` but the actual quantity was already partially reduced by the sale. The movement ledger is now incorrect.

Additionally, `findExpiringBatches(30)` uses `lte(expiryDate, cutoffStr)` where `cutoffStr = today + 30 days`. This includes batches that have already expired (expiry < today), which have already been marked `expired` in step 1 of the same job run. The alert list will double-count batches that are newly expired.

**Prevention:**
Wrap the write-off in a transaction with the movement log. Use `adjustQuantity` with the full WHERE clause and check the return value; if the batch was already depleted by a concurrent sale, skip the write-off log or log the actual delta. For the expiry alert query, add `gt(schema.inventoryBatches.expiryDate, todayStr)` to exclude already-expired batches.

**Phase:** Phase 1-F/1-H (worker implementation).

---

### Pitfall 12: Discount Has No Ceiling Validation — Negative Invoice Totals Possible

**What goes wrong:**
`salesInvoiceItems` accepts `discountPct` as a `numeric(5,2)` with no DB check constraint and no API-level validation against a maximum. A `discountPct = 110` produces a negative `lineTotal`. The invoice `totalAmount` will be negative, which will produce a negative `amountDue`. Paying a negative-total invoice credits the patient, which is probably not intended behavior and is certainly not valid for GSTR-1 (negative turnover on a regular invoice is rejected by the portal).

**Prevention:**
Add `check (discount_pct >= 0 AND discount_pct <= 100)` at the DB level. Add Zod validation: `discountPct: z.number().min(0).max(100)`. Additionally, any discount above a configured threshold (e.g., 10%) should require manager approval tracked in the audit log.

**Phase:** Phase 1-G.

---

## Minor Pitfalls

---

### Pitfall 13: Offset Pagination on High-Churn Tables Causes Row Duplication

**What goes wrong:**
`BillingRepository.findPaginated` uses `OFFSET/LIMIT`. If a new invoice is inserted while a user is paging through the list, all rows shift by one — the user sees the same invoice on two pages or skips one entirely. On `stock_movements` (append-only, high insert rate), this problem is more frequent.

**Prevention:**
For `salesInvoices` and `stockMovements`, switch to keyset/cursor pagination: `WHERE created_at < :cursor ORDER BY created_at DESC LIMIT :limit`. Return the last row's `created_at` as the next cursor. This is immune to concurrent inserts.

**Phase:** Post-v1 (performance and pagination pass).

---

### Pitfall 14: Schedule H Dispensing Register Cannot Be Reconstructed

**What goes wrong:**
Drugs and Cosmetics Rules require pharmacies to maintain a register (Form 17 / Schedule H register) for all Schedule H dispensings, showing: serial number, date, patient name, address, doctor name, doctor registration number, drug name, quantity, batch number. This must be available for inspection at any time.

The current schema can partially reconstruct this from `sales_invoices`, `sales_invoice_items`, `patients`, and `prescriptions`, but:
- The doctor name is on `prescriptions` — if `prescriptionId` is null on the invoice (walk-in without Rx for OTC items), that is fine; but if it is null for an H-drug sale (a compliance violation per Pitfall 3), the register entry will be incomplete.
- The serial number in the register must be sequential and gap-free per register. Invoice numbers have gaps (Pitfall 5).
- The register query must produce results ordered by dispensing date with a per-drug sequential register number — this is a reporting challenge if data was entered out of order.

**Prevention:**
Add a `schedule_h_register` table that is populated atomically within the billing transaction for every Schedule H item dispensed. This table is append-only, has its own sequential ID per branch, and stores all required fields redundantly (denormalized) so the register is always printable without joins.

**Phase:** Phase 1-G/1-H (reports module).

---

### Pitfall 15: Tax Percentage Stored Per Item — Rate Change Silently Affects Historical Data Recalculation

**What goes wrong:**
`medicines.taxPercent` is the live rate on the product. `salesInvoiceItems.taxPct` is a copy stored at invoice time. This is correct for the stored lineTotal. However, the `aggregateInvoiceTotals` in `TaxService` recalculates totals from line amounts rather than the stored totals — if ever called on historical data with a changed rate, it produces wrong results. More importantly, `endOfDaySummary` queries `SUM(tax_amount)` from the invoice header, but the header `taxAmount` is computed from the sum of lines; if the CGST/SGST split is added to lines later, the header must be kept consistent.

**Prevention:**
Treat stored financial figures as immutable. Never recalculate historical invoice totals. Report queries should sum the already-stored `lineTotal`, `cgstAmt`, `sgstAmt`, `igstAmt` values — not recompute from `taxPct`.

**Phase:** Phase 1-G (design decision to lock in before reporting is built).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Billing module completion (1-G) | Floating-point GST rounding breaks GSTR-1 | Introduce `decimal.js` before writing first invoice |
| Billing module completion (1-G) | IGST never calculated for inter-state | Store patient/branch state on invoice; pass `interState` flag |
| Billing module completion (1-G) | No Schedule H Rx check | Hard block in service before invoice insert |
| Billing schema (1-G) | No per-line CGST/SGST/IGST columns | Add migration now — impossible to reconstruct accurately later |
| Inventory schema (1-F) | No `reservedQty` — oversell | Add column + reservation flow before concurrent POS use |
| Inventory dispense (1-G) | Expired/quarantined batches soldable | Add `status = 'active'` guard in `adjustQuantity` |
| Invoice numbering (1-G) | Race condition on concurrent checkout | Redis INCR or DB sequence |
| Reports module (1-H) | Schedule H register unreconcilable | Add dedicated register table, populate at billing time |
| Medicine create (1-F) | Invalid HSN code silently accepted | Zod + DB constraint validation |
| Expiry scan worker (1-H) | Write-off race condition | Wrap in transaction; fix `lte` off-by-one |
| Discount handling (1-G) | Negative invoice totals | Add `discountPct >= 0 AND <= 100` constraint |
| GSTR-1 export (1-H) | Missing `customerGstin` on invoice | Add column before first B2B invoice |

---

## Sources

All findings derived from direct inspection of repository files:
- `backend/src/modules/billing/tax.service.ts` — floating-point GST, missing `interState` call
- `backend/src/modules/billing/billing.service.ts` — client price, no Rx check, no reservation
- `backend/src/modules/billing/billing.repository.ts` — invoice number race condition
- `backend/src/modules/inventory/batch.repository.ts` — no status check in adjustQuantity
- `backend/src/modules/inventory/jobs/expiry-scan.processor.ts` — write-off race, alert off-by-one
- `backend/src/database/schema/billing.ts` — missing CGST/SGST/IGST columns on invoice items
- `backend/src/database/schema/inventory.ts` — no reservedQty column
- `backend/src/database/schema/prescriptions.ts` — no maxRefills/refillCount columns
- `backend/src/database/schema/enums.ts` — schedule class stored as varchar, not enforced enum
- `.planning/codebase/CONCERNS.md` — confirmed known issues (invoice seq, stock reservation, Rx enforcement)
- `.planning/PROJECT.md` — regulatory context (Schedule H/X, GSTR-1, Form 17 requirements)
