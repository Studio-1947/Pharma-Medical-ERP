# Coding Conventions

**Analysis Date:** 2026-04-29

## Naming Patterns

**Files:**
- PascalCase for module names: `auth.service.ts`, `auth.controller.ts`, `auth.repository.ts`
- kebab-case for file names: `global-exception.filter.ts`, `jwt-auth.guard.ts`, `current-user.decorator.ts`
- Schema files use domain-based naming: `auth.ts`, `inventory.ts`, `billing.ts`, `prescriptions.ts`
- DTO/schema files use suffix pattern: `auth.dto.ts`, `billing.dto.ts`
- Service/controller/repository triplet per module: `{module}.service.ts`, `{module}.controller.ts`, `{module}.repository.ts`

**Functions:**
- camelCase for all functions and methods
- Private methods/fields prefixed with `private`
- Convention: service methods call repository methods, repositories directly access database
- Private helper methods use underscore or are marked private in classes
- Example: `findUserByEmail()`, `createUser()`, `updateLastLogin()`, `calculateLineTax()`

**Variables:**
- camelCase for local variables and parameters
- Boolean variables prefixed with `is`, `can`, or `has`: `isActive`, `isOfflineSync`, `hasPrefix`
- Numeric counters use `count` suffix: `invoiceCount`, `count`
- Constants use UPPER_SNAKE_CASE: `JWT_PRIVATE_KEY`, `REDIS_URL`, `CORS_ORIGIN`
- Configuration objects use singular or plural appropriately: `config`, `metadata`, `options`

**Types:**
- PascalCase for type/interface names
- DTOs use Zod schema naming: `loginSchema`, `registerSchema`, `createInvoiceDto`
- Type inference from Zod: `z.infer<typeof loginSchema>` → `LoginDto`
- Enum naming uses PascalCase with value descriptions: `UserRole.SUPER_ADMIN`, `InvoiceStatus.DRAFT`
- Payload types end with `Payload`: `JwtPayload`
- Database types use `$inferInsert` and `$inferSelect` from Drizzle

## Code Style

**Formatting:**
- Uses TypeScript strict mode (`"strict": true` in tsconfig)
- Target: ES2022 for base config, ES2021 for NestJS
- Module resolution: NodeNext for base, Node for NestJS
- No explicit formatting tool configured (ESLint only for linting)

**Linting:**
- ESLint configured via `npm run lint`
- Command: `eslint "{src,apps,libs,test}/**/*.ts"`
- Applied to backend with strict TypeScript rules
- Import sorting and code quality checks expected

**Type Safety:**
- `noUncheckedIndexedAccess: true` — prevents unsafe index access
- `noImplicitOverride: true` — must explicitly mark overridden methods
- `exactOptionalPropertyTypes: false` — allows `undefined` for optional properties
- All public methods must have explicit return types
- No implicit `any` types allowed

## Import Organization

**Order:**
1. Node.js built-in modules: `import { createHash } from "crypto"`
2. Third-party packages: `import { Injectable } from "@nestjs/common"`
3. Workspace packages: `import type { LoginDto } from "@pharmerp/types"`
4. Local imports: `import { AuthRepository } from "./auth.repository"`
5. Type imports: `import type { JwtPayload } from "..."` (separate)

**Path Aliases:**
- Backend: `@/*` maps to `src/*` (tsconfig `baseUrl: "./src"`)
- Workspace packages accessed via `@pharmerp/types`, `@pharmerp/config-typescript`
- Absolute imports preferred over relative (`../../../`) paths

## Error Handling

**Patterns:**
- Use NestJS exceptions for HTTP errors: `ConflictException`, `UnauthorizedException`, `NotFoundException`, `UnprocessableEntityException`, `ForbiddenException`
- All exceptions are caught by global `GlobalExceptionFilter` at `backend/src/common/filters/global-exception.filter.ts`
- Zod validation errors automatically transformed to 400 Bad Request with field-level errors
- Database constraint errors (PostgreSQL codes) mapped to specific HTTP responses:
  - `23505` (unique constraint) → 409 Conflict
  - `23503` (foreign key) → 422 Unprocessable Entity
- Always provide descriptive error message: `throw new NotFoundException("Invoice ${id} not found")`
- Do not throw raw errors — always use NestJS exception classes
- Transaction errors bubble up through service layer and are caught by global filter

**Error Response Shape:**
```typescript
{
  success: false,
  message: "Human-readable error message",
  errors: { fieldName: ["error description"] },  // From Zod validation
  path: "/api/v1/auth/login",
  timestamp: "2026-04-29T..."
}
```

## Logging

**Framework:** No dedicated logging framework configured currently
- Use NestJS `Logger` class from `@nestjs/common` where needed
- Example: `private readonly logger = new Logger(GlobalExceptionFilter.name);`
- Error logging on exceptions: `this.logger.error(exception.message, exception.stack)`

**Patterns:**
- Exceptions logged with full stack trace in catch blocks
- Success paths typically do not log (rely on audit interceptor)
- Database query logs should be handled by Drizzle ORM (development mode)

## Comments

**When to Comment:**
- JSDoc on public service methods that have complex business logic
- Comment private helpers that implement cryptographic or specialized algorithms
- Link to specification or requirements for non-obvious logic
- Do not comment obvious code

**JSDoc/TSDoc:**
- Used sparingly, mainly on service methods
- Example: `/** Creates an invoice atomically: 1. Calculate line totals... */`
- Parameter and return type documentation if logic is complex
- Constructor injection documented via type hints (preferred over JSDoc)

## Function Design

**Size:** 
- Services methods 50-100 lines (including transaction logic)
- Repository methods 20-50 lines (single responsibility per query)
- Controllers 10-20 lines (validate input, delegate to service, handle response)
- Keep transaction blocks focused — separate concerns

**Parameters:**
- Use object destructuring for multiple parameters: `async login(dto: LoginDto, meta: { ip?: string; userAgent?: string })`
- DTOs preferred over individual parameters: `create(dto: CreateInvoiceDto, staffId: string)`
- Optional metadata passed as second object argument: `login(dto, { ip, userAgent })`
- Default values for optional config parameters: `expiresIn = config.get("...") ?? "7d"`

**Return Values:**
- Services return wrapped objects: `{ data: invoice, message?: string, meta?: PaginationMeta }`
- Repositories return raw domain objects or arrays
- Controllers delegate response formatting to `TransformInterceptor`
- Async functions use `async/await`, not `.then()` chains
- Transaction results returned as single object with `{ invoice, items }`

## Module Design

**Exports:**
- Each module exports controller, service, and repository as providers
- Auth module exports `AuthService` for use in other modules
- Controllers not exported (routing only)
- Repositories exported from modules for dependency injection
- Type-only exports for shared types across modules: `import type { LoginDto }`

**Barrel Files:**
- `packages/types/src/index.ts` re-exports all DTOs and enums
- Database schema exported from `backend/src/database/schema/index.ts`
- Controllers, services, repositories NOT barrel-exported (explicit imports preferred)
- Backend modules use explicit imports to avoid circular dependencies

**Module Dependency Injection:**
- Constructor injection via `constructor(private readonly service: Service)`
- All dependencies declared in `providers: []` and `imports: []`
- Services injected into controllers, repositories injected into services
- Repositories never depend on services (data access only)

## Database Patterns

**Drizzle ORM Usage:**
- Schema defined with `pgTable()` from `drizzle-orm/pg-core`
- Types inferred: `typeof schema.users.$inferInsert`, `$inferSelect`
- Relations defined separately in `relations.ts` with `relations()` helper
- Transactions via `drizzle.db.transaction((tx) => {...})`
- Queries use both `db.query.table.findFirst()` (simple) and `db.select().from()` (complex)

**Query Patterns:**
- Use `sql` template for raw SQL when Drizzle DSL is insufficient
- Example: `sql`COUNT(*)::int`` for aggregates
- Conditions built with `eq()`, `and()`, `or()`, `gte()`, `lte()`, `isNull()`, `gt()`, `lt()`
- Join tables via `.with()` on query: `.with({ items: { with: { medicine: true } }, patient: true })`
- Pagination: `limit(params.limit).offset((params.page - 1) * params.limit)`

**Convention:**
- All tables include: `id (uuid PK)`, `createdAt`, `updatedAt` (both timestamp with tz)
- Soft deletes: `deletedAt` (nullable timestamp) — not used yet but schema ready
- Foreign keys use `.references()` with `onDelete` cascade/set null behavior
- Enums stored as PostgreSQL enums via `pgEnum()`, then `userRoleEnum("role")`

## API Response Standardization

**Success Response:**
- Wrapped by `TransformInterceptor` at `backend/src/common/interceptors/transform.interceptor.ts`
- Shape: `{ success: true, data: T, message?: string, meta?: { page, limit, total, totalPages } }`
- All list endpoints include pagination metadata
- Single resource responses include just `data` field

**Error Response:**
- Shape: `{ success: false, message: string, errors?: Record<string, string[]>, path, timestamp }`
- Handled by `GlobalExceptionFilter`
- All error routes use HTTP status codes with semantic meaning (400, 401, 403, 404, 409, 422, 500)

## Testing Conventions (See TESTING.md for frameworks)

**Naming:**
- Test files co-located or in `test/` directory with `.test.ts` or `.spec.ts` suffix
- Describe blocks match class/function name being tested
- Test names describe behavior not implementation

**Organization:**
- Arrange-Act-Assert pattern
- One main assertion per test (or grouped related assertions)
- Mock dependencies injected via constructor
- Use factories for test data

