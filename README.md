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
│   └── Swagger UI at /api/v1/docs                                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼───────┐     ┌─────────▼────────┐    ┌────────▼──────────┐
│  BUSINESS     │     │   ASYNC LAYER    │    │   STORAGE LAYER   │
│  MODULES      │     │                  │    │                   │
│               │     │  BullMQ + Redis  │    │  PostgreSQL 16    │
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
| Cache / Queue | Redis | 7 | Sessions, invoice sequences, BullMQ backend |
| Job Queue | BullMQ | 5 | Background job processing |
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

### Shared
| Package | Purpose |
|---|---|
| `@pharmerp/types` | Zod schemas + TypeScript types shared between frontend and backend |
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
│   │   ├── (auth)/signup/            # Public signup page
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
│   │   ├── layout/                   # Sidebar, Header
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
├── postgres:5433   TimescaleDB (PostgreSQL 16)
│                   Volumes: postgres_data
│                   User: pharmerp / password
│
├── redis:6379      Redis 7 Alpine
│                   Used for: BullMQ queues, session cache, invoice
│                   sequence counters (INCR pharmerp:invoice_seq:{branchId})
│
├── minio:9000      MinIO (S3-compatible object store)
│   :9001           Console UI at port 9001
│                   Buckets: pharmerp-bucket
│                   Used for: prescription images, invoice PDFs
│
└── elasticsearch:9200   Elasticsearch 8 (single-node, no security)
                         Index: medicines
                         Used for: fast medicine name/barcode search (Phase 3)
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
| `medicines` | `sku UNIQUE`, `barcode UNIQUE nullable` |
| `inventory_batches` | `(medicine_id, warehouse_id, batch_no)` unique index, `expiry_date` index |
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
http://localhost:4000/api/v1/docs
```

---

## 7. Authentication & Authorization

### JWT flow

```
Client                      Server                          Redis
  │                            │                               │
  ├─── POST /auth/login ───────►│                               │
  │    { email, password }      │── argon2id verify password    │
  │                             │── sign access JWT (RS256, 15m)│
  │                             │── sign refresh JWT (RS256, 7d)│
  │                             │── hash refresh token ─────────►│ SET refresh:{userId}
  │◄── { accessToken,           │                               │
  │      refreshToken } ────────│                               │
  │                             │                               │
  ├─── GET /any/protected ──────►│                               │
  │    Authorization: Bearer ... │── verify RS256 signature      │
  │                             │── check token not revoked      │
  │◄── { data } ────────────────│                               │
  │                             │                               │
  ├─── POST /auth/refresh ──────►│                               │
  │    { refreshToken }          │────────── GET refresh:{userId}►│
  │                             │◄──────────────────────────────│
  │                             │── verify hash match            │
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
        ├── Scan barcode / type name
        │       └── GET /inventory/medicines?search=... (debounced 200ms)
        │               └── Returns: name, MRP, schedule class, available batches
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
selectBatchesForDispense(medicineId, warehouseId, requiredQty):
  
  batches = SELECT * FROM inventory_batches
            WHERE medicine_id = ? AND warehouse_id = ?
              AND status = 'active'
              AND expiry_date > NOW()
              AND quantity > reserved_qty
            ORDER BY expiry_date ASC          -- First Expired, First Out
  
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
                        ├── TODO: Create stock_movement records at destination
                        └── status → delivered
```

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
Redis (BullMQ backend)
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

1. Define queue name in `backend/src/modules/jobs/jobs.module.ts`
2. Create worker class extending `WorkerHost`
3. Inject queue in the service that triggers it: `@InjectQueue('queue-name')`
4. Add worker to `jobs.module.ts` providers

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
        └── Auth routes: /login, /signup
                └── Has cookie → redirect to /dashboard

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
- Access tokens: RS256 asymmetric JWT, 15-minute TTL, stored in **memory only** (Zustand, not persisted to localStorage)
- Refresh tokens: RS256 JWT, 7-day TTL, stored as bcrypt hash in Redis
- Session cookie `pharmerp_session=1`: HttpOnly-adjacent (JS-set), serves only as middleware signal — no token data inside

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
# Swagger:  http://localhost:4000/api/v1/docs
# MinIO UI: http://localhost:9001
```

### Default login credentials (after seed)
| Role | Email | Password |
|---|---|---|
| Super Admin | admin@pharmerp.com | Admin@1234 |
| Pharmacist | pharmacist@pharmerp.com | Pharma@1234 |
| Cashier | cashier@pharmerp.com | Cash@1234 |
| Inventory Manager | inventory@pharmerp.com | Inv@1234 |

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

# Production (Neon)
DB_TARGET=prod pnpm run db:push:prod
DB_TARGET=prod pnpm run db:migrate:prod
```

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

### Recommended topology (production)

```
Internet
    │
    ▼
Cloudflare (CDN + DDoS)
    │
    ├── frontend.yourdomain.com
    │       └── Vercel / self-hosted Next.js (standalone output)
    │
    └── api.yourdomain.com
            └── Docker container (NestJS)
                    ├── PostgreSQL → Neon (managed, serverless)
                    ├── Redis → Upstash (managed, serverless)
                    ├── S3 → AWS S3 or MinIO on VM
                    └── Elasticsearch → Elastic Cloud (Phase 3)
```

### Docker build

```bash
# Backend
cd backend
docker build -t pharmerp-api .

# Frontend
cd frontend
docker build -t pharmerp-web .
```

### Environment checklist before production

- [ ] Rotate all JWT keys (`openssl genrsa -out private.pem 2048`)
- [ ] Set strong `DATABASE_URL_PROD` with SSL
- [ ] Set Redis password in `REDIS_URL`
- [ ] Replace MinIO with AWS S3 or configure MinIO TLS
- [ ] Set `NODE_ENV=production`
- [ ] Set `CORS_ORIGIN` to actual frontend domain
- [ ] Run `pnpm run db:migrate:prod` (not db:push)
- [ ] Configure reverse proxy (nginx/Caddy) with SSL
- [ ] Set up log aggregation (Loki / Datadog)

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
| 3 | Planned | Elasticsearch full-text medicine search, WhatsApp notifications |
| 4 | Planned | ClickHouse analytics, demand forecasting |
| 5 | Planned | Payroll engine, salary slips, leave encashment |
| 6 | Planned | Kubernetes deployment, Prometheus/Grafana, CI/CD |
| 7 | Planned | Insurance claim management, Tally/Zoho integration |
