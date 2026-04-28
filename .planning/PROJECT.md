# MedERP — Pharma Medical ERP

## What This Is

A multi-branch pharmacy management system for Indian pharmacies. It handles POS billing with GST and Schedule H/H1/X drug compliance, FEFO batch inventory, purchase order management, patient records, prescription verification, staff attendance, and regulatory reports — all in a single web app used by pharmacists, cashiers, and managers.

## Core Value

A pharmacist can scan a product, add it to a bill, and complete a cash/UPI/card transaction in under 60 seconds, with stock, GST, and compliance records updated automatically.

## Requirements

### Validated

<!-- Already built and present in the codebase -->

- ✓ Turborepo + pnpm monorepo scaffold with `packages/types`, `packages/utils`, `backend/`, `frontend/` — Phase 1-A
- ✓ NestJS 10 backend with Fastify adapter — entry point at `backend/src/main.ts` — Phase 1-B
- ✓ Drizzle ORM with full database schema: users, branches, medicines, batches, invoices, patients, prescriptions, suppliers, purchase orders, staff, attendance, audit logs — Phase 1-C
- ✓ Core middleware: `GlobalExceptionFilter`, `TransformInterceptor`, `AuditInterceptor`, JWT guards, RBAC — Phase 1-D
- ✓ Auth module with login, refresh, JWT pair, argon2 password hashing, @Public/@Roles decorators — Phase 1-E
- ✓ Inventory module: FEFO batch selection, medicine search, low-stock queries — Phase 1-F (partial)
- ✓ Billing module structure: `BillingService`, `BillingController`, `BillingRepository` scaffolded — Phase 1-G (partial)
- ✓ Remaining module stubs: suppliers, purchase-orders, patients, prescriptions, staff, HR, distribution, reports, notifications — Phase 1-H (partial)
- ✓ Frontend Next.js 15 with App Router, Tailwind, Radix UI, Zustand, React Query, axios — Phase 2-A
- ✓ Auth store, cart store, API client with interceptors, middleware route protection — Phase 2-B (partial)
- ✓ Docker Compose: PostgreSQL 16, Redis 7, Elasticsearch 8, MinIO, ClickHouse — infrastructure

### Active

<!-- Still needs to be built per CLAUDE.md -->

- [ ] Complete billing module: FEFO batch selection wired to checkout, GST split (CGST/SGST/IGST), invoice finalization transaction, stock reservation, return flow — Phase 1-G
- [ ] Complete inventory module: near-expiry alerts, expired batch queries, stock adjustment endpoint, stock value report — Phase 1-F
- [ ] Complete purchase orders: GRN receive flow (batch creation + stock movements), PO status transitions — Phase 1-H
- [ ] Complete patients module: allergy check against invoice items, loyalty points earn/redeem — Phase 1-H
- [ ] Complete prescriptions module: verification flow, MinIO image upload, validity/refill checks — Phase 1-H
- [ ] Complete staff module: attendance check-in/out, performance metrics from invoices — Phase 1-H
- [ ] Reports module: sales, inventory ABC analysis, GST (GSTR-1 format), Schedule H dispensing register, CSV export — Phase 1-H
- [ ] BullMQ workers: expiry-scanner (daily cron), reorder-engine (6hr cron), notification delivery — Phase 1-H
- [ ] Swagger documentation on all routes: tags, summaries, request/response schemas — Phase 1-I
- [ ] Seed script: super admin, 2 branches, 20 products, 2 suppliers, 3 staff users — Phase 1-I
- [ ] POS terminal page: barcode scanner hook, cart UI, payment modal, invoice preview, print — Phase 2-C
- [ ] Dashboard: stat cards (today's sales, invoices, low stock, expiry alerts), charts, alert panels — Phase 2-D
- [ ] Remaining frontend pages: products, inventory, purchase orders, patients, prescriptions, suppliers, staff, reports, settings — Phase 2-D
- [ ] Frontend polish: error boundaries, toast notifications, export button, barcode scanner hook, PWA manifest, responsive breakpoints, print styles — Phase 2-E
- [ ] Fix race conditions and security gaps identified in `.planning/codebase/CONCERNS.md`: invoice numbering (Redis INCR), stock reservation, auth token storage — post-2-E

### Out of Scope

<!-- Not in CLAUDE.md v1 scope -->

- Elasticsearch full-text search integration — Phase 3 (future)
- WhatsApp Business API notifications — Phase 3 (future)
- Demand forecasting — Phase 3 (future)
- Multi-branch stock transfers — Phase 4 (future)
- Kubernetes / CI-CD pipeline — Phase 5 (future)
- Insurance claim management / Tally integration — Phase 6 (future)
- Mobile native app — web-first, mobile later
- OAuth login — email/password sufficient for v1
- Real-time chat — not pharmacy-relevant

## Context

- Existing codebase uses NestJS (not raw Fastify) — CLAUDE.md spec was written for raw Fastify but the implementation chose NestJS with Fastify adapter. This is a divergence to accept, not fix. All new code follows NestJS patterns.
- Package namespace is `@pharmerp/*` (not `@mederp/*` from CLAUDE.md). Do not rename.
- Billing and inventory modules have service/controller/repository files but critical logic (checkout transaction, FEFO wiring, GST calc) is incomplete.
- Zero test coverage currently — `vitest` configured but no test files exist. Test coverage is a post-v1 priority per CONCERNS.md.
- CONCERNS.md documents known bugs: invoice seq race condition, missing stock reservation, localStorage token storage risk. Address these before Phase 1-I sign-off.
- Drug schedules: OTC products bill freely. SCHEDULE_H/H1 require a verified prescription linked to the invoice. SCHEDULE_X requires pharmacist override + audit. This logic must be enforced in `billing.service.ts`.

## Constraints

- **Tech Stack**: NestJS + Fastify adapter, Drizzle ORM, Next.js 15, Tailwind + shadcn/ui, pnpm + Turborepo — do not introduce other frameworks
- **API Versioning**: All routes under `/api/v1/` — no exceptions
- **Soft Deletes**: All tables have `deleted_at` — never hard-delete user-visible data
- **Audit Fields**: All tables: `created_at`, `updated_at`, `created_by uuid` — enforced at DB level
- **GST Compliance**: Indian GST rules — intra-state = CGST + SGST, inter-state = IGST. Rate lookup by HSN code.
- **FEFO**: Stock dispensed oldest-expiry-first. Never bypass for convenience.
- **Schedule H Enforcement**: `requiresRx = true` products must have a linked verified prescription before billing can finalize. Hard block, not a warning.
- **Regulatory**: Schedule H dispensing register and GSTR-1 export are legally required — must be in v1 reports.
- **Security**: No secrets hardcoded. All env vars in `.env`. Token handling must be reviewed before production deploy.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| NestJS over raw Fastify | Codebase was started with NestJS; migration would cost more than benefit | — Accept divergence |
| `@pharmerp/*` namespace | Already in use across codebase; renaming to `@mederp` would break all imports | — Accept as-is |
| Next.js 15 over 14 | Used in existing frontend; App Router API compatible | — Accept |
| Drizzle ORM | Type-safe, lightweight, works well with NestJS without heavy DI coupling | ✓ Good |
| Bull (not BullMQ) | `bull` 4.x is installed; BullMQ is the newer API — new workers should use BullMQ pattern via `@nestjs/bull` | — Pending migration |
| Redis INCR for invoice numbering | Non-atomic SELECT COUNT+1 is a race condition; Redis INCR is atomic | — Pending (fix in Phase 1-G) |
| Argon2id for passwords | Strong modern hashing; already in place | ✓ Good |

---
*Last updated: 2026-04-29 after initialization — brownfield project, codebase mapped*
