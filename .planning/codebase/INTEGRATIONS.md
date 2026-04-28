# External Integrations

**Analysis Date:** 2026-04-28

## APIs & External Services

**OpenFDA API:**
- Service: OpenFDA (FDA drug information lookup)
- SDK/Client: None (raw HTTP call expected)
- Auth: API key via `OPENFDAAPI_KEY` environment variable
- Purpose: Drug/medicine reference data validation (planned for Phase 3)
- Current status: Environment variable defined but not integrated in current codebase

## Data Storage

**Databases:**

**PostgreSQL 16:**
- Provider: Docker image `postgres:16`
- Connection: `postgresql://pharmerp:password@localhost:5432/pharmerp`
- Read replica: `DATABASE_URL_READ` (optional, for analytics scaling)
- Client: node-postgres (pg 8.11.3) via Drizzle ORM
- Connection pool: 20 max connections, 30s idle timeout, 2s connection timeout
- Schema: 8 domain tables (auth, inventory, billing, prescriptions, procurement, hr, distribution, plus enums)
- Migrations: Auto-generated via drizzle-kit to `backend/drizzle/migrations/`

**File Storage:**

**MinIO (S3-Compatible):**
- Provider: Self-hosted MinIO via Docker
- Endpoint: `http://localhost:9000` (development); S3 endpoint (production)
- Console: `http://localhost:9001`
- Bucket: `pharmerp-bucket`
- Region: `us-east-1`
- Access credentials: S3_ACCESS_KEY, S3_SECRET_KEY
- Use cases: Prescription image uploads, invoice PDFs, bulk CSV imports
- Client: AWS SDK v3 (not visible in package.json, likely transitive)
- Signed URLs: For secure temporary access to files

**Caching:**

**Redis 7 (Alpine):**
- Provider: Docker image `redis:7-alpine`
- Endpoint: `redis://localhost:6379`
- Client: ioredis 5.3.2
- Primary use: Job queue (Bull), session tokens, refresh token hashes
- Features: Auto-reconnect, connection pooling, INCR for sequential numbering
- No persistent RDB/AOF configured (development only)

**Search & Analytics:**

**Elasticsearch 8.13.0:**
- Provider: Docker image `elasticsearch:8.13.0`
- Endpoint: `http://localhost:9200`
- Security: xpack.security.enabled=false (development only)
- Memory limit: -Xms512m -Xmx512m
- Index: `medicines` (for product full-text search)
- Use: Fast product lookup by name/generic name in POS
- Status: Defined in docker-compose but not yet integrated in backend code (Phase 3)

**ClickHouse (Analytics):**
- Provider: Standalone service (not in docker-compose)
- Endpoint: `http://localhost:8123`
- Database: `pharmerp_analytics`
- Purpose: Time-series sales analytics and reporting queries
- Status: Environment variable prepared but not integrated (Phase 3)

## Authentication & Identity

**Auth Provider:**
- Type: Custom JWT-based
- Token type: RS256 (RSA public/private key pair)
- Key source: Environment variables (JWT_PRIVATE_KEY, JWT_PUBLIC_KEY in PEM format)
- Access token expiry: 15 minutes (inferred)
- Refresh token expiry: 7 days (inferred)
- Storage: Refresh token hash stored in PostgreSQL refresh_tokens table
- Password hashing: Argon2id (argon2 package)

**2FA/OTP:**
- Library: otplib 12.0.1
- Use case: Optional two-factor authentication
- Fields: two_fa_secret (varchar 64), two_fa_enabled (boolean) in users table

## Monitoring & Observability

**Logging:**
- Framework: Pino 9.0.0 (structured JSON logs)
- Adapter: Fastify logger (via NestJS platform-fastify)
- Level: Automatic in development, structured for production
- Log format: JSON (newline-delimited for log aggregation)
- No external logging service configured (Datadog, ELK, etc.)

**Error Tracking:**
- Type: Not detected
- Current approach: Global exception filter in `backend/src/common/filters/global-exception.filter.ts`
- Returns: Standard error response shape { success: false, error: { code, message, details? } }

**Metrics/APM:**
- Type: Not detected
- Planned: Docker-compose includes ClickHouse for analytics (Phase 3)

## CI/CD & Deployment

**Hosting:**
- Type: Self-hosted infrastructure expected
- Docker services: PostgreSQL, Redis, MinIO, Elasticsearch (docker-compose.yml provided)
- Expected deployment: Kubernetes or Docker Compose on dedicated server

**CI Pipeline:**
- Type: Not detected (no GitHub Actions, GitLab CI config visible)
- Build commands available:
  - `pnpm build` - Full monorepo build via Turbo
  - `pnpm typecheck` - Type checking
  - `pnpm lint` - ESLint
  - `pnpm test` - Vitest
  - Turbo caches build outputs (dist/**, .next/**, excluding .next/cache/**)

## Environment Configuration

**Required env vars:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Primary PostgreSQL | `postgresql://pharmerp:password@localhost:5432/pharmerp` |
| `DATABASE_URL_READ` | Read replica (optional) | `postgresql://pharmerp:password@localhost:5433/pharmerp` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `JWT_PRIVATE_KEY` | RSA private key (PEM) | Multi-line PEM content |
| `JWT_PUBLIC_KEY` | RSA public key (PEM) | Multi-line PEM content |
| `JWT_EXPIRES_IN` | Access token lifetime | `15m` |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifetime | `7d` |
| `S3_ENDPOINT` | MinIO/S3 endpoint | `http://localhost:9000` |
| `S3_BUCKET` | S3 bucket name | `pharmerp-bucket` |
| `S3_ACCESS_KEY` | S3 access key | `minioadmin` |
| `S3_SECRET_KEY` | S3 secret key | `minioadmin` |
| `S3_REGION` | AWS region | `us-east-1` |
| `ELASTICSEARCH_URL` | Elasticsearch endpoint | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX_MEDICINES` | Search index name | `medicines` |
| `CLICKHOUSE_URL` | ClickHouse endpoint | `http://localhost:8123` |
| `CLICKHOUSE_DB` | Analytics database | `pharmerp_analytics` |
| `OPENFDAAPI_KEY` | FDA API key | (empty, not yet used) |
| `NODE_ENV` | Environment | `development` or `production` |
| `PORT` | API server port | `3001` |
| `CORS_ORIGIN` | Frontend URL for CORS | `http://localhost:3000` |

**Secrets location:**
- `.env` file at project root (git-ignored)
- Never commit `.env` (only `.env.example` committed)
- Environment variables set by deployment system (Kubernetes secrets, docker-compose env file, etc.)

## API Documentation

**Swagger/OpenAPI:**
- Framework: `@nestjs/swagger` 7.3.0
- Setup: Automatic via NestFactory in `backend/src/main.ts`
- Endpoint: `/api/docs` (base path `/api/v1` set globally)
- Authentication: Bearer token support
- Generation: Automatic from NestJS decorators and nestjs-zod schemas

## Webhooks & Callbacks

**Incoming Webhooks:**
- Type: Not detected
- Planned: Insurance claim callbacks, payment gateway confirmations (Phase 4)

**Outgoing Webhooks:**
- Type: Not detected
- Currently: Bull jobs dispatch events (expiry scan, reorder alerts), no external webhook delivery

**Real-time Communication:**
- WebSocket: Socket.IO 4.7.5
- Setup: `@nestjs/websockets`, `@nestjs/platform-socket.io`
- Client: socket.io-client 4.7.5 in frontend
- Use: Real-time notifications (alerts, inventory updates) - not yet fully implemented

## Queue System

**Job Queue:**
- Provider: Bull 4.12.2 (backed by Redis)
- NestJS integration: `@nestjs/bull` 10.1.1
- Processors: Located in `backend/src/modules/*/jobs/*.processor.ts`
- Examples:
  - `ExpiryScanProcessor` - Nightly batch: marks expired stock, writes off inventory
  - `ReorderCheckProcessor` - 6-hourly: identifies low-stock products
- Jobs run via Redis-backed queue with retry logic

---

*Integration audit: 2026-04-28*
