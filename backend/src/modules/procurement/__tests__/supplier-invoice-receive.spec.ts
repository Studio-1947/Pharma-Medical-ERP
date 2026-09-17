import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProcurementService } from "../procurement.service";

const dto = {
  supplierId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  supplierInvoiceNo: "A000198",
  invoiceDate: "2026-09-16",
  items: [{
    medicineId: "33333333-3333-4333-8333-333333333333",
    billedQty: 10,
    freeQty: 1,
    unitsPerPack: 10,
    unitCost: "83.06",
    taxPct: "5" as const,
    discountPct: "4.00",
    mrpAtEntry: "109.00",
    batchNo: "RD-6604",
    expiryDate: "2027-11-01",
  }],
};

function setup(duplicate: any = null) {
  const tx = { name: "transaction" };
  const repo = {
    findSupplierInvoice: vi.fn().mockResolvedValue(duplicate),
    createPO: vi.fn().mockResolvedValue({ id: "po-1", items: [{ id: "poi-1" }] }),
    createGRN: vi.fn().mockResolvedValue({ grn: { id: "grn-1" }, batchIds: ["batch-1"] }),
    updatePOStatus: vi.fn().mockResolvedValue(undefined),
  };
  const drizzle = { db: { transaction: vi.fn(async (work: any) => work(tx)) } };
  return { service: new ProcurementService(repo as any, drizzle as any), repo, drizzle, tx };
}

describe("scanned supplier invoice receipt", () => {
  it("creates the procurement bill, GRN and stock in one transaction", async () => {
    const { service, repo, tx } = setup();

    const result = await service.receiveSupplierInvoice(dto, "user-1", dto.branchId);

    expect(repo.createPO).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: dto.supplierId,
      branchId: dto.branchId,
      items: [expect.objectContaining({ orderedQty: 10, unitCost: "83.06", schemeFreeQty: 1 })],
    }), "user-1", tx);
    expect(repo.createGRN).toHaveBeenCalledWith(expect.objectContaining({
      poId: "po-1",
      supplierInvoiceNo: "A000198",
      items: [expect.objectContaining({
        poItemId: "poi-1",
        receivedQty: 110,
        freeQty: 10,
        billableQty: 10,
        mrpAtEntry: "109.00",
      })],
    }), "user-1", tx);
    expect(repo.updatePOStatus).toHaveBeenCalledWith("po-1", "received", tx);
    expect(result.data.batchIds).toEqual(["batch-1"]);
  });

  it("rejects a duplicate supplier invoice before opening a transaction", async () => {
    const { service, drizzle } = setup({ id: "grn-1", grnNumber: "GRN-101" });
    await expect(service.receiveSupplierInvoice(dto, "user-1", dto.branchId))
      .rejects.toBeInstanceOf(ConflictException);
    expect(drizzle.db.transaction).not.toHaveBeenCalled();
  });
});
