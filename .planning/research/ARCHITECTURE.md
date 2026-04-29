# Architecture Patterns

**Domain:** Indian Pharmacy ERP — POS, Billing, Inventory, Background Jobs
**Researched:** 2026-04-28
**Confidence:** HIGH — based on direct codebase analysis, not speculation

---

## Recommended Architecture

The existing NestJS + Drizzle + Next.js structure is sound. The architecture problem is not the layering — it is the **gaps and race conditions within that layering**. The sections below define what the complete architecture should look like, including the missing pieces.

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `BillingController` | HTTP routing, Zod validation, role enforcement | `BillingService` |
| `BillingService` | Checkout orchestration, rule enforcement (Rx check, price re-fetch), GST pipeline, transaction coordination | `BillingRepository`, `BatchRepository`, `StockMovementRepository`, `TaxService`, `PrescriptionService`, `RedisService` |
| `BillingRepository` | Invoice and payment CRUD, invoice number generation | PostgreSQL via Drizzle |
| `TaxService` | Line-level and invoice-level GST calculation (CGST/SGST/IGST split) | None (pure stateless) |
| `InventoryService` | FEFO batch selection, stock adjustment orchestration | `BatchRepository`, `StockMovementRepository` |
| `BatchRepository` | Batch CRUD, atomic quantity adjustment (`UPDATE ... WHERE qty >= abs(delta)`), expiry queries | PostgreSQL via Drizzle |
| `StockMovementRepository` | Append-only ledger inserts, movement queries | PostgreSQL via Drizzle |
| `PrescriptionService` | Prescription verification, validity checks, refill tracking | `PrescriptionsRepository`, MinIO |
| `ReportsService` | SQL aggregation queries, CSV streaming, async PDF dispatch | PostgreSQL, BullMQ, MinIO |
| `ExpiryScanProcessor` (Bull) | Nightly: marks expired batches, logs write-offs, collects alert payloads | `BatchRepository`, `StockMovementRepository` |
| `ReorderCheckProcessor` (Bull) | Periodic: finds low-stock medicines, triggers notifications | `InventoryRepository` |
| `NotificationProcessor` (Bull) (missing) | Sends SMS/email for expiry and reorder alerts | MSG91 or equivalent |
| `PdfGeneratorProcessor` (Bull) (missing) | Async invoice PDF generation → MinIO | MinIO, invoice data |
| `RedisService` | Invoice sequence counter (INCR), product barcode cache, session cache | Redis 7 |
| POS frontend (`cart.store.ts`) | Client-side cart state, local GST pre-calculation for display | `BillingService` API |
| `useBarcodeScannerHook` (missing) | Rapid keypress detection, barcode buffer | POS page component |
| Next.js middleware | Edge JWT verification, route protection | `jose` library |

---

## Data Flow

### 1. POS Checkout — Complete Flow (Current State + What Must Be Added)

```
[Cashier scans barcode]
        |
        v
[Frontend: useBarcodeScanner hook (keypress buffer, <50ms gap = scanner)]
        |
        v
[GET /api/v1/inventory/medicines/barcode/:code?branchId=X]
  -- Redis cache check first: key=product:barcode:{code}:{branchId}, TTL 5min
  -- On miss: DB query + cache set
        |
        v
[Frontend: GET /api/v1/inventory/batches?medicineId=X (FEFO order, expiryDate ASC)]
  -- Returns batches with qty > 0, status=active, ordered oldest-expiry-first
  -- Frontend selects batches greedily from top (FEFO client-side pre-selection)
        |
        v
[Frontend: cart.store.ts addItem() -- local state only, calcLine() for display]
  NOTE: No stock reservation yet. This is the MISSING PIECE (CONCERNS.md #2).
        |
        v
[Cashier clicks Checkout -> payment-modal opens]
        |
        v
[POST /api/v1/billing/invoices]
  Body: { items[{medicineId, batchId, quantity, unitPrice, discountPct, taxPct}],
          patientId?, branchId, prescriptionId?, paymentMode, discountAmount? }
        |
        v
[BillingService.create()]
  Step 1: For each item with requiresRx=true or scheduleClass=SCHEDULE_H/H1/X:
           Verify invoice.prescriptionId exists
           Call PrescriptionService.checkValidity(prescriptionId)
             -- validUntil >= today AND refillCount < maxRefills AND status=VERIFIED
           If fails: throw 400 MISSING_VALID_PRESCRIPTION
           [CURRENTLY MISSING -- must be added]

  Step 2: Re-fetch unit prices from DB for each medicineId
           Do NOT trust client-supplied unitPrice for financial totals
           [CURRENTLY MISSING -- CONCERNS.md security risk #6]

  Step 3: TaxService.calculateLineTax() per item
           interState = (branch.state !== patient.state) ?? false
           lineTotal = (unitPrice * qty) - discount + GST
           breakdown = { cgst, sgst, igst } based on interState flag

  Step 4: TaxService.aggregateInvoiceTotals() -- subtotal, taxAmount, totalAmount

  Step 5: RedisService.INCR("invoice_seq:{branchId}") -- atomic sequence
           Format invoice number: {BRANCHCODE}-{YYYYMMDD}-{SEQ5}
           [CURRENTLY: non-atomic COUNT()+1 -- race condition, must be fixed]

  Step 6: drizzle.db.transaction(async (tx) => {
           FOR each line item:
             a. BatchRepository.adjustQuantity(batchId, -qty, tx)
                -- Uses: UPDATE inventory_batches
                         SET quantity = quantity + delta
                         WHERE id = ? AND quantity >= abs(delta)  [anti-overdraw guard]
                -- If returns undefined: throw 422 INSUFFICIENT_STOCK
             b. StockMovementRepository.log({..., referenceType:'invoice'}, tx)
                -- referenceId must be set to invoice.id AFTER insert
                -- workaround: insert movements after invoice insert, still in tx
           c. BillingRepository.createInvoiceWithItems(invoiceData, itemsData, tx)
           d. Insert payments records (tx)
           e. If patient exists: update loyaltyPoints += floor(totalAmount/100)
           })

  Step 7: Dispatch jobs (fire-and-forget, outside transaction):
           BullMQ queue 'pdf-generation': { invoiceId }
           BullMQ queue 'notification': { type:'INVOICE_CREATED', invoiceId, patientId }
```

### 2. FEFO Batch Selection Algorithm

FEFO (First Expiry First Out) is partially implemented. The complete algorithm:

```
FUNCTION selectBatchesForSale(medicineId, branchId, requestedQty):
  batches = SELECT id, batchNo, expiryDate, quantity
             FROM inventory_batches
             WHERE medicine_id = medicineId
               AND status = 'active'
               AND expiry_date > CURRENT_DATE
               AND quantity > 0
             ORDER BY expiry_date ASC   -- FEFO ordering
             FOR UPDATE SKIP LOCKED     -- [MISSING] prevents concurrent oversell

  allocated = []
  remaining = requestedQty

  FOR batch IN batches:
    take = MIN(batch.quantity, remaining)
    allocated.push({ batchId: batch.id, batchNo: batch.batchNo,
                     expiryDate: batch.expiryDate, qty: take })
    remaining -= take
    IF remaining == 0: BREAK

  IF remaining > 0:
    THROW InsufficientStockException(available = requestedQty - remaining)

  RETURN allocated   -- may span multiple batches

NOTE: FOR UPDATE SKIP LOCKED is the correct isolation pattern. The existing
      adjustQuantity() WHERE guard (qty >= delta) catches concurrent oversell
      at the UPDATE level, which is acceptable for now but produces 422 errors
      rather than clean split-batch selection. The SKIP LOCKED approach is
      cleaner and should be added in the billing transaction.
```

Current code in `inventory.repository.ts:getActiveBatchesForDispense()` does the ORDER BY correctly but without locking. The billing service performs the adjustQuantity per-batch inside a transaction, so the WHERE qty >= delta guard is the active safety mechanism. This is adequate for low concurrency but will produce 422 errors under concurrent load — the FOR UPDATE SKIP LOCKED pattern resolves this cleanly.

### 3. GST Computation Pipeline

```
[Per line item]
unitPrice (from DB, not client)
  -> gross = unitPrice * quantity
  -> discountAmount = gross * (discountPct / 100)
  -> taxableAmount = gross - discountAmount
  -> totalTax = taxableAmount * (taxPct / 100)
  -> interState? igst=totalTax, cgst=0, sgst=0
               : cgst=totalTax/2, sgst=totalTax/2, igst=0
  -> lineTotal = taxableAmount + totalTax

[Invoice aggregation]
subtotal = SUM(taxableAmount per line)
totalCgst = SUM(cgst per line)
totalSgst = SUM(sgst per line)
totalIgst = SUM(igst per line)
totalTax = totalCgst + totalSgst + totalIgst
preTotalAmount = subtotal + totalTax
invoiceDiscount = preTotalAmount * (invoiceDiscountPct / 100)  OR fixed amount
roundOff = ROUND(preTotalAmount - invoiceDiscount) - (preTotalAmount - invoiceDiscount)
totalAmount = ROUND(preTotalAmount - invoiceDiscount)

NOTE: The existing TaxService is correct in structure but:
  1. Does not separate CGST/SGST/IGST in the salesInvoices table columns
     (schema stores single taxAmount, not per-component breakdown -- must be extended)
  2. interState flag is hardcoded to false -- must derive from branch.state vs patient.state
  3. Invoice-level discount applied before rather than after GST -- must be clarified
     (GST is calculated on line-level discounted price; invoice discount is post-GST)
```

### 4. Multi-Branch Data Isolation

All queries that touch branch-specific data must include a `branchId` filter. The pattern:

```
[Request arrives]
  -> JwtAuthGuard extracts user = { id, role, branchId }
  -> For SUPER_ADMIN: branchId can come from query param (branch switching)
  -> For BRANCH_ADMIN, PHARMACIST, CASHIER: branchId is always user.branchId
     (controller must enforce: if user.role != SUPER_ADMIN, override dto.branchId = user.branchId)

[Repository queries]
  -> All inventory queries: WHERE branch_id = ? (via warehouse/location join or direct column)
  -> All invoice queries: WHERE branch_id = ?
  -> All staff queries: WHERE branch_id = ?
  -> Reports: WHERE branch_id = ? unless SUPER_ADMIN requesting aggregate

NOTE: Current schema has inventoryBatches linked to storageLocations -> warehouses -> branchId
      (indirect join path). A direct branchId column on inventory_batches would simplify
      queries and eliminate the join for the most frequent operation (POS stock lookup).
      This is a schema improvement to consider before completing the inventory module.
```

### 5. Async Report Generation

```
[User requests large report]
POST /api/v1/reports/jobs  { reportType, filters, format:'csv'|'pdf' }
  -> BullMQ queue 'report-generation': { jobId, reportType, filters, format, requestedBy }
  -> Return 202 Accepted: { jobId, pollUrl: '/api/v1/reports/jobs/{jobId}' }

[ReportGeneratorProcessor handles job]
  IF format == 'csv':
    Use pg cursor or Drizzle streaming to read rows in chunks (avoid loading all to memory)
    Pipe through csv-stringify transform stream -> MinIO upload (streaming, not buffered)
    On complete: update job status to DONE, set downloadUrl = MinIO signed URL (1hr TTL)

  IF format == 'pdf':
    Generate via @react-pdf/renderer or pdfkit
    For invoice PDF: render invoice template with all items/totals/GST breakdown
    Upload to MinIO: key = invoices/{invoiceId}/{invoiceNo}.pdf
    Update job status to DONE

[Frontend polls GET /api/v1/reports/jobs/{jobId}]
  Returns { status: 'pending'|'done'|'failed', downloadUrl? }
  On 'done': trigger browser download via downloadUrl

ALTERNATIVE for small reports (<1000 rows):
  Synchronous streaming response directly:
  GET /api/v1/reports/sales?format=csv
  Set headers: Content-Type: text/csv, Content-Disposition: attachment
  Stream directly from DB cursor without BullMQ overhead
  Use for: daily summary, stock value, single-month GSTR-1
```

### 6. Background Job Patterns

The codebase uses `@nestjs/bull` (Bull 4.x, not BullMQ). The processors are registered correctly. What is incomplete:

```
[Scheduler setup -- MISSING]
  NestJS ScheduleModule (@nestjs/schedule) must be imported in AppModule
  Inject Bull queue in a ScheduleService:
    @Cron('0 0 * * *')   -- midnight daily
    async scheduleExpiryScan() {
      await this.expiryScanQueue.add('scan', {}, { removeOnComplete: true })
    }

    @Cron('0 */6 * * *') -- every 6 hours
    async scheduleReorderCheck() {
      await this.reorderCheckQueue.add('check', {}, { removeOnComplete: true })
    }

[ExpiryScanProcessor -- existing, complete]
  1. markExpiredBatches() -- UPDATE WHERE expiry_date < today AND status = 'active'
  2. For each expired batch with qty > 0:
       StockMovementRepository.log(expiry_write_off, -qty)
       BatchRepository.adjustQuantity(id, -qty)
  3. findExpiringBatches(30) + findExpiringBatches(90) for alert payloads
  MISSING: After step 3, must push notification jobs to notification queue

[ReorderCheckProcessor -- existing, stub]
  1. getLowStockMedicines() -- already implemented
  MISSING: Push notification jobs, optionally create draft POs

[NotificationProcessor -- MISSING entirely]
  Processes jobs from 'notification' queue
  Job payload: { type, recipients, data }
  Types: EXPIRY_ALERT, REORDER_ALERT, INVOICE_CREATED
  Delivery: SMS via MSG91 API, email via Resend/Nodemailer
  On failure: retry with exponential backoff (Bull built-in: { attempts:3, backoff: exponential })
  On final failure: log to notifications table with status='failed'

[PdfGeneratorProcessor -- MISSING]
  Processes jobs from 'pdf-generation' queue
  Fetches invoice with all items via BillingRepository.findById(invoiceId)
  Generates PDF (pdfkit recommended over puppeteer for server-side -- no headless browser needed)
  Uploads to MinIO: key = invoices/{branchId}/{invoiceId}.pdf
  Updates salesInvoices.pdfUrl column (column must be added to schema)

[Error handling for all processors]
  @Process({ name: 'scan', concurrency: 1 })  -- expiry scan must be single-threaded
  Wrap handler body in try/catch, log with Logger
  Bull's built-in retry handles transient failures
  Dead-letter: Bull's failed jobs queue stores failed jobs for inspection
```

---

## Patterns to Follow

### Pattern 1: Transaction with Tx Propagation

Every multi-step write operation that touches more than one table must run inside a Drizzle transaction. Repository methods accept an optional `tx` parameter.

```typescript
// In BillingService
const result = await this.drizzle.db.transaction(async (tx) => {
  // All repository calls inside here use tx
  await this.batchRepo.adjustQuantity(batchId, -qty, tx);
  await this.movementRepo.log({ ... }, tx);
  return await this.billingRepo.createInvoiceWithItems(invoiceData, items, tx);
});
// Jobs dispatched outside transaction (fire-and-forget)
await this.pdfQueue.add('generate', { invoiceId: result.invoice.id });
```

**Why:** If the invoice insert fails, the batch decrement rolls back. Jobs are dispatched after the transaction commits — never inside, because job workers run asynchronously and cannot be rolled back.

### Pattern 2: Atomic Batch Adjustment with Overdraw Guard

```typescript
// In BatchRepository.adjustQuantity()
UPDATE inventory_batches
SET quantity = quantity + $delta, updated_at = now()
WHERE id = $id
  AND ($delta >= 0 OR quantity >= ABS($delta))  -- overdraw guard
RETURNING id, quantity
-- If returns 0 rows: throw InsufficientStockException
```

This is already implemented correctly in `batch.repository.ts`. The `delta < 0 ? gt(quantity, abs(delta) - 1) : true` WHERE clause is the correct guard. It works because PostgreSQL evaluates the WHERE atomically for each UPDATE.

### Pattern 3: Redis INCR for Invoice Sequencing

```typescript
// In RedisService (or inline in BillingRepository)
const today = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
const key = `invoice_seq:${branchId}:${today}`;
const seq = await redis.incr(key);
await redis.expire(key, 86400 * 2); // 2-day TTL, covers midnight edge
const invoiceNo = `${branchCode}-${today}-${String(seq).padStart(5, '0')}`;
```

The current `COUNT(*) + 1` approach in `billing.repository.ts` is a race condition. Redis INCR is atomic. The key must be namespaced by branchId AND date to isolate sequences per branch per day.

### Pattern 4: Streaming CSV Response for Reports

```typescript
// In ReportsController
@Get('sales')
async salesReport(@Query() query: ReportQueryDto, @Res() res: FastifyReply) {
  if (query.format === 'csv') {
    res.raw.setHeader('Content-Type', 'text/csv');
    res.raw.setHeader('Content-Disposition', `attachment; filename="sales-${query.from}-${query.to}.csv"`);
    
    // Stream from DB using cursor (Drizzle does not have native cursor streaming;
    // use pg.cursor from node-postgres directly for large datasets)
    const cursor = pgClient.query(new Cursor(salesQuery, params));
    const csvStream = csv.format({ headers: true });
    csvStream.pipe(res.raw);
    
    let batch;
    do {
      batch = await cursor.read(500); // 500 rows at a time
      batch.forEach(row => csvStream.write(row));
    } while (batch.length > 0);
    csvStream.end();
  }
}
```

### Pattern 5: Schedule H Enforcement Gate

```typescript
// In BillingService.create(), before transaction
for (const item of dto.items) {
  const medicine = await this.inventoryRepo.findMedicineById(item.medicineId);
  if (medicine.requiresPrescription || ['SCHEDULE_H','SCHEDULE_H1','SCHEDULE_X'].includes(medicine.scheduleClass)) {
    if (!dto.prescriptionId) {
      throw new BadRequestException(`${medicine.name} requires a valid prescription`);
    }
    const valid = await this.prescriptionService.checkValidity(dto.prescriptionId);
    if (!valid) {
      throw new BadRequestException(`Prescription is expired or fully dispensed`);
    }
  }
}
```

This gate must execute before the Drizzle transaction opens, to fail fast without acquiring DB locks unnecessarily.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Client-Supplied Prices Trusted for Financial Totals

**What goes wrong:** Frontend sends `unitPrice` in the invoice request body. Billing service uses it as-is. A tampered or stale price passes through to the final invoice.

**Why bad:** Financial records are wrong, GST is wrong, audits fail. Legal exposure in India for incorrect GST invoices.

**Instead:** Re-fetch `medicine.priceMrp` (and optionally branch-level selling price) from DB in `BillingService.create()`. Use client-supplied price only as a display hint. Compare and throw if >5% deviation (could indicate stale frontend cache).

### Anti-Pattern 2: Non-Atomic Invoice Sequence Generation

**What goes wrong:** `SELECT COUNT(*) FROM sales_invoices WHERE branch_id=? AND DATE(created_at)=today` then `+1`. Two concurrent requests both read 41, both generate "BRN01-20260428-0042". Unique constraint on `invoice_no` causes one to fail with a 500 error at commit time.

**Why bad:** Lost transaction, customer confusion, non-sequential audit trail, possible legal violation (GST invoice numbering must be sequential and without gaps in India).

**Instead:** Redis INCR with `invoice_seq:{branchId}:{YYYYMMDD}` key. Atomic, per-branch, per-day. No DB round-trip contention.

### Anti-Pattern 3: Jobs Dispatched Inside a Database Transaction

**What goes wrong:** `await this.pdfQueue.add(...)` called inside `drizzle.db.transaction()`. Transaction rolls back. Job was already enqueued. PDF generator tries to fetch invoice that does not exist.

**Why bad:** Ghost jobs, missing-resource errors in workers, misleading logs.

**Instead:** Dispatch jobs after `await drizzle.db.transaction(...)` returns successfully. The jobs reference the now-committed invoice ID.

### Anti-Pattern 4: Expiry Scanner Without Single-Concurrency Guarantee

**What goes wrong:** Two scheduler ticks fire nearly simultaneously (cron drift, restart overlap). Both `markExpiredBatches()` processors run, both find the same batch as "active + past expiry", both log write-off movements for the same quantity. Stock goes doubly negative in movement ledger.

**Why bad:** Movement ledger is append-only and intended as an immutable audit trail. Duplicate write-offs corrupt it.

**Instead:** `@Process({ name: 'scan', concurrency: 1 })` — already in processor signature. Also add Bull job deduplication: `{ jobId: 'expiry-scan-daily', removeOnComplete: true }`. A job with same jobId will not be enqueued if one is already pending/active.

### Anti-Pattern 5: OFFSET Pagination on High-Churn Tables

**What goes wrong:** `SELECT ... LIMIT 20 OFFSET 200` on `sales_invoices` (new records being inserted continuously). Page 11 shows some records from page 10, skips others.

**Why bad:** Cashiers see duplicate or missing invoices in list view. Reports using page-by-page export produce incorrect data.

**Instead:** Cursor-based pagination for `sales_invoices`, `stock_movements`, and `audit_logs`. Use `WHERE created_at < :cursor ORDER BY created_at DESC LIMIT 20`. Return `nextCursor = last_record.created_at` in response.

---

## Component Build Order (Dependencies)

This is the dependency-driven sequence for completing the remaining work:

```
1. Fix infrastructure bugs (no new feature depends on this, but everything breaks without it)
   a. Redis INCR invoice sequence in BillingRepository
   b. Add FOR UPDATE or rely on existing WHERE guard in batch adjustment (acceptable for now)
   c. Fix referenceId not being set in stock_movement during billing

2. Complete TaxService + schema GST columns
   - Add cgst/sgst/igst columns to salesInvoices table (migration required)
   - Extend TaxService to propagate per-component breakdown to invoice record
   - Add interState flag derivation from branch+patient state comparison
   REQUIRED BY: billing finalization, GSTR-1 report

3. Complete PrescriptionService (verification flow, validity check)
   REQUIRED BY: Schedule H gate in BillingService

4. Complete BillingService checkout (Schedule H gate, price re-fetch, GST fix)
   REQUIRED BY: POS terminal, all reports

5. Add @nestjs/schedule cron triggers for existing processors
   REQUIRED BY: expiry alerts, reorder alerts

6. Complete NotificationProcessor (SMS/email delivery)
   REQUIRED BY: expiry alerts, reorder notifications

7. Add PdfGeneratorProcessor + MinIO upload
   REQUIRED BY: invoice PDF endpoint

8. ReportsService (uses billing + inventory data, must be complete first)
   Sub-order: daily summary -> sales trend -> GSTR-1 -> Schedule H register -> ABC analysis

9. POS terminal frontend (depends on all backend endpoints being stable)
   - useBarcodeScanner hook (keypress buffer)
   - cart.store.ts already done, needs prescriptionId field added
   - payment-modal with split payment support
   - invoice-preview with print stylesheet

10. Remaining frontend pages (depend on backend modules being complete)
    Products -> Inventory -> Purchase Orders -> Patients -> Prescriptions -> Staff -> Reports
```

---

## Scalability Considerations

| Concern | At 1 branch / 200 tx/day | At 10 branches / 2000 tx/day | At 50 branches / 20K tx/day |
|---------|--------------------------|------------------------------|-----------------------------|
| Invoice numbering | COUNT+1 has occasional races | Redis INCR required (implement now) | Redis INCR sufficient, no change |
| Batch adjustment lock contention | Minimal with WHERE guard | WHERE guard sufficient | Consider advisory locks per medicine |
| POS product search | ILIKE acceptable (<10K products) | Add pg full-text index (GIN on tsvector) | Elasticsearch integration (Phase 3) |
| Expiry scan query | Runs in <1s | Add index on (status, expiry_date) | Partition inventory_batches by year |
| Report queries | Synchronous fine | Add read replica for reports | ClickHouse (already in docker-compose) |
| Medicine catalog cache | Optional | Redis cache per barcode (5min TTL) | Redis cache is required |
| BullMQ concurrency | Default (1 worker) | Set concurrency=2 per processor | Separate worker dyno per queue |

---

## Existing Architecture: What Works vs. What Needs Work

| Component | Status | Notes |
|-----------|--------|-------|
| NestJS module layering (controller/service/repository) | Working | Good separation, follow it for all new modules |
| Drizzle transaction propagation (tx parameter) | Working | Used correctly in BillingService and BatchService |
| FEFO batch ordering (ORDER BY expiry_date ASC) | Working | Missing FOR UPDATE in concurrent scenario |
| TaxService line calculation | Working | Missing CGST/SGST/IGST column storage and interState logic |
| Bull processor registration | Working | Missing @nestjs/schedule cron to actually enqueue jobs |
| adjustQuantity overdraw guard | Working | The WHERE qty >= abs(delta) guard is correct and active |
| Invoice numbering | Broken (race condition) | Replace COUNT+1 with Redis INCR before v1 |
| Schedule H enforcement | Missing | Gate code must be added to BillingService.create() |
| Price validation at checkout | Missing | Re-fetch from DB, do not trust client price |
| Stock reservation | Missing | Acceptable for v1 low-concurrency; document as known risk |
| NotificationProcessor | Missing stub | Must be built with MSG91 or equivalent |
| PdfGeneratorProcessor | Missing | Must be built before POS sign-off |
| Prescription module | Empty stub | Must be built (verification + validity check) |
| Procurement module | Empty stub | Must be built (GRN creates batches + stock movements) |
| Reports module | Empty stub | Must be built (GSTR-1 + Schedule H register are legally required) |

---

## Sources

- Direct codebase analysis: `backend/src/modules/billing/billing.service.ts`, `billing.repository.ts`, `tax.service.ts`
- Direct codebase analysis: `backend/src/modules/inventory/inventory.repository.ts`, `batch.repository.ts`, `batch.service.ts`, `stock-movement.repository.ts`
- Direct codebase analysis: `backend/src/modules/inventory/jobs/expiry-scan.processor.ts`, `reorder-check.processor.ts`
- Direct codebase analysis: `backend/src/database/schema/billing.ts`, `inventory.ts`
- Direct codebase analysis: `frontend/stores/cart.store.ts`
- `.planning/codebase/CONCERNS.md` — documented bugs and race conditions
- `.planning/PROJECT.md` — constraints and accepted decisions
- PostgreSQL documentation: UPDATE atomicity guarantees (HIGH confidence, well-established behavior)
- Redis INCR documentation: atomic increment guarantee (HIGH confidence)
- NestJS Bull documentation: concurrency and jobId deduplication (MEDIUM confidence — verified against @nestjs/bull 10.x patterns)
