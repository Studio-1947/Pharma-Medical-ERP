# TESTING.md — Pharma Medical ERP

## Current State

**Test framework configured, zero test files exist.**

- Framework: Vitest 1.5.0 (`backend/package.json`)
- NestJS testing module: `@nestjs/testing` available
- Test runner: `vitest` with `globals: true`
- No test files found anywhere in the codebase

---

## Framework & Configuration

**Backend (`backend/package.json`):**
```json
{
  "devDependencies": {
    "vitest": "^1.5.0",
    "@nestjs/testing": "^10.x"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Frontend (`apps/web`):** No test framework configured yet.

---

## Intended Test Organization

### File Location Convention
Tests should be co-located with source files:
```
src/modules/auth/
  auth.service.ts
  auth.service.test.ts    ← co-located
  auth.controller.ts
  auth.controller.test.ts
```

Or in a dedicated `test/` directory for integration tests:
```
backend/test/
  integration/
    billing.integration.test.ts
  e2e/
    pos-flow.e2e.test.ts
  fixtures/
    product.fixture.ts
    patient.fixture.ts
```

### Naming Convention
- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

---

## Test Structure Pattern

### Unit Test (Arrange-Act-Assert)
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Test } from '@nestjs/testing'
import { BillingService } from './billing.service'
import { InventoryService } from '../inventory/inventory.service'

describe('BillingService', () => {
  let billingService: BillingService
  let inventoryService: InventoryService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: InventoryService,
          useValue: {
            selectBatchesForSale: vi.fn(),
            reserveStock: vi.fn(),
          },
        },
      ],
    }).compile()

    billingService = module.get(BillingService)
    inventoryService = module.get(InventoryService)
  })

  it('should calculate GST correctly for intra-state sale', async () => {
    // Arrange
    const amount = 1000
    const gstRate = 12

    // Act
    const result = billingService.calculateGST(amount, gstRate, false)

    // Assert
    expect(result.cgst).toBe(60)
    expect(result.sgst).toBe(60)
    expect(result.igst).toBe(0)
    expect(result.total).toBe(120)
  })
})
```

### Mocking Patterns
```typescript
// Mock repository
const mockRepository = {
  findById: vi.fn().mockResolvedValue(mockProduct),
  create: vi.fn().mockResolvedValue({ id: 'uuid', ...mockProduct }),
}

// Mock with implementation
vi.spyOn(inventoryService, 'selectBatchesForSale')
  .mockResolvedValue([{ batchId: 'b1', qty: 5, expiryDate: '2025-12-31' }])

// Mock error scenarios
vi.spyOn(billingRepository, 'createInvoice')
  .mockRejectedValue(new Error('DB connection failed'))
```

### Fixture Pattern
```typescript
// test/fixtures/product.fixture.ts
export const createProductFixture = (overrides = {}) => ({
  id: 'prod-uuid-1',
  name: 'Paracetamol 500mg',
  scheduleType: 'OTC',
  requiresRx: false,
  gstRate: 12,
  sellingPrice: 50,
  ...overrides,
})

// Usage
const rxProduct = createProductFixture({ scheduleType: 'SCHEDULE_H', requiresRx: true })
```

---

## Priority Test Areas

### High Priority (write first)

| Test | File | Why |
|------|------|-----|
| GST calculation | `billing/tax.service.test.ts` | Financial accuracy, pure function |
| Invoice total calculation | `billing/billing.service.test.ts` | Core POS correctness |
| FEFO batch selection | `inventory/inventory.service.test.ts` | Stock integrity |
| Auth login / JWT | `auth/auth.service.test.ts` | Security-critical |
| RBAC guard | `common/guards/roles.guard.test.ts` | Authorization enforcement |
| Schedule H Rx check | `billing/billing.service.test.ts` | Regulatory compliance |

### Medium Priority

| Test | File | Why |
|------|------|-----|
| Stock reservation atomicity | integration test | Race condition protection |
| Invoice finalization transaction | integration test | Data integrity |
| Prescription validity check | `prescriptions/prescriptions.service.test.ts` | Rx workflow |
| Patient allergy check | `patients/patients.service.test.ts` | Safety feature |

### Low Priority (after above)
- Report generation
- Notification delivery
- PDF generation
- CSV export

---

## Common Test Patterns

### Async error testing
```typescript
it('should throw 400 when Schedule H product has no Rx', async () => {
  await expect(
    billingService.addItemToInvoice(invoiceId, { productId: scheduleHProductId, quantity: 1 })
  ).rejects.toMatchObject({ statusCode: 400, message: /prescription required/i })
})
```

### Transaction testing
```typescript
it('should rollback stock if invoice finalization fails', async () => {
  vi.spyOn(billingRepository, 'createPayments').mockRejectedValue(new Error('DB error'))

  await expect(billingService.finalizeInvoice(invoiceId, payments)).rejects.toThrow()

  // Verify stock was not deducted
  const stock = await inventoryRepository.getBatchById(batchId)
  expect(stock.quantity).toBe(originalQuantity)
})
```

---

## Running Tests

```bash
# Run all tests
pnpm --filter api test

# Watch mode
pnpm --filter api test:watch

# Coverage report
pnpm --filter api test:coverage

# Single file
pnpm --filter api test src/modules/billing/billing.service.test.ts
```

---

*Mapped: 2026-04-29*
