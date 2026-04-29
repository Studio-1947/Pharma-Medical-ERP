---
phase: 1
slug: schema-and-infrastructure-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest (NestJS default) |
| **Config file** | `backend/package.json` (jest config inline) |
| **Quick run command** | `pnpm --filter backend test -- --testPathPattern=tax.service` |
| **Full suite command** | `pnpm --filter backend test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter backend test -- --testPathPattern=tax.service`
- **After every plan wave:** Run `pnpm --filter backend test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 1-01-01 | 01 | 1 | SCHEMA-01/02/03 | migration | `pnpm db:migrate` (exits 0) | ⬜ pending |
| 1-01-02 | 01 | 1 | SCHEMA-01/02/03 | schema check | `pnpm --filter backend db:generate` (no drift) | ⬜ pending |
| 1-02-01 | 02 | 2 | BILL-01 (prep) | unit | `pnpm --filter backend test -- --testPathPattern=tax.service` | ⬜ pending |
| 1-03-01 | 03 | 3 | SCHEMA-04 | integration | two parallel curl POST → invoice numbers differ by 1 | ⬜ pending |
| 1-04-01 | 04 | 4 | SEED-01 | script | `pnpm db:seed` exits 0; login succeeds | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/modules/billing/__tests__/tax.service.spec.ts` — unit test for `TaxService.calculate(247.50, 12)` returning cgst=14.85, sgst=14.85, total=29.70

*Wave 0 creates the spec file before decimal.js is wired — test goes red first, then green after Plan 02.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two concurrent checkouts produce sequential invoice numbers | SCHEMA-04 | Requires live server + Redis | Start server; run `curl -X POST .../billing/invoices/finalize` twice in parallel; inspect invoice numbers in response |
| Seed data visible in DB | SEED-01 | No DB query in CI | Run `pnpm db:seed`; connect to Postgres; `SELECT email FROM users` — expect admin@mederp.com |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
