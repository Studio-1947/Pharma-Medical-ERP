# Feature Landscape

**Domain:** Indian Retail Pharmacy ERP / POS
**Researched:** 2026-04-28
**Confidence:** MEDIUM-HIGH — regulatory requirements from Drugs and Cosmetics Act, 1940 and Rules, 1945 (training knowledge, Aug 2025 cutoff); POS/ERP feature set from competitive analysis of Marg ERP, Vyapar, GoFrugal PharmEasy, HealthPlix, Godown ERP; cross-verified against existing codebase schema

---

## Table Stakes

Features users leave without OR that are legally mandated for a licensed retail pharmacy in India.

### Billing and POS

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| Fast barcode-scan-to-bill flow (<60s) | Core POS requirement; pharmacies deal with high patient throughput | Med | Partial — controller wired, FEFO not fully connected | Redis barcode cache missing |
| GST-compliant invoice (CGST/SGST/IGST split) | Mandatory under GST law for businesses above threshold; failing to show split = invalid tax invoice | Med | Partial — TaxService has correct logic but `salesInvoices` table stores single `taxAmount` not CGST/SGST/IGST split columns | CRITICAL GAP: DB schema missing split columns |
| HSN-code-based GST rate lookup | GST rates for pharma vary by HSN (0%, 5%, 12%, 18%); wrong rate = compliance risk | Med | Partial — `hsnCode` column exists in medicines, but rate is stored as `taxPercent` on product, not looked up from HSN master | Needs HSN-to-rate mapping table |
| Printed invoice with mandatory fields | Under GST Rules 2017, a tax invoice must show: supplier GSTIN, customer GSTIN (if applicable), HSN code per line, CGST/SGST/IGST per line, invoice number, date, place of supply | High | Not built — no PDF generation | Required before going live |
| Invoice numbering (sequential, branch-prefixed) | GST rules require consecutive serial numbers per financial year | Low | Exists but has race condition (Redis INCR fix pending per CONCERNS.md) | Fix is planned |
| Split payment (Cash + UPI, Cash + Card) | Routine in Indian pharmacies; patients combine payment modes | Low | Schema supports via `payments` table + `mixed` paymentMode enum; service not wired | Must wire to finalize flow |
| Invoice void / cancellation with stock reversal | Operational necessity; voiding must restore stock atomically | Med | Implemented in `billing.service.ts#voidInvoice` | Present |
| Sales return (return invoice) | Patients return medicines (within expiry); legally must reverse stock and GST | Med | Not implemented — no return invoice flow | In-scope gap |
| Walk-in billing (no patient record) | High volume; requiring patient registration for every sale is friction users abandon | Low | Schema supports nullable `patientId` on invoice | Present |
| Daily sales summary (end-of-day report) | Cashier close-out; required by most franchise/chain SOPs | Low | `billing.service.ts#endOfDaySummary` exists | Present |

### Drug Schedule Compliance

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| Schedule H hard block at billing | Drugs and Cosmetics Rules 1945 Rule 65 — Schedule H drugs must only be sold against valid prescription; selling without Rx is a criminal offence (imprisonment up to 3 years) | Med | Schema: `requiresPrescription` flag on medicines; CONCERNS.md notes enforcement is incomplete | CRITICAL — must be a hard block, not warning |
| Schedule H1 hard block + pharmacist counter-sign | Schedule H1 (stricter) requires recording pharmacist name and Rx details in register; naloxone, antiretrovirals, etc. | Med | `isControlled` column exists but H1 enforcement not separated from H | H1 needs distinct handling |
| Schedule X manual override + double audit | Benzodiazepines, strong opioids; must maintain quantity register; pharmacist must manually approve each sale with documented reason | High | Not implemented — `scheduleClass` field exists but no special workflow | HIGH priority for compliance |
| Prescription validation before finalization | Verify Rx: not expired, not fully dispensed, issued by registered doctor (MCI reg no), issued within validity period | Med | `prescriptions` table has `expiryDate`, `status`, pharmacist `verifiedBy` fields; validation service not wired to billing | Present in schema, absent in code |
| Prescription upload and image storage | Regulation requires copy of prescription to be kept; digitizing reduces physical storage | Med | `fileUrl` on prescriptions table; MinIO configured; upload endpoint not built | Present in infra, service missing |
| Refill tracking per prescription | Prevent dispensing more than prescribed; critical for controlled substances | Low | `quantityPrescribed` and `quantityDispensed` per prescription_item exist | Present in schema |

### Inventory

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| FEFO batch dispensing | Legal and operational: selling expired or near-expiry medicine first causes patient harm and legal liability | Med | `inventoryBatches` table has `expiryDate`; `getBatchesForDispense()` exists in inventory service | Partially wired |
| Near-expiry alerts (30/60/90 day) | Prevents write-off loss; required SOP in most pharmacy chains | Low | `ExpiryScanProcessor` job defined but not fully implemented | Bull job skeleton exists |
| Expired batch quarantine/write-off | Expired stock must not be sold; write-offs must be recorded for audit and GST purposes (input credit reversal) | Med | `batchStatus = 'expired'` enum exists; processor marks them | Present in schema |
| Batch status: recalled | Drug recall orders from CDSCO/state drug controller; pharmacies must quarantine recalled batches immediately | Med | `recalled` status in `batchStatusEnum` | Present in schema, no recall notification workflow |
| Low-stock reorder alert | Operational — running out of essential medicines damages patient trust | Low | `ReorderCheckProcessor` job skeleton; `reorderLevel` on medicines table | Skeleton exists |
| Stock adjustment with reason code | For write-offs, breakage, audit corrections; must have audit trail | Low | `stockMovements` table is append-only ledger; adjustment endpoint not complete | Schema present |
| Purchase order → GRN → batch creation flow | Proper goods receipt ties supplier invoice to batch; required for GST input credit (purchase must match invoice) | High | Schema complete (`purchaseOrders`, `goodsReceivedNotes`, `grnItems`); service flow not wired | Schema present, service pending |

### Regulatory Reports (Legally Required)

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| GSTR-1 monthly export | Mandatory GST filing for registered businesses; data must match invoice records exactly | High | No reports module exists | CRITICAL GAP |
| Schedule H dispensing register | Rule 65(11) of D&C Rules: every pharmacy must maintain a register of Schedule H drug sales with patient name, Rx details, prescriber name, date, quantity. Must be produced on inspection | High | No reports module exists | LEGALLY REQUIRED |
| Schedule X quantity register | Stricter than H; separate running quantity register with balances | High | Not implemented | Legally required if stocking Schedule X drugs |
| Drug license expiry tracking | State drug control board requires active drug license; lapse = illegal operation | Low | `branches` table does not have drug license fields in current schema (missing from billing schema vs CLAUDE.md spec) | Schema gap |

### Patient and Prescription Management

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| Patient registration with phone lookup | Fast patient identification for repeat customers; allergy check | Low | `patients` table: name, phone (unique), allergies[] | Present |
| Allergy cross-check at billing | Patient safety; pharmacist duty of care | Med | `allergies` array exists; cross-check not wired to billing | Schema present, logic missing |
| Patient purchase history | Patients ask "what did I buy last time?"; also needed for refill decisions | Low | Derivable from `salesInvoices` join | Present via join |

### Authentication and Access Control

| Feature | Why Expected | Complexity | Codebase Status | Notes |
|---------|--------------|------------|-----------------|-------|
| Role-based access (8 roles) | Different staff see different screens; cashier must not void invoices; inventory manager must not access payroll | Med | `userRoleEnum` with 8 roles; JWT guards + RolesGuard | Present |
| Branch-scoped access | Multi-branch pharmacy; staff see only their branch data | Med | `branchId` on users and all key tables | Present in schema |
| Audit log on all financial operations | Mandatory for regulatory compliance; required to detect fraud | Med | `AuditInterceptor` logs all actions | Present |

---

## Differentiators

Features that set the product apart from basic billing software. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Patient allergy warning at POS | Active safety check: warn pharmacist if item being billed matches patient's recorded allergy | Med | Data is present; needs UI alert + block/confirm pattern |
| Loyalty points (earn and redeem) | Retention mechanism common in chain pharmacies; 1 pt/Rs.100, 100 pts = Rs.10 discount | Low | Schema: `loyaltyPoints` on patients; earning/redemption logic missing |
| Insurance claim ID on patient + invoice | Some patients have group health insurance; linking claim IDs to invoices simplifies reimbursement | Low | `insuranceId` on patients table; invoice notes can hold claim ref |
| Automated reorder draft PO on low stock | Reduces manual work; ReorderCheckProcessor can auto-create draft PO when stock hits reorderLevel | Med | Job skeleton exists; auto-PO creation not implemented |
| SMS/WhatsApp invoice to patient | Patients in India heavily use WhatsApp; digital invoice is more useful than paper | High | Deferred to Phase 3 per PROJECT.md |
| OCR prescription parsing | Pre-fill prescription items from uploaded image; pharmacist reviews and confirms | Very High | `ocrRawText` column exists on prescriptions — schema anticipates this | Phase 3+ |
| Demand forecasting by season | Some drugs are seasonal (antihistamines, flu medicines); reduce over/under stocking | Very High | Phase 3 |
| Staff performance metrics | Invoices/day, average invoice value, return rate per staff member | Low | Derivable from invoices join by `staffId` | Simple query |
| Real-time dashboard (WebSocket) | Live inventory alerts, low-stock, expiry — pushed not polled | Med | Socket.IO configured; not yet wired to events |
| ABC analysis of inventory | Classify products by sales value (A=top 20%, B=mid 30%, C=bottom 50%); helps purchasing decisions | Med | Reportable from `stockMovements` + `salesInvoiceItems` data |
| Prescription expiry SMS reminder | Notify patient before their repeat prescription expires | High | Requires WhatsApp/SMS integration (Phase 3) |
| Multi-payment split with change calculation | Auto-calculate change when patient overpays in cash | Low | UI feature, backend supports multiple payment rows |
| Configurable tax profiles per branch | Different state VAT legacy combinations edge cases; GST is national but some special zones exist | Med | Currently single `taxPercent` per medicine |
| QC workflow in GRN | Mark goods as quarantine on receipt pending quality check before putting in sellable stock | Low | `qcPassed` boolean on `goodsReceivedNotes` exists | Schema present |

---

## Anti-Features

Features to explicitly NOT build in v1, with clear reasoning.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Offline-first with full sync | The existing `isOfflineSync` flag suggests this was considered. Offline invoice creation with sync is extremely complex to get right (conflict resolution, duplicate prevention, partial stock state). CONCERNS.md documents current offline queue is broken. | Build a reliable online-first system with a solid connection indicator. Address atomic race conditions first. Offline support is Phase 4+ after the base is stable. |
| Insurance claim management / NHIS integration | Complex, hospital-pharmacy interface, claim adjudication logic, insurer-specific APIs — a different product domain entirely | Store insurance ID and notes only. Full insurance module is Phase 6. |
| Accounting integration (Tally/Zoho) | Real-time two-way sync with accounting software requires deep domain expertise in each target system and is error-prone at this stage | Export GST-ready data (GSTR-1) that accountants import manually. Direct integration is Phase 6. |
| Multi-branch stock transfer UI | Transfers require a separate physical dispatch, transit state, confirmation on receipt, and branch-level financial adjustments. Operational complexity before base module is stable = risk | Schema has `transferStatusEnum`; build the backend data model but expose no UI. Phase 4 feature. |
| Drug interaction checking | Requires integration with a pharmaceutical database (RxNorm, CDAC, or licensed clinical database). Licensing cost + accuracy liability is not viable for v1 | Note allergy data but do not check drug-drug interactions. Flag for Phase 5+. |
| Patient-facing mobile app | Separate product stream, different compliance requirements (telemedicine rules), full-stack expansion when current ERP is incomplete | Pharmacy staff web app only in v1. |
| E-pharmacy / online ordering | Regulated separately under Drugs and Cosmetics Act amendments; requires separate e-pharmacy license | Out of scope. |
| Demand forecasting / ML | Requires sufficient historical data (minimum 12 months) and ML infrastructure. Meaningless for a new install | Phase 3, after data accumulation. |
| Payroll / salary disbursement | HR module should track attendance and compute payable hours, but actual salary disbursement requires bank integration, TDS deduction, PF/ESI compliance — separate HR software domain | Attendance + leave tracking only. Salary computation export (not disbursal) is acceptable. |
| WhatsApp/SMS in v1 | Third-party API cost, message template approval, vendor integration effort — distraction from core compliance | Log notifications in DB (notification record). Dispatch via queue to dead-end in v1; wire MSG91/Twilio in Phase 3. |

---

## Feature Dependencies

```
GST invoice print
  requires: CGST/SGST/IGST split columns on salesInvoices table (schema fix)
  requires: Invoice PDF generation
  requires: Branch GSTIN, drug license fields on branches

Schedule H billing block
  requires: requiresPrescription flag on medicines (present)
  requires: Prescription verification status (present)
  requires: Billing service checking invoice.prescriptionId before finalization (MISSING)

GSTR-1 export
  requires: CGST/SGST/IGST split columns on salesInvoices (schema fix first)
  requires: HSN code per invoice line (present via medicineId join)
  requires: Branch GSTIN (branches schema gap)
  requires: Patient GSTIN for B2B sales (optional for retail; patient table lacks GSTIN)

Schedule H dispensing register
  requires: Schedule H tag on medicines (scheduleClass present)
  requires: Patient name + phone per invoice (present via patientId join)
  requires: Prescription doctor name + Rx number (present via prescriptionId join)
  requires: Reports module (missing)

FEFO fully wired
  requires: Inventory service getBatchesForDispense (present)
  requires: Billing service calling selectBatches before adjustQuantity (partial)
  requires: Stock reservation to prevent concurrent oversell (MISSING — CONCERNS.md)

Purchase → GRN → stock flow
  requires: PO status transitions (schema complete)
  requires: GRN service creating batches from grnItems (not wired)
  requires: StockMovements created per GRN line (not wired)

Loyalty points
  requires: Patient record (present)
  requires: Earn logic in billing service (missing)
  requires: Redeem as discount type in billing (missing)

Patient allergy check
  requires: allergies[] on patient (present)
  requires: Medicine generic name / active ingredient (only genericName, no ingredient list)
  requires: Billing service cross-check before adding item (missing)
```

---

## MVP Recommendation

### Must ship in current milestone (Phase 1-G / 1-H completion)

1. **Schema fix: CGST/SGST/IGST columns** — Without these, GST compliance is impossible. Add `cgstAmount`, `sgstAmount`, `igstAmount` to `salesInvoiceItems` and `cgstTotal`, `sgstTotal`, `igstTotal` to `salesInvoices`. The TaxService already computes the breakdown; it just isn't persisted.

2. **Schedule H billing hard block** — Wire `requiresPrescription` check in `billing.service.ts` before `createInvoiceWithItems`. If any item has `requiresPrescription=true`, and `dto.prescriptionId` is null or prescription status is not `verified`, throw 422. Non-negotiable for regulatory compliance.

3. **Stock reservation (concurrent safety)** — Add `reservedQty` to `inventoryBatches`. Reserve on cart add, release on cart clear, commit on finalize. This is CONCERNS.md item #2 and prevents overselling.

4. **Invoice number race condition fix** — Redis INCR (or PostgreSQL sequence) before going live. Already identified in CONCERNS.md.

5. **GSTR-1 report** — Basic monthly export with B2B/B2C breakdown, HSN summary, tax amounts. CSV acceptable. Required before any pharmacy can use this for real filing.

6. **Schedule H dispensing register** — Date-range export of Schedule H/H1 sales with patient + Rx details. Drug inspector will ask for this on visit.

7. **Sales return flow** — Create return invoice (isReturn=true), restock batches, record negative payment (refund). Pharmacies process returns daily.

8. **Invoice PDF generation** — GST-compliant format with all mandatory fields. Even a simple HTML-to-PDF is acceptable for v1.

### Defer to later (Phase 2+ polish)

- Loyalty points earn/redeem (nice-to-have, schema present)
- Auto-draft PO on low stock (convenience)
- Real-time WebSocket alerts (convenience)
- Staff performance metrics (convenience)
- ABC inventory analysis (useful, but not blocking)

---

## Regulatory Reference Notes

**Confidence: MEDIUM** — Based on training knowledge of Indian pharmaceutical law up to Aug 2025. Verify against current CDSCO/state drug controller notifications before production deployment.

- **Drugs and Cosmetics Act, 1940 + Rules, 1945** — Governs all retail pharmacy operations.
- **Rule 65** — Conditions for retail sale; Schedule H must have prescription.
- **Schedule H** — Prescription-required drugs (antibiotics, systemic corticosteroids, etc.). Approx 536 drugs. Selling without Rx: 3 years imprisonment + fine.
- **Schedule H1** — Stricter schedule (antiretrovirals, XDR-TB drugs, certain antibiotics); requires pharmacist to maintain a separate register with patient details.
- **Schedule X** — Psychotropics/narcotics (benzodiazepines, opioids, barbiturates); requires a running quantity register with opening/closing balance, retained for 2 years.
- **GST compliance** — Pharmacy above Rs.20 lakh annual turnover must register; most chains are above threshold. GSTR-1 monthly for turnover above Rs.5 crore (quarterly otherwise). Pharma GST rates: 0% (generic essential medicines), 5% (some OTC), 12% (most branded), 18% (medical devices). HSN classification is the authoritative source.
- **Drug license renewal** — State Drug Controller; must be renewed; selling with lapsed license is a criminal offence. The system should warn 60 days before expiry.
- **Narcotics and Psychotropics (NDPS Act)** — Substances under NDPS require separate Form 7 licensing from CBNAAT/NCB; retail pharmacy rarely stocks these but if they do, the quantity register requirements are severe.

---

## Sources

- Existing codebase schema: `backend/src/database/schema/` (audit date 2026-04-28)
- Existing concerns: `.planning/codebase/CONCERNS.md`
- Project requirements: `.planning/PROJECT.md`
- CLAUDE.md implementation guide (project root)
- Training knowledge: Drugs and Cosmetics Act 1940/Rules 1945, GST Rules 2017, Indian pharma ERP market (Marg ERP, GoFrugal, Vyapar, HealthPlix) — confidence MEDIUM, cutoff Aug 2025
- Confidence on regulatory items: MEDIUM — statutes are stable but CDSCO issues notifications; verify current Schedule H list from CDSCO website before production
