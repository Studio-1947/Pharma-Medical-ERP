---
phase: 2
slug: billing-pipeline-compliance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.5.0 |
| **Config file** | none — Wave 0 creates `backend/vitest.config.ts` |
| **Quick run command** | `pnpm --filter backend test` |
| **Full suite command** | `pnpm --filter backend test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter backend test`
- **After every plan wave:** Run `pnpm --filter backend test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | BILL-01, BILL-03 | unit | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 0 | BILL-06 | unit | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 0 | BILL-04, BILL-07, BILL-09 | unit | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | BILL-02, BILL-03 | integration | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | BILL-04 | integration | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | BILL-06, BILL-07 | unit | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 1 | BILL-08, BILL-09 | integration | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 1 | BILL-05 | integration (concurrent) | manual curl test | N/A | ⬜ pending |
| 2-04-01 | 04 | 2 | BILL-10 | integration | `pnpm --filter backend test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/vitest.config.ts` — configure test root to `src/`, exclude `dist/`
- [ ] `backend/src/modules/billing/__tests__/tax.service.spec.ts` — unit tests for TaxService.calculateLineTax covering BILL-01 (decimal precision) and BILL-03 (intra vs inter-state split)
- [ ] `backend/src/modules/inventory/__tests__/batch.repository.spec.ts` — unit tests for FEFO accumulator logic covering BILL-06
- [ ] `backend/src/modules/billing/__tests__/billing.service.spec.ts` — unit tests with mocked repos covering BILL-04 (Schedule H gate), BILL-07 (server-side price), BILL-09 (payment sum validation)

*vitest already installed — no package install needed in Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two concurrent requests for last unit produce one success and one 422 | BILL-05 | Requires actual concurrent HTTP requests; hard to simulate reliably in vitest | Run `curl -X POST .../billing/invoices` twice in parallel with same 1-unit batch; inspect responses |
| Single transaction atomicity on checkout | BILL-08 | Requires DB state inspection mid-transaction; not automatable without test hooks | Kill DB mid-checkout, verify no partial invoice rows exist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
