# Roadmap: MedERP — Pharma Medical ERP

## Overview

A brownfield completion project. The infrastructure (NestJS, schema, module stubs, frontend scaffold) is in place. The remaining work closes six compliance-critical gaps that make the system legally non-deployable, then completes the checkout pipeline, backend modules, reports, and frontend. Phases are ordered strictly by dependency: schema correctness unlocks billing, billing unlocks reports, stable APIs unlock frontend.

## Phases

- [ ] **Phase 1: Schema and Infrastructure Fixes** - Fix three schema gaps, replace race-condition invoice numbering, install decimal.js, seed reference data
- [ ] **Phase 2: Billing Pipeline Compliance** - Complete checkout transaction with Schedule H gate, FEFO, GST split, stock reservation, and sales return
- [ ] **Phase 3: Backend Modules** - Complete inventory endpoints, purchase order GRN flow, prescription verification, and MinIO image upload
- [ ] **Phase 4: Reports and Background Jobs** - Build GSTR-1 and Schedule H register exports, sales reports, BullMQ workers for expiry/reorder/PDF
- [ ] **Phase 5: POS Terminal** - Barcode scanner hook, cart with split payment, invoice print, keyboard shortcuts
- [ ] **Phase 6: Frontend Pages and Polish** - Dashboard, all CRUD pages, responsive layout, role-based nav, toast notifications, print styles

## Phase Details

### Phase 1: Schema and Infrastructure Fixes
**Goal**: The database schema is correct and complete for GST-compliant billing; invoice numbers are atomic; GST arithmetic uses decimal precision; seed data exists for manual testing
**Depends on**: Nothing (first phase)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SEED-01
**Success Criteria** (what must be TRUE):
  1. Running `pnpm db:migrate` applies all migrations cleanly with no errors; `cgstAmt`, `sgstAmt`, `igstAmt` columns exist on `salesInvoiceItems`; `reservedQty` exists on `inventoryBatches`; `customerGstin` exists on `salesInvoices`
  2. Two simultaneous checkout requests produce invoice numbers that differ by exactly 1 (no duplicates), verified by running two parallel curl calls and inspecting the response
  3. `TaxService.calculate(247.50, 12)` returns cgst=14.85, sgst=14.85, total=29.70 — no floating-point drift
  4. `pnpm db:seed` completes without error; admin@mederp.com login succeeds; two branches, 20 products across all schedule types, and 3 staff users are visible in the database
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md — Add cgstAmt/sgstAmt/igstAmt, reservedQty, customerGstin via Drizzle migration
- [ ] 01-02-PLAN.md — Install decimal.js, rewrite TaxService with precision arithmetic (TDD)
- [ ] 01-03-PLAN.md — Create RedisModule, inject into BillingRepository, replace SELECT COUNT+1 with INCR
- [ ] 01-04-PLAN.md — Create seed script: 2 branches, 20 medicines, 4 users, 2 suppliers

### Phase 2: Billing Pipeline Compliance
**Goal**: A cashier can complete a legally compliant checkout — Schedule H drugs blocked without Rx, GST split stored per line, stock reserved and committed atomically, split payments accepted, and returns processed
**Depends on**: Phase 1
**Requirements**: BILL-01, BILL-02, BILL-03, BILL-04, BILL-05, BILL-06, BILL-07, BILL-08, BILL-09, BILL-10
**Success Criteria** (what must be TRUE):
  1. Attempting to add a Schedule H product to an invoice with no linked verified prescription returns HTTP 422; the same product adds successfully when a verified prescription is linked
  2. A finalized invoice for an intra-state sale stores non-zero `cgstAmt` and `sgstAmt` with `igstAmt = 0` per line item; an inter-state sale stores non-zero `igstAmt` with `cgstAmt = sgstAmt = 0`
  3. Two simultaneous `POST /billing/invoices/:id/finalize` requests for the same last-unit batch result in exactly one success and one stock-insufficient error — no oversell
  4. A split payment request with cash=500 and UPI=300 on a Rs. 800 invoice finalizes successfully; a request where amounts sum to Rs. 750 on an Rs. 800 invoice returns a validation error
  5. A sales return on a paid invoice restocks the returned batch quantities and creates a refund payment record linked to the original invoice
**Plans**: TBD

### Phase 3: Backend Modules
**Goal**: Inventory management, purchase order GRN, and prescription workflows are fully functional via API — an inventory manager can receive goods, a pharmacist can verify prescriptions and upload images
**Depends on**: Phase 2
**Requirements**: INV-01, INV-02, INV-03, PO-01, PO-02, RX-01, RX-02, RX-03
**Success Criteria** (what must be TRUE):
  1. `GET /inventory/near-expiry?branchId=X&days=30` returns only batches whose `expiryDate` falls within 30 days from today and whose `quantity > 0`
  2. A manual stock adjustment with a reason creates an immutable record in `stock_movements`; a subsequent adjustment cannot modify or delete the first record
  3. `POST /purchase-orders/:id/receive` with batch numbers and expiry dates creates `inventoryBatches` records, logs PURCHASE `stock_movements`, and increments the supplier's `outstandingBalance`
  4. Uploading a prescription image returns a MinIO signed URL; calling `POST /prescriptions/:id/verify` sets `status = VERIFIED`, `verifiedBy`, and `verifiedAt`
  5. Attempting to dispense a prescription where `validUntil < today` or `refillCount >= maxRefills` returns a 422 error with a descriptive message
**Plans**: TBD

### Phase 4: Reports and Background Jobs
**Goal**: The pharmacy can export GSTR-1 and Schedule H dispensing register for regulatory compliance; invoice PDFs are generated automatically; expiry and reorder alerts fire on schedule
**Depends on**: Phase 2 (reports query billing data written in Phase 2)
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04, JOB-01, JOB-02, JOB-03
**Success Criteria** (what must be TRUE):
  1. `GET /reports/gst?branchId=X&month=4&year=2026&format=csv` returns a downloadable CSV with CGST, SGST, IGST, and HSN columns matching the values stored on invoice line items
  2. `GET /reports/schedule-h-register?branchId=X&from=Y&to=Z&format=csv` returns a CSV row for every Schedule H or H1 drug dispensed in the period, including drug name, batch, quantity, patient name, and doctor name
  3. The expiry-scanner cron fires once at midnight; running it manually creates notification records for all batches with `expiryDate <= today + 30 days`
  4. After a product's batch quantity drops below `reorderLevel`, the reorder-engine cron (next run) creates a draft purchase order for that product
  5. After invoice finalization, a PDF file is stored in MinIO and `salesInvoices.pdfUrl` is populated within the worker processing window
**Plans**: TBD

### Phase 5: POS Terminal
**Goal**: A pharmacist can scan a product barcode, build a cart, link a prescription for controlled drugs, accept split payment, and print or share an invoice — entirely by keyboard in under 60 seconds
**Depends on**: Phase 2 (billing API must be correct before wiring POS)
**Requirements**: POS-01, POS-02, POS-03, POS-04, POS-05, POS-06, POS-07
**Success Criteria** (what must be TRUE):
  1. Scanning a barcode with a USB HID scanner (rapid keypress sequence ending in Enter) adds the product to the cart without any mouse interaction; typing a name shows a dropdown with stock qty and schedule badge
  2. The cart displays per-line GST breakdown and grand total; changing a line quantity instantly recalculates all totals
  3. A split payment across cash and UPI can be entered; the modal shows change due for cash; submitting when amounts do not sum to the invoice total shows a validation error
  4. After payment confirmation, an invoice preview renders with all mandatory fields; clicking Print triggers `window.print()` with sidebar and topbar hidden
  5. Pressing F2 focuses the search bar, F4 opens the payment modal, F6 prompts to clear the cart, and Ctrl+P prints — all without touching the mouse
**Plans**: TBD

### Phase 6: Frontend Pages and Polish
**Goal**: Every module has a usable UI — products, inventory, purchases, patients, prescriptions, staff, reports, and settings — with role-based navigation, responsive layout, and consistent error handling
**Depends on**: Phase 3 and Phase 4 (pages consume APIs completed in those phases)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, UI-12, UI-13, UI-14
**Success Criteria** (what must be TRUE):
  1. Logging in as a Cashier shows Billing and Dashboard in the sidebar; Inventory Management and Settings are not visible; logging in as SUPER_ADMIN shows all items
  2. The dashboard displays today's sales total, invoice count, low-stock product count, and expiry alert count — all reflecting real data from the API
  3. A product can be created, edited, and soft-deleted entirely through the Products list page without navigating away; the barcode is displayed on the detail sheet
  4. The Reports pages each have a date range picker and an Export CSV button that triggers a file download from the streaming CSV endpoint
  5. On a tablet viewport (768px), the sidebar collapses to icons; on mobile (< 640px), tables switch to card view; all interactions remain functional
  6. Every create/edit/delete mutation shows a toast notification; a network error shows an error toast; no unhandled promise rejections appear in the browser console
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema and Infrastructure Fixes | 4/4 | Completed | 2026-04-30 |
| 2. Billing Pipeline Compliance | 4/4 | Completed | 2026-04-30 |
| 3. Backend Modules | 0/TBD | Not started | - |
| 4. Reports and Background Jobs | 0/TBD | Not started | - |
| 5. POS Terminal | 0/TBD | Not started | - |
| 6. Frontend Pages and Polish | 0/TBD | Not started | - |
