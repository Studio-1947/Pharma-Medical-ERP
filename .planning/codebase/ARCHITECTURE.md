# Architecture

**Analysis Date:** 2026-04-28

## Pattern Overview

**Overall:** Modular NestJS + Next.js monorepo using feature-based modules with clear separation of concerns. Backend follows layered architecture (controller → service → repository → database) with shared types across workspace. Frontend uses client-side state management (Zustand) + server-side data fetching (React Query).

**Key Characteristics:**
- Feature-based module organization (auth, billing, inventory, patients, prescriptions, procurement, hr, distribution)
- Three-tier service layer: controller (routing/validation) → service (business logic) → repository (data access)
- Shared type definitions in workspace package (`@pharmerp/types`)
- Database-agnostic abstraction via Drizzle ORM with PostgreSQL
- Transactional operations for critical business flows (billing, stock adjustments)
- RBAC (Role-Based Access Control) via decorators and guards
- Event-driven asynchronous processing via BullMQ/Redis

## Layers

**Controller Layer:**
- Purpose: HTTP request routing, input validation via Zod schemas, role/auth enforcement
- Location: `backend/src/modules/{domain}/{domain}.controller.ts` (e.g., `backend/src/modules/billing/billing.controller.ts`)
- Contains: HTTP method handlers (@Get, @Post, @Put, @Delete), Swagger decorators, Zod parse/validation
- Depends on: Service layer, guards (JwtAuthGuard, RolesGuard), decorators (CurrentUser, Roles, Public)
- Used by: Fastify router (auto-wired via NestJS module system)

**Service Layer:**
- Purpose: Core business logic, orchestration of repositories, transaction coordination, validation
- Location: `backend/src/modules/{domain}/{domain}.service.ts`
- Contains: Domain-specific services (AuthService, BillingService, InventoryService, etc.)
- Methods follow pattern: data validation → repository calls → business logic → return DTO
- Critical patterns:
  - `create()` methods wrap in Drizzle transactions for atomic operations
  - `billing.service.ts#create()` calculates line totals with tax, decrements stock, logs movements in single transaction
  - `inventory.service.ts#getBatchesForDispense()` returns FEFO-ordered batches for sales
- Depends on: Repository layer, external services (TaxService, BarcodeService), Drizzle
- Used by: Controllers, other services

**Repository Layer:**
- Purpose: Data access abstraction, query building, result mapping
- Location: `backend/src/modules/{domain}/{domain}.repository.ts`
- Contains: Typed queries using Drizzle ORM, pagination helpers, result transformation
- Patterns:
  - `findPaginated()` returns `{ data: T[], meta: { page, limit, total, totalPages } }`
  - Soft deletes via `where(isNull(deletedAt))`
  - Methods accept optional Drizzle transaction parameter for nested transactions
- Depends on: Drizzle service, database schema
- Used by: Service layer

**Database Layer:**
- Purpose: ORM configuration, connection pooling, schema definitions, migrations
- Location: `backend/src/database/`
  - `drizzle.service.ts` — PostgreSQL connection pool (max 20 connections), Drizzle instance
  - `schema/` — Drizzle table definitions (8 domain files: auth.ts, billing.ts, inventory.ts, etc.)
- Drizzle manages:
  - Schema inference for type safety
  - Automatic timestamp columns (createdAt, updatedAt)
  - Soft delete support (deletedAt column)
  - Enum types (userRoleEnum, invoiceStatusEnum, etc.)
  - Indexes on frequently queried columns
- Depends on: PostgreSQL via node-postgres
- Used by: Repository layer

**Guard/Middleware Layer:**
- Purpose: Authentication and authorization enforcement
- Location: `backend/src/common/guards/` and `backend/src/common/decorators/`
- Key files:
  - `jwt-auth.guard.ts` — Validates JWT tokens, respects @Public() decorator for public routes
  - `roles.guard.ts` — Enforces role-based access, super_admin bypasses all checks
  - `current-user.decorator.ts` — Extracts and types JwtPayload from request
  - `roles.decorator.ts` — Marks routes with required roles
- Integration: Guards applied at module level in AppModule
- Used by: All protected routes

**Global Middleware:**
- Purpose: Cross-cutting concerns (error handling, response transformation, audit logging)
- Location: `backend/src/common/`
  - `filters/global-exception.filter.ts` — Catches exceptions, formats error responses
  - `interceptors/transform.interceptor.ts` — Wraps all responses in `{ success, data, meta }`
  - `interceptors/audit.interceptor.ts` — Logs actions for compliance
- Response envelope:
  - Success: `{ success: true, data: T, message?: string, meta?: { page, limit, total } }`
  - Error: `{ success: false, message: string, errors?: object, path: string, timestamp: ISO }`

## Data Flow

**Authentication Flow:**
1. POST /api/v1/auth/login (email, password)
2. AuthController validates with loginSchema (Zod), calls AuthService.login()
3. AuthService hashes password with argon2, verifies against DB, generates JWT pair
4. Returns `{ accessToken: JWT(15m), refreshToken: JWT(7d), user: UserDTO }`
5. Client stores tokens in localStorage, attaches accessToken to Authorization header
6. JwtAuthGuard verifies token signature on protected routes
7. CurrentUser decorator extracts and types payload as JwtPayload { sub (userId), email, role, branchId }

**Billing (Core POS) Flow:**
1. POST /api/v1/billing/invoices (items[], patientId?, branchId, discountAmount)
2. BillingController validates with createInvoiceSchema, calls BillingService.create()
3. BillingService.create() inside Drizzle transaction:
   - Calculate line totals (unitPrice × qty) with tax using TaxService
   - For each item: BatchRepository.adjustQuantity(batchId, -qty) — decrements stock atomically
   - Log stock movement: StockMovementRepository.log() with movementType='sale'
   - Insert salesInvoices and invoiceLineItems records
   - Return complete invoice with calculated totals
4. BillingRepository.nextInvoiceNumber() generates sequential number (format: YYYY-MM-001 per branch)
5. All stock decrements are logged in stock_movements append-only ledger

**Inventory (Stock Management) Flow:**
1. GET /api/v1/inventory/medicines (filters: categoryId, branchId, status, search, page, limit)
2. InventoryController calls InventoryService.findAll()
3. InventoryService.findAll() calls InventoryRepository.findMedicinesPaginated()
4. Repository queries medicines table with joins to categories, filters by deletedAt IS NULL
5. Returns paginated results with meta (page, limit, total, totalPages)
6. GET /api/v1/inventory/medicines/{id}/batches returns FEFO-ordered batches for that medicine
   - Ordered by expiryDate ASC (First Expiry First)
   - Filters by batchStatus != 'expired' and quantity > 0

**State Management (Frontend) Flow:**
1. User logs in → apiClient POST /auth/login → response has accessToken, refreshToken
2. LoginForm dispatches useAuthStore.setTokens(access, refresh)
3. Zustand persist middleware saves to localStorage key 'pharmerp-auth'
4. On page load, auth provider reads localStorage, calls /auth/refresh to get fresh accessToken
5. All subsequent requests include `Authorization: Bearer {accessToken}`
6. If 401 response: apiClient interceptor auto-calls /auth/refresh, retries original request
7. On refresh error: clear localStorage, redirect to /login

**POS Terminal Flow:**
1. POS page mounts, initializes empty cart via useCartStore
2. User scans barcode (or searches product name)
3. ProductSearch calls GET /api/v1/inventory/medicines/barcode/{code} or search endpoint
4. Select batch → useCartStore.addItem() calculates lineTotal locally
5. On checkout: gather cart items → POST /api/v1/billing/invoices
6. Backend transactionally creates invoice + decrements stock in single DB transaction
7. Response includes invoiceNo — displayed for print/share

## Key Abstractions

**Module Pattern:**
- Purpose: Self-contained domain feature with clear boundaries
- Example: `AuthModule` imports JwtModule, ConfigModule, provides AuthService, AuthController
- Exports: Controllers (auto-wired), Services (available for injection)
- Each module has own repository, service, controller, DTOs (imported from @pharmerp/types)

**Repository Pattern:**
- Purpose: Data access abstraction, testable queries, transaction support
- Methods accept optional Drizzle transaction (tx) parameter for nested transactions
- Query building via Drizzle (type-safe, composable)
- Result mapping: database records → DTOs (InventoryBatch → BatchDto)

**Service Pattern:**
- Purpose: Business logic orchestration, validation, error handling
- Depends on: Repositories (injected), external services (TaxService, BarcodeService)
- Methods wrap multi-step operations in Drizzle transactions for consistency

**Guard/Decorator Pattern:**
- JwtAuthGuard + RolesGuard enforce auth + RBAC at route level
- @Public() decorator exempts routes from JWT requirement
- @Roles(...) decorator declares required roles on handler
- CurrentUser decorator extracts typed user object from request

**DTOs (Data Transfer Objects):**
- Location: `packages/types/src/dtos/`
- Defined as Zod schemas with TypeScript inference via z.infer<>
- Shared between frontend and backend for type safety
- Used for: request validation (controller), response transformation (service), API contract

**Transactions:**
- Drizzle.db.transaction(async (tx) => { ... }) for ACID operations
- Passed to repositories as optional parameter for nested access
- Critical for: billing (stock + invoice consistency), stock adjustments, purchase order GRN

## Entry Points

**Backend:**
- Location: `backend/src/main.ts`
- Triggers: `npm run dev` (NestFactory.create() with FastifyAdapter)
- Responsibilities:
  - Create FastifyAdapter for HTTP server
  - Register global filters (GlobalExceptionFilter), interceptors (TransformInterceptor, AuditInterceptor)
  - Enable Swagger documentation at /api/docs
  - Set global prefix /api/v1
  - Listen on port 3001

**Frontend:**
- Location: `frontend/app/layout.tsx` (root) → `frontend/app/providers.tsx` (context setup)
- Triggers: `npm run dev` (Next.js dev server)
- Responsibilities:
  - Initialize React Query (staleTime: 5min, gcTime: 10min)
  - Wrap app in QueryClientProvider
  - Load root fonts, metadata, globals.css

**Module Initialization:**
- AppModule (`backend/src/app.module.ts`) imports all feature modules
- Feature modules (AuthModule, BillingModule, etc.) register controllers, provide services
- DrizzleModule provides db instance to all services

## Error Handling

**Strategy:** Centralized exception handling via GlobalExceptionFilter

**Patterns:**
- HttpException (status, message) → caught by filter, sent to client with same status
- ZodError (validation) → caught, reformatted as `{ errors: { field: [messages] } }`, 400 status
- PostgreSQL constraint errors:
  - Code 23505 (unique violation) → 409 Conflict, "Resource already exists"
  - Code 23503 (FK violation) → 422 Unprocessable Entity, "Referenced resource does not exist"
- Unhandled errors → 500 Internal Server Error, logged to console

**Response format:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": { "email": ["Email already registered"] },
  "path": "/api/v1/auth/register",
  "timestamp": "2026-04-28T10:30:00Z"
}
```

## Cross-Cutting Concerns

**Logging:** Pino (structured JSON logging, configured in TransformInterceptor for request/response logging)

**Validation:** Zod schemas at DTO level (backend controllers parse incoming data), re-used from @pharmerp/types

**Authentication:** JWT (HS256, accessed via JwtService from NestJS)
- Access tokens: 15m expiry (short-lived, verified on every protected request)
- Refresh tokens: 7d expiry (stored in DB as hashed values, rotated on refresh)

**Authorization:** Role-based guards (super_admin, admin, pharmacist, cashier, inventory_manager, distribution_staff, hr_manager, reports_analyst)

**Auditing:** AuditInterceptor logs all actions (userId, action, resource, path, timestamp) on successful requests

**Transactions:** Drizzle transaction() for ACID guarantees on:
- Invoice creation (consistency between invoices, items, stock movements)
- Stock adjustments (batch quantity + movement ledger)
- Purchase order GRN (items received + batches created + stock movements)

---

*Architecture analysis: 2026-04-28*
