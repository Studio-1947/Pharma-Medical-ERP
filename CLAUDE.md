itcheck for furRead existing files before writing. Don't re-read unless changed.
Thorough in reasoning, concise in output.
Skip files over 100KB unless required.
No sycophantic openers or closing fluff.
No emojis or em-dashes.
Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## DEPENDENCY INTEGRITY RULES (apply before every build attempt)

- If any build or dev command fails with `MODULE_NOT_FOUND`, run `pnpm fix-deps` (root) before investigating further. This is almost always a corrupted pnpm store, not a code bug.
- Never investigate a MODULE_NOT_FOUND error by editing source files. Fix the store first.
- After resuming work in a new session, if `pnpm build` or `pnpm dev` fails immediately, run `pnpm fix-deps` first.
- `pnpm fix-deps` = `pnpm store verify` then `pnpm install --force`. Both steps are required: verify cleans corrupted store entries, --force re-extracts them.
- The frontend `prebuild` script auto-heals silently on every `pnpm build` run. If it runs `pnpm install --force` unexpectedly, it means the store was corrupted again -- check disk health.
- Do not run `pnpm install` without `--force` to fix MODULE_NOT_FOUND -- it will reuse the corrupted store entry and fail again.

# MedERP — Pharmacy ERP System: Claude Code Implementation Guide

> **How to use this file with Claude Code:**
> Feed each `## PHASE` block one at a time. Complete and verify each phase before proceeding.
> Never paste the entire file at once — it will waste tokens and context window.

---

## CONVENTIONS (read once, apply always)

- **Monorepo:** Turborepo + pnpm workspaces
- **Language:** TypeScript strict mode everywhere
- **Backend:** Node.js 20 LTS + Fastify + Drizzle ORM
- **Frontend:** Next.js 14 App Router + Tailwind + shadcn/ui
- **Database:** PostgreSQL 16 + Redis 7
- **API docs:** Swagger via `@fastify/swagger` + `@fastify/swagger-ui`
- **Validation:** Zod (shared between frontend and backend)
- **All env vars** go in `.env` files, never hardcoded
- **All routes** are versioned: `/api/v1/...`
- **Soft deletes** on all DB tables: `deleted_at TIMESTAMPTZ DEFAULT NULL`
- **Audit fields** on all tables: `created_at`, `updated_at`, `created_by uuid`

---

## PHASE 1-A — Monorepo Scaffold

### Prompt for Claude Code:

```
Create a Turborepo monorepo called "mederp" with pnpm workspaces.

Directory structure to create:
mederp/
├── package.json               # root — workspaces config
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
├── docker-compose.yml         # postgres, redis, elasticsearch, minio
├── .gitignore
├── packages/
│   ├── types/                 # shared TypeScript types & Zod schemas
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── enums.ts       # ScheduleType, InvoiceStatus, UserRole, etc.
│   │       ├── schemas/       # one Zod schema file per domain
│   │       │   ├── auth.schema.ts
│   │       │   ├── product.schema.ts
│   │       │   ├── inventory.schema.ts
│   │       │   ├── billing.schema.ts
│   │       │   ├── patient.schema.ts
│   │       │   ├── prescription.schema.ts
│   │       │   ├── supplier.schema.ts
│   │       │   ├── staff.schema.ts
│   │       │   └── branch.schema.ts
│   │       └── types/         # inferred types from schemas
│   │           └── index.ts
│   └── utils/                 # shared pure utilities
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── date.ts        # date formatting helpers
│           ├── currency.ts    # INR formatting, GST split calc
│           ├── barcode.ts     # barcode validation
│           └── pagination.ts  # cursor + offset pagination helpers
├── apps/
│   ├── api/                   # Fastify backend (built in Phase 1-B)
│   └── web/                   # Next.js frontend (built in Phase 2)

Root package.json scripts:
  "dev": "turbo run dev"
  "build": "turbo run build"
  "lint": "turbo run lint"
  "typecheck": "turbo run typecheck"

turbo.json pipeline:
  build depends on ^build
  dev is persistent

docker-compose.yml services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    port: 5432
    env: POSTGRES_USER=mederp, POSTGRES_PASSWORD=mederp, POSTGRES_DB=mederp
    volume: postgres_data
  redis:
    image: redis:7-alpine
    port: 6379
  elasticsearch:
    image: elasticsearch:8.12.0
    port: 9200
    env: discovery.type=single-node, ES_JAVA_OPTS=-Xms512m -Xmx512m, xpack.security.enabled=false
  minio:
    image: minio/minio
    port: 9000, 9001
    command: server /data --console-address ":9001"

.env.example variables:
  DATABASE_URL=postgresql://mederp:mederp@localhost:5432/mederp
  REDIS_URL=redis://localhost:6379
  ELASTICSEARCH_URL=http://localhost:9200
  MINIO_ENDPOINT=localhost
  MINIO_PORT=9000
  MINIO_ACCESS_KEY=minioadmin
  MINIO_SECRET_KEY=minioadmin
  JWT_ACCESS_SECRET=change-me-access
  JWT_REFRESH_SECRET=change-me-refresh
  JWT_ACCESS_EXPIRES=15m
  JWT_REFRESH_EXPIRES=7d
  PORT=3001
  NODE_ENV=development

packages/types/src/enums.ts should export:
  UserRole: SUPER_ADMIN | BRANCH_ADMIN | PHARMACIST | CASHIER | INVENTORY_MANAGER | REPORT_VIEWER
  ScheduleType: OTC | SCHEDULE_H | SCHEDULE_H1 | SCHEDULE_X
  InvoiceStatus: DRAFT | PAID | PARTIAL | VOID
  PaymentMethod: CASH | UPI | CARD | INSURANCE | CREDIT
  StockMovementType: PURCHASE | SALE | RETURN | TRANSFER | ADJUSTMENT | EXPIRY_WRITE_OFF
  PrescriptionStatus: PENDING | VERIFIED | DISPENSED | EXPIRED | REFUSED
  OrderStatus: DRAFT | SENT | RECEIVED | PARTIAL | CANCELLED

packages/types/src/schemas/product.schema.ts — create Zod schemas for:
  CreateProductSchema, UpdateProductSchema, ProductResponseSchema

Do the same pattern for all other schema files (auth, billing, patient, etc.)
Use z.infer<> to export TypeScript types from each schema.
```

---

## PHASE 1-B — Backend: Fastify App Structure

### Prompt for Claude Code:

```
Inside apps/api/, scaffold a complete Fastify + TypeScript backend.

Full directory structure:
apps/api/
├── package.json
├── tsconfig.json
├── .env                       # copy from root .env.example
├── src/
│   ├── index.ts               # entry point — build app + start server
│   ├── app.ts                 # createApp() factory — register all plugins
│   ├── config/
│   │   ├── index.ts           # exports typed config from env vars (use envalid)
│   │   ├── database.ts        # drizzle instance + pg connection pool
│   │   ├── redis.ts           # ioredis client singleton
│   │   └── swagger.ts         # swagger spec config
│   ├── plugins/
│   │   ├── auth.plugin.ts     # JWT verify decorator + onRequest hook
│   │   ├── rbac.plugin.ts     # hasPermission(role, action) fastify decorator
│   │   ├── cors.plugin.ts
│   │   ├── rate-limit.plugin.ts
│   │   └── error-handler.plugin.ts   # global error → standard JSON shape
│   ├── middleware/
│   │   ├── authenticate.ts    # extracts + validates JWT, sets request.user
│   │   ├── authorize.ts       # (roles: UserRole[]) => preHandler hook factory
│   │   └── audit-log.ts       # onResponse hook — writes to audit_logs table
│   ├── db/
│   │   ├── index.ts           # re-exports drizzle db instance
│   │   ├── schema/            # one file per domain
│   │   │   ├── users.ts
│   │   │   ├── branches.ts
│   │   │   ├── products.ts
│   │   │   ├── stock-batches.ts
│   │   │   ├── stock-movements.ts
│   │   │   ├── suppliers.ts
│   │   │   ├── purchase-orders.ts
│   │   │   ├── purchase-order-items.ts
│   │   │   ├── patients.ts
│   │   │   ├── prescriptions.ts
│   │   │   ├── prescription-items.ts
│   │   │   ├── invoices.ts
│   │   │   ├── invoice-items.ts
│   │   │   ├── payments.ts
│   │   │   ├── staff.ts
│   │   │   ├── attendance.ts
│   │   │   ├── audit-logs.ts
│   │   │   └── notifications.ts
│   │   ├── relations.ts       # all drizzle relations defined here
│   │   └── migrations/        # auto-generated by drizzle-kit
│   ├── modules/               # feature modules — each is self-contained
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts
│   │   │   └── auth.schemas.ts    # fastify route schema (JSON Schema for swagger)
│   │   ├── users/
│   │   │   ├── users.routes.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   └── users.schemas.ts
│   │   ├── branches/
│   │   │   ├── branches.routes.ts
│   │   │   ├── branches.service.ts
│   │   │   ├── branches.repository.ts
│   │   │   └── branches.schemas.ts
│   │   ├── products/
│   │   │   ├── products.routes.ts
│   │   │   ├── products.service.ts
│   │   │   ├── products.repository.ts
│   │   │   └── products.schemas.ts
│   │   ├── inventory/
│   │   │   ├── inventory.routes.ts
│   │   │   ├── inventory.service.ts
│   │   │   ├── inventory.repository.ts
│   │   │   └── inventory.schemas.ts
│   │   ├── suppliers/
│   │   │   ├── suppliers.routes.ts
│   │   │   ├── suppliers.service.ts
│   │   │   ├── suppliers.repository.ts
│   │   │   └── suppliers.schemas.ts
│   │   ├── purchase-orders/
│   │   │   ├── purchase-orders.routes.ts
│   │   │   ├── purchase-orders.service.ts
│   │   │   ├── purchase-orders.repository.ts
│   │   │   └── purchase-orders.schemas.ts
│   │   ├── patients/
│   │   │   ├── patients.routes.ts
│   │   │   ├── patients.service.ts
│   │   │   ├── patients.repository.ts
│   │   │   └── patients.schemas.ts
│   │   ├── prescriptions/
│   │   │   ├── prescriptions.routes.ts
│   │   │   ├── prescriptions.service.ts
│   │   │   ├── prescriptions.repository.ts
│   │   │   └── prescriptions.schemas.ts
│   │   ├── billing/
│   │   │   ├── billing.routes.ts
│   │   │   ├── billing.service.ts
│   │   │   ├── billing.repository.ts
│   │   │   ├── billing.schemas.ts
│   │   │   └── gst.calculator.ts  # CGST/SGST/IGST logic
│   │   ├── staff/
│   │   │   ├── staff.routes.ts
│   │   │   ├── staff.service.ts
│   │   │   ├── staff.repository.ts
│   │   │   └── staff.schemas.ts
│   │   ├── reports/
│   │   │   ├── reports.routes.ts
│   │   │   ├── reports.service.ts
│   │   │   └── reports.schemas.ts
│   │   └── notifications/
│   │       ├── notifications.routes.ts
│   │       ├── notifications.service.ts
│   │       └── notifications.schemas.ts
│   ├── queues/
│   │   ├── index.ts           # BullMQ queue definitions
│   │   ├── workers/
│   │   │   ├── expiry-scanner.worker.ts
│   │   │   ├── reorder-engine.worker.ts
│   │   │   ├── pdf-generator.worker.ts
│   │   │   └── notification.worker.ts
│   │   └── jobs/
│   │       ├── expiry-alert.job.ts
│   │       ├── reorder-alert.job.ts
│   │       └── daily-report.job.ts
│   ├── lib/
│   │   ├── jwt.ts             # signToken, verifyToken helpers
│   │   ├── bcrypt.ts          # hash, compare helpers
│   │   ├── pagination.ts      # buildPaginatedResponse helper
│   │   ├── gst.ts             # GST rate lookup by HSN
│   │   ├── invoice-number.ts  # branch-sequential invoice numbering
│   │   └── logger.ts          # pino logger instance
│   └── types/
│       ├── fastify.d.ts       # augment FastifyRequest with user, branchId
│       └── env.d.ts

package.json dependencies:
  fastify, @fastify/cors, @fastify/jwt, @fastify/swagger, @fastify/swagger-ui,
  @fastify/rate-limit, @fastify/multipart, drizzle-orm, pg, ioredis,
  bullmq, zod, bcryptjs, pino, pino-pretty, envalid, uuid, date-fns

package.json devDependencies:
  drizzle-kit, typescript, tsx, @types/node, @types/bcryptjs

scripts:
  "dev": "tsx watch src/index.ts"
  "build": "tsc"
  "db:generate": "drizzle-kit generate"
  "db:migrate": "drizzle-kit migrate"
  "db:studio": "drizzle-kit studio"
  "start": "node dist/index.js"
```

---

## PHASE 1-C — Database Schema (Drizzle)

### Prompt for Claude Code:

```
Create all Drizzle ORM schema files inside apps/api/src/db/schema/.
Use PostgreSQL dialect. Every table must have:
  id: uuid primaryKey defaultRandom()
  createdAt: timestamp('created_at').defaultNow().notNull()
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
  deletedAt: timestamp('deleted_at')   (soft delete)
  createdBy: uuid('created_by')        (FK to users.id, nullable for system)

--- users.ts ---
Table: users
Columns:
  id, email (unique), phone (unique), passwordHash, firstName, lastName,
  role (UserRole enum), isActive boolean default true,
  branchId uuid FK branches.id nullable (null = super admin),
  lastLoginAt timestamp,
  mfaSecret varchar nullable,
  + audit fields

--- branches.ts ---
Table: branches
Columns:
  id, name, code varchar(10) unique (billing prefix e.g. "BRN01"),
  gstin varchar(15), drugLicenseNo varchar, licenseExpiry date,
  addressLine1, addressLine2, city, state, pincode,
  phone, email, managerId uuid FK users.id nullable,
  isActive boolean default true,
  + audit fields

--- products.ts ---
Table: products
Columns:
  id, name varchar(255), genericName varchar(255),
  barcode varchar unique, hsnCode varchar(8),
  scheduleType ScheduleType enum default 'OTC',
  requiresRx boolean default false,
  manufacturer varchar, composition text,
  unitOfMeasure varchar(20) default 'STRIP',  (STRIP|BOX|VIAL|ML|TABLET|CAPSULE)
  packSize integer default 10,               (units per strip/box)
  mrp numeric(12,2), purchasePrice numeric(12,2),
  sellingPrice numeric(12,2),
  gstRate numeric(5,2) default 12,           (0|5|12|18)
  isActive boolean default true,
  categoryId uuid FK categories.id nullable,
  supplierId uuid FK suppliers.id nullable,  (default/preferred supplier)
  reorderLevel integer default 0,
  maxStockLevel integer,
  imageUrl varchar,
  + audit fields

--- categories.ts ---
Table: categories
Columns: id, name, parentId uuid self-FK nullable, + audit fields

--- stock_batches.ts ---
Table: stock_batches
Columns:
  id, productId uuid FK products.id, branchId uuid FK branches.id,
  batchNumber varchar, lotNumber varchar,
  expiryDate date, manufacturingDate date nullable,
  quantity integer default 0,            (current available qty)
  reservedQty integer default 0,         (qty locked in active carts)
  purchasePrice numeric(12,2),           (cost for this batch)
  mrp numeric(12,2),
  purchaseOrderItemId uuid FK nullable,
  + audit fields
Index: (productId, branchId), (expiryDate), (branchId, expiryDate)

--- stock_movements.ts ---
Table: stock_movements
Columns:
  id, productId uuid FK, batchId uuid FK stock_batches.id,
  branchId uuid FK, movementType StockMovementType enum,
  quantity integer,     (positive=in, negative=out)
  referenceId uuid nullable,  (invoice_id or purchase_order_id)
  referenceType varchar nullable, (INVOICE|PURCHASE_ORDER|TRANSFER|ADJUSTMENT)
  reason text nullable, performedBy uuid FK users.id,
  + audit fields (no updatedAt — movements are immutable)
This is an append-only ledger table.

--- suppliers.ts ---
Table: suppliers
Columns:
  id, name, contactPerson, phone, email, gstin, drugLicenseNo,
  addressLine1, city, state, pincode,
  paymentTerms integer default 30, (days)
  creditLimit numeric(12,2) default 0,
  outstandingAmount numeric(12,2) default 0,
  rating integer check 1-5 nullable,
  isActive boolean default true,
  + audit fields

--- purchase_orders.ts ---
Table: purchase_orders
Columns:
  id, poNumber varchar unique, supplierId uuid FK,
  branchId uuid FK, status OrderStatus enum default 'DRAFT',
  orderDate date, expectedDeliveryDate date nullable,
  subtotal numeric(12,2) default 0,
  totalGst numeric(12,2) default 0,
  totalAmount numeric(12,2) default 0,
  notes text nullable, approvedBy uuid FK users.id nullable,
  + audit fields

--- purchase_order_items.ts ---
Table: purchase_order_items
Columns:
  id, purchaseOrderId uuid FK, productId uuid FK,
  orderedQty integer, receivedQty integer default 0,
  unitPrice numeric(12,2), gstRate numeric(5,2),
  totalAmount numeric(12,2),
  batchNumber varchar nullable, expiryDate date nullable,
  + audit fields

--- patients.ts ---
Table: patients
Columns:
  id, firstName, lastName, dob date nullable, gender varchar(10),
  phone varchar unique, email varchar nullable,
  addressLine1, city, state, pincode — all nullable,
  allergies text[] default '{}',
  chronicConditions text[] default '{}',
  loyaltyPoints integer default 0,
  creditLimit numeric(12,2) default 0,
  creditBalance numeric(12,2) default 0,
  branchId uuid FK (registered at branch),
  + audit fields

--- prescriptions.ts ---
Table: prescriptions
Columns:
  id, patientId uuid FK, doctorName varchar, doctorRegNo varchar nullable,
  rxDate date, validUntil date,
  imageUrl varchar nullable, (S3 path)
  status PrescriptionStatus enum default 'PENDING',
  refillCount integer default 0,
  maxRefills integer default 1,
  verifiedBy uuid FK users.id nullable,
  verifiedAt timestamp nullable,
  notes text nullable,
  branchId uuid FK,
  + audit fields

--- prescription_items.ts ---
Table: prescription_items
Columns:
  id, prescriptionId uuid FK, productId uuid FK nullable,
  productName varchar, (as written on Rx — may not match catalog)
  dosage varchar, frequency varchar, duration varchar,
  quantityPrescribed integer, quantityDispensed integer default 0,
  + audit fields

--- invoices.ts ---
Table: invoices
Columns:
  id, invoiceNumber varchar unique,
  patientId uuid FK nullable, (null = walk-in)
  prescriptionId uuid FK nullable,
  branchId uuid FK,
  billedBy uuid FK users.id,
  invoiceDate timestamp defaultNow,
  subtotal numeric(12,2) default 0,
  discountAmount numeric(12,2) default 0,
  discountPercent numeric(5,2) default 0,
  cgst numeric(12,2) default 0,
  sgst numeric(12,2) default 0,
  igst numeric(12,2) default 0,
  totalGst numeric(12,2) default 0,
  roundOff numeric(5,2) default 0,
  totalAmount numeric(12,2) default 0,
  paidAmount numeric(12,2) default 0,
  balanceAmount numeric(12,2) default 0,
  status InvoiceStatus enum default 'DRAFT',
  notes text nullable,
  isReturn boolean default false,
  originalInvoiceId uuid FK nullable, (for return invoices)
  + audit fields

--- invoice_items.ts ---
Table: invoice_items
Columns:
  id, invoiceId uuid FK, productId uuid FK, batchId uuid FK stock_batches.id,
  productName varchar, batchNumber varchar, expiryDate date,
  quantity integer, unitMrp numeric(12,2),
  unitSellingPrice numeric(12,2), discountPercent numeric(5,2) default 0,
  gstRate numeric(5,2), cgstAmount numeric(12,2), sgstAmount numeric(12,2),
  totalAmount numeric(12,2),
  + audit fields

--- payments.ts ---
Table: payments
Columns:
  id, invoiceId uuid FK, method PaymentMethod enum,
  amount numeric(12,2), referenceNo varchar nullable,
  (UPI txn ID, card last4, insurance claim no)
  paidAt timestamp defaultNow,
  receivedBy uuid FK users.id,
  + audit fields (no soft delete — financial record)

--- staff.ts ---
Table: staff (extends users for pharmacy-specific fields)
Columns:
  id, userId uuid FK users.id unique,
  branchId uuid FK, designation varchar,
  pharmacistLicenseNo varchar nullable,
  licenseExpiry date nullable,
  joinDate date, basicSalary numeric(12,2),
  emergencyContact varchar nullable,
  documents jsonb default '[]',  (array of {type, url, expiry})
  + audit fields

--- attendance.ts ---
Table: attendance
Columns:
  id, staffId uuid FK staff.id, branchId uuid FK,
  date date, checkIn timestamp nullable, checkOut timestamp nullable,
  status varchar(20),  (PRESENT|ABSENT|HALF_DAY|LEAVE)
  overtimeHours numeric(4,2) default 0,
  notes varchar nullable,
  + createdAt (no soft delete)

--- audit_logs.ts ---
Table: audit_logs  (append-only, never delete)
Columns:
  id uuid primaryKey defaultRandom(),
  userId uuid nullable, userName varchar nullable,
  action varchar,  (CREATE|UPDATE|DELETE|VIEW|LOGIN|LOGOUT|OVERRIDE)
  resourceType varchar,  (INVOICE|PRODUCT|USER|PRESCRIPTION etc.)
  resourceId uuid nullable,
  oldValues jsonb nullable,
  newValues jsonb nullable,
  ipAddress varchar nullable,
  userAgent varchar nullable,
  branchId uuid nullable,
  createdAt timestamp defaultNow() (immutable)

After creating all schema files, create apps/api/src/db/relations.ts
defining all drizzle relations() between tables.

Then run: pnpm --filter api db:generate
```

---

## PHASE 1-D — Core Plugins & Middleware

### Prompt for Claude Code:

```
Implement the core Fastify plugins and middleware for apps/api/src/.

1. src/app.ts — createApp() function:
   Register plugins in this order:
   a. @fastify/cors — allow origin from env CORS_ORIGIN
   b. @fastify/rate-limit — max 100 per minute per IP, skip for /health
   c. @fastify/multipart — for prescription image uploads, max 10MB
   d. @fastify/swagger with options:
        openapi: { info: { title: 'MedERP API', version: '1.0.0' } }
        routePrefix: '/api/v1'
   e. @fastify/swagger-ui with:
        routePrefix: '/docs'
        uiConfig: { docExpansion: 'list' }
   f. error-handler.plugin — global setErrorHandler
   g. auth.plugin — decorate fastify with verifyJwt
   Register all module routes under prefix '/api/v1'
   Add GET /health route that returns { status: 'ok', timestamp }

2. src/plugins/error-handler.plugin.ts:
   Catch ZodError → 400 with formatted field errors
   Catch { statusCode: 401 } → 401 Unauthorized
   Catch { statusCode: 403 } → 403 Forbidden
   Catch { statusCode: 404 } → 404 Not Found
   Catch any other error → 500
   All error responses shape: { success: false, error: { code, message, details? } }
   All success responses shape: { success: true, data: ... }

3. src/middleware/authenticate.ts:
   preHandler hook factory:
   - Extract Bearer token from Authorization header
   - Verify with JWT_ACCESS_SECRET
   - Load user from Redis cache (key: session:{userId})
     If not in cache, load from DB, cache for 15 minutes
   - Set request.user = { id, email, role, branchId, permissions[] }
   - Throw 401 if token missing or invalid

4. src/middleware/authorize.ts:
   authorize(allowedRoles: UserRole[]) → preHandler hook
   Checks request.user.role is in allowedRoles
   Throws 403 if not

5. src/lib/jwt.ts:
   signAccessToken(payload) → JWT signed with JWT_ACCESS_SECRET, expires 15m
   signRefreshToken(payload) → JWT signed with JWT_REFRESH_SECRET, expires 7d
   verifyAccessToken(token) → payload or throws
   verifyRefreshToken(token) → payload or throws

6. src/middleware/audit-log.ts:
   onResponse hook factory: auditLog(action, resourceType)
   After response sent (status < 400), insert into audit_logs:
     userId, action, resourceType, resourceId (from params.id if present),
     ipAddress (request.ip), branchId (request.user?.branchId)
   Fire-and-forget (don't await — never fail the request for audit)

7. src/lib/invoice-number.ts:
   generateInvoiceNumber(branchCode: string, branchId: string) → string
   Format: {BRANCHCODE}-{YYYY}-{MMDD}-{SEQ5}
   Example: BRN01-2024-0115-00042
   Seq is per-branch, stored in Redis incr key: invoice_seq:{branchId}
   Use Redis INCR for atomic sequential numbering.

8. src/lib/gst.ts:
   calculateGST(amount: number, gstRate: number, isInterState: boolean)
   Returns: { cgst, sgst, igst, total }
   If interState: igst = amount * rate/100, cgst=0, sgst=0
   If intraState: cgst = sgst = amount * rate/2/100, igst=0
   isInterState = invoice.branch.state !== patient.state (or always false for walk-in)

9. src/lib/pagination.ts:
   buildPaginatedResponse<T>(data: T[], total: number, page: number, limit: number)
   Returns: { data, pagination: { page, limit, total, totalPages, hasNext, hasPrev } }
```

---

## PHASE 1-E — Auth Module (complete with tests)

### Prompt for Claude Code:

```
Implement the auth module at apps/api/src/modules/auth/.

auth.schemas.ts — JSON Schema for Fastify (also used for Swagger):
  LoginBody: { email: string, password: string }
  RegisterBody: { email, phone, password, firstName, lastName, role, branchId? }
  RefreshBody: { refreshToken: string }
  ChangePasswordBody: { currentPassword, newPassword }
  ForgotPasswordBody: { email }
  ResetPasswordBody: { token, newPassword }
  Responses: AuthResponse { accessToken, refreshToken, user: UserDTO }
  UserDTO: { id, email, phone, firstName, lastName, role, branchId, lastLoginAt }

auth.repository.ts:
  findByEmail(email) → user | null
  findByPhone(phone) → user | null
  findById(id) → user | null
  createUser(data) → user
  updateUser(id, data) → user
  updateLastLogin(id) → void
  storeRefreshToken(userId, token, expiresAt) → void  (in Redis: refresh:{userId})
  revokeRefreshToken(userId, token) → void
  isRefreshTokenValid(userId, token) → boolean
  storePasswordResetToken(userId, token) → void  (Redis, 1hr TTL)
  getPasswordResetToken(token) → userId | null
  deletePasswordResetToken(token) → void

auth.service.ts:
  login(email, password, ip):
    1. Find user by email
    2. Check isActive
    3. Compare bcrypt password
    4. Sign access + refresh tokens
    5. Store refresh token in Redis
    6. Update lastLoginAt
    7. Cache user session in Redis (session:{userId} → UserDTO, 15min)
    8. Return AuthResponse

  logout(userId, refreshToken):
    1. Revoke refresh token in Redis
    2. Delete session cache: session:{userId}

  refreshTokens(refreshToken):
    1. Verify refresh token JWT
    2. Check Redis that token is still valid (not revoked)
    3. Issue new access token (refresh token reuse — keep same refresh token)

  register(data):  (SUPER_ADMIN only — create staff accounts)
    1. Check email + phone unique
    2. Hash password
    3. Create user record

  changePassword(userId, currentPassword, newPassword):
    1. Verify current password
    2. Hash new password
    3. Update user
    4. Revoke all refresh tokens for user (security)

auth.routes.ts — register these routes:
  POST /api/v1/auth/login         → auth.service.login (public)
  POST /api/v1/auth/logout        → auth.service.logout (authenticated)
  POST /api/v1/auth/refresh       → auth.service.refreshTokens (public)
  POST /api/v1/auth/register      → auth.service.register (SUPER_ADMIN only)
  POST /api/v1/auth/change-password → auth.service.changePassword (authenticated)

All routes must have swagger tags: ['Auth'] and full schema definitions for swagger-ui.
All routes return { success: true, data: ... } or throw errors handled by error-handler.
```

---

## PHASE 1-F — Products & Inventory Module

### Prompt for Claude Code:

```
Implement products and inventory modules.

--- PRODUCTS MODULE ---

products.repository.ts:
  findAll(filters: { branchId?, categoryId?, scheduleType?, search?, page, limit })
    → paginated products with stock summary per branch
  findById(id) → product with category + default supplier
  findByBarcode(barcode) → product
  create(data) → product
  update(id, data) → product
  softDelete(id, deletedBy) → void
  getStockSummary(productId, branchId) → { totalQty, nearExpiryQty, batches[] }
  searchProducts(query, branchId) → top 10 matches (for POS barcode/name search)
    Use ILIKE on name + genericName + barcode — Elasticsearch in Phase 3

products.service.ts:
  All methods call repository + add business logic:
  - On create: validate barcode unique, HSN code format
  - On update: if barcode changed, validate unique
  - searchForPOS(query, branchId): returns product + available stock + batches for billing
    Must be fast (<200ms) — use Redis cache keyed by barcode, 5min TTL
    Cache key: product:barcode:{barcode}:{branchId}

products.routes.ts:
  GET    /api/v1/products              (SUPER_ADMIN, BRANCH_ADMIN, PHARMACIST, CASHIER, INV_MANAGER)
  GET    /api/v1/products/:id          (same roles)
  GET    /api/v1/products/search?q=&branchId=  (POS fast search, authenticated)
  GET    /api/v1/products/barcode/:code (POS scan, authenticated)
  POST   /api/v1/products              (SUPER_ADMIN, BRANCH_ADMIN, INV_MANAGER)
  PUT    /api/v1/products/:id          (same)
  DELETE /api/v1/products/:id          (SUPER_ADMIN, BRANCH_ADMIN)
  All with Swagger schema, tags: ['Products'], audit logging on POST/PUT/DELETE.

--- INVENTORY MODULE ---

inventory.repository.ts:
  getBatchesByProduct(productId, branchId) → batches ordered by expiryDate ASC (FEFO)
  getAvailableBatches(productId, branchId) → batches with qty > 0, not expired
  getLowStockProducts(branchId, threshold?) → products below reorder level
  getNearExpiryBatches(branchId, days: 30|60|90) → batches expiring within N days
  getExpiredBatches(branchId) → batches where expiryDate < today
  addBatch(data) → stock_batch (called from GRN)
  adjustStock(batchId, qty, reason, userId) → stock_movement record
    Creates stock_movements record, updates stock_batches.quantity
  reserveStock(batchId, qty) → void  (increment reservedQty, atomic)
  releaseReservation(batchId, qty) → void
  commitReservation(batchId, qty) → void  (decrements both qty and reservedQty)
  getTotalStockValue(branchId) → { totalValue, totalItems }
  getStockMovements(productId, branchId, from?, to?, page, limit) → paginated movements

inventory.service.ts:
  adjustStock: validate adjustment reason, check result qty won't go negative,
    create movement record, invalidate product cache
  selectBatchesForSale(productId, branchId, qty):
    FEFO selection — oldest expiry first, auto-split across batches if needed
    Returns: Array<{ batchId, batchNumber, expiryDate, qty }>
    Throws if insufficient stock
  processStockAdjustment(items[], type, reason, userId, branchId):
    Transaction: adjust each batch, create movement records

inventory.routes.ts:
  GET  /api/v1/inventory/stock?branchId=&productId=  → current stock summary
  GET  /api/v1/inventory/batches/:productId?branchId=
  GET  /api/v1/inventory/low-stock?branchId=
  GET  /api/v1/inventory/near-expiry?branchId=&days=
  GET  /api/v1/inventory/expired?branchId=
  POST /api/v1/inventory/adjust          (INV_MANAGER, BRANCH_ADMIN, SUPER_ADMIN)
  GET  /api/v1/inventory/movements?productId=&branchId=&from=&to=
  GET  /api/v1/inventory/value?branchId= → total stock value
  Tags: ['Inventory']
```

---

## PHASE 1-G — Billing Module (Core POS)

### Prompt for Claude Code:

```
Implement the billing module — most critical module in the system.

billing.repository.ts:
  createInvoice(data) → invoice
  updateInvoice(id, data) → invoice
  getInvoiceById(id) → invoice with items + payments + patient + branch
  getInvoiceByNumber(number) → invoice with full details
  listInvoices(filters: { branchId, patientId?, from?, to?, status?, page, limit })
  addPayment(invoiceId, paymentData) → payment
  getInvoiceItems(invoiceId) → invoice_items[]
  getDailySummary(branchId, date) → { totalSales, totalInvoices, totalGst, paymentBreakdown }
  voidInvoice(id, reason, userId) → void

billing.service.ts:
  ====== CHECKOUT FLOW (most important) ======
  createDraftInvoice(patientId?, branchId, billedBy):
    Create invoice with status DRAFT, generate invoice number

  addItemToInvoice(invoiceId, { productId, quantity, batchId? }):
    1. Load product — verify not deleted, is active
    2. If product.requiresRx or scheduleType != OTC:
       Check invoice has linked verified prescription (throw 400 if not)
    3. Select batches via FEFO (inventory.service.selectBatchesForSale)
    4. Reserve stock: inventory.repository.reserveStock
    5. Calculate line total: qty * sellingPrice * (1 - discount/100)
    6. Calculate GST per line using gst.lib
    7. Add invoice_item records, update invoice totals
    Return updated invoice

  removeItemFromInvoice(invoiceId, itemId):
    Release stock reservation, remove item, recalculate totals

  applyDiscount(invoiceId, { type: 'PERCENT'|'AMOUNT', value, approvedBy? }):
    If percent > 5%, require approvedBy (manager role check)
    Update invoice discountPercent / discountAmount, recalculate total

  finalizeInvoice(invoiceId, payments: { method, amount, referenceNo? }[]):
    Transaction:
    1. Validate payment amounts sum to totalAmount (or >= for overpayment)
    2. Commit stock reservations for all items
    3. Create stock_movement records (SALE) for each item batch
    4. Create payment records
    5. Update invoice status to PAID (or PARTIAL if underpaid)
    6. Update patient loyalty points (1 point per ₹100)
    7. Dispatch invoice-generated event (queue: PDF gen + WhatsApp notification)
    Return final invoice

  createReturnInvoice(originalInvoiceId, returnItems[], reason, userId):
    1. Load original invoice, validate it's PAID
    2. Create new invoice with isReturn=true, originalInvoiceId
    3. For each return item: restock batch (positive stock movement type RETURN)
    4. Create negative payment (refund)
    5. Update original invoice if partially returned
    Return return invoice

  ====== CALCULATION HELPERS ======
  calculateInvoiceTotals(items[], discount):
    Returns: { subtotal, discountAmount, cgst, sgst, igst, totalGst, roundOff, totalAmount }

billing.routes.ts:
  POST /api/v1/billing/invoices                   → create draft
  GET  /api/v1/billing/invoices                   → list (with filters)
  GET  /api/v1/billing/invoices/:id               → get full invoice
  PUT  /api/v1/billing/invoices/:id/items         → add item to draft
  DELETE /api/v1/billing/invoices/:id/items/:itemId → remove item
  PUT  /api/v1/billing/invoices/:id/discount      → apply discount
  POST /api/v1/billing/invoices/:id/finalize      → checkout
  POST /api/v1/billing/invoices/:id/return        → create return
  POST /api/v1/billing/invoices/:id/void          → void invoice
  GET  /api/v1/billing/invoices/:id/pdf           → generate PDF (queue job)
  GET  /api/v1/billing/summary/daily?branchId=&date= → daily sales summary
  Tags: ['Billing'], authenticate on all, authorize appropriately
```

---

## PHASE 1-H — Remaining Core Modules (Suppliers, Patients, Prescriptions, Staff)

### Prompt for Claude Code:

```
Implement these four modules following the same pattern as products/billing.
Keep implementations complete but concise.

=== SUPPLIERS MODULE ===
Endpoints:
  GET/POST /api/v1/suppliers
  GET/PUT/DELETE /api/v1/suppliers/:id
  GET /api/v1/suppliers/:id/purchase-orders
  GET /api/v1/suppliers/:id/outstanding

Service logic:
  - Track outstandingAmount (increases on PO receipt, decreases on payment)
  - Supplier rating auto-calculated from delivery accuracy + payment history

=== PURCHASE ORDERS MODULE ===
Endpoints:
  GET/POST /api/v1/purchase-orders
  GET/PUT /api/v1/purchase-orders/:id
  POST /api/v1/purchase-orders/:id/send     → status: DRAFT → SENT
  POST /api/v1/purchase-orders/:id/receive  → GRN: mark items received, create stock batches
  POST /api/v1/purchase-orders/:id/cancel

GRN flow (receive endpoint):
  Body: { items: [{ poItemId, receivedQty, batchNumber, expiryDate, purchasePrice }] }
  Transaction:
    1. Update purchase_order_items.receivedQty
    2. Create stock_batch records for each item
    3. Create stock_movement records (PURCHASE)
    4. Update PO status to RECEIVED or PARTIAL
    5. Update supplier outstandingAmount

=== PATIENTS MODULE ===
Endpoints:
  GET/POST /api/v1/patients
  GET/PUT/DELETE /api/v1/patients/:id
  GET /api/v1/patients/:id/invoices
  GET /api/v1/patients/:id/prescriptions
  GET /api/v1/patients/search?phone=&name=  → fast lookup for POS

Service:
  - On billing: check patient allergies against products being added, warn if match
  - Loyalty: getPoints, redeemPoints (100 points = ₹10 discount)

=== PRESCRIPTIONS MODULE ===
Endpoints:
  GET/POST /api/v1/prescriptions
  GET/PUT /api/v1/prescriptions/:id
  POST /api/v1/prescriptions/:id/verify    → status: PENDING → VERIFIED (PHARMACIST+)
  POST /api/v1/prescriptions/:id/upload    → multipart image upload to MinIO
  GET /api/v1/prescriptions/:id/image      → signed URL from MinIO

Service:
  - verifyPrescription: set verifiedBy, verifiedAt, status=VERIFIED
  - checkValidity(id): is validUntil >= today AND refillCount < maxRefills
  - linkToInvoice(prescriptionId, invoiceId): update invoice.prescriptionId
  - On dispensing: increment refillCount, auto-expire if maxRefills reached

=== STAFF MODULE ===
Endpoints:
  GET/POST /api/v1/staff
  GET/PUT/DELETE /api/v1/staff/:id
  POST /api/v1/staff/:id/attendance/checkin
  POST /api/v1/staff/:id/attendance/checkout
  GET /api/v1/staff/:id/attendance?month=&year=
  GET /api/v1/staff/attendance/today?branchId=
  GET /api/v1/staff/:id/performance?from=&to=
    → { totalSales, invoiceCount, avgInvoiceValue, returnRate }
    Join with invoices table on billed_by

=== REPORTS MODULE ===
Endpoints (all GET, REPORT_VIEWER role+):
  GET /api/v1/reports/sales?branchId=&from=&to=&groupBy=day|week|month
  GET /api/v1/reports/inventory/stock-value?branchId=
  GET /api/v1/reports/inventory/movement?productId=&branchId=&from=&to=
  GET /api/v1/reports/inventory/abc-analysis?branchId=  → A/B/C category by sales value
  GET /api/v1/reports/expiry?branchId=&days=
  GET /api/v1/reports/purchase?branchId=&from=&to=
  GET /api/v1/reports/gst?branchId=&month=&year=  → GSTR-1 format data
  GET /api/v1/reports/schedule-h-register?branchId=&from=&to=
  All reports support ?format=json|csv query param.
  CSV: stream response with Content-Disposition: attachment

=== NOTIFICATIONS MODULE ===
Queue workers (implement as BullMQ workers, not HTTP routes):
  expiry-scanner.worker.ts — runs daily 9am cron:
    Query batches expiring in 30 days
    For each: create notification record + queue SMS/email
  reorder-engine.worker.ts — runs every 6 hours:
    Query products below reorderLevel per branch
    Create notification + optional auto-draft PO
  notification.worker.ts — processes notification queue:
    Reads notification jobs
    Sends via MSG91 (SMS), Resend (email) based on type
    Updates notification.status = SENT | FAILED

One HTTP endpoint:
  GET /api/v1/notifications?branchId=&unreadOnly=&page=  (authenticated user sees own branch)
  POST /api/v1/notifications/:id/read
```

---

## PHASE 1-I — Swagger Verification & Final Backend Check

### Prompt for Claude Code:

```
Perform final backend wiring and verification:

1. In src/app.ts, ensure all module routes are registered:
   fastify.register(authRoutes, { prefix: '/api/v1/auth' })
   fastify.register(usersRoutes, { prefix: '/api/v1/users' })
   fastify.register(branchesRoutes, { prefix: '/api/v1/branches' })
   fastify.register(productsRoutes, { prefix: '/api/v1/products' })
   fastify.register(inventoryRoutes, { prefix: '/api/v1/inventory' })
   fastify.register(suppliersRoutes, { prefix: '/api/v1/suppliers' })
   fastify.register(purchaseOrdersRoutes, { prefix: '/api/v1/purchase-orders' })
   fastify.register(patientsRoutes, { prefix: '/api/v1/patients' })
   fastify.register(prescriptionsRoutes, { prefix: '/api/v1/prescriptions' })
   fastify.register(billingRoutes, { prefix: '/api/v1/billing' })
   fastify.register(staffRoutes, { prefix: '/api/v1/staff' })
   fastify.register(reportsRoutes, { prefix: '/api/v1/reports' })
   fastify.register(notificationsRoutes, { prefix: '/api/v1/notifications' })

2. Ensure every route has:
   schema: { tags: [...], summary: '...', body/querystring/params schema, response schema }
   This is what powers Swagger-UI at /docs

3. Create src/index.ts:
   const app = await createApp()
   await app.listen({ port: config.PORT, host: '0.0.0.0' })
   console.log(`API running at http://localhost:${config.PORT}`)
   console.log(`Swagger docs at http://localhost:${config.PORT}/docs`)
   Handle SIGINT/SIGTERM for graceful shutdown:
     - Close DB connections
     - Close Redis
     - Drain BullMQ queues
     - app.close()

4. Start BullMQ workers in a separate process (src/worker.ts):
   Import and start all workers
   This file is run separately: "worker": "tsx watch src/worker.ts"

5. Run: pnpm --filter api dev
   Verify:
   - Server starts on port 3001
   - /health returns 200
   - /docs loads Swagger UI with all routes grouped by tag
   - POST /api/v1/auth/login works with test credentials

6. Add a seed script at apps/api/src/db/seed.ts:
   Create:
   - 1 super admin user: admin@mederp.com / Admin@123
   - 2 branches: Main Branch (BRN01), Branch 2 (BRN02)
   - 5 sample product categories
   - 20 sample products across all schedule types
   - 2 suppliers
   - 3 staff users (pharmacist, cashier, inventory manager)
   Script: "db:seed": "tsx src/db/seed.ts"
```

---

## PHASE 2-A — Frontend: Next.js App Setup

### Prompt for Claude Code:

```
Scaffold the Next.js 14 frontend inside apps/web/.

Full directory structure:
apps/web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── middleware.ts              # route protection (check JWT in cookie)
├── public/
│   ├── logo.svg
│   └── manifest.json          # PWA manifest
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── layout.tsx         # root layout — fonts, providers
│   │   ├── page.tsx           # redirect to /dashboard or /login
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx
│   │   └── (dashboard)/       # protected route group
│   │       ├── layout.tsx     # sidebar + topbar layout
│   │       ├── dashboard/
│   │       │   └── page.tsx   # main dashboard (role-aware)
│   │       ├── billing/
│   │       │   ├── page.tsx   # invoice list
│   │       │   └── pos/
│   │       │       └── page.tsx  # POS terminal
│   │       ├── inventory/
│   │       │   ├── page.tsx   # stock overview
│   │       │   ├── products/
│   │       │   │   ├── page.tsx
│   │       │   │   └── [id]/page.tsx
│   │       │   └── batches/page.tsx
│   │       ├── purchases/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── patients/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── prescriptions/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── suppliers/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── staff/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── reports/
│   │       │   ├── page.tsx
│   │       │   ├── sales/page.tsx
│   │       │   ├── inventory/page.tsx
│   │       │   ├── gst/page.tsx
│   │       │   └── compliance/page.tsx
│   │       ├── notifications/page.tsx
│   │       └── settings/
│   │           ├── page.tsx
│   │           ├── branches/page.tsx
│   │           └── users/page.tsx
│   ├── components/
│   │   ├── ui/                # shadcn/ui components (generated)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── topbar.tsx
│   │   │   ├── breadcrumb.tsx
│   │   │   └── page-header.tsx
│   │   ├── forms/
│   │   │   ├── product-form.tsx
│   │   │   ├── patient-form.tsx
│   │   │   ├── supplier-form.tsx
│   │   │   ├── purchase-order-form.tsx
│   │   │   └── staff-form.tsx
│   │   ├── tables/
│   │   │   ├── data-table.tsx     # reusable TanStack Table wrapper
│   │   │   ├── columns/           # column definitions per domain
│   │   │   │   ├── products.columns.tsx
│   │   │   │   ├── invoices.columns.tsx
│   │   │   │   ├── patients.columns.tsx
│   │   │   │   └── staff.columns.tsx
│   │   ├── charts/
│   │   │   ├── sales-trend.tsx    # Recharts line chart
│   │   │   ├── category-pie.tsx
│   │   │   ├── stock-bar.tsx
│   │   │   └── revenue-area.tsx
│   │   ├── pos/                   # POS-specific components
│   │   │   ├── product-search.tsx # barcode/name search input
│   │   │   ├── cart.tsx
│   │   │   ├── cart-item.tsx
│   │   │   ├── payment-modal.tsx
│   │   │   ├── invoice-preview.tsx
│   │   │   └── prescription-link.tsx
│   │   └── shared/
│   │       ├── stat-card.tsx
│   │       ├── badge-status.tsx
│   │       ├── date-range-picker.tsx
│   │       ├── confirm-dialog.tsx
│   │       ├── loading-skeleton.tsx
│   │       ├── empty-state.tsx
│   │       └── export-button.tsx
│   ├── lib/
│   │   ├── api.ts             # axios instance with interceptors
│   │   ├── auth.ts            # getSession, clearSession helpers
│   │   ├── permissions.ts     # can(role, action) helper
│   │   └── utils.ts           # cn(), formatINR(), formatDate()
│   ├── hooks/
│   │   ├── use-auth.ts        # current user + role
│   │   ├── use-branch.ts      # active branch context
│   │   ├── use-permissions.ts # usePermission('billing.create')
│   │   ├── use-debounce.ts
│   │   └── use-barcode-scanner.ts  # keypress event listener
│   ├── stores/
│   │   ├── auth.store.ts      # Zustand: user, token, logout
│   │   ├── cart.store.ts      # Zustand: active POS cart
│   │   └── branch.store.ts    # Zustand: active branch selection
│   ├── queries/               # React Query query + mutation hooks
│   │   ├── auth.queries.ts
│   │   ├── products.queries.ts
│   │   ├── inventory.queries.ts
│   │   ├── billing.queries.ts
│   │   ├── patients.queries.ts
│   │   ├── prescriptions.queries.ts
│   │   ├── suppliers.queries.ts
│   │   ├── purchase-orders.queries.ts
│   │   ├── staff.queries.ts
│   │   └── reports.queries.ts
│   ├── providers/
│   │   ├── query-provider.tsx     # ReactQueryClientProvider
│   │   ├── auth-provider.tsx      # session init
│   │   └── branch-provider.tsx    # branch context
│   └── types/
│       └── index.ts               # re-export from @mederp/types

package.json dependencies:
  next, react, react-dom, @tanstack/react-query, @tanstack/react-table,
  @tanstack/react-virtual, zustand, axios, zod, react-hook-form,
  @hookform/resolvers, recharts, date-fns, clsx, tailwind-merge,
  lucide-react, @radix-ui/react-* (via shadcn)

scripts:
  "dev": "next dev --port 3000"
  "build": "next build"
  "start": "next start"

next.config.ts:
  output: 'standalone'
  images: { domains: ['localhost'] }

Run after scaffold:
  npx shadcn@latest init (choose: Default style, Zinc color, CSS variables yes)
  npx shadcn@latest add button input label card dialog sheet
    table badge select textarea toast skeleton separator
    dropdown-menu popover command calendar
```

---

## PHASE 2-B — Frontend: Auth, Layout & Core Infrastructure

### Prompt for Claude Code:

```
Implement auth flow, layout, API client, and state management.

1. src/lib/api.ts — axios instance:
   baseURL: process.env.NEXT_PUBLIC_API_URL (default http://localhost:3001)
   Request interceptor: attach Authorization: Bearer {token} from auth store
   Response interceptor:
     On 401: clear auth store → redirect to /login
     On success: return response.data.data (unwrap envelope)
   Export typed API functions per domain:
     export const authApi = { login, logout, refresh, changePassword }
     export const productsApi = { list, getById, create, update, delete, search }
     etc. for all domains

2. src/stores/auth.store.ts — Zustand with persist:
   State: { user: UserDTO | null, accessToken: string | null, isAuthenticated: bool }
   Actions: setAuth(user, token), clearAuth(), updateUser(partial)
   Persist: localStorage key 'mederp-auth' (only user + isAuthenticated, not token)
   Token: store in memory only (security) — on refresh load, call /auth/refresh

3. src/stores/cart.store.ts — Zustand:
   State: {
     invoiceId: string | null,
     branchId: string | null,
     patientId: string | null,
     prescriptionId: string | null,
     items: CartItem[],  // { productId, productName, batchId, batchNumber, expiry, qty, unitPrice, total, gstRate }
     subtotal, discount, totalGst, total
   }
   Actions: initCart, addItem, removeItem, updateQty, applyDiscount, clearCart
   Cart is synced with backend (each mutation calls API)

4. src/providers/auth-provider.tsx:
   On mount: check localStorage for user
   If user exists: call POST /auth/refresh to get new access token
   If refresh fails: clearAuth → redirect to login
   Set axios Authorization header after refresh

5. middleware.ts (Next.js middleware):
   Protected routes: /dashboard/*, /billing/*, /inventory/*, etc.
   Public routes: /login
   If no auth cookie / token → redirect to /login
   Use jose library to verify JWT in edge runtime (not jsonwebtoken)

6. src/app/(auth)/login/page.tsx:
   Form: email + password fields using react-hook-form + zod
   On submit: call authApi.login → store in auth.store → redirect to /dashboard
   Show error messages inline
   Loading state on submit button
   Professional pharmacy-themed design

7. src/app/(dashboard)/layout.tsx:
   Sidebar (collapsible on mobile):
     Logo + store name at top
     Nav items (show/hide based on user role using usePermissions):
       Dashboard, POS / Billing, Inventory → Products, Batches
       Purchases → Orders, Suppliers
       Patients, Prescriptions
       Staff, Reports, Notifications, Settings
     User avatar + name + logout at bottom
   Topbar:
     Breadcrumb, branch selector (if SUPER_ADMIN: dropdown to switch branches),
     notification bell with unread count, user menu

8. src/components/layout/sidebar.tsx:
   Navigation items with icons (lucide-react)
   Active state highlighting
   Collapsible sub-menus
   Role-based visibility using usePermissions hook

9. src/hooks/use-permissions.ts:
   const ROLE_PERMISSIONS = { SUPER_ADMIN: ['*'], BRANCH_ADMIN: [...], ... }
   usePermission(action: string): boolean
   usePermissions(): { can: (action) => boolean, role: UserRole }
```

---

## PHASE 2-C — POS Terminal (Most Critical UI)

### Prompt for Claude Code:

```
Build the POS terminal at src/app/(dashboard)/billing/pos/page.tsx.
This is the most-used screen — optimize for keyboard-first, fast operation.

Layout (split pane):
  LEFT PANEL (60%): Product search + cart
  RIGHT PANEL (40%): Invoice summary + payment

LEFT PANEL — components/pos/product-search.tsx:
  Large search input at top, autofocused on page load
  Listens for barcode scanner (fast keypress sequence ending in Enter)
  Also supports typing product name for fuzzy search
  On scan/search: call GET /api/v1/products/barcode/:code or /search?q=
  Show results as dropdown list:
    Product name, generic name, schedule badge, MRP, stock qty
    Click / Enter to add to cart
  Keyboard shortcut: F2 = focus search, Esc = clear search
  Show "Schedule H — Rx required" warning badge for controlled drugs

components/pos/cart.tsx:
  Table of cart items:
    Columns: Product, Batch/Expiry, Qty (editable), MRP, Disc%, Selling Price, Total
  Each row: increase/decrease qty buttons, remove button
  Inline qty edit: click qty cell → number input
  Bottom: subtotal, discount row (click to apply), GST breakdown, grand total
  Patient selector at top: search by phone → select patient → load loyalty points
  Prescription link button: open prescription selector modal

components/pos/payment-modal.tsx:
  Dialog that opens on "Checkout" click
  Shows: Patient name (or Walk-in), total amount
  Payment methods (can split):
    Cash: input amount, show change due
    UPI: reference number input
    Card: last 4 digits input
    Insurance: claim number + company
    Credit: uses patient.creditBalance
  Multiple payment rows if splitting
  Validation: sum of payments must equal total
  "Confirm & Print" button → calls billing.service.finalizeInvoice
  On success: show invoice preview, option to print/WhatsApp

components/pos/invoice-preview.tsx:
  Shows formatted invoice after payment
  Print button (window.print() with @media print CSS)
  WhatsApp button: open wa.me link with invoice summary
  New sale button: reset cart

Keyboard shortcuts (document-level listeners):
  F2: focus product search
  F4: open payment modal (if cart has items)
  F6: clear cart (with confirmation)
  Ctrl+P: print last invoice
  Escape: close any open modal

State: use cart.store (Zustand) for cart state
All mutations: optimistic UI — update store immediately, sync API in background
On API error: rollback store + show toast

React Query integration:
  useProductSearch(query, branchId) — debounced 200ms, min 2 chars
  useAddCartItem() mutation
  useFinalizeInvoice() mutation
```

---

## PHASE 2-D — Remaining Frontend Pages

### Prompt for Claude Code:

```
Build remaining pages following consistent patterns. Each page:
- Uses TanStack Table via components/tables/data-table.tsx
- Has filters (date range, search, status)
- Has create/edit via Sheet (slide-over) or Dialog
- Uses React Query for data fetching + mutations
- Shows loading skeleton during fetch
- Shows empty state if no data

=== DASHBOARD PAGE (src/app/(dashboard)/dashboard/page.tsx) ===
Stat cards row:
  Today's Sales (₹), Invoices Today, Items Out of Stock, Expiring in 30 Days
Charts:
  Sales trend last 30 days (line chart — recharts)
  Top 5 products by sales this month (bar chart)
  Payment method breakdown today (pie chart)
Alert cards:
  Low stock products (top 5, link to full report)
  Near-expiry batches (top 5)
  Pending prescriptions (if pharmacist/admin)
All data from: /reports/sales, /inventory/low-stock, /inventory/near-expiry

=== PRODUCTS PAGE ===
  Filterable table: name, category, schedule type, active status
  Quick actions: edit, view batches, toggle active
  Create/edit via Sheet with product-form.tsx
  Barcode display with react-barcode

=== INVENTORY / STOCK PAGE ===
  Table: product, total qty, batches, near-expiry qty, value
  Color coding: red if qty < reorderLevel, amber if near expiry
  Click row: expand to see all batches with expiry dates
  Tab: Low Stock | Near Expiry | Expired

=== PURCHASE ORDERS PAGE ===
  Table of POs with status badges
  Create PO: select supplier, add items, set quantities
  GRN Modal: on "Receive" button — enter batch numbers + expiry for each item

=== PATIENTS PAGE ===
  Search by phone/name
  Patient card: loyalty points, purchase count, outstanding credit
  Patient detail: full history tabs (invoices, prescriptions, medications)

=== PRESCRIPTIONS PAGE ===
  Pending tab: prescriptions awaiting verification (pharmacist view)
  Table with: patient, doctor, date, status, action buttons
  Verify action: opens image preview + verify button

=== REPORTS PAGE ===
  Sidebar sub-navigation: Sales, Inventory, GST, Compliance
  Each report: date range picker + branch selector + Export CSV button
  Recharts visualization where applicable

=== SETTINGS PAGE ===
  Tabs: General, Branches, Users, Tax Config, Notifications
  Users table: invite user, change role, deactivate
  Branch form: GSTIN, drug license, address
```

---

## PHASE 2-E — Final Frontend Polish

### Prompt for Claude Code:

```
Complete the frontend with cross-cutting concerns.

1. Error boundaries:
   src/app/error.tsx — catches page-level errors
   src/app/not-found.tsx — 404 page
   Wrap each module section in React ErrorBoundary

2. Toast notifications (shadcn Sonner):
   Success toast on: create, update, delete, checkout, stock adjustment
   Error toast on: API errors (use axios interceptor to auto-show)
   Install: npx shadcn@latest add sonner

3. src/components/shared/export-button.tsx:
   Button that calls report endpoint with ?format=csv
   Triggers browser download via blob URL

4. src/hooks/use-barcode-scanner.ts:
   Listen for rapid keypress events (< 50ms between chars, ends with Enter)
   Buffer characters, emit scanned barcode
   Debounce: ignore normal typing (> 50ms gap = not scanner)
   Usage in POS: useBarcodeScanner((code) => addToCart(code))

5. PWA setup (next.config.ts + public/manifest.json):
   manifest.json: name, short_name, icons, theme_color, display: standalone
   next.config.ts: add withPWA wrapper (next-pwa package)
   Cache strategy: StaleWhileRevalidate for API GET requests

6. Responsive breakpoints:
   Desktop (1280px+): full sidebar + dual-pane POS
   Tablet (768px-1280px): collapsible sidebar, single-pane POS with tabs
   Mobile (< 768px): bottom nav, mobile-optimized tables (card view)

7. Print styles (globals.css):
   @media print:
     Hide sidebar, topbar, buttons
     Show only invoice content
     Page break rules for long invoices

8. Performance:
   All tables use TanStack Virtual for rows > 100
   Images: next/image with lazy loading
   Heavy pages (reports): dynamic import with loading fallback
   API calls: React Query with staleTime: 30s for list data

9. Environment variables (apps/web/.env.local):
   NEXT_PUBLIC_API_URL=http://localhost:3001
   NEXT_PUBLIC_APP_NAME=MedERP
   NEXT_PUBLIC_CURRENCY=INR

10. Final check — run and verify:
    pnpm dev (starts both api on 3001 + web on 3000)
    Login with admin@mederp.com / Admin@123
    Create a product, do a full POS sale, check inventory updated
    Swagger docs accessible at http://localhost:3001/docs
```

---

## POST-PHASE CHECKLIST

Run these after each phase before moving to next:

```
□ pnpm typecheck — zero TypeScript errors
□ pnpm lint — zero ESLint errors
□ All new API routes visible in Swagger UI at /docs
□ Database migrations run cleanly (pnpm db:migrate)
□ Seed data loads (pnpm db:seed)
□ No console.error in browser DevTools
□ Network tab: all API calls return 200 with { success: true, data: ... }
□ Role-based access: log in as cashier → billing works, inventory blocked
□ FEFO: add 2 batches (different expiry), sell → older expiry deducted first
□ Schedule H product: attempt billing without Rx → blocked with 400 error
```

---

## FUTURE PHASES (feed individually when ready)

- **Phase 3:** Elasticsearch integration, demand forecasting, WhatsApp Business API
- **Phase 4:** Multi-branch distribution, stock transfers, inter-branch billing
- **Phase 5:** Kubernetes deployment, monitoring (Prometheus + Grafana), CI/CD pipeline
- **Phase 6:** Insurance claim management, Tally/Zoho accounting integration
