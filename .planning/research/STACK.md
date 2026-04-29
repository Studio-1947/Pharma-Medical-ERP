# Technology Stack

**Project:** MedERP — Pharma POS + ERP (Remaining Phases)
**Researched:** 2026-04-28
**Scope:** Libraries needed to complete billing/POS checkout, PDF invoice generation, Indian GST calculation, browser barcode scanning, offline POS sync, and GSTR-1 compliance reporting.

---

## What Is Already Installed (Do Not Replace)

These are locked decisions. The codebase is brownfield; replacing any of these mid-project costs more than it saves.

| Package | Version | Role |
|---------|---------|------|
| NestJS | 10.3.0 | Backend framework (with Fastify adapter) |
| Next.js | 15.0.0 | Frontend framework (App Router) |
| Drizzle ORM | 0.30.0 | Database queries and schema |
| pdfkit | 0.15.0 | PDF generation — **installed, not yet used** |
| bwip-js | 3.5.0 | Barcode image generation (server-side, PNG) |
| Dexie | 4.0.7 | IndexedDB offline queue — **already wired** |
| bull + @nestjs/bull | 4.12.2 / 10.1.1 | Job queues — installed and active in expiry/reorder workers |
| ioredis | 5.3.2 | Redis client |
| zod + nestjs-zod | 3.23.0 / 3.0.0 | Validation |
| argon2 | 0.31.2 | Password hashing |
| @nestjs/swagger | 7.3.0 | OpenAPI docs |
| zustand | 5.0.0-rc.2 | Frontend state |
| @tanstack/react-query | 5.40.0 | Server state, caching |
| recharts | 2.12.0 | Charts for reports |

---

## Recommended Additions by Domain

### 1. PDF Invoice Generation

**Recommendation: Keep `pdfkit` 0.15.0. Do not add another PDF library.**

Rationale: `pdfkit` is already in `package.json` with types installed. It produces programmatic PDFs with full control over layout — suitable for pharmacy invoices that need specific Indian regulatory formatting (GST breakdown, GSTIN, drug license number, Schedule H annotation). It runs server-side inside the NestJS BullMQ worker, avoiding browser memory pressure.

The alternative `@react-pdf/renderer` (React-based declarative PDF) runs in both browser and server but requires React as a peer dep in the backend, which is undesirable. Puppeteer (headless Chrome) is 300+ MB of Chromium, excessive for invoice generation. `pdf-lib` is for editing existing PDFs, not generating from data.

**Implementation pattern for `InvoicePdfService`:**

```typescript
import PDFDocument from 'pdfkit';
// Stream to MinIO bucket key: invoices/{invoiceId}.pdf
// Then return signed URL from MinIO for download
```

Generate PDF in a Bull worker job (`pdf-generator` queue). The `/billing/invoices/:id/pdf` endpoint enqueues the job and returns a signed MinIO URL. For invoices already generated, return cached URL directly.

**Confidence: HIGH** — package already installed, no install needed.

---

### 2. Indian GST Calculation

**Recommendation: Write it in-house. No external library.**

Rationale: `tax.service.ts` already exists with correct CGST/SGST/IGST split logic. The GST rules for Indian pharmacy are narrow and deterministic: look up GST rate by HSN code from a static table, apply intra/inter-state split, round to 2 decimal places. No Indian GST NPM library has meaningful adoption or maintenance; the few that exist (`gst-india`, `indian-gst`) are unmaintained as of 2024.

The existing `TaxService.calculateLineTax` is correct for line-level tax. What is missing:

1. HSN code-to-GST-rate lookup table (static, baked in as a TypeScript map in `packages/utils/src/gst.ts`). Pharmacy-relevant HSN codes: 3004 (formulations, 5%), 3006 (pharma preparations, 12%), 3002 (blood products, 5%), 9018 (medical instruments, 12%).
2. Rounding rule: Indian GST rounds per line (not per invoice) per GST Council guidance.
3. `calculateInvoiceTotals()` must separate `cgstTotal`, `sgstTotal`, `igstTotal` for GSTR-1 export — the current `taxAmount` aggregation loses this detail.

**What to build:**

```typescript
// packages/utils/src/gst.ts
export const HSN_GST_RATES: Record<string, number> = {
  '3004': 5,   // formulations
  '3006': 12,  // pharma preparations
  '3002': 5,   // blood products / vaccines
  '9018': 12,  // medical devices / instruments
  '3005': 12,  // bandages, dressings
};

export function getGstRateByHsn(hsnCode: string): number {
  // Match on 4-digit prefix
  const prefix = hsnCode.slice(0, 4);
  return HSN_GST_RATES[prefix] ?? 12; // default 12% if unknown
}

export function splitGst(taxableAmount: number, gstRate: number, interState: boolean) {
  const total = Math.round(taxableAmount * gstRate) / 100;
  if (interState) return { cgst: 0, sgst: 0, igst: total };
  const half = Math.round(total * 100) / 200; // round each leg independently
  return { cgst: half, sgst: half, igst: 0 };
}
```

**Confidence: HIGH** — deterministic logic, no external dependency needed.

---

### 3. Browser Barcode Scanning (POS Terminal)

**Recommendation: `@zxing/browser` 0.1.5 — add to frontend.**

The current POS terminal (`pos-terminal.tsx`) treats the barcode scanner as a keyboard device: the cashier types or a USB/Bluetooth HID barcode scanner emits keypresses ending in Enter. This works for plug-in USB scanners (common in Indian pharmacy counters) and needs no additional library for that path.

However, the CLAUDE.md spec calls for a camera-based barcode scan as well (for prescription image upload and product lookup fallback). For camera-based scanning:

- `@zxing/browser` wraps the ZXing C++ library (via WebAssembly) — scans Code-128, EAN-13, QR, Data Matrix. These are the formats used on Indian medicine packaging (EAN-13 for consumer packs, Code-128 for internal batch labels).
- `react-zxing` (wrapper around `@zxing/browser`) offers a React hook `useZxing()` — install size is acceptable (the WASM bundle is ~1.2 MB, lazy-loadable).
- `quaggajs` is abandoned (last release 2020). Do not use.
- `html5-qrcode` supports more formats but has a heavy opinionated UI overlay; `@zxing/browser` gives raw control.

For the **HID scanner path** (the primary use case), no library is needed. The existing POS terminal already handles keyboard input. What is missing is a dedicated hook that distinguishes scanner input (chars arriving in <30ms intervals, terminated by Enter) from manual typing:

```typescript
// frontend/hooks/use-barcode-scanner.ts
// Buffer chars with timing — if full sequence < 400ms, treat as scanner
// Emit scanned string, ignore partial manual input
```

This hook is pure TypeScript — zero dependencies.

**Install for camera scanning only:**
```bash
pnpm --filter frontend add @zxing/browser react-zxing
```

`react-zxing` is a thin wrapper; importing `@zxing/browser` directly is fine if you prefer avoiding the wrapper.

**Confidence: MEDIUM** — ZXing is the standard; version pinning needs verification against current npm but the library has been stable at 0.1.x for years.

---

### 4. Offline POS Support

**Recommendation: Keep `dexie` 4.0.7 — it is already correctly implemented. Add retry logic to `syncOfflineQueue`.**

`pos-db.ts` is already correct architecture: Dexie for IndexedDB, `offlineInvoices` table with `synced` flag, `syncOfflineQueue` triggered on `window.online` event. The POS terminal already shows an offline banner and queues to Dexie when `navigator.onLine === false`.

What is missing per CONCERNS.md:

1. **Exponential backoff on sync failures** — current code silently increments `attempts` with no backoff, so a server-validation failure retries immediately on next reconnect in a tight loop.
2. **Dead-letter state** — invoices that fail 3+ times should move to `status: 'failed'` for manual review, not keep retrying.
3. **Medicine catalog pre-caching** — `pos-db.ts` defines a `medicines` table but it is not populated. At POS startup, the app should fetch the active medicine catalog for the branch and write to Dexie so searches work offline.

No new library is needed. The existing Dexie setup handles all of this.

**Offline sync improvements (pure code, no new packages):**

```typescript
// lib/pos-db.ts additions
export async function syncOfflineQueue(submitFn: ...) {
  const pending = await posDb.offlineInvoices
    .where('synced').equals(0)
    .and(i => (i.attempts ?? 0) < 5)   // skip dead-letter
    .toArray();

  for (const item of pending) {
    const backoffMs = Math.min(1000 * 2 ** (item.attempts ?? 0), 30_000);
    const lastAttemptAge = Date.now() - (item.lastAttemptAt?.getTime() ?? 0);
    if (lastAttemptAge < backoffMs) continue;

    try {
      await submitFn(item.payload);
      await posDb.offlineInvoices.update(item.id!, { synced: true });
    } catch (e) {
      await posDb.offlineInvoices.update(item.id!, {
        attempts: (item.attempts ?? 0) + 1,
        lastAttemptAt: new Date(),
        lastError: String(e),
      });
    }
  }
}
```

**Confidence: HIGH** — Dexie 4.x is stable, already integrated, no change needed.

---

### 5. GSTR-1 Compliance Reporting

**Recommendation: Generate in-house using raw SQL + CSV streaming. No external library.**

GSTR-1 is a structured data export, not a complex calculation. The GST portal accepts JSON or CSV upload in the prescribed GSTN format. What the reports module needs:

**GSTR-1 B2B table (inter-business sales):** Aggregate invoices by buyer GSTIN, invoice date, taxable value, IGST/CGST/SGST.

**GSTR-1 B2C table (retail / OTC sales):** Aggregate by state code, rate, taxable value.

**Schedule H dispensing register:** All Schedule-H/H1/X dispensings in a date range: medicine name, batch, quantity, patient name, prescription reference, pharmacist who dispensed.

All of this is PostgreSQL aggregate queries on `sales_invoices`, `sales_invoice_items`, `medicines`, and `patients` tables. The data is already in the schema.

For CSV streaming: use Node.js built-in `stream.Readable` piped to the Fastify/NestJS response. Do not buffer the entire result in memory.

```typescript
// modules/reports/reports.service.ts
async streamGstr1Csv(branchId: string, month: number, year: number, res: FastifyReply) {
  res.raw.setHeader('Content-Type', 'text/csv');
  res.raw.setHeader('Content-Disposition', `attachment; filename="GSTR1-${year}-${month}.csv"`);

  const stream = new PassThrough();
  res.raw.pipe(stream); // or use fastify reply.raw directly

  stream.write('GSTIN,Invoice No,Invoice Date,Invoice Value,Taxable Value,IGST,CGST,SGST\n');

  // Paginate DB query to avoid OOM on large datasets
  let offset = 0;
  while (true) {
    const rows = await this.repo.getGstr1Rows(branchId, month, year, 500, offset);
    if (rows.length === 0) break;
    for (const r of rows) stream.write(formatGstr1Row(r) + '\n');
    offset += rows.length;
  }
  stream.end();
}
```

No `csv-stringify` or `fast-csv` needed — the output format is simple enough that manual string formatting is cleaner and zero-dep.

**Confidence: HIGH** — standard streaming pattern, no external library risk.

---

### 6. Invoice Numbering (Fix Race Condition)

**Recommendation: Replace `SELECT COUNT + 1` with Redis INCR.**

The current `BillingRepository.nextInvoiceNumber` uses a non-atomic daily count query. Under concurrent load this produces duplicate invoice numbers (documented in CONCERNS.md as high-priority).

The fix uses `ioredis` (already installed):

```typescript
// lib/invoice-sequence.ts
async function nextInvoiceNumber(redis: Redis, branchCode: string, branchId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `inv_seq:${branchId}:${today}`;
  const seq = await redis.incr(key);
  await redis.expire(key, 86400 * 2); // 2-day TTL, cleans up automatically
  return `${branchCode.toUpperCase()}-${today}-${String(seq).padStart(5, '0')}`;
}
```

No new package. `ioredis` is already a dependency.

**Confidence: HIGH** — Redis INCR is atomic by definition, this is a textbook fix.

---

### 7. Stock Reservation (Fix Race Condition)

**Recommendation: `SELECT FOR UPDATE` in Drizzle transaction. No new library.**

The batch adjustment race (CONCERNS.md: "Concurrent Batch Adjustment Race") needs database-level row locking. Drizzle ORM supports `FOR UPDATE` via `.for('update')` on select queries within a transaction.

```typescript
// Inside billing transaction:
const [batch] = await tx.select()
  .from(inventoryBatches)
  .where(eq(inventoryBatches.id, batchId))
  .for('update');   // <-- row-level lock

if (batch.quantity < requiredQty) throw new UnprocessableEntityException('Insufficient stock');
await tx.update(inventoryBatches)
  .set({ quantity: batch.quantity - requiredQty })
  .where(eq(inventoryBatches.id, batchId));
```

Drizzle 0.30.0 supports `.for('update')` on PostgreSQL. No version upgrade needed.

**Confidence: HIGH** — verified against Drizzle ORM PostgreSQL docs pattern.

---

### 8. Token Security Fix (XSS Risk)

**Recommendation: Move access token to memory + use httpOnly refresh cookie. Use `jose` for edge-compatible JWT verification.**

Current state: both access and refresh tokens in `localStorage` (documented security risk in CONCERNS.md and visible in `api-client.ts`).

Fix pattern:
- Access token: store in closure/memory inside `auth.store.ts` (Zustand, not persisted)
- Refresh token: send as `httpOnly; Secure; SameSite=Strict` cookie from the backend auth endpoint
- On page load: call `/auth/refresh` (cookie sent automatically) to get new access token into memory

For Next.js middleware JWT verification in the edge runtime (where `jsonwebtoken` does not work):

```bash
pnpm --filter frontend add jose
```

`jose` is a pure Web Crypto API implementation, works in Node.js, browser, and edge runtime. It is the standard for Next.js middleware JWT verification.

**Confidence: HIGH** — `jose` is the canonical Next.js middleware JWT library, documented in Next.js official docs.

---

## Packages to Install

```bash
# Frontend only
pnpm --filter frontend add jose
pnpm --filter frontend add @zxing/browser react-zxing   # camera scanning only, optional

# Backend — nothing new needed
# pdfkit, bwip-js, ioredis already installed
```

No backend packages need to be added. All remaining backend work uses already-installed packages.

---

## Packages NOT to Add

| Package | Reason |
|---------|--------|
| `puppeteer` / `playwright` | 300+ MB Chromium binary for PDF generation — `pdfkit` is already installed and sufficient |
| `pdf-lib` | Designed for editing existing PDFs, not programmatic generation |
| `@react-pdf/renderer` | Requires React in backend, duplicates `pdfkit` which is already present |
| `quaggajs` | Abandoned since 2020, no maintenance |
| `html5-qrcode` | Heavy opinionated UI, worse than `@zxing/browser` for pharmacy POS |
| `csv-stringify` / `fast-csv` | Overkill for GSTR-1 export; plain string formatting is sufficient |
| `bullmq` + `@nestjs/bullmq` | A migration from `bull` to BullMQ is justified long-term but is a breaking change; the existing `bull` + `@nestjs/bull` processors work and should not be migrated mid-build |
| Any GST NPM library | All published Indian GST packages are unmaintained; the logic is simple enough to own |

---

## Version Currency Notes

All version recommendations are based on reading the actual installed `package.json` files in this repository and cross-checking against known stable release history. Web access for npm version lookups was unavailable during this research session. The confidence flags reflect this:

| Claim | Confidence | Basis |
|-------|------------|-------|
| pdfkit sufficient for invoice generation | HIGH | Package installed, API is stable |
| GST in-house is correct | HIGH | `tax.service.ts` already implements correct logic |
| HID barcode scanner = keyboard events, no lib needed | HIGH | Standard hardware behavior |
| `@zxing/browser` for camera scanning | MEDIUM | Widely cited, but version not verified from npm this session |
| `jose` for edge JWT | HIGH | Next.js official docs consistently recommend this |
| Redis INCR for invoice sequence | HIGH | Redis documentation, ioredis already installed |
| Drizzle `.for('update')` in 0.30.0 | HIGH | Drizzle PostgreSQL dialect documented feature |
| Dexie 4.0.7 sufficient for offline | HIGH | Already integrated and working |

---

*Stack analysis: 2026-04-28*
