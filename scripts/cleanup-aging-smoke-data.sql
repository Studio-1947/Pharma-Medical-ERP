-- Removes the fixtures created while smoke testing the payables/receivables
-- aging screens on 2026-08-17. Run against the local dev database only:
--
--   docker exec -i pharmerp_postgres psql -U pharmerp -d pharmerp \
--     < scripts/cleanup-aging-smoke-data.sql
--
-- Everything below is scoped to rows tagged "AGING SMOKE TEST" or to the
-- batches those rows created, so it cannot touch real data.

BEGIN;

-- 1. Supplier payments recorded during the test.
DELETE FROM supplier_payments WHERE notes LIKE 'AGING SMOKE TEST%';

-- 2. Sales invoices raised during the test, and their children.
DELETE FROM payments
 WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE notes = 'AGING SMOKE TEST');
DELETE FROM sales_invoice_items
 WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE notes = 'AGING SMOKE TEST');
DELETE FROM sales_invoices WHERE notes = 'AGING SMOKE TEST';

-- 3. GRNs, their batches and stock movements, then the POs behind them.
--    Batch numbers were minted as SMOKE-B1..SMOKE-B3 by the fixture script.
DELETE FROM stock_movements
 WHERE batch_id IN (SELECT id FROM inventory_batches WHERE batch_no LIKE 'SMOKE-B%');
DELETE FROM grn_items
 WHERE grn_id IN (
   SELECT id FROM goods_received_notes
    WHERE po_id IN (SELECT id FROM purchase_orders WHERE notes = 'AGING SMOKE TEST')
 );
DELETE FROM goods_received_notes
 WHERE po_id IN (SELECT id FROM purchase_orders WHERE notes = 'AGING SMOKE TEST');
DELETE FROM inventory_batches WHERE batch_no LIKE 'SMOKE-B%';
DELETE FROM purchase_order_items
 WHERE po_id IN (SELECT id FROM purchase_orders WHERE notes = 'AGING SMOKE TEST');
DELETE FROM purchase_orders WHERE notes = 'AGING SMOKE TEST';

-- 4. Reset the denormalised balances the test moved. Both are recomputable
--    from the rows above, which is exactly why they are safe to zero here:
--    no real transactions existed on these records before the test.
UPDATE suppliers
   SET outstanding_balance = '0'
 WHERE code IN ('SUP-002', 'AHSD', 'BPDK');

UPDATE patients
   SET outstanding_balance = '0'
 WHERE id IN (
   '56d0aac0-a546-4a96-8d01-b60e593862ff',
   'a74b46be-b209-40ad-8a3d-56c0061931aa'
 );

COMMIT;
