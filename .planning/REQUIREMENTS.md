# Requirements: MedERP — Pharma Medical ERP

**Defined:** 2026-04-29
**Core Value:** A pharmacist can scan a product, build a bill, and complete a transaction in under 60 seconds, with stock, GST, and compliance records updated automatically.

## v1 Requirements

### Schema Fixes

- [ ] **SCHEMA-01**: Database migration adds `cgstAmt`, `sgstAmt`, `igstAmt` columns to `salesInvoiceItems` table
- [ ] **SCHEMA-02**: Database migration adds `reservedQty` column to `inventoryBatches` table
- [ ] **SCHEMA-03**: Database migration adds `customerGstin` column to `salesInvoices` table
- [ ] **SCHEMA-04**: Invoice numbering uses Redis INCR (atomic, replaces non-atomic SELECT COUNT+1)

### Billing — Compliance

- [ ] **BILL-01**: GST amounts calculated using `decimal.js` (no floating-point rounding errors)
- [ ] **BILL-02**: CGST/SGST/IGST amounts persisted per invoice line item in new schema columns
- [ ] **BILL-03**: Inter-state vs intra-state GST determined from `branch.state` vs `patient.state` at invoice creation
- [ ] **BILL-04**: Schedule H/H1/X products blocked at billing if no linked verified prescription exists (hard block, not warning)

### Billing — Checkout Flow

- [ ] **BILL-05**: Stock reservation (`reservedQty`) incremented atomically when item added to cart; released on remove or void
- [ ] **BILL-06**: Server performs FEFO batch selection (oldest expiry first) when adding item — client does not supply batchId
- [ ] **BILL-07**: Server re-fetches `unitPrice` from DB at invoice finalization — client-supplied price is ignored
- [ ] **BILL-08**: Invoice finalization is a single Drizzle transaction: stock deduct + invoice write + movement log (atomic)
- [ ] **BILL-09**: Split payment accepted: cash, UPI, card, insurance, credit — amounts must sum to invoice total
- [ ] **BILL-10**: Sales return (credit note) flow: select items to return, restock batches, create refund payment record, link to original invoice

### Inventory

- [ ] **INV-01**: Near-expiry batch query endpoint (`/inventory/near-expiry?branchId=&days=30|60|90`)
- [ ] **INV-02**: Manual stock adjustment endpoint with reason field; creates immutable `stock_movements` record
- [ ] **INV-03**: Stock value report endpoint: total inventory value at cost and MRP per branch

### Purchase Orders

- [ ] **PO-01**: GRN receive flow: mark PO items received with batch number + expiry, creates `inventoryBatches` records + PURCHASE stock movements
- [ ] **PO-02**: Supplier `outstandingBalance` increments on GRN receive; decrements on payment
- [ ] **PO-03**: Reorder engine background job creates draft purchase orders when product quantity falls below `reorderLevel`

### Patients and Prescriptions

- [ ] **RX-01**: Prescription image upload stored in MinIO; signed URL returned for viewing
- [ ] **RX-02**: Pharmacist can verify prescription (PENDING → VERIFIED); sets `verifiedBy` and `verifiedAt`
- [ ] **RX-03**: Prescription validity enforced: block dispensing if `validUntil < today` or `refillCount >= maxRefills`

### Reports

- [ ] **RPT-01**: GSTR-1 monthly export as CSV — B2C and B2B sections with CGST/SGST/IGST per HSN code
- [ ] **RPT-02**: Schedule H dispensing register export as CSV — drug name, batch, qty, patient, doctor, date
- [ ] **RPT-03**: Sales report with day/week/month grouping; includes revenue, invoice count, payment method breakdown
- [ ] **RPT-04**: Inventory ABC analysis: products ranked A/B/C by sales value contribution

### Background Jobs

- [ ] **JOB-01**: Expiry scanner cron (daily 9am): queues notifications for batches expiring within 30 days
- [ ] **JOB-02**: Reorder engine cron (every 6hr): creates draft POs for products below `reorderLevel`
- [ ] **JOB-03**: PDF invoice generator worker: generates invoice PDF via `pdfkit` on queue message after finalization

### Frontend — POS Terminal

- [ ] **POS-01**: Barcode scanner input hook: captures HID USB scanner keypress sequence, searches by barcode
- [ ] **POS-02**: Product search by name or barcode with results dropdown showing stock qty and schedule badge
- [ ] **POS-03**: Cart with editable quantities, per-line discount, GST breakdown display, and grand total
- [ ] **POS-04**: Patient selector by phone number; loads loyalty points balance
- [ ] **POS-05**: Payment modal: accepts split payments, shows change due for cash, validates total matches
- [ ] **POS-06**: Invoice preview after payment with print (window.print) and WhatsApp share link
- [ ] **POS-07**: Keyboard shortcuts: F2 (focus search), F4 (open payment), F6 (clear cart), Ctrl+P (print)

### Frontend — Core Pages

- [ ] **UI-01**: Dashboard: stat cards (today's sales, invoices, low-stock count, expiry alerts), sales trend chart, alert panels
- [ ] **UI-02**: Products list page with create/edit sheet, category filter, schedule type filter, barcode display
- [ ] **UI-03**: Inventory stock page: tabbed view (Low Stock / Near Expiry / Expired), expandable batch rows
- [ ] **UI-04**: Purchase orders list and detail with GRN receive modal
- [ ] **UI-05**: Patients list with search by phone/name; patient detail with invoice and prescription history tabs
- [ ] **UI-06**: Prescriptions list with pending-verification tab; prescription detail with image preview and verify button
- [ ] **UI-07**: Suppliers list with create/edit; supplier detail showing outstanding balance
- [ ] **UI-08**: Staff list with create/edit; attendance check-in/out; monthly attendance view
- [ ] **UI-09**: Reports pages: Sales, Inventory, GST, Compliance — each with date range picker and CSV export button
- [ ] **UI-10**: Settings: Branches (GSTIN, drug license), Users (invite, role change, deactivate)

### Frontend — Polish

- [ ] **UI-11**: Role-based navigation: menu items shown/hidden based on `UserRole`
- [ ] **UI-12**: Error boundaries on each page; 404 page; toast notifications for all mutations
- [ ] **UI-13**: Responsive layout: collapsible sidebar on tablet; mobile-friendly tables (card view)
- [ ] **UI-14**: Print styles: sidebar/topbar hidden, invoice formatted for A4 thermal/laser print

### Seed Data

- [ ] **SEED-01**: Seed script creates: 1 super admin, 2 branches, 5 categories, 20 products (all schedule types), 2 suppliers, 3 staff users

## v2 Requirements

### Not in v1

- **SEC-01**: Move access token from localStorage to memory + httpOnly cookie — deferred (security hardening)
- **SEC-02**: Rate limiting on `/auth/login` and `/auth/refresh` — deferred
- **NOTIF-01**: SMS/email notification delivery via MSG91/Resend — deferred (expiry/reorder alerts logged but not sent)
- **BILL-11**: Patient loyalty points earn and redeem — deferred
- **BILL-12**: Discount with manager approval gate (>5%) — deferred
- **PO-04**: Create and send purchase orders (Draft → Sent flow) — deferred (GRN-first approach in v1)
- **RX-04**: Patient allergy check at billing — deferred
- **UI-15**: PWA offline support (Dexie IndexedDB queue) — deferred
- **TEST-01**: Unit tests for TaxService, BillingService financial calculations — deferred to post-v1

## Out of Scope

| Feature | Reason |
|---------|--------|
| Elasticsearch full-text search | Phase 3 future — `ILIKE` search sufficient for v1 volume |
| WhatsApp Business API | Phase 3 future |
| Multi-branch stock transfers | Phase 4 future |
| Kubernetes / CI-CD | Phase 5 future |
| Insurance claim management | Phase 6 future |
| Mobile native app | Web-first; PWA deferred to v2 |
| Schedule X (NDPS) running register | Significantly more complex than H register; separate workflow needed |
| ClickHouse analytics | Prepared in config but not integrated |
| OAuth login | Email/password sufficient for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 to SCHEMA-04 | Phase 1 | Pending |
| BILL-01 to BILL-04 | Phase 2 | Pending |
| BILL-05 to BILL-10 | Phase 2 | Pending |
| INV-01 to INV-03 | Phase 3 | Pending |
| PO-01 to PO-03 | Phase 3 | Pending |
| RX-01 to RX-03 | Phase 3 | Pending |
| RPT-01 to RPT-04 | Phase 4 | Pending |
| JOB-01 to JOB-03 | Phase 4 | Pending |
| POS-01 to POS-07 | Phase 5 | Pending |
| UI-01 to UI-14 | Phase 6 | Pending |
| SEED-01 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 after initial definition*
