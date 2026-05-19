# PharmERP — Production Requirements Checklist

> Track every gap from development to production-ready deployment.
> Status: `[ ]` not started · `[~]` in progress · `[x]` done

---

## LEGEND

- **P0** — Blocker. App will crash or be insecure without this.
- **P1** — Required before first real user or pharmacy goes live.
- **P2** — Required before scaling beyond one branch or pilot.
- **P3** — Important for long-term operations but deferrable 30-90 days.

---

## 1. CRITICAL SCHEMA / DATABASE FIXES

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 1.1 | P0 | Export `systemAlerts` table from schema index — reorder engine and expiry scanner insert into this table at runtime, causing crashes | `backend/src/database/schema/index.ts` |
| 1.2 | P0 | Verify `branches` table is exported in schema/index — seed and controllers reference it | `backend/src/database/schema/index.ts` |
| 1.3 | P1 | Add missing index on `prescriptions(status)` and `prescriptions(expiry_date)` — hit on every Schedule H billing check | migration |
| 1.4 | P1 | Add missing index on `inventory_batches(expiry_date, quantity)` — hit on every FEFO batch selection | migration |
| 1.5 | P1 | Add missing index on `sales_invoices(branch_id, created_at)` — hit on all reports queries | migration |
| 1.6 | P2 | Write seed script for production: admin user only, no demo data, strong random passwords | `backend/src/database/seed.prod.ts` |
| 1.7 | P2 | Add `branches` table soft-delete and audit fields if not already present | schema check |
| 1.8 | P3 | Add `system_logs` table for detailed application-level audit trail (beyond `audit_logs`) | new migration |

---

## 2. AUTH & SECURITY

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 2.1 | P0 | Add rate limiting on `POST /auth/login` — currently no brute-force protection | `backend/src/main.ts`, `auth.controller.ts` |
| 2.2 | P0 | Add `@nestjs/throttler` globally; skip on non-auth routes; Redis-backed store | `backend/src/app.module.ts` |
| 2.3 | P0 | Add helmet (security headers: CSP, HSTS, X-Frame-Options, etc.) to Fastify bootstrap | `backend/src/main.ts` |
| 2.4 | P1 | Implement Forgot Password / Reset Password flow: generate time-limited token, send email, validate, update hash | `auth.service.ts`, `auth.controller.ts` |
| 2.5 | P1 | Implement account lockout after N failed login attempts (5 attempts → 15 min lock, store in Redis) | `auth.service.ts` |
| 2.6 | P1 | Implement TOTP-based MFA: schema fields `twoFaSecret`, `twoFaEnabled` already exist — wire up generate/verify with `otplib` | `auth.service.ts`, `auth.controller.ts` |
| 2.7 | P1 | Add email verification on registration (send OTP, block login until verified) | `auth.service.ts` |
| 2.8 | P1 | Harden CORS: validate `CORS_ORIGIN` is a strict allowlist, reject wildcard in production | `backend/src/main.ts` |
| 2.9 | P1 | Add response compression (`@fastify/compress`) | `backend/src/main.ts` |
| 2.10 | P2 | Add request logging middleware (Pino request logger, log method+path+status+latency) | `backend/src/main.ts` |
| 2.11 | P2 | Rotate JWT private/public key pair with real 4096-bit RSA key for production (current dev key is in `.env`) | `.env.production` |
| 2.12 | P2 | Add Redis password to production Redis config (currently no auth on Redis) | `docker-compose.prod.yml`, `.env.production` |
| 2.13 | P3 | Implement OAuth2 / Google SSO for staff login (optional but useful) | new auth flow |
| 2.14 | P3 | Add IP allowlist option for admin accounts | `auth.service.ts` |

---

## 3. BACKEND — BILLING MODULE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 3.1 | P1 | Validate that `voidInvoice` correctly reverses all stock movements (audit by querying `stock_movements` after void in integration test) | `billing.service.ts` |
| 3.2 | P1 | Add duplicate invoice guard: prevent same `branchId + invoiceNo` combination | `billing.repository.ts` |
| 3.3 | P1 | Handle PDF generation failure gracefully: if S3 upload fails, retry 3×, then mark invoice with `pdfStatus: 'failed'` and surface in UI | `invoice-pdf.worker.ts` |
| 3.4 | P2 | Implement credit memo workflow: issue credit note for a voided/returned invoice for accounting reconciliation | new service method |
| 3.5 | P2 | Implement loyalty point redemption at POS: patient can redeem N points = ₹X discount at checkout | `billing.service.ts`, POS frontend |
| 3.6 | P2 | Add `END_OF_DAY` reconciliation endpoint: lock day, generate EOD summary, persist to `eod_reports` table | new endpoint |
| 3.7 | P3 | Payment gateway integration (Razorpay or PayU) for card/UPI: webhook for payment confirmation | new integration |
| 3.8 | P3 | Add installment / credit billing for institutional clients (hospital accounts) | new workflow |

---

## 4. BACKEND — INVENTORY MODULE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 4.1 | P1 | Implement damage / expiry write-off endpoint: manually reduce batch qty with reason and `WRITE_OFF` movement type | `inventory.service.ts` |
| 4.2 | P1 | Implement batch quarantine: mark a batch as `QUARANTINE`, block from billing/FEFO selection | `inventory.service.ts`, schema |
| 4.3 | P1 | Barcode uniqueness validation on medicine create/update | `inventory.service.ts` |
| 4.4 | P2 | Implement auto-draft PO generation from reorder engine: when stock drops below `reorderLevel` and medicine has `preferredSupplierId`, create draft PO | `reorder-check.processor.ts` |
| 4.5 | P2 | Implement batch recall workflow: mark batches by batch number as recalled, generate alert + affected invoice list | new service method |
| 4.6 | P2 | Add Elasticsearch indexing for medicine search: index on create/update, search via ES instead of ILIKE | `inventory.service.ts`, new ES service |
| 4.7 | P3 | ABC analysis report: classify medicines into A/B/C tiers by revenue contribution | `reports.service.ts` |

---

## 5. BACKEND — PROCUREMENT MODULE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 5.1 | P1 | Validate that GRN correctly creates `inventoryBatches` records and `stockMovements` of type `PURCHASE` — audit in integration test | `procurement.repository.ts` |
| 5.2 | P1 | Add PO amendment: allow editing items/quantities while status is `draft` or `pending_approval` | `procurement.service.ts` |
| 5.3 | P2 | Implement 3-way invoice matching: PO → GRN → supplier invoice with variance report | new service method |
| 5.4 | P2 | Lead time tracking: record expected vs actual delivery date per PO, feed into supplier performance score | schema + service |
| 5.5 | P3 | Supplier performance dashboard: on-time delivery %, fill rate, invoice accuracy | `reports.service.ts` |

---

## 6. BACKEND — HR MODULE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 6.1 | P1 | Validate leave balance before approval: prevent approving leave if employee has exhausted quota | `hr.service.ts` |
| 6.2 | P1 | Add annual leave balance reset (yearly cron job resets `sickLeaveBalance`, `casualLeaveBalance`) | new cron job |
| 6.3 | P2 | Implement basic payroll calculation: `baseSalary - lossOfPay(unpaidDays) + overtime` per month | new service method |
| 6.4 | P2 | Generate salary slip PDF (using PDFKit, similar to invoice worker) | new worker |
| 6.5 | P3 | Shift management: define shifts (morning/afternoon/night), assign employees to shifts | new schema + service |
| 6.6 | P3 | PF/ESI/PT compliance report export | `reports.service.ts` |

---

## 7. BACKEND — DISTRIBUTION MODULE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 7.1 | P1 | Validate that `deliver()` correctly creates stock movements: +qty in destination warehouse, -qty in source warehouse | `distribution.service.ts` (integration test) |
| 7.2 | P1 | Add in-transit stock movement: deduct from source on `approve`, add to destination on `deliver` | `distribution.repository.ts` |
| 7.3 | P2 | Partial delivery: allow delivering a subset of items, update transfer status to `partial` | `distribution.service.ts` |
| 7.4 | P3 | Transfer rejection investigation workflow: log reasons for rejected items | new schema field |

---

## 8. BACKEND — NOTIFICATIONS & ALERTS

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 8.1 | P1 | `systemAlerts` schema export fix (see 1.1) — until fixed, expiry and reorder jobs crash | `schema/index.ts` |
| 8.2 | P1 | Implement email delivery for critical alerts: low stock, near expiry (use Resend or Nodemailer + SMTP) | new notification service |
| 8.3 | P1 | Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` to `.env` and config | `backend/.env.example` |
| 8.4 | P2 | Implement SMS delivery for Schedule H prescription alerts and critical stock events (MSG91 or Twilio) | new SMS service |
| 8.5 | P2 | Add dead-letter queue handling: failed jobs after max retries → notify admin via email | `backend/src/jobs/` |
| 8.6 | P2 | Add BullMQ dashboard (Bull Board) behind admin auth | new route |
| 8.7 | P3 | WhatsApp notifications for patient invoice delivery (WhatsApp Business API) | new integration |

---

## 9. BACKEND — REPORTS & COMPLIANCE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 9.1 | P1 | GSTR-1 JSON export in government-mandated format (B2B, B2C, CDNR sections) — current CSV is informational only | `reports.service.ts` |
| 9.2 | P1 | Schedule H register: verify format matches D&C Act requirement (patient address, ID proof type required) | `reports.service.ts` |
| 9.3 | P1 | Add `GET /reports/expiry?branchId=&days=` endpoint returning expiring batches (frontend alert panel calls this) | `reports.controller.ts` |
| 9.4 | P2 | GSTR-3B monthly summary (aggregate tax payable by rate slab: 5%, 12%, 18%) | `reports.service.ts` |
| 9.5 | P2 | Profit & loss report per product: `(selling_price - purchase_price) * qty` by time range | `reports.service.ts` |
| 9.6 | P3 | ABC analysis: rank medicines by revenue contribution (A = top 20% by value, B = 30%, C = 50%) | `reports.service.ts` |
| 9.7 | P3 | Export reports to Excel (`.xlsx`) using `exceljs` — CSV works but pharmacies expect Excel | `reports.controller.ts` |

---

## 10. FRONTEND — POS TERMINAL

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 10.1 | P1 | Verify offline sync conflict resolution: what happens if same invoice is created offline on two devices simultaneously? | `pos-terminal.tsx`, `pos-db.ts` |
| 10.2 | P1 | Add Prescription selector in POS: when Schedule H item is added, require linking an Rx before checkout can proceed | `pos-terminal.tsx` |
| 10.3 | P1 | Display patient loyalty points balance at POS when patient is selected, with redeem option | `pos-terminal.tsx` |
| 10.4 | P1 | Print invoice on checkout: `window.print()` with `@media print` CSS showing only invoice content | `pos-terminal.tsx` |
| 10.5 | P1 | Handle stock-out gracefully: if FEFO returns insufficient batches, show per-item stock availability and block checkout | `pos-terminal.tsx` |
| 10.6 | P2 | Hold / recall cart: allow cashier to park an in-progress sale and start a new one | `pos-terminal.tsx` |
| 10.7 | P2 | Quick product favourites: pin top-10 frequently sold items for one-click add | `pos-terminal.tsx` |
| 10.8 | P3 | Thermal printer support: ESC/POS receipt output for 80mm thermal printers | new util |
| 10.9 | P3 | Payment gateway widget: embed Razorpay/PayU QR code for UPI payments, auto-confirm on webhook | `payment-modal.tsx` |

---

## 11. FRONTEND — BILLING

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 11.1 | P1 | Show PDF generation status in invoice list: "Generating..." spinner if `pdfUrl` is null | `frontend/app/(shell)/billing/page.tsx` |
| 11.2 | P1 | Invoice search and filter: by date range, patient name, invoice number, status | `billing/page.tsx` |
| 11.3 | P2 | Bulk export invoices as CSV/Excel for accountant | `billing/page.tsx` |
| 11.4 | P2 | EOD summary view in billing page: show today's totals, payment mode split | `billing/page.tsx` |

---

## 12. FRONTEND — INVENTORY

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 12.1 | P1 | Add damage/write-off form in Batches tab: select batch, enter qty and reason, submit | inventory batches component |
| 12.2 | P1 | Show expiry colour coding in batch list: red = expired, amber = expiring in 30d, green = OK | batch list component |
| 12.3 | P1 | Low stock alert banner on inventory page: count of medicines below reorder level | inventory page |
| 12.4 | P2 | Barcode label print: generate printable barcode for a batch (batch no, expiry, MRP) | batch detail |
| 12.5 | P2 | Batch quarantine action button in UI | batch list component |

---

## 13. FRONTEND — HR

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 13.1 | P1 | Show leave balance per employee (sick/casual/annual days remaining) in employee row | `employees-view.tsx` |
| 13.2 | P1 | Attendance calendar view: month grid showing P/A/L/HD per employee | new component |
| 13.3 | P2 | Payroll summary table: employee, days worked, unpaid days, gross salary per month | new component |
| 13.4 | P2 | Export attendance report as CSV | `leaves-view.tsx` |

---

## 14. FRONTEND — SETTINGS

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 14.1 | P1 | User invite: ensure invite email is sent with temp password (currently service creates user but no email delivery) | `users.service.ts` + email service |
| 14.2 | P1 | Password change in Security settings tab: wire `POST /auth/change-password` | `frontend/components/modules/settings/security-settings.tsx` |
| 14.3 | P1 | MFA setup in Security tab (enable/disable TOTP, show QR code) — backend must be built first (2.6) | settings frontend |
| 14.4 | P1 | Branch form must include GSTIN, Drug License No, License Expiry — required for GST reports and compliance | branch settings |
| 14.5 | P2 | Role permissions matrix display: show what each role can and cannot do | settings users tab |
| 14.6 | P2 | Audit log viewer in settings: searchable log of all admin actions | new component |

---

## 15. FRONTEND — REPORTS & COMPLIANCE

| # | Priority | Task | File(s) |
|---|----------|------|---------|
| 15.1 | P1 | GSTR-1 download must use actual branch GSTIN in filename, not blank | `reports-client.tsx` |
| 15.2 | P1 | Schedule H register: add patient address and ID proof fields to the download (required for D&C Act) | `reports.service.ts` + frontend |
| 15.3 | P2 | Add inventory valuation report tab: current stock value by warehouse | `reports-client.tsx` |
| 15.4 | P2 | Add expiry report tab: list of batches expiring in 30/60/90 days with action buttons | `reports-client.tsx` |
| 15.5 | P3 | Add profit margin report: product-level gross margin table | `reports-client.tsx` |

---

## 16. INFRASTRUCTURE & DEVOPS

| # | Priority | Task | Notes |
|---|----------|------|-------|
| 16.1 | P0 | Write `Dockerfile` for backend (multi-stage: build → production, non-root user) | `backend/Dockerfile` |
| 16.2 | P0 | Write `Dockerfile` for frontend (multi-stage: build → standalone Next.js output) | `frontend/Dockerfile` |
| 16.3 | P0 | Write `docker-compose.prod.yml`: no MinIO default creds, Redis with password, postgres with secrets, no ES single-node dev flag | `docker-compose.prod.yml` |
| 16.4 | P0 | Create `.env.production.example` with all required production variables documented | `.env.production.example` |
| 16.5 | P1 | Set up GitHub Actions CI pipeline: lint → typecheck → test on every PR | `.github/workflows/ci.yml` |
| 16.6 | P1 | Set up GitHub Actions CD pipeline: build Docker images → push to registry → deploy on merge to main | `.github/workflows/deploy.yml` |
| 16.7 | P1 | Write `nginx.conf`: reverse proxy to backend (:4000) and frontend (:3000), SSL termination, gzip, security headers | `nginx/nginx.conf` |
| 16.8 | P1 | Set up SSL/TLS: Let's Encrypt with Certbot or ACM (if AWS) | infra |
| 16.9 | P1 | Set up database backups: pg_dump daily cron to S3 with 30-day retention | cron / script |
| 16.10 | P1 | Change all default credentials in production: MinIO, Redis, PostgreSQL, JWT keys | `.env.production` |
| 16.11 | P1 | Set Redis maxmemory + eviction policy for production (`allkeys-lru`, `maxmemory 512mb`) | Redis config |
| 16.12 | P1 | Enable PostgreSQL connection pooling (PgBouncer) for production load | `docker-compose.prod.yml` |
| 16.13 | P2 | Set up monitoring: Prometheus metrics endpoint + Grafana dashboard (NestJS metrics plugin) | infra |
| 16.14 | P2 | Set up error tracking: Sentry for both backend and frontend | `main.ts`, `frontend/app/layout.tsx` |
| 16.15 | P2 | Set up log aggregation: ship Pino logs to Loki or CloudWatch | infra |
| 16.16 | P2 | Add health check endpoint `GET /health` with DB + Redis + S3 connectivity check | `backend/src/modules/health/` |
| 16.17 | P2 | Set up S3/MinIO bucket policies: private by default, presigned URLs only, lifecycle rules for old PDFs | MinIO / S3 config |
| 16.18 | P3 | Kubernetes manifests: Deployment, Service, Ingress, HPA for backend + frontend | `k8s/` |
| 16.19 | P3 | Set up CDN for frontend static assets (CloudFront or Cloudflare) | infra |
| 16.20 | P3 | Database read replica for reports queries (config already has `DATABASE_URL_READ`) | infra |

---

## 17. TESTING

| # | Priority | Task | Notes |
|---|----------|------|-------|
| 17.1 | P1 | Integration test: full invoice creation flow (branch → Schedule H gate → FEFO → payment → PDF queue) | `billing/__tests__/` |
| 17.2 | P1 | Integration test: GRN flow (create PO → approve → send → GRN → verify batch created + stock movement) | `procurement/__tests__/` |
| 17.3 | P1 | Integration test: stock transfer (create → approve → deliver → verify movements in both warehouses) | `distribution/__tests__/` |
| 17.4 | P1 | Unit test: GST calculation (intra-state CGST+SGST split, inter-state IGST, 0%/5%/12%/18% slabs) | `billing/__tests__/tax.service.spec.ts` (extend) |
| 17.5 | P1 | Unit test: FEFO batch selection (multiple batches, partial allocation, stock-out scenario) | `inventory/__tests__/` |
| 17.6 | P1 | Unit test: auth flows (login, refresh, logout, rate limit, lockout) | `auth/__tests__/` |
| 17.7 | P2 | E2E test (Playwright): login → POS → add medicine → checkout → verify invoice created | `e2e/` |
| 17.8 | P2 | E2E test (Playwright): create PO → GRN → verify inventory updated | `e2e/` |
| 17.9 | P2 | E2E test (Playwright): create prescription → verify → link to invoice → dispensed status | `e2e/` |
| 17.10 | P2 | Load test (k6 or Artillery): 100 concurrent POS checkouts, target < 500ms p95 | `load-tests/` |
| 17.11 | P2 | Security scan: OWASP ZAP against staging, fix all HIGH/CRITICAL findings | CI/CD pipeline |
| 17.12 | P3 | Mutation testing: verify test suite actually catches regressions | CI/CD |

---

## 18. COMPLIANCE & LEGAL (India-specific)

| # | Priority | Task | Notes |
|---|----------|------|-------|
| 18.1 | P0 | Drug & Cosmetics Act compliance: Schedule H / H1 / X dispensing only with verified Rx — **already implemented in billing gate** — verify in UAT | billing.service.ts |
| 18.2 | P0 | Schedule H Register must be maintained electronically per D&C Rules — ensure register is non-editable after generation | `reports.service.ts` |
| 18.3 | P1 | GST registration: GSTIN must be stored per branch and printed on every invoice | schema + PDF worker |
| 18.4 | P1 | Drug License Number must be printed on every invoice | `invoice-pdf.worker.ts` |
| 18.5 | P1 | Pharmacist name + registration number must appear on Schedule H invoices | `invoice-pdf.worker.ts` |
| 18.6 | P1 | Data retention policy: invoices and audit logs must be kept for minimum 5 years (legal requirement) | S3 lifecycle + DB policy |
| 18.7 | P1 | Patient data (DPDP Act 2023): implement data deletion / anonymisation on patient request | new endpoint |
| 18.8 | P2 | GSTR-1 filing: export must match exact format for government GST portal upload | `reports.service.ts` |
| 18.9 | P2 | Narcotic drugs (Schedule X): additional register, separate reporting to drug authority | new schema + report |
| 18.10 | P3 | NABH accreditation data points: traceability from prescription to dispensing to stock | audit trail completeness |

---

## 19. DOCUMENTATION

| # | Priority | Task | Notes |
|---|----------|------|-------|
| 19.1 | P1 | API documentation: ensure all endpoints have Swagger `@ApiOperation` summaries and response schemas | all controllers |
| 19.2 | P1 | Deployment runbook: step-by-step guide to deploy on a fresh server | `docs/deployment.md` |
| 19.3 | P1 | Environment variable reference: document every `.env` key, its purpose, and example value | `docs/env-reference.md` |
| 19.4 | P2 | Admin user manual: how to create branches, invite users, configure roles | `docs/admin-guide.md` |
| 19.5 | P2 | Pharmacist user manual: POS workflow, prescription verification, Schedule H dispensing | `docs/pharmacist-guide.md` |
| 19.6 | P3 | Data dictionary: all tables, columns, data types, constraints | `docs/data-dictionary.md` |

---

## IMPLEMENTATION ORDER

Work top-to-bottom within each priority level. Suggested sprint sequence:

### Sprint 1 — Unblock Everything (P0 items)
1.1, 1.2 (schema fixes) → 2.1, 2.2, 2.3 (security basics) → 16.1, 16.2 (Dockerfiles)

### Sprint 2 — Auth & Core Safety (P1 auth)
2.4 (password reset) → 2.5 (lockout) → 2.6 (MFA) → 2.7 (email verify) → 14.2, 14.3 (settings frontend)

### Sprint 3 — Data Integrity (P1 backend)
1.3–1.5 (indices) → 4.1, 4.2 (inventory write-off + quarantine) → 6.1, 6.2 (leave balance) → 3.1 (billing integration test)

### Sprint 4 — POS & Billing Completeness (P1 frontend)
10.1–10.5 → 11.1, 11.2 → 3.5 (loyalty redemption)

### Sprint 5 — Infra & CI/CD
16.3–16.12 → 17.1–17.6 (integration + unit tests)

### Sprint 6 — Compliance (P1 legal)
18.1–18.7 → 9.1, 9.2 (GSTR-1 + Schedule H format)

### Sprint 7 — Notifications & Monitoring
8.2–8.5 → 16.13–16.17

### Sprint 8 — Reports, Analytics, P2 features
All P2 items across sections 4–15

### Sprint 9 — Scale & Advanced (P3)
Elasticsearch, ClickHouse, Kubernetes, payment gateway, WhatsApp

---

## QUICK REFERENCE — CURRENT STATUS

| Module | Backend | Frontend | Tests | Overall |
|--------|---------|----------|-------|---------|
| Auth | 70% | 80% | 0% | 60% |
| Billing / POS | 90% | 85% | 30% | 75% |
| Inventory | 75% | 80% | 20% | 60% |
| Procurement | 85% | 90% | 0% | 60% |
| Prescriptions | 80% | 85% | 0% | 60% |
| Patients | 85% | 85% | 0% | 65% |
| HR | 80% | 85% | 0% | 55% |
| Distribution | 80% | 85% | 0% | 55% |
| Reports | 85% | 90% | 0% | 65% |
| Settings | 80% | 75% | 0% | 55% |
| Notifications | 50% | 70% | 0% | 40% |
| Infrastructure | 20% | 20% | — | 20% |
| Testing overall | — | — | 10% | 10% |
| **TOTAL READINESS** | | | | **~55%** |

---

*Last updated: 2026-05-19*
*Next review: after Sprint 1 completion*
