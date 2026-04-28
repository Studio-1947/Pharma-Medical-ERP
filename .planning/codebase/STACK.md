# Technology Stack

**Analysis Date:** 2026-04-28

## Languages

**Primary:**
- TypeScript 5.4 - All backend, frontend, and package code with strict mode via `@pharmerp/config-typescript`

**Secondary:**
- JavaScript/JSON - Configuration files (next.config.ts, tailwind.config.ts, drizzle.config.ts)

## Runtime

**Environment:**
- Node.js 20 LTS (specified in package.json as packageManager constraint)
- Target: ES2020+ via TypeScript compilation

**Package Manager:**
- pnpm 9.0.0 (enforced at root level via packageManager field)
- Lockfile: pnpm-lock.yaml (not present in initial files, auto-generated)
- Monorepo: pnpm workspaces with Turborepo orchestration

## Frameworks

**Backend:**
- NestJS 10.3.0 - Modular backend framework with decorators
- Fastify 4.26.0 - HTTP adapter for NestJS (via `@nestjs/platform-fastify`)
- Drizzle ORM 0.30.0 - Type-safe SQL queries with migrations
- Drizzle Kit 0.20.0 - Schema generation and migration tools

**Frontend:**
- Next.js 15.0.0 - React framework with App Router (TypeScript enabled)
- React 18.3.0 - UI library
- React DOM 18.3.0 - DOM bindings

**Build/Dev:**
- Turbo 2.0.0 - Monorepo task orchestrator at root level
- TypeScript 5.4 - Language compiler across all packages
- ESLint 8.57.0 - Linting (frontend: eslint-config-next 15.0.0)
- Autoprefixer 10.4.19 - CSS vendor prefixing

## Key Dependencies

**Critical Backend:**
- `@nestjs/jwt` 10.2.0 - JWT token generation and verification
- `@nestjs/passport` 10.0.3 - Passport.js authentication integration
- `passport-jwt` 4.0.1 - JWT strategy for Passport
- `pg` 8.11.3 - PostgreSQL driver for node-postgres Pool
- `ioredis` 5.3.2 - Redis client for caching and queue operations
- `bull` 4.12.2 - Job queue library backed by Redis
- `@nestjs/bull` 10.1.1 - NestJS integration for Bull
- `argon2` 0.31.2 - Password hashing (via argon2id)
- `bwip-js` 3.5.0 - Barcode generation for stock/invoice codes
- `pdfkit` 0.15.0 - PDF generation for invoices
- `otplib` 12.0.1 - OTP/2FA secret management

**Validation & Schema:**
- `zod` 3.23.0 - Runtime schema validation (shared between backend and frontend)
- `nestjs-zod` 3.0.0 - Zod integration for NestJS route validation

**Shared Packages:**
- `@pharmerp/types` - Shared TypeScript types and Zod schemas (workspace:*)
- `@pharmerp/config-typescript` - Shared TypeScript config files (workspace:*)

**Frontend UI & State:**
- `@tanstack/react-query` 5.40.0 - Server state management with caching
- `@tanstack/react-table` 8.17.0 - Headless table component library
- `@tanstack/react-virtual` 3.5.0 - Virtual scrolling for large lists
- `zustand` 5.0.0-rc.2 - Lightweight client state management
- `axios` 1.7.0 - HTTP client with interceptors
- `recharts` 2.12.0 - React charting library for reports
- `dexie` 4.0.7 - IndexedDB wrapper for offline support
- `dexie-react-hooks` 1.1.7 - React hooks for Dexie IndexedDB

**Frontend Forms & Validation:**
- `react-hook-form` 7.52.0 - Form state management with performance
- `@hookform/resolvers` 3.6.0 - Zod resolver for react-hook-form

**Frontend UI Components:**
- `tailwindcss` 3.4.0 - Utility-first CSS framework
- `@radix-ui/react-*` - Unstyled, accessible component primitives:
  - `@radix-ui/react-dialog` 1.1.1 - Modal/Dialog
  - `@radix-ui/react-dropdown-menu` 2.1.1 - Dropdown menus
  - `@radix-ui/react-select` 2.1.1 - Select dropdowns
  - `@radix-ui/react-tabs` 1.1.0 - Tab navigation
  - `@radix-ui/react-toast` 1.2.1 - Toast notifications
  - `@radix-ui/react-avatar` 1.1.0 - User avatars
  - `@radix-ui/react-badge` 1.0.0+ - Badge components
- `lucide-react` 0.395.0 - Icon library
- `clsx` 2.1.1 - Conditional classname utility
- `tailwind-merge` 2.3.0 - Merge Tailwind classes intelligently

**Real-time Communication:**
- `socket.io-client` 4.7.5 - WebSocket client for real-time features
- `@nestjs/websockets` 10.3.0 - NestJS WebSocket adapter
- `@nestjs/platform-socket.io` 10.3.0 - Socket.IO adapter for NestJS

**Utilities:**
- `date-fns` 3.6.0 - Date manipulation and formatting
- `pino` 9.0.0 - Structured logging (backend)
- `reflect-metadata` 0.2.1 - Metadata reflection for decorators
- `rxjs` 7.8.1 - Reactive extensions (NestJS dependency)

**API Documentation:**
- `@nestjs/swagger` 7.3.0 - Swagger/OpenAPI documentation generation
- `nestjs-zod` 3.0.0 - Zod schema integration with Swagger

## Configuration

**Environment:**
- Centralized in `.env` file at project root (copied per workspace if needed)
- NestJS ConfigModule (forRoot with envFilePath: ".env") at `backend/src/app.module.ts`
- Config service injected via `@nestjs/config` with typed getOrThrow

**Build:**
- `backend/drizzle.config.ts` - Drizzle ORM configuration
  - Schema path: `./src/database/schema/index.ts`
  - Output: `./drizzle/migrations`
  - Dialect: PostgreSQL
  - Strict mode: enabled
  - Verbose logging: enabled
- `frontend/next.config.ts` - Next.js configuration
  - transpilePackages: ["@pharmerp/types"]
  - experimental.typedRoutes: true
- `frontend/tailwind.config.ts` - Tailwind configuration
  - darkMode: "class"
  - Custom brand color palette (50-900)
  - Content paths: ./app/**, ./components/**, ./hooks/**
- `backend/tsconfig.json` - Base TypeScript config (via @pharmerp/config-typescript/nestjs.json)
- `frontend/tsconfig.json` - Base TypeScript config (via @pharmerp/config-typescript/nextjs.json)
- `turbo.json` - Task pipeline orchestration
  - Build depends on ^build (dependencies first)
  - Dev is persistent (long-running)
  - Test outputs coverage/

## Platform Requirements

**Development:**
- Node.js 20 LTS minimum
- pnpm 9.0.0+ (enforced)
- PostgreSQL 16 (docker-compose provides this)
- Redis 7 (docker-compose provides this)
- MinIO or S3-compatible storage (docker-compose provides MinIO)
- Elasticsearch 8.13.0 (docker-compose provides this)

**Production:**
- Node.js 20 LTS runtime
- PostgreSQL 16 database server
- Redis 7 for caching and queue processing
- S3-compatible object storage (MinIO, AWS S3, etc.)
- Elasticsearch 8+ for full-text search
- Reverse proxy for CORS and SSL (nginx/caddy recommended)

## Database

**Primary:**
- PostgreSQL 16 (via `postgres:16` Docker image)
- Connection: `postgresql://pharmerp:password@localhost:5432/pharmerp`
- Connection pooling: node-postgres Pool with max 20, idle timeout 30s, connection timeout 2s
- Read replica: `DATABASE_URL_READ` environment variable (optional for scaling)

**ORM:**
- Drizzle ORM with PostgreSQL dialect
- Type-safe schema definitions in `backend/src/database/schema/`
- Migrations auto-generated to `backend/drizzle/migrations/`
- Soft deletes via deleted_at field (not implemented yet, inferred from CLAUDE.md)
- Audit fields: createdAt, updatedAt, userId tracking

## Caching & Queues

**Cache:**
- Redis 7 via `redis:7-alpine` Docker image
- Connection: `redis://localhost:6379`
- Client: ioredis (connection pooling, auto-reconnect)
- Session tokens, refresh token hashes, product/barcode cache

**Job Queue:**
- Bull 4.12.2 backed by Redis
- NestJS Bull module for processor registration
- Processors in `backend/src/modules/*/jobs/*.processor.ts`
- Queue examples: expiry-scan, reorder-check (from visible code)

## File Storage

**Object Storage:**
- MinIO 7 (S3-compatible, docker-compose provided)
- S3 endpoint: `http://localhost:9000` (local) or AWS S3 (production)
- S3 bucket: `pharmerp-bucket`
- S3 region: `us-east-1`
- Access via S3_ACCESS_KEY, S3_SECRET_KEY environment variables
- Use cases: prescription images, invoice PDFs, bulk uploads

## Search & Analytics

**Full-text Search:**
- Elasticsearch 8.13.0 (docker-compose provides this)
- URL: `http://localhost:9200`
- Security: xpack.security.enabled=false (development only)
- Index: `medicines` for product search
- Use: Fast product lookup by name/barcode in POS

**Analytics Database:**
- ClickHouse (docker-compose not included, env var provided)
- URL: `http://localhost:8123`
- Database: `pharmerp_analytics`
- Use: Time-series sales data, reporting queries
- Note: Not integrated in current codebase, prepared for Phase 3

## Authentication & Authorization

**JWT Strategy:**
- Algorithm: RS256 (RSA public/private key pair)
- Tokens: ACCESS_TOKEN (15m), REFRESH_TOKEN (7d) - inferred from CLAUDE.md
- Storage: Access token in memory or httpOnly cookie, refresh in secure storage
- Key format: PEM-encoded RSA keys in environment variables (JWT_PRIVATE_KEY, JWT_PUBLIC_KEY)
- Implementation: `@nestjs/passport` with `passport-jwt` strategy

**Password Hashing:**
- Algorithm: Argon2id (via argon2 package)
- Config: timeCost=2, memoryCost=65536, parallelism=1
- Never stored in plaintext; always hashed

**2FA/MFA:**
- OTP support via otplib 12.0.1
- Field: two_fa_secret (varchar 64) in users table
- Status flag: two_fa_enabled boolean

## Logging

**Backend:**
- Pino 9.0.0 - Structured JSON logging
- Fastify logger adapter (enabled in development via NestFactory)
- No explicit separate log aggregation configured

---

*Stack analysis: 2026-04-28*
