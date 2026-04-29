# Phase 1: Schema and Infrastructure Fixes - Research

**Researched:** 2026-04-29
**Domain:** Drizzle ORM schema migrations, Redis INCR atomicity, decimal.js precision, NestJS seed scripting
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHEMA-01 | Add `cgstAmt`, `sgstAmt`, `igstAmt` columns to `salesInvoiceItems` | Confirmed missing from schema and migration; addColumn migration pattern documented below |
| SCHEMA-02 | Add `reservedQty` column to `inventoryBatches` | Confirmed missing; integer default 0 pattern matches existing `quantity` column |
| SCHEMA-03 | Add `customerGstin` column to `salesInvoices` | Confirmed missing; varchar(15) pattern matches existing `gstNo` on suppliers table |
| SCHEMA-04 | Replace SELECT COUNT+1 invoice numbering with Redis INCR | Race condition confirmed in `billing.repository.ts:nextInvoiceNumber`; ioredis already installed |
| SEED-01 | Seed script: 1 super admin, 2 branches, 5 categories, 20 products, 2 suppliers, 3 staff | No seed script exists; argon2 (not bcryptjs) is the password hasher in this project |
</phase_requirements>

---

## Summary

This phase fixes five concrete gaps before any billing compliance work can begin. Three are schema gaps (missing GST columns, missing stock reservation column, missing B2B GSTIN column) confirmed by direct inspection of both the Drizzle schema TypeScript files and the existing `0000_fat_ulik.sql` migration. The fourth is a race condition in invoice numbering: `billing.repository.ts:nextInvoiceNumber` uses `SELECT COUNT(*) + 1` scoped to today, which produces duplicate numbers under concurrent load. The fifth is the absence of a seed script for manual testing.

The project uses **NestJS 10 + Fastify adapter**, **Drizzle ORM 0.33** with `drizzle-kit 0.22`, and a single existing migration (`0000_fat_ulik`). The migration output path is `./drizzle/migrations` (relative to `backend/`). The root `package.json` exposes `pnpm db:generate` and `pnpm db:migrate` that delegate to `pnpm --filter backend drizzle-kit generate/migrate`. There is no `db:seed` script anywhere yet.

**decimal.js is not in `backend/package.json`** — it must be added. The current `TaxService.calculateLineTax` uses plain JavaScript arithmetic (`*`, `/`) which produces floating-point drift on values like 247.50 * 12 / 100 = 29.700000000000003. The fix is to install `decimal.js` and rewrite the arithmetic using `Decimal` instances. Redis (`ioredis`) is already installed as a runtime dependency and BullMQ is registered in `AppModule`, but there is no injectable Redis client singleton outside the Bull queue — one must be created to support `INCR` for invoice sequencing.

**Primary recommendation:** Add the three schema columns via a single new Drizzle migration, install and wire decimal.js into TaxService, inject an ioredis client into BillingRepository for atomic INCR, and write a standalone seed TypeScript script runnable with `tsx`.

---

## Current Codebase State (Verified by Direct Read)

### Schema Files Location
`backend/src/database/schema/` — one file per domain, all re-exported from `index.ts`

### Confirmed Missing Columns

**`salesInvoiceItems` table** (`billing.ts`, line 100-118):
Present: `id`, `invoiceId`, `medicineId`, `batchId`, `quantity`, `unitPrice`, `discountPct`, `taxPct`, `lineTotal`
Missing: `cgstAmt`, `sgstAmt`, `igstAmt` — confirmed absent in both TypeScript schema and `0000_fat_ulik.sql`

**`inventoryBatches` table** (`inventory.ts`, line 99-131):
Present: `id`, `medicineId`, `locationId`, `batchNo`, `expiryDate`, `quantity`, `costPrice`, `mrpAtEntry`, `status`, `poId`, `grnId`, `createdAt`, `updatedAt`
Missing: `reservedQty` — confirmed absent in both TypeScript schema and `0000_fat_ulik.sql`

**`salesInvoices` table** (`billing.ts`, line 54-98):
Present: `id`, `invoiceNo`, `patientId`, `staffId`, `branchId`, `prescriptionId`, `subtotal`, `discountAmount`, `taxAmount`, `totalAmount`, `amountPaid`, `amountDue`, `paymentMode`, `status`, `notes`, `isOfflineSync`, `createdAt`, `updatedAt`
Missing: `customerGstin` — confirmed absent; needed for B2B GST invoices (GSTR-1 requirement)

**`branches` table** (`distribution.ts`, line 15-30):
Present: `id`, `name`, `code`, `address`, `phone`, `email`, `isHeadOffice`, `isActive`, `createdAt`, `updatedAt`
Missing: `state`, `gstin`, `drugLicenseNo` — these are needed for Phase 2 (inter-state GST determination from `branch.state`). **Not in Phase 1 scope per SCHEMA-01/02/03**, but the planner should be aware they will be added in Phase 2.

### Invoice Numbering Race Condition (Confirmed)
File: `backend/src/modules/billing/billing.repository.ts`, function `nextInvoiceNumber` (lines 12-21)

```typescript
// CURRENT — RACE CONDITION
const result = await this.db
  .select({ count: sql<number>`count(*)::int` })
  .from(schema.salesInvoices)
  .where(and(eq(schema.salesInvoices.branchId, branchId), sql`DATE(created_at) = CURRENT_DATE`));
const count = result[0]?.count ?? 0;
const seq = String(count + 1).padStart(4, "0");
return `${branchCode.toUpperCase()}-${today.replace(/-/g, "")}-${seq}`;
```

Two concurrent requests both read count=5, both generate seq=6, unique constraint on `invoice_no` causes one to fail with a DB error rather than a clean 409. The fix is Redis `INCR` on a per-branch-per-day key.

### TaxService Arithmetic (Confirmed Floating-Point Risk)
File: `backend/src/modules/billing/tax.service.ts`, line 27

```typescript
// CURRENT — plain JS arithmetic
const totalTax = (taxableAmount * taxPct) / 100;
// ...
breakdown: { taxableAmount, cgst: totalTax / 2, sgst: totalTax / 2, igst: 0, totalTax }
```

`247.50 * 12 / 100` in JavaScript = `29.700000000000003` (verified by IEEE 754 arithmetic).
`29.700000000000003 / 2` = `14.850000000000001` not `14.85`.
The `TaxBreakdown` interface is already defined but `cgst` and `sgst` are not persisted to DB (no columns exist yet — that's SCHEMA-01).

### decimal.js — Not Installed
Confirmed absent from `backend/package.json` dependencies. Must be added.

### Redis Client — Not Injectable Outside BullMQ
`app.module.ts` registers BullMQ with Redis config via `BullModule.forRootAsync`, but there is no standalone `ioredis` client registered as a NestJS provider for injection. `ioredis` is in `dependencies` (version ^5.3.2) so the package is installed. A `RedisModule` or `REDIS_CLIENT` provider token must be created.

### Seed Script — Does Not Exist
No seed file found anywhere in `backend/src/` or root. The `package.json` scripts have no `db:seed` entry. Password hashing uses `argon2` (not bcryptjs) per `backend/package.json`.

### Migration Infrastructure
- `drizzle.config.ts` in `backend/`: `schema: "./src/database/schema/index.ts"`, `out: "./drizzle/migrations"`, dialect `postgresql`
- One existing migration: `backend/drizzle/migrations/0000_fat_ulik.sql` (739 lines, 28 tables)
- `drizzle-kit 0.22.0` in devDependencies
- Run via: `pnpm db:generate` / `pnpm db:migrate` from root (delegates with `--filter backend`)

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.33.0 | ORM + query builder | Already in project |
| drizzle-kit | ^0.22.0 | Migration generation | Already in project |
| ioredis | ^5.3.2 | Redis client for INCR | Already installed, used by BullMQ |
| decimal.js | ^10.x | Arbitrary-precision decimal arithmetic | Industry standard for financial calculations; no native alternative |
| argon2 | ^0.31.2 | Password hashing for seed admin user | Already in project (not bcryptjs) |
| tsx | N/A | Run TypeScript seed scripts directly | Already available via NestJS CLI ecosystem |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/common | ^10.3.0 | NestJS DI for injectable Redis provider | Creating `RedisModule` with `REDIS_CLIENT` token |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| decimal.js | big.js, bignumber.js | decimal.js is the most widely used for financial work; all three are comparable; decimal.js preferred because it handles both integers and decimals cleanly |
| Redis INCR | PostgreSQL sequence per branch | Sequences require DDL per branch (unscalable); Redis INCR is simpler and the infrastructure already exists |
| Drizzle addColumn migration | Raw SQL `ALTER TABLE` | Drizzle-generated migrations are safer (tracked in journal, type-safe); always prefer `drizzle-kit generate` |

**Installation:**
```bash
pnpm --filter backend add decimal.js
```

---

## Architecture Patterns

### Drizzle Migration Pattern (Additive Columns)
The existing codebase uses `drizzle-kit generate` to diff schema TypeScript vs existing migrations and emit a new numbered SQL file. The correct workflow for adding columns is:

1. Edit the TypeScript schema file (e.g., `billing.ts`, `inventory.ts`)
2. Run `pnpm db:generate` — drizzle-kit diffs and emits `0001_<hash>.sql`
3. Review the generated SQL for correctness
4. Run `pnpm db:migrate` to apply

Do NOT manually write the migration SQL. Let drizzle-kit generate it.

### New Column Specifications

**`salesInvoiceItems`** — add to `billing.ts`:
```typescript
cgstAmt: numeric("cgst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
sgstAmt: numeric("sgst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
igstAmt: numeric("igst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
```
All three default to `"0"` (string for Drizzle numeric columns) and are `notNull()` — existing rows will receive `0` via the default.

**`inventoryBatches`** — add to `inventory.ts`:
```typescript
reservedQty: integer("reserved_qty").notNull().default(0),
```
Integer, not numeric. Matches the pattern of existing `quantity` column on the same table.

**`salesInvoices`** — add to `billing.ts`:
```typescript
customerGstin: varchar("customer_gstin", { length: 15 }),
```
Nullable (most sales are B2C walk-in). No default needed. Pattern matches `gstNo varchar(20)` on `suppliers` table.

### Redis INCR Pattern for Invoice Numbering

Create an injectable Redis client provider, then inject it into `BillingRepository`.

**Provider (create `backend/src/common/redis/redis.module.ts`):**
```typescript
// Source: ioredis docs + NestJS custom provider pattern
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>("REDIS_URL") ?? "redis://localhost:6379"),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

**Updated `nextInvoiceNumber` in `billing.repository.ts`:**
```typescript
// Key per branch per calendar day — resets naturally as key expires
async nextInvoiceNumber(branchId: string, branchCode: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD
  const key = `invoice_seq:${branchId}:${today}`;
  const seq = await this.redis.incr(key);
  // Expire at end of day + buffer (86400s = 24hr; key auto-ages out)
  if (seq === 1) {
    await this.redis.expire(key, 86400 * 2); // 48hr TTL — covers midnight race
  }
  return `${branchCode.toUpperCase()}-${today.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
}
```

Key format: `invoice_seq:{branchId}:{YYYY-MM-DD}` — one counter per branch per day. Atomic because `INCR` is a single Redis command (not read-then-write). TTL set to 48 hours to avoid issues at day rollover.

### decimal.js TaxService Pattern

```typescript
// Source: decimal.js README (https://mikemcl.github.io/decimal.js/)
import Decimal from "decimal.js";

calculateLineTax(
  unitPrice: number,
  quantity: number,
  discountPct: number,
  taxPct: number,
  interState = false,
): { lineTotal: number; taxAmount: number; breakdown: TaxBreakdown } {
  const gross = new Decimal(unitPrice).times(quantity);
  const discount = gross.times(discountPct).dividedBy(100);
  const taxableAmount = gross.minus(discount);
  const totalTax = taxableAmount.times(taxPct).dividedBy(100);
  const lineTotal = taxableAmount.plus(totalTax);
  const halfTax = totalTax.dividedBy(2);

  const breakdown: TaxBreakdown = interState
    ? { taxableAmount: taxableAmount.toNumber(), cgst: 0, sgst: 0, igst: totalTax.toNumber(), totalTax: totalTax.toNumber() }
    : { taxableAmount: taxableAmount.toNumber(), cgst: halfTax.toNumber(), sgst: halfTax.toNumber(), igst: 0, totalTax: totalTax.toNumber() };

  return { lineTotal: lineTotal.toNumber(), taxAmount: totalTax.toNumber(), breakdown };
}
```

**Verification:** `new Decimal(247.50).times(12).dividedBy(100)` = `29.70` exactly. `new Decimal("29.70").dividedBy(2)` = `14.85` exactly.

Note: The `TaxBreakdown` interface returns `number` type. Callers receive clean numbers with `.toNumber()` at the boundary. Internal arithmetic stays in Decimal throughout the chain.

### Seed Script Pattern

The project has no seed script. Create `backend/src/database/seed.ts` as a standalone TypeScript script runnable with `tsx`:

```typescript
// Run with: npx tsx src/database/seed.ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import argon2 from "argon2";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool, { schema });

async function seed() { /* ... insert data ... */ }

seed().then(() => { pool.end(); process.exit(0); }).catch((e) => { console.error(e); pool.end(); process.exit(1); });
```

Add to root `package.json` scripts:
```json
"db:seed": "pnpm --filter backend tsx src/database/seed.ts"
```

Or add to `backend/package.json`:
```json
"db:seed": "tsx src/database/seed.ts"
```

The `branches` table lives in `distribution.ts` / `branches` table. The seed must create branches before users (users.branchId FK). No FK exists yet from `users.branchId` to `branches.id` in the schema — it is a bare uuid column. The seed can freely insert.

**Required seed data per SEED-01:**
- 1 super admin: `admin@mederp.com`, password `Admin@123` (hashed with argon2)
- 2 branches: e.g., `{ name: "Main Branch", code: "BRN01" }`, `{ name: "Branch 2", code: "BRN02" }`
- 5 medicine categories
- 20 medicines: cover all `scheduleClass` values — `OTC`, `H`, `H1`, `X` (and some with no schedule)
- 2 suppliers
- 3 staff users (pharmacist, cashier, inventory_manager roles) linked to branches

The `medicines.scheduleClass` column is `varchar(10)` with no enum constraint — values are free-form strings. The seed should use the same values the application logic will check against (e.g., `"H"`, `"H1"`, `"X"`, `"OTC"`).

### Anti-Patterns to Avoid

- **Do NOT use `db:push` for schema changes.** `drizzle-kit push` bypasses the migration journal and directly syncs the DB. It is suitable only for local scratch environments and will corrupt the journal for production migrations.
- **Do NOT add columns with `NOT NULL` and no default if existing rows exist.** The three new columns all need `default("0")` or `default(0)` — already specified above.
- **Do NOT store Decimal instances in the DB.** Convert to `.toFixed(2)` string before inserting into Drizzle `numeric` columns.
- **Do NOT create the Redis key without a TTL.** Unbounded keys accumulate indefinitely. The 48hr TTL ensures cleanup.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Decimal arithmetic | Custom rounding helpers | `decimal.js` | IEEE 754 edge cases are subtle; decimal.js has 20+ years of financial use |
| Atomic counters | SELECT MAX + 1 in a transaction | Redis `INCR` | `INCR` is O(1) atomic; SQL solutions require row locking or advisory locks |
| Migration SQL | Hand-written `ALTER TABLE` | `drizzle-kit generate` | Keeps journal consistent; auto-handles defaults, nullability, FK syntax |
| Password hashing | Custom or MD5 | `argon2` (already in project) | argon2 is already the project standard — do not introduce bcryptjs |

---

## Common Pitfalls

### Pitfall 1: `db:generate` Emits No File Because Schema Is Not Changed
**What goes wrong:** Developer edits `billing.ts` but forgets to save, or runs `db:generate` from the wrong working directory.
**Why it happens:** `drizzle-kit generate` diffs against the snapshot in `drizzle/migrations/meta/0000_snapshot.json`. If the TypeScript source hasn't changed, no migration is emitted.
**How to avoid:** After editing schema files, run `pnpm db:generate` from the repo root (not from inside `backend/`). Verify a new `000N_*.sql` file appears in `backend/drizzle/migrations/`.
**Warning signs:** `drizzle-kit generate` completes with "No schema changes" message.

### Pitfall 2: Redis INCR Key Not Expired, Counter Carries Over Days
**What goes wrong:** Key `invoice_seq:{branchId}:2026-04-29` is not given a TTL. On 2026-04-30, a new request uses the same key from yesterday, producing sequence numbers starting from yesterday's count.
**Why it happens:** The key includes the date, so it will not collide — but leftover keys accumulate in Redis memory without TTL.
**How to avoid:** Set TTL to 48hr on the first INCR (when `seq === 1`). The "if seq === 1" check is atomic-safe: only the first caller in a given day gets seq=1.

### Pitfall 3: Decimal .toNumber() Precision Loss on Large Values
**What goes wrong:** `new Decimal("999999999.999999").toNumber()` may lose precision in JS float.
**Why it happens:** JavaScript `number` is IEEE 754 double — max safe integer is 2^53.
**How to avoid:** For DB inserts, use `.toFixed(2)` (returns string) rather than `.toNumber()`. For the `TaxBreakdown` interface (which returns `number`), values in pharmacy billing are always < ₹100,000 per line, well within safe range.

### Pitfall 4: Seed Fails on Re-Run Due to Unique Constraint Violations
**What goes wrong:** `seed.ts` is run twice; the second run tries to insert `admin@mederp.com` again and fails.
**Why it happens:** No `ON CONFLICT DO NOTHING` or existence check.
**How to avoid:** Use Drizzle's `.onConflictDoNothing()` on inserts, or check for existing data before inserting. Pattern: `await db.insert(schema.users).values(adminData).onConflictDoNothing()`.

### Pitfall 5: BillingModule Does Not Import RedisModule
**What goes wrong:** `BillingRepository` gets `@Inject(REDIS_CLIENT)` but NestJS DI throws "Nest can't resolve dependencies of the BillingRepository".
**Why it happens:** NestJS modules are scoped — `RedisModule` must be imported in `BillingModule` for its exports to be available.
**How to avoid:** Add `imports: [RedisModule]` to `BillingModule` decorator alongside `DrizzleModule`.

---

## Code Examples

### Verified: Drizzle numeric column with default
```typescript
// Source: backend/src/database/schema/billing.ts (existing pattern)
discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
  .notNull()
  .default("0"),
```
Apply the same pattern for `cgstAmt`, `sgstAmt`, `igstAmt`.

### Verified: Drizzle integer column with default
```typescript
// Source: backend/src/database/schema/inventory.ts (existing pattern)
quantity: integer("quantity").notNull().default(0),
```
Apply same pattern for `reservedQty`.

### Verified: Drizzle varchar nullable column (no default)
```typescript
// Source: backend/src/database/schema/procurement.ts (existing pattern)
gstNo: varchar("gst_no", { length: 20 }),
```
Apply same pattern for `customerGstin` with length 15.

### Verified: argon2 hashing in this project
```typescript
// Source: backend/package.json — argon2 ^0.31.2 is the password library
import argon2 from "argon2";
const hash = await argon2.hash("Admin@123");
```

### Verified: Drizzle transaction pattern (existing in billing.service.ts)
```typescript
// Source: backend/src/modules/billing/billing.service.ts lines 53-101
const result = await this.drizzle.db.transaction(async (tx) => {
  // operations using tx
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| drizzle-kit `push` for dev | `generate` + `migrate` with journal | Drizzle 0.22+ best practice | Ensures production-safe migration history |
| `COUNT(*)+1` sequential IDs | Redis `INCR` | Required for Phase 1 | Eliminates duplicate invoice numbers under concurrent load |
| Plain JS arithmetic | decimal.js | Required for Phase 1 | Eliminates floating-point GST calculation errors |

**Deprecated/outdated in this codebase:**
- `taxAmount` column on `salesInvoices`: stores total GST as a single number. After Phase 1 + 2, per-line `cgstAmt/sgstAmt/igstAmt` columns become the authoritative source; `taxAmount` on the invoice header remains as a summary total (not removed, but derived from line sums).

---

## Validation Architecture

Each Phase 1 success criterion maps to a specific programmatic check.

### Success Criterion 1: Migration applies cleanly; columns exist
**Command sequence:**
```bash
# 1. Generate migration after schema edits
pnpm db:generate

# 2. Apply migration
pnpm db:migrate

# 3. Verify columns exist (requires psql or DB connection)
# Use drizzle-kit studio OR run a direct SQL check:
psql "$DATABASE_URL" -c "\d sales_invoice_items" | grep -E "cgst_amt|sgst_amt|igst_amt"
psql "$DATABASE_URL" -c "\d inventory_batches" | grep "reserved_qty"
psql "$DATABASE_URL" -c "\d sales_invoices" | grep "customer_gstin"
```
**Expected:** Each grep returns a non-empty line showing the column and its type.

**Alternative (no psql):**
```bash
# drizzle-kit studio opens a browser UI showing all tables and columns
pnpm db:studio
```

### Success Criterion 2: Atomic invoice numbering — no duplicates under concurrency
**Setup:** Server running on port 4000, at least one branch and user seeded (run seed first).

**Test:**
```bash
# Get an auth token first
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mederp.com","password":"Admin@123"}' \
  | jq -r '.data.accessToken')

# Two simultaneous invoice creation requests (requires curl 7.68+ for --parallel)
curl -s -X POST http://localhost:4000/api/v1/billing/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branchId":"<BRANCH_UUID>","items":[...],"paymentMode":"cash"}' &

curl -s -X POST http://localhost:4000/api/v1/billing/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branchId":"<BRANCH_UUID>","items":[...],"paymentMode":"cash"}' &

wait
```
**Expected:** Two responses each with `success: true`, `data.invoiceNo` values differing by exactly 1 in the sequence component. Neither returns a 500 or unique constraint error.

**Simpler verification (unit-level):**
```bash
# Using vitest, assert Redis INCR produces non-colliding values
# Test: call nextInvoiceNumber twice with same branchId in parallel, assert results differ
```

### Success Criterion 3: TaxService decimal precision
**Manual check (Node REPL or vitest):**
```typescript
// vitest test — add to backend/src/modules/billing/tax.service.spec.ts
import { TaxService } from "./tax.service";
const svc = new TaxService();
const result = svc.calculateLineTax(247.50, 1, 0, 12);
// Assert:
expect(result.breakdown.cgst).toBe(14.85);
expect(result.breakdown.sgst).toBe(14.85);
expect(result.breakdown.totalTax).toBe(29.70);
```

**Quick smoke test via Node:**
```bash
node -e "
const Decimal = require('decimal.js');
const taxable = new Decimal(247.50);
const rate = new Decimal(12);
const total = taxable.times(rate).dividedBy(100);
const half = total.dividedBy(2);
console.log('total:', total.toFixed(2));   // must be 29.70
console.log('half:', half.toFixed(2));     // must be 14.85
"
```

### Success Criterion 4: Seed completes; data visible; login works
```bash
# Run seed
pnpm db:seed

# Verify login succeeds
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mederp.com","password":"Admin@123"}' \
  | jq '.data.accessToken'
# Expected: non-null JWT string

# Verify branch count (via drizzle-kit studio or psql)
psql "$DATABASE_URL" -c "SELECT count(*) FROM branches;"
# Expected: 2

# Verify product count and schedule types
psql "$DATABASE_URL" -c "SELECT schedule_class, count(*) FROM medicines GROUP BY schedule_class;"
# Expected: rows for OTC, H, H1, X schedules totalling 20

# Verify user count (admin + 3 staff)
psql "$DATABASE_URL" -c "SELECT role, count(*) FROM users GROUP BY role;"
# Expected: super_admin=1, pharmacist=1, cashier=1, inventory_manager=1
```

---

## Open Questions

1. **`branches.state` column for inter-state GST (Phase 2 dependency)**
   - What we know: `branches` table in `distribution.ts` has no `state`, `gstin`, or `drugLicenseNo` columns
   - What's unclear: Whether to add these in Phase 1 or Phase 2; SCHEMA-03 only adds `customerGstin` to invoices
   - Recommendation: Do NOT add `branches.state` in Phase 1. It is not in SCHEMA-01/02/03. Phase 2 (BILL-03) requires it; flag it for Phase 2 planning.

2. **`branchCode` source for invoice number prefix**
   - What we know: `billing.service.ts` calls `repo.nextInvoiceNumber(dto.branchId, "MAIN")` — hardcoded "MAIN" string
   - What's unclear: Should Phase 1 wire the actual `branches.code` value, or is "MAIN" a known placeholder?
   - Recommendation: Fix to pass actual branch code. The seed creates branches with `code: "BRN01"` / `"BRN02"`. The billing service should look up the branch code from the `branches` table (or pass it as part of the invoice DTO). This is a minor fix that belongs in Phase 1 since it affects invoice number correctness.

3. **`tsx` availability for seed script**
   - What we know: `tsx` is not in `backend/package.json` devDependencies; NestJS CLI uses `ts-node` under the hood
   - What's unclear: Whether `tsx` is available transitively or if `ts-node` should be used instead
   - Recommendation: Add `tsx` explicitly to `backend/package.json` devDependencies for the seed script. It is faster than `ts-node` and supports ESM. Alternatively use `ts-node -r tsconfig-paths/register`.

---

## Sources

### Primary (HIGH confidence)
- Direct file read: `backend/src/database/schema/billing.ts` — confirmed missing columns
- Direct file read: `backend/src/database/schema/inventory.ts` — confirmed missing `reservedQty`
- Direct file read: `backend/drizzle/migrations/0000_fat_ulik.sql` — confirmed migration state
- Direct file read: `backend/src/modules/billing/billing.repository.ts` — confirmed SELECT COUNT race condition
- Direct file read: `backend/src/modules/billing/tax.service.ts` — confirmed plain JS arithmetic
- Direct file read: `backend/package.json` — confirmed decimal.js absent, argon2 present, ioredis present

### Secondary (MEDIUM confidence)
- decimal.js README: https://mikemcl.github.io/decimal.js/ — `Decimal` API, `.times()`, `.dividedBy()`, `.toFixed()`
- drizzle-orm docs — `numeric` column with string default, `integer` default, migration generation workflow
- ioredis GitHub README — `INCR` command, TTL via `expire()`

### Tertiary (LOW confidence)
- NestJS custom provider pattern for injectable Redis client — well-known pattern, not verified against NestJS 10 changelog specifically

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present or absent by reading package.json directly
- Architecture: HIGH — patterns derived from existing code in the same project
- Pitfalls: HIGH — derived from direct reading of the bug-containing code, not hypothetical

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (drizzle-kit 0.22 stable; decimal.js 10.x stable for years)
