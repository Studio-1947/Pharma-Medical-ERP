# Phase 3 Context: Backend Modules

## Objective
Complete the operational backend modules required for inventory management, procurement, and clinical workflows. This phase transitions the system from a "sales engine" to a full-scale ERP capable of managing the entire lifecycle of a medicine from purchase to dispensing.

## Scope
### 1. Inventory Management (INV)
- **INV-01**: Near-expiry reporting (list batches expiring in X days).
- **INV-02**: Stock adjustments (loss/damage/correction) with mandatory audit reasons.
- **INV-03**: Reorder alerts (identify products below reorder level).

### 2. Procurement (PO)
- **PO-01**: Purchase Order creation and state management (draft -> sent -> received).
- **PO-02**: Goods Received Note (GRN) flow (receiving stock, generating batches, updating supplier balance).

### 3. Prescriptions & Clinical (RX)
- **RX-01**: Prescription verification workflow (pharmacist review).
- **RX-02**: Prescription image management (MinIO upload and signed URL retrieval).

## Key Implementation Patterns
- **Atomic Operations**: All inventory updates must be transactional.
- **Audit Logging**: Every stock change must be logged in `stock_movements`.
- **Decimal Precision**: All financial updates (supplier balances) must use `decimal.js`.
- **S3 Integration**: Prescription images stored in MinIO using the `S3Service`.

## Success Criteria
- Pharmacists can verify prescriptions with image evidence.
- Inventory managers can receive stock and adjust counts with an audit trail.
- Reports show upcoming expiries and items needing reorder.
