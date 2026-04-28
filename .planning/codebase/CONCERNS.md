# CONCERNS.md — Pharma Medical ERP

## Technical Debt

### High Priority

1. **Invoice Numbering Race Condition** — `billing.service.ts`
   Non-atomic `SELECT COUNT + 1` for invoice sequence. Concurrent requests can generate duplicate invoice numbers.
   Fix: Use Redis INCR or database sequence.

2. **Missing Stock Reservation** — `inventory` module
   No stock hold/reserve for active carts. Two concurrent sales can both read available qty, both succeed, and overdraw stock.
   Fix: Implement `reservedQty` field and atomic reservation before checkout.

3. **Concurrent Batch Adjustment Race** — `stock-batches`
   Batch adjustment lacks transaction isolation. Concurrent stock sales can exceed available quantity.
   Fix: Use `SELECT FOR UPDATE` or optimistic locking.

4. **Offline Invoice Sync** — billing offline queue
   Weak state management with no retry strategy for validation failures. Offline queue sync doesn't retry failed items.
   Fix: Add exponential backoff, dead-letter queue, and sync status tracking.

5. **Tokens in localStorage (XSS Risk)**
   Access tokens stored in localStorage are vulnerable to XSS attacks.
   Fix: Use httpOnly cookies or memory-only storage with silent refresh.

6. **No Pagination Boundary Validation**
   `page=0` and unlimited `limit` values accepted. Large limits can cause OOM.
   Fix: Enforce `page >= 1`, `limit <= 100` at controller level.

---

## Known Bugs

1. **Invoice Sequence Resets After Midnight** — invoice numbering logic
   Daily sequence counter resets cause numbering gaps and possible duplicates near midnight.

2. **Stock Movement Missing Reference IDs** — `stock_movements` table
   `referenceId` not always populated when creating movements during billing. Makes audit trails incomplete.

3. **Offline Queue Validation Failures Not Retried** — offline sync
   Items that fail server-side validation are silently dropped rather than queued for manual review.

---

## Security Risks

1. **Insufficient Numeric Field Validation**
   Price and quantity fields not validated for negative values or unrealistic ranges at API boundary.

2. **Argon2 Parameters Below OWASP Recommendations**
   Password hashing parameters (memory, iterations) not configured to current OWASP minimums.

3. **No Rate Limiting on Auth Endpoints**
   `/auth/login` and `/auth/refresh` have no brute-force protection.

4. **CORS Hardcoded to localhost**
   `CORS_ORIGIN` defaults to `localhost:3000` — must be overridden for production but no validation enforces this.

5. **No CSRF Protection**
   JWT in Authorization header mitigates most risk, but cookie-based flows lack CSRF tokens.

6. **Client-Provided Pricing Not Validated**
   Invoice items accept client-supplied `unitSellingPrice`. Stale or manipulated prices can pass through.
   Fix: Always re-fetch price from DB on finalization.

---

## Performance Bottlenecks

1. **POS Search Unoptimized** — `products.service.ts`
   No debounce on search, no full-text index. Uses `ILIKE` on name + genericName + barcode — slow on large catalogs.
   Fix: Add Elasticsearch or pg full-text index; debounce 200ms.

2. **Invoice List Over-fetches** — `billing.repository.ts`
   List query loads all columns + relations unnecessarily. No field projection.

3. **Expiry Scan N+1 Queries** — `expiry-scanner.worker.ts`
   Notification creation loops without batch insert.

4. **Medicine Catalog Not Cached**
   Repeated API calls for product lookups in POS without Redis caching.
   Fix: Cache by barcode with 5-minute TTL (per CLAUDE.md spec).

5. **Batch Queries Always Force FEFO Sort**
   Hard-coded `ORDER BY expiry_date ASC` on every batch query, even for non-sale operations.

---

## Fragile Areas

1. **Invoice Void Lacks Rollback Safeguards** — `billing.service.ts`
   Void transaction doesn't fully reverse stock movements if partial failure occurs.

2. **Batch Status Enums Not Synchronized** — frontend/backend
   Frontend hardcodes some batch status strings instead of importing from `@mederp/types`.

3. **Schedule H Enforcement Not Wired to Billing** — `prescriptions` + `billing`
   `requiresRx` check exists in service but prescription link validation is incomplete — Schedule H products can be billed without verified Rx in some code paths.

4. **Offset Pagination Causes Duplicates on Concurrent Inserts**
   Standard `OFFSET/LIMIT` pagination produces duplicate or skipped rows when new records are inserted during paging.
   Fix: Cursor-based pagination for high-churn tables (invoices, movements).

---

## Missing Features (In-Scope Gaps)

| Feature | Module | Priority |
|---------|--------|----------|
| Stock reservation for active carts | inventory | High |
| Prescription verification enforcement at billing | billing | High |
| GSTR-1 export | reports | High |
| Schedule H dispensing register | reports | High |
| Multi-branch stock transfer | inventory | Medium |
| Auto-draft PO on low stock | purchase-orders | Medium |
| Soft delete audit trail | all | Medium |
| Cursor-based pagination | all list endpoints | Low |

---

## Test Coverage Gaps

| Area | Priority | Notes |
|------|----------|-------|
| Financial calculations (GST, rounding) | High | Zero unit tests — pure functions, easy to test |
| Concurrent transaction safety | High | Race conditions in billing + inventory |
| POS E2E flow | High | Most critical user path, untested |
| Auth / RBAC enforcement | High | Security-critical |
| Error scenario coverage | Medium | Only happy path covered |
| Database migration tests | Medium | Schema changes unverified |
| Load testing | Low | No baseline established |

**Current state:** Vitest 1.5.0 configured, zero test files exist.

---

## Scaling Limits

| Limit | Threshold | Impact |
|-------|-----------|--------|
| Invoice numbering (non-atomic) | ~100 concurrent/branch | Duplicate numbers |
| Batch adjustment lock contention | ~100 ops/sec | Stock corruption risk |
| Expiry scan query | >50k batches | Timeout/slowdown |
| Invoice list query | >500 invoices | Noticeable latency |

---

*Mapped: 2026-04-29*
