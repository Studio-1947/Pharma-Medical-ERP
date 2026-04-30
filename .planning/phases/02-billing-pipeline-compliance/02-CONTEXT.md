# Phase 2: Billing Pipeline Compliance - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the billing module so a cashier can perform a legally compliant checkout. Specifically: Schedule H/H1/X drugs are gated behind a prescription or manager override, GST split (CGST/SGST/IGST) is calculated and stored per invoice line item, stock is deducted atomically using FEFO batch selection, split payments are accepted, and sales returns produce a credit note with restocked inventory.

Frontend POS UI is Phase 5. This phase delivers the backend API only.

</domain>

<decisions>
## Implementation Decisions

### Checkout Flow Model

- Single-shot POST /billing/invoices — client sends items[] with medicineId + quantity (no batchId), optional patientId, optional prescriptionId
- Server handles Schedule H gate, FEFO selection, stock deduction, and GST calculation all within a single Drizzle transaction
- No draft-then-finalize multi-step flow; the single-shot model is the contract the POS terminal will call in Phase 5
- Auto-split FEFO: if 10 units needed and batch A has 6, batch B has 4, server creates two invoice line items for the same medicine — client sees the split in the response

### Schedule H Gate

- Soft block with override: if a Schedule H/H1/X item has no linked verified prescription, the server returns 422 unless an override is supplied
- If no override and no prescription: reject the entire invoice (not just the problematic item) — all-or-nothing
- Override fields in the request body (invoice level, not per-item):
  - `overrideReason`: string (required when overriding)
  - `overriddenBy`: UUID of the approving user (required when overriding)
- Server validates `overriddenBy` user has role PHARMACIST, BRANCH_ADMIN, or SUPER_ADMIN
- Override stored on `salesInvoices` (invoice-level columns: `overrideReason`, `overriddenBy`) — requires a schema migration to add these columns
- Prescription validation: linked prescription must have `status = 'verified'` and `validUntil >= today`

### FEFO + Stock Deduction

- Atomic deduct at finalization — no two-phase reservation; single-shot model means no abandoned-cart problem
- `reservedQty` column on `inventoryBatches` is not used in Phase 2 (reserved for a future cart feature)
- FEFO logic lives in `BatchRepository.selectBatchesForDispense(medicineId, branchId, qty)` — reusable method, not inline in BillingService
- FEFO selection skips expired batches (expiryDate < today) and batches with status != 'active'
- If non-expired available stock < requested qty: return 422 with the available qty so client can adjust
- Stock deduction uses optimistic lock: `UPDATE inventoryBatches SET quantity = quantity - X WHERE id = ? AND quantity >= X` — if 0 rows updated, throw 422 (prevents oversell under concurrent requests)

### GST Split Per Line

- `calculateLineTax()` already exists in TaxService with correct CGST/SGST/IGST logic
- Write `cgstAmt`, `sgstAmt`, `igstAmt` to `salesInvoiceItems` for each line (columns added in Phase 1)
- Inter-state detection: if patient has a state on record that differs from branch state → IGST; otherwise CGST+SGST
- Walk-in customers (no patientId) always use intra-state (CGST + SGST) — branch state is the default
- `interState` boolean derived server-side; client never supplies it

### Split Payment

- POST /billing/invoices body accepts `payments: [{ mode, amount, referenceNo? }][]`
- Server validates sum of payment amounts == invoice totalAmount (exact match required; no partial payment at checkout)
- Each payment entry creates one row in the payments table
- Supported modes: cash, upi, card, insurance, credit (existing payment mode enum)

### Sales Returns

- POST /billing/invoices/:id/return
- Supports partial quantity: body contains `items: [{ invoiceItemId, returnQty }]`
- Server validates returnQty <= (original quantity on that item - quantity already returned via prior returns)
- Eligible invoices: status = 'confirmed' only; cancelled invoices cannot be returned
- Return creates a new salesInvoice row with `isReturn = true` and `originalInvoiceId` pointing to the source invoice (both columns already exist in schema)
- Return invoice totalAmount is negative (credit note)
- Restocked to the same original batchId from the invoice item — stock movement type = 'return'

### Claude's Discretion

- Inter-state logic implementation details (how to fetch patient state and branch state within the transaction)
- Error message wording for 422 responses
- Whether split payment validation uses exact-match or allows overpayment with change calculated

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `TaxService.calculateLineTax(unitPrice, qty, discountPct, taxPct, interState?)` — already correct with Decimal.js; just needs `interState` flag wired and return value written to `cgstAmt/sgstAmt/igstAmt` columns
- `TaxService.aggregateInvoiceTotals(lines)` — aggregates subtotal, taxAmount, totalAmount; keep using
- `BillingRepository.nextInvoiceNumber(branchId, branchCode)` — atomic Redis INCR, already correct
- `BillingRepository.createInvoiceWithItems(invoiceData, itemsData, tx)` — reuse, extend to accept cgstAmt/sgstAmt/igstAmt per item
- `StockMovementRepository.log(data, tx?)` — already supports transaction context; use for sale and return movements
- `BatchRepository.adjustQuantity(batchId, delta, tx)` — exists but currently has no optimistic lock check; needs to be upgraded to WHERE quantity >= needed pattern

### Established Patterns

- All multi-step DB operations use `this.drizzle.db.transaction(async (tx) => { ... })` — maintain this pattern
- NestJS modules with service/controller/repository separation — billing follows this
- `UnprocessableEntityException` for business rule violations (already used in BillingService.create for insufficient stock)
- `NotFoundException` for missing records

### Integration Points

- `BillingService.create()` — this is the method being rewritten; its signature and behavior will change significantly
- `BatchRepository` — new `selectBatchesForDispense()` method added here
- `salesInvoices` schema — add `overrideReason varchar` and `overriddenBy uuid` columns via migration
- `salesInvoiceItems` schema — `cgstAmt/sgstAmt/igstAmt` columns already added in Phase 1

</code_context>

<specifics>
## Specific Ideas

- No specific UI references; this is a pure backend phase
- The split payment sum validation should reject the request if amounts don't add up exactly (not silent rounding)

</specifics>

<deferred>
## Deferred Ideas

- Inter-state GST detection was not discussed in depth — walk-in always intra-state is an acceptable simplification for v1
- `reservedQty` on batches is not used this phase; could be wired for a future in-progress cart feature
- Patient allergy check against invoice items (mentioned in PROJECT.md BILL requirements) — out of scope for Phase 2, belongs in Phase 3 patient module work

</deferred>

---

*Phase: 02-billing-pipeline-compliance*
*Context gathered: 2026-04-30*
