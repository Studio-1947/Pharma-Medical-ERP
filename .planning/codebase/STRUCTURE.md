# Codebase Structure

**Analysis Date:** 2026-04-28

## Directory Layout

```
pharmerp/
├── backend/                          # NestJS + Fastify + Drizzle API
│   ├── src/
│   │   ├── main.ts                  # Entry point — bootstrap NestJS app
│   │   ├── app.module.ts            # Root module — imports all feature modules
│   │   ├── common/
│   │   │   ├── decorators/
│   │   │   │   ├── current-user.decorator.ts      # Extract JwtPayload from request
│   │   │   │   └── roles.decorator.ts             # Mark routes with @Roles() + @Public()
│   │   │   ├── filters/
│   │   │   │   └── global-exception.filter.ts     # Centralized error handling
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts              # JWT verification + public route bypass
│   │   │   │   └── roles.guard.ts                 # RBAC enforcement
│   │   │   └── interceptors/
│   │   │       ├── transform.interceptor.ts       # Wrap responses in { success, data, meta }
│   │   │       └── audit.interceptor.ts           # Log audit trail
│   │   ├── database/
│   │   │   ├── drizzle.service.ts                 # PostgreSQL connection pool + Drizzle instance
│   │   │   ├── drizzle.module.ts                  # Exports DrizzleService
│   │   │   └── schema/
│   │   │       ├── index.ts                       # Re-exports all schemas
│   │   │       ├── enums.ts                       # Drizzle pgEnum definitions
│   │   │       ├── auth.ts                        # users, refreshTokens tables
│   │   │       ├── inventory.ts                   # medicines, medicineCategories, inventoryBatches, storageLocations, etc.
│   │   │       ├── billing.ts                     # salesInvoices, invoiceLineItems, payments tables
│   │   │       ├── prescriptions.ts               # prescriptions, prescriptionItems tables
│   │   │       ├── procurement.ts                 # purchaseOrders, purchaseOrderItems tables
│   │   │       ├── hr.ts                          # staffMembers, attendance, leaves tables
│   │   │       └── distribution.ts                # stockTransfers, transferItems tables
│   │   └── modules/
│   │       ├── auth/
│   │       │   ├── auth.module.ts                 # Exports AuthController, AuthService
│   │       │   ├── auth.controller.ts             # register, login, refresh, logout routes
│   │       │   ├── auth.service.ts                # JWT issuance, password hashing, token validation
│   │       │   ├── auth.repository.ts             # User CRUD, token management
│   │       │   └── strategies/
│   │       │       └── jwt.strategy.ts            # Passport JWT strategy
│   │       ├── billing/
│   │       │   ├── billing.module.ts
│   │       │   ├── billing.controller.ts          # POST /invoices, /invoices/:id/void, /payments
│   │       │   ├── billing.service.ts             # Core invoice creation (transactional)
│   │       │   ├── billing.repository.ts          # Queries salesInvoices, invoiceLineItems
│   │       │   └── tax.service.ts                 # GST calculation (CGST/SGST/IGST)
│   │       ├── inventory/
│   │       │   ├── inventory.module.ts
│   │       │   ├── inventory.controller.ts        # GET /medicines, /medicines/:id, /low-stock
│   │       │   ├── inventory.service.ts
│   │       │   ├── inventory.repository.ts        # Query medicines, batches, low-stock
│   │       │   ├── batch.controller.ts            # Batch-specific routes
│   │       │   ├── batch.service.ts
│   │       │   ├── batch.repository.ts            # Batch CRUD, FEFO selection, quantity adjustments
│   │       │   ├── warehouse.controller.ts        # Warehouse routes
│   │       │   ├── barcode.service.ts             # Barcode generation + validation
│   │       │   ├── stock-movement.repository.ts   # Append-only stock ledger
│   │       │   └── jobs/
│   │       │       ├── expiry-scanner.job.ts      # BullMQ: scan for expiring batches
│   │       │       └── reorder-engine.job.ts      # BullMQ: detect low-stock items
│   │       ├── patients/
│   │       │   ├── patients.module.ts
│   │       │   ├── patients.controller.ts         # GET /patients, POST /patients, etc.
│   │       │   ├── patients.service.ts
│   │       │   └── patients.repository.ts         # Patients CRUD
│   │       ├── prescriptions/
│   │       │   ├── prescriptions.module.ts
│   │       │   ├── prescriptions.controller.ts    # POST /verify, /upload image, etc.
│   │       │   ├── prescriptions.service.ts
│   │       │   └── prescriptions.repository.ts
│   │       ├── procurement/
│   │       │   ├── procurement.module.ts
│   │       │   ├── purchase-orders.controller.ts  # GET /purchase-orders, POST /receive (GRN)
│   │       │   ├── purchase-orders.service.ts     # GRN logic, batch creation
│   │       │   └── purchase-orders.repository.ts
│   │       ├── hr/
│   │       │   ├── hr.module.ts
│   │       │   └── [staff, attendance routes]
│   │       ├── distribution/
│   │       │   ├── distribution.module.ts
│   │       │   └── [stock transfer routes]
│   │       └── users/
│   │           ├── users.module.ts
│   │           ├── users.controller.ts
│   │           ├── users.service.ts
│   │           └── users.repository.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── .env                          # DATABASE_URL, REDIS_URL, JWT secrets (git-ignored)
├── frontend/                         # Next.js 15 + React 18 + TailwindCSS
│   ├── app/
│   │   ├── layout.tsx                # Root layout — fonts, metadata, providers
│   │   ├── page.tsx                  # Redirect to /dashboard or /login
│   │   ├── providers.tsx             # QueryClientProvider setup
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx          # Login form (public route)
│   │   └── (shell)/                  # Protected route group with sidebar + header
│   │       ├── layout.tsx            # Shell layout (sidebar + header wrapper)
│   │       ├── dashboard/page.tsx    # Dashboard (stats, charts)
│   │       ├── billing/
│   │       │   ├── page.tsx          # Invoice list
│   │       │   └── pos/
│   │       │       └── page.tsx      # POS terminal (core feature)
│   │       └── inventory/
│   │           └── page.tsx          # Stock overview
│   ├── components/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   └── login-form.tsx    # Login form with react-hook-form
│   │   │   ├── billing/
│   │   │   │   ├── pos-terminal.tsx  # POS main component
│   │   │   │   ├── product-search.tsx # Barcode + name search with debounce
│   │   │   │   ├── cart.tsx          # Cart display with line items
│   │   │   │   ├── payment-modal.tsx # Checkout modal (payment methods, change calculation)
│   │   │   │   └── invoice-preview.tsx
│   │   │   └── inventory/
│   │   │       ├── medicine-list.tsx # Medicine table with pagination
│   │   │       ├── medicine-form.tsx # Create/edit form
│   │   │       ├── batch-list.tsx    # Batch view (FEFO ordered)
│   │   │       └── stock-dashboard.tsx
│   │   ├── shared/
│   │   │   ├── sidebar.tsx           # Main navigation (role-aware visibility)
│   │   │   ├── header.tsx            # Top bar (user menu, notifications, branch selector)
│   │   │   ├── stat-card.tsx         # Reusable stat display component
│   │   │   └── [other shared UI]
│   │   └── ui/
│   │       └── [shadcn/ui components - button, dialog, input, etc.]
│   ├── lib/
│   │   ├── api-client.ts             # Axios instance with JWT interceptors
│   │   ├── pos-db.ts                 # Dexie (IndexedDB) for offline POS cache
│   │   └── utils.ts                  # Helpers (formatINR, formatDate, cn, etc.)
│   ├── stores/
│   │   ├── auth.store.ts             # Zustand: user, tokens, isAuthenticated
│   │   └── cart.store.ts             # Zustand: items[], subtotal, discount, totals()
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js                # Output: standalone, image domains
│   └── tailwind.config.ts
├── packages/
│   ├── types/                        # Shared TypeScript types + Zod schemas
│   │   ├── src/
│   │   │   ├── index.ts              # Re-export all DTOs + enums
│   │   │   ├── enums.ts              # UserRole, InvoiceStatus, etc. (TypeScript enums)
│   │   │   └── dtos/
│   │   │       ├── auth.dto.ts       # loginSchema, registerSchema, refreshTokenSchema
│   │   │       ├── medicine.dto.ts   # createMedicineSchema, updateMedicineSchema, etc.
│   │   │       ├── invoice.dto.ts    # createInvoiceSchema, queryInvoiceSchema
│   │   │       ├── patient.dto.ts
│   │   │       ├── batch.dto.ts
│   │   │       └── [other DTOs]
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── config-typescript/            # Shared ESLint + TypeScript config
│       ├── eslint-config.js
│       └── tsconfig.json
├── package.json                      # Root pnpm workspace config
├── pnpm-workspace.yaml               # Declares workspaces: backend, frontend, packages/*
├── turbo.json                        # Turborepo task pipeline (build, dev, lint, typecheck)
├── docker-compose.yml                # PostgreSQL 16, Redis 7, MinIO
├── .env.example                      # Env var template
└── .gitignore
```

## Directory Purposes

**backend/src/:**
Backend API source code — all TypeScript compiled to dist/ on build.

**backend/src/common/:**
Shared, reusable pieces across modules:
- decorators: @Public(), @Roles(), @CurrentUser()
- guards: JWT verification, role enforcement
- filters: Global error handling
- interceptors: Response transformation, audit logging

**backend/src/database/:**
ORM configuration and schema definitions:
- drizzle.service.ts: PostgreSQL connection pool (max 20 connections)
- schema/*.ts: Drizzle table + enum definitions (one file per domain)
- No migrations directory — managed via drizzle-kit CLI

**backend/src/modules/{domain}/**
Feature modules — each is self-contained with controller, service, repository:
- controller: HTTP routing, input validation (Zod parse), guards/decorators
- service: Business logic, orchestration, transaction wrapping
- repository: Query building, data access

**frontend/app/:**
Next.js App Router structure:
- layout.tsx files: wrapper layouts for sections (root layout, shell layout)
- page.tsx files: actual pages/routes
- (auth) and (shell) are route groups: grouping related pages without affecting URL

**frontend/components/**
Reusable React components organized by domain:
- modules/{domain}: Domain-specific components (auth, billing, inventory)
- shared: Cross-cutting UI (sidebar, header, stat cards)
- ui: Base components from shadcn/ui

**frontend/lib/**
Utility functions and configurations:
- api-client.ts: Axios instance with interceptors for JWT attachment, auto-refresh, error handling
- pos-db.ts: Dexie IndexedDB schema for offline POS
- utils.ts: Currency, date, classname helpers

**frontend/stores/**
Zustand state management:
- auth.store.ts: User identity and authentication tokens (persisted to localStorage)
- cart.store.ts: Active POS shopping cart (in-memory + localStorage)

**packages/types/**
Shared type definitions consumed by backend and frontend:
- enums.ts: TypeScript enums (UserRole, InvoiceStatus, PaymentMode, etc.)
- dtos/{domain}.dto.ts: Zod schemas for request/response validation and type inference

## Key File Locations

**Entry Points:**
- `backend/src/main.ts` — NestJS bootstrap (FastifyAdapter, Swagger setup, listen on port 3001)
- `frontend/app/layout.tsx` — Root React component
- `frontend/app/providers.tsx` — React Query provider initialization

**Configuration:**
- `backend/.env` — Database URL, Redis URL, JWT secrets (git-ignored)
- `frontend/.env.local` — NEXT_PUBLIC_API_URL, app configuration
- `docker-compose.yml` — PostgreSQL 16, Redis 7 services

**Core Logic:**
- `backend/src/modules/billing/billing.service.ts` — Invoice creation with FEFO stock selection and transaction
- `backend/src/modules/inventory/batch.repository.ts` — FEFO batch selection, quantity adjustments
- `backend/src/common/filters/global-exception.filter.ts` — Error response formatting
- `backend/src/database/drizzle.service.ts` — PostgreSQL connection and Drizzle configuration
- `frontend/stores/cart.store.ts` — POS cart state and calculations
- `frontend/components/modules/billing/pos-terminal.tsx` — POS UI orchestration

**Testing:**
- Test files follow pattern: `{module}.spec.ts` or `{module}.test.ts` (none present yet; vitest configured)
- Config: `vitest` configured in backend package.json

**Database:**
- Schema files: `backend/src/database/schema/{domain}.ts`
- Migrations: Auto-generated in `backend/drizzle/migrations/` via drizzle-kit
- Not yet committed; run `pnpm db:generate && pnpm db:migrate` after schema changes

## Naming Conventions

**Files:**
- Controllers: `{domain}.controller.ts` (e.g., `auth.controller.ts`)
- Services: `{domain}.service.ts` (e.g., `billing.service.ts`)
- Repositories: `{domain}.repository.ts` (e.g., `inventory.repository.ts`)
- DTOs: `{domain}.dto.ts` (e.g., `auth.dto.ts`)
- Database tables: camelCase plural (e.g., `salesInvoices`, `inventoryBatches`)
- Database columns: camelCase (e.g., `createdAt`, `deletedAt`)
- Drizzle enums: camelCaseEnum (e.g., `userRoleEnum`, `invoiceStatusEnum`)
- React components: PascalCase file + export (e.g., `pos-terminal.tsx` exports `<POSTerminal />`)
- Zustand stores: `{entity}.store.ts` with `use{Entity}Store` hook

**Directories:**
- Feature modules: lowercase domain name (e.g., `auth/`, `billing/`, `inventory/`)
- Shared utilities: `common/`, `lib/`, `components/shared/`

## Where to Add New Code

**New API Endpoint:**
1. Create/update `backend/src/modules/{domain}/{domain}.controller.ts` with new @Get/@Post method
2. Add business logic to `backend/src/modules/{domain}/{domain}.service.ts`
3. Add data access to `backend/src/modules/{domain}/{domain}.repository.ts`
4. Add Zod schema to `packages/types/src/dtos/{domain}.dto.ts` if input/output needs validation
5. Import schema in controller, parse with `schema.parse(body)`
6. Add route decorator (@Get, @Post, @UseGuards(JwtAuthGuard, RolesGuard), @Roles(...))
7. Swagger decorators auto-generated via nestjs-zod + OpenAPI

**New Page/Feature (Frontend):**
1. Create page file: `frontend/app/(shell)/{feature}/page.tsx`
2. Create module component: `frontend/components/modules/{feature}/index.tsx`
3. Create API queries hook: Define in `frontend/lib/api-client.ts` or new file
4. Use in page via `useQuery()` from React Query
5. Add navigation link to sidebar: `frontend/components/shared/sidebar.tsx`
6. Add role-based visibility check if restricted

**New Module (Backend):**
1. Create `backend/src/modules/{domain}/` directory
2. Create `{domain}.module.ts`, `{domain}.controller.ts`, `{domain}.service.ts`, `{domain}.repository.ts`
3. Add Drizzle table definitions to `backend/src/database/schema/{domain}.ts`
4. Create Zod DTOs in `packages/types/src/dtos/{domain}.dto.ts`
5. Import new module in `backend/src/app.module.ts`
6. Run `pnpm db:generate && pnpm db:migrate`

**Utilities:**
- Shared helpers: `frontend/lib/utils.ts` or `packages/utils/` (if needed across workspaces)
- Backend-only utilities: `backend/src/lib/` (e.g., tax calculation, barcode validation)
- Shared DTOs/types: Always in `packages/types/`

## Special Directories

**backend/drizzle/migrations/:**
- Purpose: Database schema versions (auto-generated by drizzle-kit)
- Generated: Yes (by `pnpm db:generate`)
- Committed: Yes (migrations checked into git)
- How to use: `pnpm db:migrate` applies all pending migrations

**backend/dist/ and frontend/.next/:**
- Purpose: Build outputs
- Generated: Yes (by `pnpm build` or `pnpm dev`)
- Committed: No (.gitignored)

**packages/types/src/dtos/:**
- Purpose: Centralized Zod schema and type definitions
- Exports: Both Zod schema objects and inferred TypeScript types via `z.infer<>`
- Used by: Backend (validation) + Frontend (type safety)
- Pattern: Export both schema and type from same file
  ```typescript
  export const loginSchema = z.object({ email: z.string().email(), password: z.string() });
  export type LoginDto = z.infer<typeof loginSchema>;
  ```

**node_modules/.pnpm/ (pnpm monorepo):**
- Purpose: Dependency installation per workspace
- Generated: Yes (by `pnpm install`)
- Committed: No (.gitignored)
- How it works: Root pnpm-workspace.yaml declares workspaces; each package.json has local deps; shared at root

---

*Structure analysis: 2026-04-28*
