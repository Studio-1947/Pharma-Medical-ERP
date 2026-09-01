# PharmERP — Pharmacy Management System

A full-stack, production-grade pharmacy ERP system built for Indian retail pharmacies. Handles POS billing, GST-compliant invoicing, FEFO inventory, Schedule H compliance, procurement, HR, and multi-branch distribution.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Infrastructure & Services](#4-infrastructure--services)
5. [Database Design](#5-database-design)
6. [API Design](#6-api-design)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Core Business Flows](#8-core-business-flows)
9. [Background Jobs & Queues](#9-background-jobs--queues)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Security Model](#11-security-model)
12. [Development Setup](#12-development-setup)
13. [Database Management](#13-database-management)
14. [Environment Variables](#14-environment-variables)
15. [Deployment](#15-deployment)
16. [Troubleshooting](#16-troubleshooting)
17. [Known Issues & Hardening Backlog](#17-known-issues--hardening-backlog)

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│                                                                     │
│   Browser / PWA          Barcode Scanner       Mobile (responsive)  │
│   Next.js 15             USB HID events        Tailwind breakpoints  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS / WebSocket
┌───────────────────────────────▼─────────────────────────────────────┐
│                         API GATEWAY LAYER                           │
│                                                                     │
│   NestJS + Fastify adapter                                          │
│   ├── Global JWT Auth Guard (RS256)                                 │
│   ├── Role-based Access Guard (8 roles)                             │
│   ├── Global Exception Filter → standard JSON envelope             │
│   ├── Audit Interceptor → writes to audit_logs table               │
│   ├── Transform Interceptor → unwraps response data                │
│   ├── Rate Limiter (@nestjs/throttler)                              │
│   └── Swagger UI at /docs                                           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼───────┐     ┌─────────▼────────┐    ┌────────▼──────────┐
│  BUSINESS     │     │   ASYNC LAYER    │    │   STORAGE LAYER   │
│  MODULES      │     │                  │    │                   │
│               │     │  Bull + Redis    │    │  PostgreSQL 16    │
│  auth         │     │  ├── pdf-queue   │    │  (Drizzle ORM)    │
│  billing      │     │  ├── expiry-scan │    │                   │
│  inventory    │     │  └── reorder-eng │    │  Redis 7          │
│  procurement  │     │                  │    │  (sessions, cache,│
│  prescriptions│     │  Workers         │    │   invoice seq,    │
│  patients     │     │  ├── PDF gen     │    │   queue backend)  │
│  hr           │     │  ├── Expiry alert│    │                   │
│  distribution │     │  └── Reorder     │    │  MinIO (S3)       │
│  reports      │     │      alert       │    │  (prescription    │
│  users        │     │                  │    │   images, PDFs)   │
└───────────────┘     └──────────────────┘    └───────────────────┘
```

### Request lifecycle

```
Request
  │
  ├─ middleware.ts (Next.js Edge) ── no session cookie → redirect /login
  │
  ├─ Next.js page fetch → apiClient (axios)
  │    └─ Request interceptor: attach Bearer token from localStorage
  │
  ├─ NestJS Fastify server
  │    ├─ JwtAuthGuard     → verify RS256 JWT, load user
  │    ├─ RolesGuard       → check role permission
  │    ├─ Controller       → parse + validate body with Zod
  │    ├─ Service          → business logic
  │    ├─ Repository       → Drizzle query
  │    └─ AuditInterceptor → fire-and-forget audit log write
  │
  └─ Response
       └─ TransformInterceptor wraps in { data: ..., statusCode: ... }
```

---

## 2. Technology Stack

### Backend
| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Server runtime |
| Framework | NestJS | 10 | Modular application structure |
| HTTP Adapter | Fastify | 4 | High-performance HTTP server |
| ORM | Drizzle ORM | 0.33 | Type-safe SQL query builder |
| Database | PostgreSQL | 16 | Primary data store |
| Cache / Queue | Redis | 7 | Invoice sequences, cache, Bull backend |
| Job Queue | Bull (`@nestjs/bull`) | 4 | Background job processing |
| Barcode | bwip-js | 3.4 | Code-128 barcode PNG generation for shelf labels |
| Auth | Passport + JWT | RS256 | Stateless authentication |
| Password | Argon2id | — | Key stretching (2 iter, 64 MB) |
| Validation | Zod | 3 | Runtime schema validation |
| File Storage | MinIO (S3) | latest | Prescription images, invoice PDFs |
| PDF | pdfkit | 0.15 | Invoice PDF generation |
| Search | Elasticsearch | 8 | Medicine catalog search (Phase 3) |
| Analytics | ClickHouse | — | Time-series sales analytics (Phase 6) |

### Frontend
| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Framework | Next.js | 15 | App Router, SSR/RSC |
| UI Library | Tailwind CSS + Radix UI | 3.4 | Styling + accessible primitives |
| State | Zustand | 5 | Auth, cart, branch stores |
| Server State | TanStack Query | 5 | Data fetching, caching, mutations |
| Forms | React Hook Form + Zod | 7 | Validation, controlled forms |
| Charts | Recharts | 2 | Sales trend, category breakdowns |
| Tables | TanStack Table | 8 | Sortable, filterable data tables |
| Offline | Dexie (IndexedDB) | 4 | Offline POS queue + sync |
| HTTP Client | Axios | 1.7 | API calls with interceptors |
| Camera scanning | html5-qrcode | 2.3 | Camera-based barcode scanning (mobile/tablet) |

### Shared
| Package | Purpose |
|---|---|
| `@pharmerp/types` | Zod schemas + TypeScript types shared between frontend and backend (builds to `dist` — run `pnpm build` after editing) |
| `@pharmerp/utils` | Pure utilities (EAN-13 validation, currency, date helpers) |
| `@pharmerp/config-typescript` | Shared TypeScript config |

---

## 3. Repository Structure

```
pharmerp/
├── backend/                          # NestJS API (port 4000)
│   ├── src/
│   │   ├── main.ts                   # Fastify bootstrap
│   │   ├── app.module.ts             # Root module + all feature registrations
│   │   ├── common/
│   │   │   ├── decorators/           # @CurrentUser, @Roles, @Public
│   │   │   ├── guards/               # JwtAuthGuard, RolesGuard
│   │   │   ├── filters/              # GlobalExceptionFilter
│   │   │   ├── interceptors/         # AuditInterceptor, TransformInterceptor
│   │   │   └── pipes/                # Zod validation pipe
│   │   ├── database/
│   │   │   ├── schema/               # Drizzle table definitions (one file per domain)
│   │   │   │   ├── auth.ts           # users, refresh_tokens, audit_logs
│   │   │   │   ├── inventory.ts      # medicines, batches, movements, warehouses
│   │   │   │   ├── billing.ts        # sales_invoices, invoice_items, payments
│   │   │   │   ├── prescriptions.ts  # prescriptions, prescription_items
│   │   │   │   ├── procurement.ts    # suppliers, purchase_orders, grn_items
│   │   │   │   ├── hr.ts             # employees, attendance, leaves, departments
│   │   │   │   ├── distribution.ts   # branches, stock_transfers, transfer_items
│   │   │   │   └── enums.ts          # All pg enums (userRole, invoiceStatus, etc.)
│   │   │   ├── drizzle.service.ts    # DB connection singleton
│   │   │   ├── drizzle.module.ts     # Global module export
│   │   │   ├── seed.ts               # Dev seed data
│   │   │   └── migrations/           # drizzle-kit generated SQL migrations
│   │   └── modules/
│   │       ├── auth/                 # Login, refresh, register, JWT strategy
│   │       ├── users/                # User CRUD, invite, role change, deactivate
│   │       ├── inventory/            # Medicines, batches, warehouses, stock movements
│   │       ├── billing/              # Invoices, FEFO dispatch, GST, payments, returns
│   │       ├── prescriptions/        # Rx CRUD, verify, S3 image upload
│   │       ├── patients/             # Patient CRUD, loyalty points
│   │       ├── procurement/          # Suppliers, purchase orders, GRN
│   │       ├── hr/                   # Employees, attendance, leaves, departments
│   │       ├── distribution/         # Inter-warehouse stock transfers
│   │       ├── reports/              # GSTR-1, Schedule H register, sales reports
│   │       └── jobs/                 # BullMQ workers + cron schedulers
│   └── drizzle/
│       └── migrations/               # Migration SQL files + meta snapshots
│
├── frontend/                         # Next.js 15 (port 3000)
│   ├── app/
│   │   ├── (auth)/login/             # Public login page
│   │   └── (shell)/                  # Protected layout (sidebar + header)
│   │       ├── dashboard/
│   │       ├── billing/pos/
│   │       ├── inventory/
│   │       ├── procurement/
│   │       ├── patients/
│   │       ├── prescriptions/
│   │       ├── hr/
│   │       ├── distribution/
│   │       ├── analytics/
│   │       └── settings/
│   ├── components/
│   │   ├── ui/                       # Radix primitives (toast, modal, etc.)
│   │   ├── shared/                   # AppShell, Sidebar, Header, barcode scanner dialog
│   │   └── modules/                  # Feature-specific components
│   ├── hooks/                        # use-auth, use-permissions, use-barcode-scanner, etc.
│   ├── stores/                       # Zustand: auth, cart, branch
│   ├── queries/                      # React Query hooks per domain
│   ├── lib/
│   │   ├── api-client.ts             # Axios instance + interceptors + query keys
│   │   └── pos-db.ts                 # Dexie offline queue
│   └── middleware.ts                 # Next.js Edge: session cookie check
│
└── packages/
    ├── types/src/
    │   ├── enums.ts                  # UserRole, InvoiceStatus, PaymentMode, etc.
    │   └── dtos/                     # Zod schemas + inferred TS types per domain
    └── config-typescript/            # Shared tsconfig base
```

---

## 4. Infrastructure & Services

```
docker-compose.yml
│
├── postgres:5433   PostgreSQL 16 (postgres:16 image, host port 5433)
│                   Volumes: postgres_data
│                   User: pharmerp / password
│
├── redis:6379      Redis 7 Alpine
│                   Used for: Bull queues, cache, invoice sequence
│                   counters (INCR invoice_seq:{YYYY-MM-DD} — global
│                   daily counter, invoice no INV-YYYYMMDD-0001)
│
├── minio:9000      MinIO (S3-compatible object store)
│   :9001           Console UI at port 9001
│                   Buckets: pharmerp-bucket
│                   Used for: prescription images, invoice PDFs
│
├── elasticsearch:9200   Elasticsearch 8 (single-node, no security)
│                        Index: medicines
│                        Used for: fast medicine name/barcode search (Phase 3)
│
└── clickhouse:8123      ClickHouse 24.3 (HTTP :8123, native TCP :9009)
                         DB: pharmerp_analytics
                         Provisioned for Phase 4 analytics — not yet
                         consumed by the backend
```

### Service health checks

```bash
# PostgreSQL
docker exec pharmerp_postgres pg_isready -U pharmerp

# Redis
docker exec pharmerp_redis redis-cli ping

# MinIO
curl http://localhost:9000/minio/health/live

# Elasticsearch
curl http://localhost:9200/_cluster/health

# ClickHouse
curl http://localhost:8123/ping
```

---

## 5. Database Design

### Entity relationship overview

```
users ──────────────────────┐
  │ 1                        │ created_by (audit)
  │ creates                  │
  ▼ N                        │
employees ──── attendance    │
       └────── leaves        │
                             │
branches ─────────────────── │──────────────────────────────┐
  │ 1                        │                              │
  │                          │                              │
  ▼ N                        │                              │
warehouses ──────────────────┤                              │
  │ 1                        │                              │
  │ stocks                   │                              │
  ▼ N                        │                              │
inventory_batches ────────── │──────────────────┐           │
  │ belongs to               │                  │           │
  ▼                          │                  │           │
medicines ──── categories    │                  │           │
  │ supplied by               │                  │           │
  ▼                          │                  │           │
suppliers ─────────────────── │                  │           │
  │ 1                         │                  │           │
  ▼ N                         │                  │           │
purchase_orders               │                  │           │
  └── purchase_order_items    │                  │           │
       └── grn_items ─────────┘                  │           │
                                                 │           │
patients ────────────────────────────────────────┤           │
  │ has prescriptions                            │           │
  ▼                                              │           │
prescriptions ── prescription_items              │           │
  │ linked to                                    │           │
  ▼                                              │           │
sales_invoices ──────────────────────────────────┘           │
  │ 1                                                        │
  ├── N sales_invoice_items (each references batch)          │
  └── N payments                                             │
                                                             │
stock_transfers ─────────────────────────────────────────────┘
  └── stock_transfer_items
```

### Key table constraints

| Table | Notable constraints |
|---|---|
| `users` | `email UNIQUE`, `role` enum default `cashier` |
| `medicines` | `sku UNIQUE`; `barcode` nullable with a **non-unique** index — uniqueness is enforced at the service layer (create/update reject duplicates with 409, bulk import skips them) and 13-digit barcodes are EAN-13 checksum-validated in the shared Zod schema |
| `inventory_batches` | `(medicine_id, batch_no)` unique index **across the whole table** (not scoped per warehouse — a batch lives at exactly one location/warehouse at a time via `location_id → storage_locations.warehouse_id`), `expiry_date` index |
| `sales_invoices` | `invoice_no UNIQUE`, `status` enum, soft-delete via `deleted_at` |
| `sales_invoice_items` | Immutable after invoice confirmation |
| `payments` | No soft delete — financial record |
| `stock_movements` | Append-only ledger, no updates |
| `audit_logs` | Append-only, no deletes, no soft-delete |
| `refresh_tokens` | `token_hash UNIQUE`, `revoked_at` nullable |

### Soft deletes

All business tables except financial records (`payments`, `stock_movements`, `audit_logs`) carry a `deleted_at TIMESTAMPTZ` column. Repositories filter with `isNull(schema.table.deletedAt)` in all list queries.

---

## 6. API Design

### Base URL
```
http://localhost:4000/api/v1
```

### Versioning
All routes are prefixed `/api/v1/`. Future breaking changes increment to `/api/v2/`.

### Response envelope
Every response is wrapped by `TransformInterceptor`:

```json
{
  "data": { ... },
  "statusCode": 200
}
```

Errors from `GlobalExceptionFilter`:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email address" }
  ],
  "timestamp": "2025-05-19T10:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

### Pagination

List endpoints accept `?page=1&limit=20` and return:
```json
{
  "data": {
    "data": [...],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 145,
      "totalPages": 8
    }
  }
}
```

### Module endpoints

| Module | Base path | Key endpoints |
|---|---|---|
| Auth | `/auth` | POST login, POST refresh, POST register |
| Users | `/users` | GET list, POST invite, PATCH role, PATCH deactivate |
| Medicines | `/inventory/medicines` | GET list/search, POST, PATCH, GET low-stock |
| Batches | `/inventory/batches` | GET by medicine, POST (GRN), GET expiring |
| Billing | `/billing/invoices` | POST, GET, POST finalize, POST return, POST void |
| Prescriptions | `/prescriptions` | GET, POST, PATCH verify, POST upload-image |
| Patients | `/patients` | GET, POST, PATCH, GET invoices |
| Procurement | `/procurement/suppliers` | Full CRUD |
| Procurement | `/procurement/purchase-orders` | CRUD + approve + send + receive (GRN) |
| HR | `/hr/employees` | CRUD + deactivate |
| HR | `/hr/attendance` | POST check-in/out, GET by employee |
| HR | `/hr/leaves` | POST request, PATCH review |
| Distribution | `/distribution/transfers` | CRUD + approve + deliver + cancel |
| Reports | `/reports/gst` | GET (branchId, month, year) + CSV |
| Reports | `/reports/schedule-h-register` | GET (branchId, from, to) + CSV |
| Reports | `/reports/sales` | GET daily/weekly/monthly summary |

### Swagger UI
Interactive API documentation available at:
```
http://localhost:4000/docs
```
(`SwaggerModule.setup("docs", ...)` is not affected by the `api/v1` global prefix.)

---

## 7. Authentication & Authorization

### JWT flow

```
Client                      Server                          PostgreSQL
  │                            │                               │
  ├─── POST /auth/login ───────►│                               │
  │    { email, password }      │── argon2id verify password    │
  │                             │── sign access JWT (RS256, 15m)│
  │                             │── sign refresh JWT (RS256, 7d)│
  │                             │── sha256(refresh token) ──────►│ INSERT refresh_tokens
  │◄── { accessToken,           │                               │   (token_hash, expires_at)
  │      refreshToken } ────────│                               │
  │                             │                               │
  ├─── GET /any/protected ──────►│                               │
  │    Authorization: Bearer ... │── verify RS256 signature      │
  │◄── { data } ────────────────│                               │
  │                             │                               │
  ├─── POST /auth/refresh ──────►│                               │
  │    { refreshToken }          │── SELECT by sha256 hash ──────►│ token_hash match,
  │                             │◄──────────────────────────────│ not revoked, not expired
  │◄── { accessToken } ─────────│                               │
```

### Role hierarchy

```
SUPER_ADMIN  ──── all permissions + cross-branch access
    │
ADMIN        ──── all branch permissions
    │
    ├── PHARMACIST      ──── billing, prescription verify, inventory adjust
    │
    ├── CASHIER         ──── billing only (no Rx dispensing alone)
    │
    ├── INVENTORY_MANAGER ── inventory, procurement, no billing
    │
    ├── HR_MANAGER      ──── HR module only
    │
    ├── REPORTS_ANALYST ──── read-only reports
    │
    └── DISTRIBUTION_STAFF ── stock transfers only
```

### Permission enforcement

Guards are applied at the controller method level:
```typescript
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.PHARMACIST)
@UseGuards(JwtAuthGuard, RolesGuard)
@Post('invoices/:id/finalize')
finalizeInvoice(...) { }
```

`SUPER_ADMIN` bypasses role checks — enforced in `RolesGuard`.

---

## 8. Core Business Flows

### 8.1 POS Billing Flow (most critical)

```
Cashier opens POS terminal
        │
        ├── Scan barcode (USB scanner or camera dialog) / type name
        │       ├── GET /inventory/medicines?search=... (debounced 300ms;
        │       │     exact match on barcode/SKU, ILIKE on name)
        │       └── GET /inventory/medicines/:id/batches
        │               └── FEFO-ordered active batches (qty > 0, not expired)
        │
        ├── Add item to cart (Zustand cart store)
        │       └── POST /billing/invoices/:id/items
        │               ├── Schedule H gate: check linked verified Rx
        │               ├── Stock availability check
        │               └── FEFO batch selection (oldest expiry first)
        │
        ├── (Optional) Link patient
        │       └── GET /patients?phone=... → select → apply loyalty discount
        │
        ├── (Optional) Apply discount
        │       └── > 5% requires manager approval
        │
        ├── Click "Checkout" (F4 shortcut)
        │       └── POST /billing/invoices/:id/finalize
        │               ├── Validate payments sum ≥ total
        │               ├── Commit stock reservations → decrement batch quantities
        │               ├── Create stock_movement records (type: SALE)
        │               ├── Record payment records
        │               ├── Update invoice status → PAID / PARTIALLY_PAID
        │               ├── Update patient loyalty points (+1 per ₹100)
        │               └── Queue PDF generation job
        │
        └── Invoice preview → Print / WhatsApp share
```

### 8.2 GST Calculation (CGST / SGST / IGST)

```
for each line item:
  taxable_amount = unit_price × quantity × (1 - discount%)
  
  if supplier_state == branch_state:          # Intra-state
    cgst = taxable_amount × (gst_rate / 2)
    sgst = taxable_amount × (gst_rate / 2)
    igst = 0
  else:                                       # Inter-state
    cgst = 0
    sgst = 0
    igst = taxable_amount × gst_rate
  
  line_total = taxable_amount + cgst + sgst + igst

invoice totals = SUM(all line totals)
round_off = ROUND(grand_total) - grand_total
```

All monetary arithmetic uses `Decimal.js` to avoid float precision errors.

### 8.3 FEFO Batch Selection

```
selectBatchesForDispense(medicineId, requiredQty):
  
  batches = SELECT * FROM inventory_batches
            WHERE medicine_id = ?
              AND status = 'active'
              AND expiry_date > CURRENT_DATE
              AND quantity > 0
            ORDER BY expiry_date ASC          -- First Expired, First Out
  -- reserved_qty (e.g. stock mid-transfer) is subtracted from each batch's
  -- quantity in application code before allocating, not filtered in SQL
  
  allocated = []
  remaining = requiredQty
  
  for batch in batches:
    available = batch.quantity - batch.reserved_qty
    take = MIN(available, remaining)
    allocated.append({ batchId, batchNo, expiryDate, qty: take })
    remaining -= take
    if remaining == 0: break
  
  if remaining > 0:
    throw InsufficientStockException
  
  return allocated
```

### 8.4 Schedule H Dispensing Gate

```
When adding a controlled drug to cart:

  if medicine.scheduleClass IN (SCHEDULE_H, SCHEDULE_H1, SCHEDULE_X)
  OR medicine.requiresPrescription == true:
  
    prescription = invoice.linkedPrescription
    
    if prescription == null:
      throw 400 "Prescription required for {medicine.name}"
    
    if prescription.status != 'verified':
      throw 400 "Prescription not yet verified by pharmacist"
    
    if prescription.validUntil < TODAY:
      throw 400 "Prescription expired on {validUntil}"
    
    dispensed = SUM(qty dispensed in prior invoices for this Rx item)
    if dispensed + requestedQty > prescription_item.quantityPrescribed:
      throw 400 "Exceeds prescribed quantity ({prescribed} prescribed, {dispensed} already dispensed)"
```

### 8.5 Stock Transfer Flow

```
Inventory Manager (Branch A)
        │
        ├── Create draft transfer
        │       └── POST /distribution/transfers
        │               { fromWarehouseId, toWarehouseId, items: [{medicineId, batchId, qty}] }
        │
Admin approves
        │
        └── PATCH /distribution/transfers/:id/approve
                └── status: draft → in_transit, dispatchedAt = NOW()

Distribution Staff (Branch B receives)
        │
        └── PATCH /distribution/transfers/:id/deliver
                └── { status: "delivered", items: [{itemId, receivedQty, rejectedQty}] }
                        ├── Update received/rejected quantities per item
                        ├── Relocate the batch's locationId to a location in the
                        │     destination warehouse (same row — batchNo is unique
                        │     per medicine across the whole table, so transfers
                        │     move a batch's full quantity, not a partial split)
                        ├── INSERT stock_movements (type: transfer_reject_writeoff)
                        │     for any rejectedQty
                        └── status → delivered
```

> **Note:** A transfer's `requestedQty` must equal the batch's full available
> quantity (`quantity - reservedQty`) at creation time — partial transfers of
> a single batch aren't supported without a schema change (see
> [§17 Hardening Backlog](#17-known-issues--hardening-backlog)). `approve()`
> atomically sets `reservedQty = quantity` on each batch so it can't be sold
> or re-transferred while in transit; FEFO sale allocation
> (`selectBatchesForDispense`) excludes reserved quantity.

### 8.6 Purchase Order → GRN Flow

```
Inventory Manager
        │
        ├── Create Draft PO
        │       └── POST /procurement/purchase-orders
        │
Admin approves → status: pending_approval → approved
        │
        ├── Send to supplier → status: sent
        │
Supplier delivers → GRN (Goods Received Note)
        │
        └── POST /procurement/purchase-orders/:id/receive
                body: { items: [{poItemId, receivedQty, batchNo, expiryDate, purchasePrice}] }
                Transaction:
                  ├── Update grn_items.received_qty
                  ├── INSERT inventory_batches (new batch per item)
                  ├── INSERT stock_movements (type: PURCHASE)
                  └── Update PO status → partially_received | received
```

---

## 9. Background Jobs & Queues

### Queue architecture

```
Redis (Bull backend — @nestjs/bull + bull v4, not BullMQ)
├── Queue: pdf-generation
│     └── Worker: InvoicePdfWorker
│           ├── Triggered by: BillingService.finalizeInvoice()
│           ├── Generates PDF with pdfkit
│           ├── Uploads to MinIO at invoices/{year}/{month}/{invoiceNo}.pdf
│           └── Updates sales_invoices.pdf_url
│
├── Queue: system-alerts (implicit via cron workers)
│     └── ExpiryScanner (cron: 0 0 * * * — daily midnight)
│           ├── SELECT batches expiring within 30 days (qty > 0)
│           └── INSERT system_alerts records
│
└── Queue: system-alerts
      └── ReorderEngine (cron: 0 * * * * — hourly)
            ├── SELECT SUM(quantity) per medicine per warehouse
            ├── Compare against medicine.reorder_level
            └── INSERT system_alerts for items below threshold
```

### Adding a new job

1. Register the queue name in `backend/src/modules/jobs/jobs.module.ts` (`BullModule.registerQueue`)
2. Create a worker class decorated with `@Processor('queue-name')` and a `@Process()` handler method
3. Inject the queue in the service that triggers it: `@InjectQueue('queue-name')`
4. Add the worker to `jobs.module.ts` providers

---

## 10. Frontend Architecture

### State management layers

```
┌────────────────────────────────────────────────────────┐
│                    COMPONENT TREE                       │
│                                                        │
│  Page Component                                        │
│    ├── useQuery() ──────────────► TanStack Query Cache  │
│    │       └── apiClient.get()  ◄── axios interceptor  │
│    │                                  └── Bearer token │
│    │                                      from Zustand │
│    ├── useMutation() ──────────► optimistic update     │
│    │       └── invalidateQueries() on success          │
│    │                                                   │
│    └── Zustand stores (in-memory, localStorage persist)│
│           ├── useAuthStore   → user, token, logout     │
│           ├── useCartStore   → POS cart items, totals  │
│           └── useBranchStore → active branch           │
└────────────────────────────────────────────────────────┘
```

### Offline POS (Dexie + IndexedDB)

```
Network goes offline
        │
        ├── PosTerminal detects: navigator.onLine = false
        │
        ├── Checkout attempted
        │       └── queueOfflineInvoice(invoiceData)
        │               └── INSERT INTO offlineInvoices (Dexie, IndexedDB)
        │                       status: 'pending', attempts: 0
        │
Network restores
        │
        └── syncOfflineQueue()
                └── for each pending invoice:
                        ├── POST /billing/invoices (online)
                        ├── On success: mark status = 'synced'
                        └── On failure: increment attempts (max 3)
```

### Route protection

```
Next.js middleware.ts (Edge runtime)
        │
        ├── Read cookie: pharmerp_session
        │
        ├── Protected routes: /dashboard/*, /billing/*, etc.
        │       └── No cookie → redirect to /login?from={pathname}
        │
        └── Auth routes: /login
                └── Has cookie → redirect to /dashboard

There is no public self-signup route. New accounts are created by an
existing super_admin/admin via Settings → Users ("Invite User"), which
calls POST /auth/register with the inviter's own JWT — the endpoint
requires an authenticated caller and rejects creating super_admin
accounts entirely (seed script only).

Cookie is set on login (setTokens in auth.store.ts)
Cookie is cleared on logout (logout() in auth.store.ts)
Token itself stays in localStorage — never in cookie (XSS surface reduction)
```

### Query key conventions (`lib/api-client.ts`)

```typescript
queryKeys.medicines.all()              // ["medicines"]
queryKeys.medicines.list(params)       // ["medicines", "list", { page, search }]
queryKeys.medicines.detail(id)         // ["medicines", id]
queryKeys.invoices.list(params)        // ["invoices", "list", { ... }]
```

Invalidation strategy: mutations invalidate the `.all()` key, which cascades to list and detail keys.

---

## 11. Security Model

### Token security
- Access tokens: RS256 asymmetric JWT, 15-minute TTL, persisted in localStorage via the Zustand `persist` middleware (survives reload; accepted XSS trade-off — see §10 route protection note)
- Refresh tokens: RS256 JWT, 7-day TTL, stored server-side as a **sha256 hash in the Postgres `refresh_tokens` table** with `revoked_at`/`expires_at` checks
- Session cookie `pharmerp_session=1`: JS-set, serves only as a middleware routing signal — no token data inside

### Password security
- Argon2id with: time cost 2, memory 64 MB, parallelism 1
- Minimum 8 characters enforced at Zod schema level

### API security
- All endpoints require Bearer JWT except `POST /auth/login`, `POST /auth/refresh`, `POST /auth/register`
- Rate limiting: 100 requests / minute per IP (configurable via throttler)
- CORS: origin restricted to `CORS_ORIGIN` env var

### Audit trail
Every state-changing API call writes to `audit_logs`:
- `userId`, `action` (CREATE / UPDATE / DELETE / VIEW)
- `entity`, `entityId`
- `oldValue`, `newValue` (JSON snapshots)
- `ipAddress`, `userAgent`
- Append-only — no UPDATE or DELETE on audit_logs

### Schedule H compliance
- Controlled substance dispensing gated at service layer (not just frontend)
- Prescription verification status checked server-side
- All dispensed quantities recorded against prescription items
- Schedule H register report available for Drug Inspector audit

---

## 12. Development Setup

### Prerequisites
- Node.js v20+
- pnpm v9+
- Docker + Docker Compose

### Quick start

```bash
# 1. Install all dependencies
pnpm install

# 2. Generate RSA keys + .env files
node setup.js

# 3. Start infrastructure
docker compose up -d

# 4. Push schema to local DB
pnpm run db:push

# 5. Seed development data
pnpm run db:seed

# 6. Start everything
pnpm run dev
# Frontend: http://localhost:3000
# Backend:  http://localhost:4000
# Swagger:  http://localhost:4000/docs
# MinIO UI: http://localhost:9001
```

### Default login credentials (after seed)
| Role | Email | Password | Branch |
|---|---|---|---|
| Super Admin | rkmc@email.com | RadhaMadhav@123 | — (cross-branch) |
| Super Admin | admin@mederp.com | Admin@123 | — (cross-branch) |
| Pharmacist | pharmacist@mederp.com | Pharm@123 | BRN01 |
| Cashier | cashier@mederp.com | Cash@123 | BRN01 |
| Inventory Manager | inventory@mederp.com | Inv@1234 | BRN02 |

### Individual service commands

```bash
# Backend only
pnpm --filter backend run dev

# Frontend only
pnpm --filter frontend run dev

# Type check all packages
pnpm run typecheck

# Lint all packages
pnpm run lint

# Run backend tests
pnpm --filter backend run test

# Run backend tests (watch)
pnpm --filter backend run test:watch
```

---

## 13. Database Management

### Environment switching

The backend automatically selects the database based on `DB_TARGET`:

```bash
# Local Docker (default)
pnpm run db:push          # Push schema changes
pnpm run db:migrate       # Apply versioned migrations
pnpm run db:generate      # Generate new migration from schema diff
pnpm run db:studio        # Open Drizzle Studio GUI
```

> **`backend/.env`'s `DATABASE_URL_PROD` (Neon) is NOT the live production
> database.** The actual `pharmerp-backend` Cloud Run service reads
> `DATABASE_URL` from GCP Secret Manager, pointing at the Terraform-provisioned
> Cloud SQL instance `pharmerp-prod` (private IP only — see §15). The Neon URL
> is a leftover/alternate value; running `db:push:prod`/`db:migrate:prod`
> against it does **not** touch what users actually hit. Verify the live
> target before assuming otherwise:
> ```bash
> gcloud run services describe pharmerp-backend --project=radha-madhav-497409 \
>   --region=asia-south1 --format="yaml(spec.template.spec.containers[0].env)"
> ```

### Reaching production Cloud SQL (private IP, no public endpoint)

Cloud SQL has no public IP (`ipv4_enabled = false` in `infra/gcp/main.tf`), so
it's unreachable directly from a local machine. To run a one-off script or
migration against it:

1. Build the backend image locally (it already contains `pnpm db:migrate`
   and any one-off scripts under `backend/src/database/`).
2. Push it to Artifact Registry:
   `asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/backend`.
3. Create a temporary Cloud Run Job wired to the same VPC connector
   (`pharmerp-connector`) and `DATABASE_URL` secret as the live service:
   ```bash
   gcloud run jobs create <job-name> \
     --project=radha-madhav-497409 --region=asia-south1 \
     --image=<image>:<tag> --command=node --args=dist/path/to/script.js \
     --vpc-connector=pharmerp-connector --vpc-egress=private-ranges-only \
     --set-secrets=DATABASE_URL=DATABASE_URL:latest --max-retries=0
   ```
4. `gcloud run jobs execute <job-name> --wait`, check logs, then
   `gcloud run jobs delete <job-name> --quiet` to avoid leaving billed
   resources behind.

This is how the initial `rkmc@email.com` super_admin was seeded into
production — see `backend/src/database/seed-admin.ts` for the idempotent
(`ON CONFLICT DO NOTHING`) pattern used, which only touches that one row
rather than running the full demo `seed.ts` against real data.

### Safe schema change workflow

```
1. Edit schema file in backend/src/database/schema/
2. pnpm run db:push          ← test locally
3. pnpm run db:generate      ← create migration file
4. Review generated SQL in drizzle/migrations/
5. pnpm run db:migrate        ← verify migration applies cleanly
6. Commit migration file
7. pnpm run db:migrate:prod   ← deploy to production
```

> **Warning:** Never use `db:push:prod` on a database with live data. Always use versioned migrations.

---

## 14. Environment Variables

### Backend (`backend/.env`)

```env
# Database
DATABASE_URL=postgresql://pharmerp:password@localhost:5433/pharmerp
DATABASE_URL_PROD=postgresql://...@neon.tech/neondb?sslmode=require

# Auth (RS256 — generated by setup.js)
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# Redis
REDIS_URL=redis://localhost:6379

# S3 / MinIO
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=pharmerp-bucket
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX_MEDICINES=medicines

# App
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_WS_URL=ws://localhost:4000
NEXT_PUBLIC_APP_NAME=PharmERP
NEXT_PUBLIC_CURRENCY=INR
```

---

## 15. Deployment

### Actual production topology (GCP, project `radha-madhav-497409`, region `asia-south1`)

This is the real, live setup — defined in `infra/gcp/main.tf` (Terraform) and
deployed by `.github/workflows/deploy-gcp.yml` (GitHub Actions, on push to
`main`). It does **not** match the generic Neon/Vercel/Upstash description
this section used to have — see the git history if you need that older,
never-deployed plan for reference.

```
GitHub (push to main)
    │
    ▼
GitHub Actions (deploy-gcp.yml)
    ├── lint-typecheck, test
    ├── Build + push backend image  → Artifact Registry
    │       asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/backend
    ├── Deploy Cloud Run: pharmerp-backend
    └── Deploy Cloud Run: pharmerp-frontend
            (build-arg NEXT_PUBLIC_API_URL = pharmerp-backend's Cloud Run URL)

Cloud Run: pharmerp-frontend  ──HTTPS──▶  Cloud Run: pharmerp-backend
                                                │
                                                ├── VPC connector: pharmerp-connector
                                                │     (vpc-egress: private-ranges-only)
                                                │
                                                ├──▶ Cloud SQL: pharmerp-prod
                                                │      Postgres 16, PRIVATE IP ONLY,
                                                │      backups + PITR enabled
                                                │      (DATABASE_URL via Secret Manager)
                                                │
                                                ├──▶ Memorystore Redis: pharmerp-redis
                                                │      (REDIS_URL via Secret Manager)
                                                │
                                                └──▶ GCS bucket: radha-madhav-prod-files
                                                       (S3_BUCKET — prescriptions, invoice PDFs)
```

Secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`) are
stored in **Secret Manager** and mounted into Cloud Run via `secretKeyRef` —
they are set once out-of-band (console/gcloud), not by the deploy workflow,
which only updates `NODE_ENV`, `S3_BUCKET`, `CORS_ORIGIN` on each deploy.

Inspect the live config at any time:
```bash
gcloud run services describe pharmerp-backend --project=radha-madhav-497409 \
  --region=asia-south1 --format="yaml(spec.template.spec.containers[0].env, spec.template.metadata.annotations)"
```

### Docker build (matches CI)

```bash
# Backend
docker build -f backend/Dockerfile -t asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/backend:local .

# Frontend
docker build -f frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://pharmerp-backend-728779791744.asia-south1.run.app/api/v1 \
  -t asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:local .
```

### Environment checklist before production changes

- [ ] Never run `db:push`/`db:migrate` against `DATABASE_URL_PROD` in
      `backend/.env` expecting it to reach live users — it's Neon, not the
      real Cloud SQL prod (see §13). Use the Cloud Run Job pattern instead.
- [ ] Rotate JWT keys via Secret Manager (`gcloud secrets versions add`), not
      by editing `backend/.env`
- [ ] `pharmerp-prod` Cloud SQL has `deletion_protection = true` — don't
      remove that in Terraform without a deliberate, confirmed decision
- [ ] `google_storage_bucket.files` has `force_destroy = false` — same caution
- [ ] Any one-off script touching prod data should be idempotent
      (`ON CONFLICT DO NOTHING`/similar) and run via a temporary, deleted-after
      Cloud Run Job — never by temporarily exposing Cloud SQL publicly

---

## 16. Troubleshooting

### `MODULE_NOT_FOUND` on `pnpm dev` or `pnpm build`

**Symptom:** Either server fails to start with errors like:

```
Error: Cannot find module '../client/router'   # Next.js frontend
Error: Cannot find module 'semver'             # fastify / backend
```

**Cause:** The pnpm content-addressable store has corrupted (mutated) package files. This can happen after an antivirus scan, a crashed install, a disk error, or another package manager writing into `~/.pnpm-store`. The packages appear installed but their file contents no longer match what pnpm extracted.

**Fix:**

```bash
# Diagnose — lists every mutated store entry
pnpm store status

# Fix — re-extracts all packages from the store (or re-downloads if the store entry is gone)
pnpm install --force
```

The root `fix-deps` script runs both steps:

```bash
pnpm fix-deps
```

**Never edit source files to work around a `MODULE_NOT_FOUND` error** — the module is missing from the store, not from the code. `pnpm install --force` is always the correct first step.

---

## 17. Known Issues & Hardening Backlog

Full-codebase audit findings, tracked here so work continues from this list
rather than re-discovering the same issues. Update this table as items are
fixed — move the row's Status to `Fixed` with a one-line note, don't delete it
(keeps the history of what shipped and why).

### Critical

| # | Finding | Status |
|---|---|---|
| 1 | Stock transfers never moved inventory — `approve()`/`deliver()` only flipped status flags | **Fixed** — full-batch relocation model; see §8.5 |
| 2 | Schedule H/H1/X override bypass — cashier can skip Rx requirement with just an `overrideReason` string, no real approver verification | Open |
| 3 | Patient allergies collected but never checked against dispensed medicines; no UI field to populate them | Open |
| 4 | Double-return / over-refund race — `createReturn` has no mutex analogous to `voidInvoice`'s conditional update | Open |
| 5 | `recordPayment` has no amount/state validation — can push `amountDue` negative, no status transition on full payment | Open |
| 6 | Privilege escalation — any `ADMIN` can PATCH any user's role to `SUPER_ADMIN` (including their own); last `SUPER_ADMIN` can be deactivated | Open |
| 7 | Notifications never produced — expiry/reorder jobs only `logger.log`, `NotificationsService.create()` never called | Open |

### High

| # | Finding | Status |
|---|---|---|
| 8 | GRN over-receiving not checked against remaining ordered qty; PO cancel allowed after partial receipt | Open |
| 9 | GRN status computed via a query that bypasses the active transaction — reads stale `receivedQty` | Open |
| 10 | Supplier outstanding balance only increases — no payment-side decrement, no credit-limit enforcement | Open |
| 11 | Loyalty points: redemption race can drive balance negative; not reversed on invoice void/return | Open |
| 12 | Cross-branch prescription access — no `branchId` scoping; any user can fetch any patient's Rx image by ID | Open |
| 13 | `inviteUser` and branch create/update skip Zod validation (unsafe `as` cast, same pattern as old change-password bug) | Open |
| 14 | `findLeaveRequests` ignores its own `branchId` filter — cross-branch data leak in HR | Open |

### Medium

| # | Finding | Status |
|---|---|---|
| 15 | `change-password` skipped Zod validation entirely | **Fixed** |
| 16 | POS checkout had no `onError` — failed sale showed nothing to the cashier | **Fixed** |
| 17 | Prescription presigned-URL failures silently swallowed (comment claimed to log, didn't) | **Fixed** |
| 18 | Split-payment refund always uses the first payment's mode | Open |
| 19 | Frontend (0.01 tolerance) / backend (exact match) payment-sum mismatch | Open |
| 20 | Prescription "Edit" button calls a PATCH route that doesn't exist (404) | Open |
| 21 | Prescription image upload has no size limit, MIME check is client-header only | Open |
| 22 | `findSkuSet` (bulk import) and GST/Schedule-H CSV export do full-table loads instead of DB-level filtering | Open |
| 23 | Attendance has no frontend UI at all despite full backend support | Open |
| 24 | Report query params (`days`, etc.) unvalidated — bad input silently produces `Invalid Date` | Open |
| 25 | No admin "reset password" and no self-service "forgot password" — an account lockout has no recovery path | Open |

### Barcode scanner feature audit (July 2026, `bar-code-scanner` branch)

| # | Finding | Status |
|---|---|---|
| 26 | Barcode PNG download used a plain `<a href>` to a JWT-guarded endpoint — always 401 (token only travels in the Authorization header) | **Fixed** — fetched as a blob via `apiClient`, downloaded as `{SKU}-barcode.png` |
| 27 | Duplicate barcodes possible (column has only a non-unique index, no validation) — POS scan with `limit: 1` would silently dispense whichever medicine sorts first | **Fixed** — create/update reject duplicates with 409, bulk import skips them (in-file + against DB), 13-digit codes EAN-13 checksum-validated in the shared Zod schema |
| 28 | POS scan and click-to-add picked `batchList[0]` from the unfiltered batch list — could select an expired or zero-quantity batch | **Fixed** — POS now uses the FEFO dispense endpoint (`GET /inventory/medicines/:id/batches`), which also excludes expired batches (`expiry_date >= CURRENT_DATE`) |
| 29 | Camera scanner dialog "Close & Retry" button was a stub (dead placeholder code) — never restarted the camera | **Fixed** — retry re-runs the camera startup effect |
| 30 | Hardware scanner stayed active while the payment modal was open (a stray scan mutated the cart mid-payment); failed scans left scanner characters in the search box | **Fixed** — scan capture suspended while any POS modal is open; search input cleared on every scan |
| 31 | No DB-level unique constraint on `medicines.barcode` — service check closes the practical hole, but a partial unique index (`WHERE deleted_at IS NULL`) would make it airtight; needs a duplicate-data check + migration first | Open |

### Low

- Various `as any` casts bypassing type safety at repository boundaries (not exploitable today since controllers validate first, but fragile against future schema changes).
- Discount-override UI is dead code in the POS terminal (`discountAmount` hardcoded to `"0"`).
- Generated invoice PDF is cached forever, even after the invoice is later voided/returned.
- `dotenv/config` is imported by `seed.ts`/would be by any deployed script, but `dotenv` isn't a direct dependency of `backend/package.json` — fine locally (transitively present), fails with `MODULE_NOT_FOUND` if ever run inside the production image. `seed-admin.ts` avoids this by not importing it (Cloud Run injects env vars directly).

### Performance

Ranked by real-world impact — checkout speed matters most since it's what a
cashier feels every single sale.

| # | Finding | Impact | Status |
|---|---|---|---|
| P1 | Checkout issued 20-30+ sequential DB round trips per sale | **Fixed** — FEFO selection batched into one query across all cart lines (`selectBatchesForDispenseMulti`), stock-movement inserts batched into one multi-row insert (`logMany`), and the invoice-level prescription/approver checks (previously re-queried once per controlled-drug item) hoisted to run once. The per-batch quantity `UPDATE` stays one-per-allocation — it needs its own atomic oversell guard and can't be safely batched. |
| P2 | No debounce on POS medicine/patient search | **Fixed** — both search inputs now debounce the query (not the input's own value/re-render) by 300ms via the existing `useDebounce` hook, cutting a full "paracetamol"-length search from ~11 API calls down to 1. The whole-component re-render issue (single 1000+ line `PosTerminal`, no memoized children/selectors) is still open — deferred as a larger refactor. |
| P3 | `prescriptionItems` has zero indexes despite being queried by `(prescriptionId, medicineId)` on every controlled-drug checkout line — `schema/prescriptions.ts:48-63` | Compounds P1 as prescriptions accumulate | Open |
| P4 | `sales_invoices.branch_id` has no index despite being filtered in nearly every report query and EOD summary; combined with the existing `DATE(created_at)` issue this forces full-table scans on report generation past ~50k invoices/branch | Reporting/EOD, not checkout | Open |
| P5 | Medicine/POS search uses leading-wildcard `ILIKE '%term%'` (can't use the btree index — always a seq scan) with no Redis cache, despite Redis already being wired into `BillingRepository` — `inventory.repository.ts:15-72` | Noticeable at 10k+ SKU catalogs | Open |
| P6 | `hr` schema (`employees`, `departments`, `attendance`, `leave_requests`) has no indexes at all despite `branchId`/`employeeId` filters in every list query | HR list pages slow as headcount grows | Open |
| P7 | GRN receiving does 4 sequential insert/update statements per line item (batch insert, stock movement, GRN item, PO item update) — a 50-line GRN issues ~200 round trips in one transaction | Back-office, not customer-facing | Open |
| P8 | `getScheduleHData` and the GST/Schedule-H CSV export both do "load everything, enrich with a second query, reduce in memory" instead of a single join or streaming | Slow for month-long regulatory report ranges | Open |
| P9 | `findLeaveRequests` has no pagination — returns the entire table when unfiltered | Payload/latency risk past a few thousand leave rows | Open |
| P10 | Offline POS sync (`pos-db.ts:49`) does an unindexed `.filter()` full scan instead of using the `synced` index already defined in the Dexie schema | Only runs once on reconnect — low priority | Open |

**Two changes would give the most felt improvement for the least effort:**
add a ~300ms debounce to the POS medicine/patient search inputs (P2), and
batch the per-item stock-movement/prescription-item writes in checkout into
single multi-row statements instead of one query per cart line (P1).

### Architectural note — partial batch transfers

`inventory_batches` has a unique constraint on `(medicine_id, batch_no)`
**across the whole table** (not scoped per warehouse), and a batch's
warehouse is derived indirectly via `location_id → storage_locations.warehouse_id`.
This means a batch physically exists at exactly one location at a time —
transfers can move a batch's full quantity but can't split it across two
warehouses without a schema change (e.g. a `batch_stock (batch_id, location_id, quantity)`
ledger table, decoupling "how much of this batch exists" from "where it is").
Deferred as a deliberate scope decision, not an oversight — flag before
building anything that assumes partial-batch transfers work.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1-A — Monorepo scaffold | Done | Turborepo, pnpm workspaces, shared packages |
| 1-B — Backend structure | Done | NestJS + Fastify, Swagger, global middleware |
| 1-C — Database schema | Done | All 9 Drizzle schema files, migrations |
| 1-D — Auth & guards | Done | RS256 JWT, 8 roles, audit interceptor |
| 1-E — Auth module | Done | Login, refresh, register, logout |
| 1-F — Inventory module | Done | Medicines, batches, FEFO, warehouses |
| 1-G — Billing module | Done | POS, GST, FEFO dispatch, returns, void |
| 1-H — Core modules | Done | Procurement, patients, prescriptions, HR, reports |
| 1-I — Frontend scaffold | Done | Next.js 15, shadcn/ui, Zustand, React Query |
| 2-A — Auth & layout | Done | Login, shell layout, sidebar, route protection |
| 2-B — POS terminal | Done | Barcode scanner, offline sync, split payments |
| 2-C — All pages | Done | Dashboard, inventory, billing, HR, reports, procurement |
| 2-D — Distribution module | Done | Stock transfers backend + frontend page |
| 2-E — Polish | Done | Toast, error boundaries, print styles, hooks |
| 2-F — Barcode scanner | Done | USB HID + camera scanning (html5-qrcode), Code-128 label PNGs (bwip-js), EAN-13 checksum validation, service-level barcode uniqueness, FEFO-safe POS dispense |
| 2-G — Mobile responsive UI | Done | Off-canvas sidebar drawer, stacked POS with sticky pay bar, bottom-sheet modals on phones, fluid camera scanner viewport |
| 3 | Planned | Elasticsearch full-text medicine search, WhatsApp notifications |
| 4 | Planned | ClickHouse analytics, demand forecasting |
| 5 | Planned | Payroll engine, salary slips, leave encashment |
| 6 | Planned | Kubernetes deployment, Prometheus/Grafana, CI/CD |
| 7 | Planned | Insurance claim management, Tally/Zoho integration |


)RKX.jR.B1@W''-k - ADMIN root pass 
