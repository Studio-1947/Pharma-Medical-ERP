# Project Research Summary

**Project:** MedERP -- Pharma POS + ERP (Remaining Phases)
**Domain:** Indian Retail Pharmacy ERP / Multi-branch POS with GST compliance
**Researched:** 2026-04-28
**Confidence:** HIGH (stack/architecture from direct codebase analysis), MEDIUM (regulatory/features from statutory knowledge)

## Executive Summary

MedERP is a brownfield Indian retail pharmacy ERP built on NestJS + Next.js + Drizzle ORM + PostgreSQL. The core infrastructure (modules, schema, Bull job skeletons, frontend scaffolding) is already in place. The remaining work is not about architecture decisions -- it is about closing six critical gaps that make the system legally non-deployable: floating-point GST arithmetic, missing Schedule H prescription enforcement at billing, no per-line CGST/SGST/IGST storage (blocks GSTR-1 filing), invoice number race condition, client-supplied unit price accepted without re-validation, and absent stock reservation. Every one of these gaps is documented in CONCERNS.md and confirmed by direct codebase inspection.

The recommended approach is schema-first and compliance-first: fix the three billing schema gaps (add CGST/SGST/IGST columns to invoice items, add reservedQty to inventory batches, add customerGstin to invoices) before writing any new service logic. Once the schema is correct, complete the BillingService checkout pipeline with all guards, then build reports (GSTR-1 + Schedule H register), then complete the frontend POS terminal and remaining pages. No major new dependencies are needed on the backend; only jose and optionally @zxing/browser need to be added to the frontend.

The primary risk is compliance order: if a pharmacy processes real invoices before the Schedule H gate and CGST/SGST/IGST split are in place, the existing data will be irrecoverable for GSTR-1 filing and will constitute a regulatory violation. The fix window is narrow -- it must happen before any production invoice is written.

---

## Key Findings

### Recommended Stack

The stack is locked -- NestJS 10 (Fastify adapter), Next.js 15, Drizzle ORM 0.30, PostgreSQL 16, Redis 7, Bull 4.x, Dexie 4.x are all installed and wired. No replacements should be considered. The only additions needed are jose (frontend, for Next.js middleware edge-compatible JWT verification) and optionally react-zxing / @zxing/browser for camera-based barcode scanning. All backend remaining work uses only installed packages.

Do NOT migrate from bull + @nestjs/bull to BullMQ mid-build. The existing processors work; migration is a breaking change with no immediate payoff.

**Core technologies (already installed, role confirmed):**
- pdfkit 0.15.0: server-side invoice PDF generation inside Bull worker -- no Puppeteer/Chromium needed
- ioredis 5.3.2: Redis INCR for atomic invoice sequence and product barcode cache (5-min TTL)
- dexie 4.0.7: IndexedDB offline queue -- needs exponential backoff + dead-letter logic added, no new package
- decimal.js: NOT YET INSTALLED -- must be added before first invoice; replaces IEEE-754 arithmetic in TaxService
- jose (frontend): edge-compatible JWT verification for Next.js middleware

**Critical missing installs:**
- pnpm --filter backend add decimal.js
- pnpm --filter frontend add jose

### Expected Features

**Must have (table stakes -- legally required before go-live):**
- GST-compliant tax invoice with CGST/SGST/IGST split per line -- mandatory under GST Rules 2017; current DB schema does not store split columns (critical schema gap)
- Schedule H hard block at POS -- Drugs and Cosmetics Rules 1945 Rule 65; selling without Rx is criminal; currently not enforced in BillingService
- Schedule H dispensing register export -- drug inspector can demand this at any time; requires dedicated append-only table populated at billing time
- GSTR-1 monthly CSV export -- mandatory for businesses above GST threshold; blocked by missing CGST/SGST/IGST schema columns
- Printed invoice with all mandatory fields (GSTIN, HSN per line, invoice number, place of supply)
- Sequential invoice numbering without race condition -- GST law requires consecutive serial numbers
- Sales return flow (return invoice with stock restock)
- Purchase order GRN flow (receive goods, create batches, record stock movements)

**Should have (differentiators for pharmacy chains):**
- Patient allergy warning at POS -- data present (allergies[] on patients), cross-check not wired to billing
- Loyalty points earn/redeem -- schema present, service logic missing
- Automated draft PO on low-stock trigger -- ReorderCheckProcessor skeleton exists
- Real-time expiry + reorder alerts -- Bull job skeletons exist, cron scheduling missing
- ABC inventory analysis -- derivable from existing stockMovements data
- Staff performance metrics (invoices/day, return rate) -- derivable from invoices join

**Defer to v2+:**
- Offline-first POS with full sync -- fix online race conditions first
- WhatsApp/SMS delivery -- log to notifications table in v1, wire MSG91 in Phase 3
- Insurance claim management -- separate product domain, Phase 6
- Accounting integration (Tally/Zoho) -- GSTR-1 CSV export sufficient for v1
- Drug interaction checking -- requires licensed pharmaceutical database
- Multi-branch stock transfer UI -- backend schema supports it, UI is Phase 4
- OCR prescription parsing -- ocrRawText column exists in schema, Phase 3+

### Architecture Approach

The NestJS module layering (Controller/Service/Repository) is correct and must be followed consistently. The architecture problems are point defects in the billing pipeline, not structural issues. Every multi-table write must use Drizzle transactions with the tx parameter propagation pattern already established. Background jobs must be dispatched after the transaction commits, never inside it.

**Major components and status:**
1. BillingService (checkout pipeline) -- partially complete; missing Schedule H gate, price re-fetch from DB, CGST/SGST/IGST persistence, stock reservation
2. TaxService -- correct structure; missing interState flag propagation and decimal.js precision
3. InventoryService / BatchRepository -- FEFO ordering correct; missing status=active guard in adjustQuantity and reservedQty column
4. PrescriptionService -- empty stub; must implement validity check consumed by billing
5. ReportsService -- empty stub; GSTR-1 and Schedule H register are legally required
6. Bull processors (ExpiryScan, ReorderCheck) -- skeletons exist; missing @nestjs/schedule cron triggers and NotificationProcessor
7. PdfGeneratorProcessor -- missing entirely; pdfkit is installed and ready
8. POS frontend -- partially done; needs useBarcodeScanner hook, prescription link, split payment, print stylesheet

### Critical Pitfalls

1. **Floating-point GST arithmetic** -- IEEE-754 rounding causes cgst + sgst != totalTax on real prices (e.g. Rs.247.50 at 12%). GSTR-1 portal rejects filings with mismatched totals. Fix: install decimal.js and replace all TaxService monetary math before any invoice is written.

2. **IGST never calculated (inter-state mis-taxation)** -- interState flag defaults to false and is never derived from branch.state vs patient.state. All inter-state sales are illegally taxed as CGST+SGST. Fix: store patientState and branchState on the invoice; derive interState at billing time.

3. **Schedule H/X enforcement missing** -- BillingService.create performs no Rx check. Any Schedule H drug can be sold without a prescription (criminal offence under D&C Act). Fix: pre-transaction gate; throw 422 if requiresPrescription=true and no verified prescription linked.

4. **Client-supplied unit price trusted** -- parseFloat(item.unitPrice) from the request body is used directly. A tampered price passes to the invoice and GSTR-1. Fix: re-fetch medicine.priceMrp from DB on every checkout; throw if deviation exceeds 5%.

5. **Concurrent invoice number duplicates** -- SELECT COUNT(*) + 1 is not atomic; simultaneous checkouts produce the same invoice number. Fix: redis.incr with key invoice_seq:{branchId}:{YYYYMMDD} and 25-hour TTL.

6. **No stock reservation -- oversell under concurrency** -- No reservedQty column on inventoryBatches. Fix: add column; reserve on cart add; commit on finalize; release on cart abandon via BullMQ delayed job.

---

## Implications for Roadmap

### Phase 1: Schema Fixes and Infrastructure Bugs
**Rationale:** Three schema gaps cannot be added later without rewriting service code that writes to those tables. Two infrastructure bugs corrupt financial data on every transaction. These must be resolved before any service logic is written or tested.
**Delivers:** Correct billing schema, atomic invoice sequencing, decimal-safe GST arithmetic, reserved stock column
**Addresses:** Prerequisite for GST-compliant invoices, GSTR-1 export, and stock reservation
**Avoids:** Pitfalls 1, 2, 5, 6, 8 (floating-point, IGST schema, invoice race, oversell, GSTR-1 schema gap)

Deliverables:
- Add cgstAmt, sgstAmt, igstAmt numeric(12,2) to salesInvoiceItems (migration)
- Add cgstTotal, sgstTotal, igstTotal numeric(12,2) to salesInvoices (migration)
- Add customerGstin varchar(15) to salesInvoices (migration)
- Add reservedQty integer default 0 to inventoryBatches (migration)
- Add pdfUrl varchar to salesInvoices (migration)
- Create schedule_h_register append-only table (migration)
- Install decimal.js; replace TaxService IEEE-754 math throughout
- Replace BillingRepository.nextInvoiceNumber COUNT+1 with Redis INCR

### Phase 2: Billing Pipeline Completion (Core Compliance)
**Rationale:** BillingService.create is the revenue-critical path. All compliance requirements must be wired before the POS frontend can be trusted. Hard blocker for production use.
**Delivers:** Legally compliant checkout; Schedule H enforcement; correct GST on all invoice types; atomic stock reservation; sales return flow
**Addresses:** Table stakes: Schedule H hard block, FEFO batch dispensing, split payment, sales return, prescription validation
**Avoids:** Pitfalls 3, 4, 6, 7, 9, 12 (Rx gate, client price, oversell, batch status, refill enforcement, negative discount)
**Research flag:** Standard NestJS/Drizzle patterns; no phase research needed

Deliverables:
- Implement PrescriptionService.checkValidity(id) -- expiryDate, refillCount, status=VERIFIED
- Add Schedule H/H1/X enforcement gate in BillingService.create (pre-transaction)
- Add DB price re-fetch + client price deviation check (>5% = throw)
- Wire interState flag derivation into TaxService call
- Persist cgstAmt/sgstAmt/igstAmt per line item and aggregate to invoice totals
- Implement stock reservation flow (reserve on add-to-cart, commit on finalize, release on abandon)
- Add status=active guard to BatchRepository.adjustQuantity
- Implement BillingService.createReturnInvoice
- Add discountPct 0-100 constraint at Zod + DB level
- Update prescriptionItems.quantityDispensed atomically within billing transaction
- Populate schedule_h_register within billing transaction for Schedule H items

### Phase 3: Background Jobs, Reports, and PDF
**Rationale:** GSTR-1 and Schedule H register are legally required before a pharmacy can operate. Background jobs prevent write-off losses. PDF generation is required for GST-compliant invoice delivery. All depend on Phase 2 correct billing data.
**Delivers:** GSTR-1 monthly CSV; Schedule H dispensing register; invoice PDF (pdfkit + MinIO); expiry alerts; reorder alerts; purchase order GRN flow
**Addresses:** GSTR-1, Schedule H register, near-expiry alerts, reorder, GRN flow
**Avoids:** Pitfalls 10, 11, 14 (HSN validation, expiry scan race, register reconstruction)
**Research flag:** GSTR-1 format must be verified against current GSTN portal specification before implementation -- format changes across portal versions.

Deliverables:
- Add @nestjs/schedule cron triggers for ExpiryScanProcessor (midnight daily) and ReorderCheckProcessor (every 6 hours)
- Fix expiry scan race condition (wrap write-off in transaction; fix lte off-by-one on alert query)
- Build NotificationProcessor (Bull worker; log to notifications table in v1)
- Build PdfGeneratorProcessor (pdfkit invoice PDF, MinIO upload, set salesInvoices.pdfUrl)
- Build ReportsService with streaming CSV: GSTR-1 B2B/B2C/HSN summary, Schedule H register, daily sales, stock value
- Build PurchaseOrdersService GRN flow (receive items, create inventory batches, log stock movements)
- Add HSN code format validation at Zod + DB constraint
- Add drug license expiry fields to branches schema + 60-day warning query

### Phase 4: POS Frontend and Remaining Pages
**Rationale:** Frontend work can only be reliably completed after backend APIs are stable and compliance-correct. Building the POS terminal against a broken billing API produces UI that masks bugs.
**Delivers:** Keyboard-first POS terminal with barcode scanner, payment modal with split payment, invoice print, all remaining CRUD pages
**Addresses:** Fast barcode-scan-to-bill (<60s), split payment, printed invoice, patient purchase history, prescription management UI
**Avoids:** Offline complexity -- build reliable online-first path first; offline enhancements are Phase 5+
**Research flag:** No additional research needed. jose install required before Next.js middleware.

Deliverables:
- Install jose in frontend
- Implement useBarcodeScanner hook (keypress timing buffer, HID scanner detection, zero dependencies)
- Complete POS terminal: product search, cart with FEFO batch display, prescription link, payment modal, invoice preview with print stylesheet
- Build remaining CRUD pages (products, inventory, purchase orders, patients, prescriptions, staff, reports, settings)
- Wire dashboard stats (sales today, low stock count, expiry alerts)
- Connect export buttons to streaming CSV report endpoints

### Phase Ordering Rationale

- Schema migrations must precede service code that writes to those columns; inverting this requires service rewrites
- Compliance enforcement (Schedule H, GST accuracy) must precede any production data; existing data cannot be retroactively corrected for GSTR-1
- Reports depend on correct billing data from Phase 2; building reports before billing is fixed produces a module that queries incorrect stored values
- POS frontend depends on backend API stability; building UI against a known-broken API entrenches workarounds

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (GSTR-1):** Verify the current filing format against GSTN developer documentation before implementing the export.
- **Phase 3 (Schedule H register):** Exact fields for Form 17 vary by state drug controller. Verify against state-specific rules for the target deployment state.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Schema migrations + decimal.js):** Drizzle migration syntax and decimal.js API are well-documented.
- **Phase 2 (BillingService gates):** NestJS service pattern, Drizzle transaction propagation are established patterns in this codebase.
- **Phase 4 (Frontend):** Next.js 15 + Zustand + React Query patterns are well-documented; jose middleware is in Next.js official docs.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct package.json and source file inspection; no speculation |
| Features | MEDIUM-HIGH | Table stakes confirmed by codebase gaps; regulatory requirements from statutory knowledge; MEDIUM on exact regulatory form fields |
| Architecture | HIGH | All findings from direct codebase analysis of billing.service.ts, batch.repository.ts, tax.service.ts, schema files |
| Pitfalls | HIGH | All 15 pitfalls confirmed with exact file paths and code references; not inferred |

**Overall confidence:** HIGH for build priorities and phase order; MEDIUM for exact regulatory form formats

### Gaps to Address

- GSTR-1 portal format: Fetch the current GSTN offline tool specification before Phase 3. Do not rely on training knowledge for byte-level format details.
- Schedule H current drug list: The CDSCO list is updated by notification. Provide a seed file but disclaim operators must verify against current CDSCO notifications.
- State-specific drug license fields: Add fields as free-text with application-layer validation rather than state-specific DB schema enforcement.
- decimal.js + Drizzle pg driver: Drizzle returns numeric(12,2) columns as JavaScript strings. Initialize new Decimal(stringValue) directly -- never parse through parseFloat first.

---

## Sources

### Primary (HIGH confidence -- direct codebase inspection)
- backend/src/modules/billing/billing.service.ts -- checkout flow gaps, client price trust, missing Rx gate
- backend/src/modules/billing/billing.repository.ts -- invoice sequence race condition
- backend/src/modules/billing/tax.service.ts -- floating-point arithmetic, missing interState propagation
- backend/src/modules/inventory/batch.repository.ts -- adjustQuantity without status check
- backend/src/modules/inventory/jobs/expiry-scan.processor.ts -- write-off race and alert off-by-one
- backend/src/database/schema/billing.ts -- missing CGST/SGST/IGST columns, missing customerGstin
- backend/src/database/schema/inventory.ts -- no reservedQty column
- backend/src/database/schema/prescriptions.ts -- no maxRefills/refillCount
- .planning/codebase/CONCERNS.md -- confirmed known issues
- .planning/PROJECT.md -- regulatory context and accepted decisions

### Secondary (MEDIUM confidence -- statutory/regulatory knowledge)
- Drugs and Cosmetics Act 1940 + Rules 1945 -- Schedule H/H1/X dispensing requirements, Form 17 register
- GST Rules 2017 -- tax invoice mandatory fields, GSTR-1 filing requirements
- Indian pharma ERP market (Marg ERP, GoFrugal, HealthPlix) -- feature expectations; cutoff Aug 2025

### Tertiary (MEDIUM -- needs verification before implementation)
- GSTN developer portal -- GSTR-1 upload format specification (verify current version before Phase 3)
- CDSCO website -- current Schedule H drug list (verify before seeding medicines data)

---
*Research completed: 2026-04-28*
*Ready for roadmap: yes*