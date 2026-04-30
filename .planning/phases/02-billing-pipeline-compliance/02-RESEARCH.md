# Phase 2: Billing Pipeline Compliance - Research

**Researched:** 2026-04-30
**Domain:** NestJS billing transaction pipeline — Schedule H gate, FEFO, GST split, atomic stock deduction, split payments, sales returns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Checkout Flow Model**
- Single-shot POST /billing/invoices — client sends items[] with medicineId + quantity (no batchId), optional patientId, optional prescriptionId
- Server handles Schedule H gate, FEFO selection, stock deduction, and GST calculation all within a single Drizzle transaction
- No draft-then-finalize multi-step flow
- Auto-split FEFO: if 10 units needed and batch A has 6, batch B has 4, server creates two invoice line items for the same medicine

**Schedule H Gate**
- Soft block with override: if a Schedule H/H1/X item has no linked verified prescription, server returns 422 unless an override is supplied
- If no override and no prescription: reject the entire invoice — all-or-nothing
- Override fields at invoice level: `overrideReason` (string, required), `overriddenBy` (UUID, required)
- Server validates `overriddenBy` user has role pharmacist, admin, or super_admin
- Override stored on `salesInvoices` table — requires schema migration to add columns
- Prescription validation: linked prescription must have status = 'verified' and validUntil >= today

**FEFO + Stock Deduction**
- Atomic deduct at finalization — no two-phase reservation; `reservedQty` not used in Phase 2
- FEFO logic lives in `BatchRepository.selectBatchesForDispense(medicineId, branchId, qty)`
- FEFO skips expired batches (expiryDate < today) and batches with status != 'active'
- If non-expired available stock < requested qty: return 422 with available qty
- Optimistic lock: `UPDATE inventoryBatches SET quantity = quantity - X WHERE id = ? AND quantity >= X`

**GST Split Per Line**
- `calculateLineTax()` already exists in TaxService with correct Decimal.js logic
- Write `cgstAmt`, `sgstAmt`, `igstAmt` to `salesInvoiceItems` for each line (columns exist from Phase 1)
- Inter-state: patient.state differs from branch.state → IGST; otherwise CGST+SGST
- Walk-in customers (no patientId) always use intra-state

**Split Payment**
- POST /billing/invoices body accepts `payments: [{ mode, amount, referenceNo? }][]`
- Server validates sum of payment amounts == invoice totalAmount (exact match)
- Each payment entry creates one row in the payments table

**Sales Returns**
- POST /billing/invoices/:id/return
- Supports partial quantity: body contains `items: [{ invoiceItemId, returnQty }]`
- Server validates returnQty <= (original quantity - quantity already returned)
- Eligible: status = 'confirmed' only
- Return creates new salesInvoice row with isReturn = true and originalInvoiceId pointing to source
- Return invoice totalAmount is negative
- Restocked to same original batchId — movement type = 'return'

### Claude's Discretion
- Inter-state logic implementation details (how to fetch patient state and branch state within the transaction)
- Error message wording for 422 responses
- Whether split payment validation uses exact-match or allows overpayment

### Deferred Ideas (OUT OF SCOPE)
- `reservedQty` column not used this phase
- Patient allergy check against invoice items — Phase 3
- Walk-in always intra-state is acceptable simplification for v1
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BILL-01 | GST amounts calculated using decimal.js (no floating-point rounding errors) | TaxService already uses Decimal.js; wire interState flag and capture breakdown per line |
| BILL-02 | CGST/SGST/IGST amounts persisted per invoice line item in new schema columns | Columns cgstAmt/sgstAmt/igstAmt exist on salesInvoiceItems from Phase 1; BillingService must write them |
| BILL-03 | Inter-state vs intra-state GST determined from branch.state vs patient.state at invoice creation | branches table lacks state column — migration needed, OR use warehouse address for now; research below |
| BILL-04 | Schedule H/H1/X products blocked at billing if no linked verified prescription exists | medicines.scheduleClass column exists; prescriptions.status enum has 'verified'; expiryDate = validUntil on prescriptions |
| BILL-05 | Stock reservation (reservedQty) — locked decision: NOT used in Phase 2; atomic deduct only | Implementation uses optimistic lock pattern; BILL-05 is satisfied by the WHERE quantity >= X pattern |
| BILL-06 | Server performs FEFO batch selection — client does not supply batchId | New BatchRepository.selectBatchesForDispense() method; order by expiryDate ASC |
| BILL-07 | Server re-fetches unitPrice from DB at invoice finalization | Use mrpAtEntry from inventoryBatches (or priceMrp from medicines) — client-supplied price ignored |
| BILL-08 | Invoice finalization is a single Drizzle transaction: stock deduct + invoice write + movement log | BillingService.create() rewrite wraps all steps in this.drizzle.db.transaction() |
| BILL-09 | Split payment accepted: sum must equal invoice total | payments array in CreateInvoiceDto; Decimal.js sum validation before transaction |
| BILL-10 | Sales return flow: select items, restock batches, create refund payment record, link to original | POST /billing/invoices/:id/return; new method BillingService.createReturn() |
</phase_requirements>

---

## Summary

Phase 2 rewrites `BillingService.create()` and adds `BillingService.createReturn()` — both are pure NestJS service methods backed by a single Drizzle transaction. The existing codebase provides correct building blocks: `TaxService.calculateLineTax()` with Decimal.js, `BillingRepository.nextInvoiceNumber()` with Redis INCR, `StockMovementRepository.log()` with transaction context, and `BatchRepository.adjustQuantity()` with a partial optimistic lock. The work is integration and completion, not greenfield development.

Three schema gaps require a migration before code changes: (1) `salesInvoices` needs `overrideReason` and `overriddenBy` columns for the Schedule H soft block, (2) `salesInvoices` needs `isReturn boolean` and `originalInvoiceId uuid` for the return flow, and (3) `branches` needs a `state` column for inter-state GST detection. The `cgstAmt/sgstAmt/igstAmt` columns on `salesInvoiceItems` and `reservedQty` on `inventoryBatches` already exist from the Phase 1 migration (0001_keen_dagger.sql confirmed).

The most complex piece is `selectBatchesForDispense()`: a pure-read FEFO accumulator that runs inside the same transaction as the deduction loop. The optimistic lock pattern — `UPDATE ... WHERE id = ? AND quantity >= X RETURNING id` — returning zero rows means concurrent depletion; this is what prevents oversell.

**Primary recommendation:** Structure the rewrite as five sequential steps inside one transaction: (1) validate Schedule H gate, (2) call selectBatchesForDispense for each line item to get batch allocations, (3) deduct each batch with optimistic lock, (4) write invoice + items with GST fields, (5) write payment rows. Keep all five steps inside `this.drizzle.db.transaction()`.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.33.0 | ORM + transaction API | Already in use; `.transaction(async (tx) => {...})` pattern established |
| decimal.js | ^10.6.0 | GST arithmetic precision | Already in TaxService; avoids float drift on 12/18% GST rates |
| ioredis | ^5.3.2 | Redis INCR for invoice sequence | Already in BillingRepository |
| @nestjs/common | ^10.3.0 | UnprocessableEntityException, NotFoundException | Already the pattern in BillingService |
| zod | ^3.23.0 | DTO validation | Already used via @pharmerp/types |

### No New Dependencies Required

All required libraries are installed. Phase 2 adds no new npm packages.

---

## Architecture Patterns

### Established NestJS Module Pattern

```
backend/src/modules/billing/
├── billing.controller.ts   (add return route, update create signature)
├── billing.service.ts      (rewrite create(), add createReturn())
├── billing.repository.ts   (add findReturnedQty(), add return invoice write)
├── billing.module.ts       (no changes needed)
└── tax.service.ts          (no changes needed — already correct)

backend/src/modules/inventory/
└── batch.repository.ts     (add selectBatchesForDispense())

packages/types/src/dtos/
└── invoice.dto.ts          (replace InvoiceItemDto, add ReturnInvoiceDto)
```

### Recommended Project Structure Change

The current `CreateInvoiceDto` in `packages/types/src/dtos/invoice.dto.ts` has `batchId` on items (client-supplied). This must change since the server now owns batch selection. The new shape also needs `payments[]` and override fields.

### Pattern 1: Single-Shot Transaction Sequence

**What:** All checkout logic runs inside one `this.drizzle.db.transaction(async (tx) => {...})` call.
**When to use:** Any multi-table write that must be atomic.

```typescript
// Source: existing BillingService.create() pattern + locked CONTEXT.md decision
const result = await this.drizzle.db.transaction(async (tx) => {
  // Step 1: Schedule H gate (read-only, inside tx for snapshot consistency)
  // Step 2: FEFO batch selection (read-only)
  // Step 3: Optimistic-lock deductions (write)
  // Step 4: Invoice + items insert (write)
  // Step 5: Payment rows insert (write)
  return { invoice, items, payments };
});
```

### Pattern 2: Optimistic Lock on Batch Deduction

**What:** UPDATE with a WHERE guard that checks quantity is sufficient before decrementing.
**Why:** Prevents oversell under concurrent requests without serializable isolation.

```typescript
// Source: existing BatchRepository.adjustQuantity() — needs upgrade
const [updated] = await tx
  .update(schema.inventoryBatches)
  .set({
    quantity: sql`${schema.inventoryBatches.quantity} - ${needed}`,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(schema.inventoryBatches.id, batchId),
      gte(schema.inventoryBatches.quantity, needed),
    )
  )
  .returning({ id: schema.inventoryBatches.id });

if (!updated) {
  throw new UnprocessableEntityException(`Insufficient stock in batch ${batchId}`);
}
```

Note: the existing `adjustQuantity` uses `gt(quantity, abs(delta) - 1)` which is equivalent to `gte(quantity, abs(delta))` but less readable. The new `selectBatchesForDispense` deduction loop should use `gte` directly for clarity.

### Pattern 3: FEFO Accumulator (selectBatchesForDispense)

**What:** Pure read query inside the transaction that returns batch allocation plan before deducting.
**When to use:** Every FEFO-based dispense; reusable by Phase 3 prescription dispensing.

```typescript
// New method on BatchRepository
async selectBatchesForDispense(
  medicineId: string,
  branchId: string,  // filter via storageLocations -> warehouses -> branchId
  needed: number,
  tx?: any,
): Promise<Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number }>> {
  const db = tx ?? this.db;
  const today = new Date().toISOString().split("T")[0]!;

  // FEFO: active, non-expired, qty > 0, ordered by expiryDate ASC
  const batches = await db
    .select({
      id: schema.inventoryBatches.id,
      batchNo: schema.inventoryBatches.batchNo,
      expiryDate: schema.inventoryBatches.expiryDate,
      quantity: schema.inventoryBatches.quantity,
      mrpAtEntry: schema.inventoryBatches.mrpAtEntry,
    })
    .from(schema.inventoryBatches)
    .where(
      and(
        eq(schema.inventoryBatches.medicineId, medicineId),
        eq(schema.inventoryBatches.status, "active"),
        gt(schema.inventoryBatches.quantity, 0),
        gt(schema.inventoryBatches.expiryDate, today), // strictly after today
      )
    )
    .orderBy(asc(schema.inventoryBatches.expiryDate));

  // Accumulate until needed is satisfied
  const allocations = [];
  let remaining = needed;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.id, batchNo: batch.batchNo, expiryDate: batch.expiryDate, allocate: take, mrpAtEntry: batch.mrpAtEntry });
    remaining -= take;
  }

  if (remaining > 0) {
    const available = needed - remaining;
    throw new UnprocessableEntityException(
      `Insufficient stock for medicine ${medicineId}: requested ${needed}, available ${available}`,
    );
  }

  return allocations;
}
```

**Critical note on branchId filter:** The `inventoryBatches` table links to `storageLocations`, not directly to branches. The chain is: `inventoryBatches.locationId → storageLocations.warehouseId → warehouses.branchId`. Phase 2 should join through this chain to filter by branch. If a batch has `locationId = null`, it is branch-agnostic and may appear in results. The planner must decide: enforce branch filter via join, or accept null-location batches for the branch. Recommended: require locationId to be non-null via the filter (add `isNotNull(schema.inventoryBatches.locationId)` and join to warehouses).

### Pattern 4: Schedule H Gate

```typescript
// Inside the transaction, before FEFO selection
for (const item of dto.items) {
  const medicine = await tx.query.medicines.findFirst({
    where: eq(schema.medicines.id, item.medicineId),
    columns: { scheduleClass: true, requiresPrescription: true, isActive: true },
  });

  if (!medicine || !medicine.isActive) {
    throw new NotFoundException(`Medicine ${item.medicineId} not found or inactive`);
  }

  const isControlled = ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"].includes(
    medicine.scheduleClass ?? ""
  ) || medicine.requiresPrescription;

  if (isControlled) {
    if (!dto.prescriptionId && !dto.overrideReason) {
      throw new UnprocessableEntityException(
        `Medicine ${item.medicineId} requires a verified prescription or manager override`,
      );
    }
    if (dto.prescriptionId) {
      // Validate prescription
      const rx = await tx.query.prescriptions.findFirst({
        where: eq(schema.prescriptions.id, dto.prescriptionId),
        columns: { status: true, expiryDate: true },
      });
      if (!rx || rx.status !== "verified") {
        throw new UnprocessableEntityException("Linked prescription is not verified");
      }
      if (rx.expiryDate < today) {
        throw new UnprocessableEntityException("Linked prescription has expired");
      }
    }
    if (dto.overrideReason && dto.overriddenBy) {
      // Validate overriddenBy user role
      const approver = await tx.query.users.findFirst({
        where: eq(schema.users.id, dto.overriddenBy),
        columns: { role: true },
      });
      const allowedRoles = ["pharmacist", "admin", "super_admin"];
      if (!approver || !allowedRoles.includes(approver.role)) {
        throw new UnprocessableEntityException("Override approver must be pharmacist or admin");
      }
    }
  }
}
```

### Pattern 5: Split Payment Validation

```typescript
// Before the transaction — fail fast on math error
const paymentTotal = dto.payments.reduce(
  (sum, p) => new Decimal(sum).plus(p.amount).toNumber(),
  0,
);
// Use Decimal.js comparison to avoid float equality issues
if (!new Decimal(paymentTotal).equals(new Decimal(invoiceTotal))) {
  throw new UnprocessableEntityException(
    `Payment total ${paymentTotal} does not match invoice total ${invoiceTotal}`,
  );
}
```

### Pattern 6: Return Invoice Flow

```typescript
// BillingService.createReturn(originalInvoiceId, dto, staffId)
// 1. Load original invoice with items
const original = await this.repo.findById(originalInvoiceId);
if (!original || original.status !== "confirmed") {
  throw new UnprocessableEntityException("Only confirmed invoices can be returned");
}

// 2. For each return item, compute already-returned qty
//    by summing salesInvoiceItems.quantity WHERE invoiceId IN
//    (SELECT id FROM salesInvoices WHERE originalInvoiceId = X AND isReturn = true)
// 3. Validate returnQty <= originalQty - alreadyReturnedQty
// 4. Inside transaction:
//    a. Restock each batch: adjustQuantity(batchId, +returnQty, tx) — no lock needed for positive
//    b. Log stock movement type = 'return'
//    c. Insert return salesInvoice with isReturn=true, originalInvoiceId, totalAmount = negative
//    d. Insert return salesInvoiceItems
//    e. Insert payment row with negative amount (refund) linked to return invoice
```

### Anti-Patterns to Avoid

- **Client-supplied batchId in new CreateInvoiceDto:** Remove from the items schema entirely — server owns FEFO selection.
- **Client-supplied unitPrice trusted at checkout:** BILL-07 requires server re-fetch. Use `mrpAtEntry` from the batch record selected by FEFO, not the value in the request body.
- **Float arithmetic for payment total comparison:** Always use `new Decimal(a).equals(new Decimal(b))` — never `a === b` on numbers derived from string numerics.
- **Reading prescription outside transaction:** The prescription status could change between a pre-flight check and the transaction write. Validate prescription inside the transaction.
- **Multiple database calls per line item in a loop:** Pre-load all medicines and prescriptions in batch queries before the item loop to avoid N+1 queries.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GST split arithmetic | Custom CGST/SGST/IGST math | `TaxService.calculateLineTax()` | Already correct with Decimal.js; interState flag ready to wire |
| Invoice sequence | SELECT MAX()+1 or UUID | `BillingRepository.nextInvoiceNumber()` | Redis INCR is atomic; already implemented |
| DB transaction | Nested try/catch with rollback | `this.drizzle.db.transaction()` | Drizzle handles rollback on thrown exception |
| Negative stock guard | Read then write | optimistic lock WHERE quantity >= X | Read-then-write has a race window under concurrent load |
| Payment total math | `payments.reduce((s,p) => s + parseFloat(p.amount), 0)` | `new Decimal(sum).plus(p.amount)` | Float accumulation drifts; Decimal.js is installed |

**Key insight:** The codebase has all the right primitives. The rewrite is primarily about wiring them together in the correct order inside a single transaction, removing client-trusted inputs (batchId, unitPrice), and adding the missing validation logic (Schedule H, payment sum).

---

## Common Pitfalls

### Pitfall 1: Invoice Status Enum Mismatch

**What goes wrong:** The current `BillingService.create()` sets `status: "confirmed"` directly. The `invoiceStatusEnum` in `enums.ts` has values: `draft, confirmed, paid, partially_paid, refunded, cancelled`. The CONTEXT.md success criteria say "status = confirmed". These must match exactly.
**Why it happens:** Enum values in Postgres are case-sensitive; any mismatch causes a DB-level error.
**How to avoid:** Always use the enum literal strings as defined in `backend/src/database/schema/enums.ts`. Do not invent new status values.
**Warning signs:** Drizzle insert throws a type error at compile time if the string doesn't match the enum definition.

### Pitfall 2: Branch State Column Does Not Exist

**What goes wrong:** BILL-03 requires inter-state detection from `branch.state` vs `patient.state`. Inspection of `backend/src/database/schema/distribution.ts` confirms the `branches` table has no `state` column — only `name, code, address (text), phone, email`. The `patients` table in `billing.ts` has no `state` column either (only `address (text)`).
**Why it happens:** The initial schema stored address as a single text blob, not structured fields.
**How to avoid:** The migration for Phase 2 must add a `state` column to `branches` (varchar, nullable). For patients, a `state` column (varchar, nullable) is also needed. For the Phase 2 migration, walk-in invoices default to intra-state (CONTEXT.md approved this simplification). Patient state can be null → intra-state. Branch state populated via seed update.
**Warning signs:** Any code that accesses `branch.state` or `patient.state` will fail at compile time with a Drizzle type error until the migration and schema files are updated.

### Pitfall 3: Optimistic Lock Returns Undefined, Not an Error

**What goes wrong:** `BatchRepository.adjustQuantity()` returns `undefined` when the WHERE guard fails (0 rows updated). The current code checks `if (!updated)` but the check is against the destructured first element. If the developer expects a thrown exception from Drizzle, they will miss the failure.
**Why it happens:** Drizzle's `.returning()` returns an empty array when 0 rows match — it does not throw. The caller must check `updated === undefined` and throw manually.
**How to avoid:** Always check the returned array length after an optimistic-lock UPDATE. The new `selectBatchesForDispense` loop deducts batch-by-batch and must check each deduction result individually.

### Pitfall 4: FEFO Batch Selection Must Run Inside the Transaction

**What goes wrong:** Running `selectBatchesForDispense` before the transaction (for a "pre-flight check") and then deducting inside the transaction creates a race window. Between the pre-flight read and the actual deduction, another request could deplete the batch.
**Why it happens:** Developers split pre-validation from transaction execution for readability.
**How to avoid:** Pass the transaction handle `tx` into `selectBatchesForDispense`. The entire sequence — select batches, deduct, write invoice — must be inside the same `tx`.
**Warning signs:** If the FEFO selection query runs without a `tx` parameter, it's outside the transaction.

### Pitfall 5: Return Item "Already Returned" Tracking

**What goes wrong:** To enforce `returnQty <= originalQty - alreadyReturnedQty`, the service must query all prior return invoices linked to `originalInvoiceId`. If this query is missing, the system allows returning more units than were originally sold.
**Why it happens:** The return flow is easy to implement for first returns; the partial/cumulative case is an afterthought.
**How to avoid:** Add `BillingRepository.findReturnedQuantities(originalInvoiceId)` that returns a map of `invoiceItemId → totalReturnedQty` by summing across all existing return invoices. Always call this before accepting a return request.
**Warning signs:** The return endpoint works for the first return but allows a second return of the same item without error.

### Pitfall 6: isReturn and originalInvoiceId Columns Missing from Schema

**What goes wrong:** The CONTEXT.md states "both columns already exist in schema" but inspection of `billing.ts` confirms they do NOT exist. `salesInvoices` schema in the codebase has no `isReturn` or `originalInvoiceId` column. This is a required schema migration for Phase 2.
**Why it happens:** CONTEXT.md's code context section appears to have been written optimistically. The actual billing.ts schema was read directly and these columns are absent.
**How to avoid:** Add `isReturn boolean default false` and `originalInvoiceId uuid references salesInvoices.id nullable` to `salesInvoices` via a new Drizzle migration before implementing the return flow.
**Warning signs:** TypeScript will error on any reference to `schema.salesInvoices.isReturn` until the migration and schema file are updated.

---

## Schema Migration Plan

This is what the Phase 2 migration must add to `salesInvoices` and `branches`/`patients`:

```sql
-- salesInvoices: override + return columns
ALTER TABLE "sales_invoices"
  ADD COLUMN "is_return" boolean NOT NULL DEFAULT false,
  ADD COLUMN "original_invoice_id" uuid REFERENCES "sales_invoices"("id"),
  ADD COLUMN "override_reason" text,
  ADD COLUMN "overridden_by" uuid REFERENCES "users"("id");

-- branches: state for inter-state GST detection
ALTER TABLE "branches"
  ADD COLUMN "state" varchar(100);

-- patients: state for inter-state GST detection
ALTER TABLE "patients"
  ADD COLUMN "state" varchar(100);
```

Drizzle schema file changes needed:
- `backend/src/database/schema/billing.ts`: Add `isReturn`, `originalInvoiceId`, `overrideReason`, `overriddenBy` to `salesInvoices` table definition. Add relations for `originalInvoice` self-reference.
- `backend/src/database/schema/distribution.ts`: Add `state` column to `branches`.
- `backend/src/database/schema/billing.ts`: Add `state` column to `patients`.

---

## DTO Changes Required (packages/types)

### packages/types/src/dtos/invoice.dto.ts — Replace entirely

Current `createInvoiceSchema` has `batchId` on items (client-supplied, now server-managed) and no `payments[]` or override fields.

New `createInvoiceSchema`:
```typescript
export const invoiceItemSchema = z.object({
  medicineId: z.string().uuid(),
  quantity: z.number().int().min(1),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  // batchId REMOVED — server performs FEFO
  // unitPrice REMOVED — server re-fetches from DB (BILL-07)
  // taxPct REMOVED — server reads from medicines.taxPercent
});

export const paymentEntrySchema = z.object({
  mode: z.enum(["cash", "card", "upi", "insurance", "credit"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  referenceNo: z.string().max(100).optional(),
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  notes: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
  payments: z.array(paymentEntrySchema).min(1),
  // Override fields (optional — only required when overriding Schedule H gate)
  overrideReason: z.string().min(1).optional(),
  overriddenBy: z.string().uuid().optional(),
});
```

New `returnInvoiceSchema`:
```typescript
export const returnItemSchema = z.object({
  invoiceItemId: z.string().uuid(),
  returnQty: z.number().int().min(1),
});

export const returnInvoiceSchema = z.object({
  items: z.array(returnItemSchema).min(1),
  reason: z.string().min(1),
});
```

Export these from `packages/types/src/index.ts` alongside the existing exports.

---

## BillingService.create() Rewrite Map

What the current `create()` does vs what Phase 2 needs:

| Step | Current | Phase 2 |
|------|---------|---------|
| Input | items[] with batchId + unitPrice + taxPct (client-trusted) | items[] with medicineId + quantity + discountPct only |
| Schedule H check | None | Gate: check scheduleClass/requiresPrescription, validate rx or override |
| Batch selection | Client provides batchId | `batchRepo.selectBatchesForDispense()` inside tx — FEFO |
| Price source | `item.unitPrice` from request | `batch.mrpAtEntry` from FEFO selection |
| Tax rate source | `item.taxPct` from request | `medicine.taxPercent` from DB |
| GST split | TaxService called but interState not wired; cgstAmt/sgstAmt/igstAmt not written | Wire interState flag; write all three amounts per line |
| Payment | `dto.paymentMode` single enum | `dto.payments[]` array; create payment rows; update amountPaid/amountDue |
| Invoice status | "confirmed" | "confirmed" (no change) |
| Override storage | Not present | Write overrideReason + overriddenBy to salesInvoices if present |
| Transaction scope | Stock deduct + invoice write | Adds: rx validation, FEFO read, override validation, payment rows |

---

## Inter-State Detection Implementation

Since the `branches.state` and `patients.state` columns must be added via migration, the detection logic within `BillingService.create()` is:

```typescript
// Inside the transaction, after loading branch and patient
const [branchRow] = await tx
  .select({ code: schema.branches.code, state: schema.branches.state })
  .from(schema.branches)
  .where(eq(schema.branches.id, dto.branchId));

let interState = false;
if (dto.patientId) {
  const [patientRow] = await tx
    .select({ state: schema.patients.state })
    .from(schema.patients)
    .where(eq(schema.patients.id, dto.patientId));

  if (patientRow?.state && branchRow?.state) {
    interState = patientRow.state.trim().toLowerCase() !== branchRow.state.trim().toLowerCase();
  }
  // null patient state or null branch state → default intra-state
}
// Walk-in (no patientId) → interState remains false
```

---

## Module Import Changes

`BillingModule` (`billing.module.ts`) currently imports `RedisModule` and provides `BatchRepository` and `StockMovementRepository` directly. No new module imports are needed for Phase 2. The module is already wired correctly. Adding the new methods (`selectBatchesForDispense`, `createReturn`) does not require module changes.

The controller needs two new routes:
1. Existing `POST /billing/invoices` — update to parse new `createInvoiceSchema`
2. New `POST /billing/invoices/:id/return` — parse `returnInvoiceSchema`

---

## Code Examples

### Exact Drizzle optimistic lock pattern for deduction

```typescript
// Source: analysis of existing BatchRepository.adjustQuantity() + CONTEXT.md decision
// Use inside tx; do NOT call adjustQuantity() directly (it has the old pattern)
const [deducted] = await tx
  .update(schema.inventoryBatches)
  .set({
    quantity: sql`${schema.inventoryBatches.quantity} - ${allocate}`,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(schema.inventoryBatches.id, batchId),
      gte(schema.inventoryBatches.quantity, allocate),
    )
  )
  .returning({ id: schema.inventoryBatches.id });

if (!deducted) {
  throw new UnprocessableEntityException(
    `Concurrent depletion: batch ${batchId} no longer has ${allocate} units`,
  );
}
```

### Writing GST amounts to salesInvoiceItems

```typescript
// Source: TaxService.calculateLineTax() return shape + billing.ts schema
const { lineTotal, taxAmount, breakdown } = this.taxService.calculateLineTax(
  unitPrice,      // from batch.mrpAtEntry
  allocation.allocate,
  parseFloat(item.discountPct ?? "0"),
  medicine.taxPercent,  // from DB, not client
  interState,
);

itemsData.push({
  medicineId: item.medicineId,
  batchId: allocation.batchId,
  quantity: allocation.allocate,
  unitPrice: String(unitPrice),
  discountPct: item.discountPct ?? "0",
  taxPct: String(medicine.taxPercent),
  lineTotal: lineTotal.toFixed(2),
  cgstAmt: breakdown.cgst.toFixed(2),    // writes to cgst_amt column
  sgstAmt: breakdown.sgst.toFixed(2),    // writes to sgst_amt column
  igstAmt: breakdown.igst.toFixed(2),    // writes to igst_amt column
});
```

### Payment rows insert inside transaction

```typescript
// Source: existing BillingRepository.recordPayment() pattern
// All payment inserts happen inside the same tx as invoice creation
for (const p of dto.payments) {
  await tx.insert(schema.payments).values({
    invoiceId: invoice.id,
    amount: p.amount,
    mode: p.mode as any,
    referenceNo: p.referenceNo,
    processedBy: staffId,
  });
}
// Update invoice amountPaid = totalAmount (since sum is validated == totalAmount)
await tx.update(schema.salesInvoices)
  .set({ amountPaid: invoice.totalAmount, amountDue: "0.00" })
  .where(eq(schema.salesInvoices.id, invoice.id));
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SELECT COUNT+1 invoice number | Redis INCR (atomic) | Phase 1 | No race condition — already in place |
| Client supplies batchId | Server FEFO selection | Phase 2 | BILL-06 compliance; clients simplified |
| Client supplies unitPrice | Server reads mrpAtEntry | Phase 2 | BILL-07 compliance; price manipulation impossible |
| Single paymentMode enum on invoice | payments[] array | Phase 2 | BILL-09 split payment support |
| No Schedule H gate | Schedule H soft block with override | Phase 2 | BILL-04 compliance |
| cgstAmt/sgstAmt/igstAmt columns unused | Written per line item | Phase 2 | BILL-01/BILL-02 compliance |

---

## Open Questions

1. **branchId filter in selectBatchesForDispense**
   - What we know: `inventoryBatches.locationId → storageLocations.warehouseId → warehouses.branchId` is the join chain; `locationId` is nullable on `inventoryBatches`
   - What's unclear: Should batches with `locationId = null` be treated as available to any branch, or should they be excluded?
   - Recommendation: For Phase 2, require `locationId NOT NULL` and join to warehouses for branch filter. Null-location batches are excluded until they are assigned a location. This is safer for multi-branch correctness.

2. **unitPrice source for POS**
   - What we know: BILL-07 says "server re-fetches unitPrice from DB at finalization"; `inventoryBatches.mrpAtEntry` is the per-batch MRP; `medicines.priceMrp` is the global MRP
   - What's unclear: Should the invoice line use `mrpAtEntry` (batch-level, reflects price at time of GRN) or `medicines.priceMrp` (current global)?
   - Recommendation: Use `mrpAtEntry` from the selected batch. This is the price actually paid when the batch was received, which is what FEFO-based cost tracking requires.

3. **Payment mode 'mixed' enum value**
   - What we know: `paymentModeEnum` includes "mixed" as a valid value; the invoice-level `paymentMode` column defaults to "cash"
   - What's unclear: Since Phase 2 uses a `payments[]` array, the invoice-level `paymentMode` column becomes redundant for split payments
   - Recommendation: Set invoice-level `paymentMode = "mixed"` when `payments.length > 1`, otherwise use the single payment's mode. This preserves backward compatibility with existing queries that filter by paymentMode.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. Include validation section.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 1.5.0 |
| Config file | none detected — `vitest` runs via `"test": "vitest run"` in backend/package.json; uses default config (looks for `*.test.ts`, `*.spec.ts` in src/) |
| Quick run command | `pnpm --filter backend test` |
| Full suite command | `pnpm --filter backend test` |

No test files currently exist (`vitest` is installed but zero spec files found). All test infrastructure must be created in Wave 0.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-01 | Decimal.js arithmetic — no float drift | unit | `pnpm --filter backend test -- --reporter=verbose` | Wave 0 |
| BILL-02 | cgstAmt/sgstAmt/igstAmt written per line | integration | `pnpm --filter backend test` | Wave 0 |
| BILL-03 | Inter-state → igstAmt non-zero; intra-state → cgstAmt+sgstAmt non-zero | unit (TaxService) | `pnpm --filter backend test` | Wave 0 |
| BILL-04 | Schedule H + no rx → 422; Schedule H + verified rx → 201 | integration | `pnpm --filter backend test` | Wave 0 |
| BILL-05 | Two concurrent requests for last unit → one success, one 422 | integration (concurrent) | manual curl test per success criteria | Wave 0 |
| BILL-06 | FEFO: older batch deducted first | unit (BatchRepository) | `pnpm --filter backend test` | Wave 0 |
| BILL-07 | Client-supplied price ignored; mrpAtEntry used | unit (BillingService) | `pnpm --filter backend test` | Wave 0 |
| BILL-08 | Single transaction atomicity | integration | manual DB state inspection | Wave 0 |
| BILL-09 | Payments sum != total → 422; sum == total → 201 | unit | `pnpm --filter backend test` | Wave 0 |
| BILL-10 | Return restocks batch + creates refund payment | integration | `pnpm --filter backend test` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter backend test`
- **Per wave merge:** `pnpm --filter backend test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `backend/src/modules/billing/__tests__/tax.service.spec.ts` — covers BILL-01, BILL-03 (unit tests for TaxService.calculateLineTax with interState flag)
- [ ] `backend/src/modules/inventory/__tests__/batch.repository.spec.ts` — covers BILL-06 (FEFO accumulator logic)
- [ ] `backend/src/modules/billing/__tests__/billing.service.spec.ts` — covers BILL-04, BILL-07, BILL-09 (service unit tests with mocked repos)
- [ ] `backend/vitest.config.ts` — configure test root to `src/`, exclude `dist/`
- [ ] Framework install: vitest already installed (`vitest ^1.5.0` in devDependencies) — no install needed

---

## Sources

### Primary (HIGH confidence)

- Direct file read: `backend/src/modules/billing/billing.service.ts` — current checkout flow
- Direct file read: `backend/src/modules/billing/billing.repository.ts` — Redis invoice number, createInvoiceWithItems
- Direct file read: `backend/src/modules/billing/tax.service.ts` — TaxService.calculateLineTax with Decimal.js
- Direct file read: `backend/src/modules/inventory/batch.repository.ts` — adjustQuantity, findExpiringBatches
- Direct file read: `backend/src/modules/inventory/stock-movement.repository.ts` — log() with tx context
- Direct file read: `backend/src/database/schema/billing.ts` — confirmed cgstAmt/sgstAmt/igstAmt exist; confirmed isReturn/originalInvoiceId do NOT exist
- Direct file read: `backend/src/database/schema/inventory.ts` — confirmed reservedQty exists; FEFO join chain via locationId → storageLocations → warehouses
- Direct file read: `backend/src/database/schema/distribution.ts` — confirmed branches has NO state column
- Direct file read: `backend/src/database/schema/enums.ts` — exact enum values for invoiceStatus, paymentMode, batchStatus, userRole, prescriptionStatus
- Direct file read: `backend/src/database/schema/prescriptions.ts` — confirmed prescriptions.expiryDate (date column) and prescriptions.status uses prescriptionStatusEnum with 'verified' value
- Direct file read: `backend/drizzle/migrations/0001_keen_dagger.sql` — confirmed Phase 1 migration applied cgstAmt/sgstAmt/igstAmt and reservedQty
- Direct file read: `packages/types/src/dtos/invoice.dto.ts` — current CreateInvoiceDto shape (batchId present; needs removal)
- Direct file read: `backend/src/modules/billing/billing.module.ts` — module wiring; no new imports needed
- Direct file read: `backend/package.json` — vitest 1.5.0 installed, zero test files exist

### Secondary (MEDIUM confidence)

- CONTEXT.md locked decisions — all implementation choices verified against actual codebase state
- REQUIREMENTS.md BILL-01 through BILL-10 — cross-referenced with schema and service code

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified by direct file reads; all required packages installed
- Schema gap analysis: HIGH — compared CONTEXT.md claims against actual schema files; found two discrepancies (isReturn/originalInvoiceId absent; branches.state absent)
- Architecture patterns: HIGH — based on established codebase patterns confirmed by reading source files
- Pitfalls: HIGH — identified from direct code inspection (adjustQuantity pattern, missing columns, null locationId)
- Validation architecture: MEDIUM — vitest installed but no existing test files to verify config

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (stable codebase, low churn risk)
