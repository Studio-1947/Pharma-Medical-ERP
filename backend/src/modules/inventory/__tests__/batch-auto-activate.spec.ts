import { describe, it, expect, vi, beforeEach } from "vitest";
import { BatchService } from "../batch.service";

/**
 * When a medicine was imported via CSV without an MRP it is parked inactive.
 * Receiving a batch for it with a valid mrpAtEntry should promote the medicine:
 * set priceMrp on the medicine record and flip isActive to true so the POS can
 * sell it without a separate edit step.
 */

describe("BatchService.create — auto-activate inactive medicine", () => {
  let service: BatchService;
  let mockBatchRepo: any;
  let mockMovementRepo: any;
  let mockInventoryRepo: any;
  let mockBarcodeService: any;

  const inactiveMedicine = {
    id: "med-inactive",
    name: "Amoxicillin 250mg",
    isActive: false,
    priceMrp: "0",
  };

  const activeMedicine = {
    id: "med-active",
    name: "Paracetamol 500mg",
    isActive: true,
    priceMrp: "30.00",
  };

  const branchId = "branch-1";
  const userId = "user-1";

  beforeEach(() => {
    mockBatchRepo = {
      createBatch: vi.fn().mockResolvedValue({ id: "batch-new", medicineId: "med-inactive", branchId }),
      findOrCreateDefaultLocationForBranch: vi.fn().mockResolvedValue("loc-1"),
    };
    mockMovementRepo = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    mockInventoryRepo = {
      findMedicineById: vi.fn(),
      updateMedicine: vi.fn().mockResolvedValue({ id: "med-inactive", isActive: true, priceMrp: "85.50" }),
    };
    mockBarcodeService = {};
    service = new BatchService(mockBatchRepo, mockMovementRepo, mockInventoryRepo, mockBarcodeService);
  });

  it("activates an inactive medicine when the batch has a valid MRP", async () => {
    mockInventoryRepo.findMedicineById.mockResolvedValue(inactiveMedicine);

    await service.create(
      {
        medicineId: "med-inactive",
        branchId,
        batchNo: "BATCH01",
        expiryDate: "2027-06-30",
        quantity: 50,
        mrpAtEntry: "85.50",
        costPrice: "60.00",
      } as any,
      userId,
      branchId,
    );

    expect(mockInventoryRepo.updateMedicine).toHaveBeenCalledWith("med-inactive", {
      priceMrp: "85.50",
      isActive: true,
    });
  });

  it("does NOT touch an already-active medicine", async () => {
    mockInventoryRepo.findMedicineById.mockResolvedValue(activeMedicine);

    await service.create(
      {
        medicineId: "med-active",
        branchId,
        batchNo: "BATCH02",
        expiryDate: "2027-06-30",
        quantity: 100,
        mrpAtEntry: "30.00",
        costPrice: "20.00",
      } as any,
      userId,
      branchId,
    );

    expect(mockInventoryRepo.updateMedicine).not.toHaveBeenCalled();
  });

  it("does NOT activate when mrpAtEntry is 0 or missing", async () => {
    mockInventoryRepo.findMedicineById.mockResolvedValue(inactiveMedicine);

    await service.create(
      {
        medicineId: "med-inactive",
        branchId,
        batchNo: "BATCH03",
        expiryDate: "2027-06-30",
        quantity: 25,
        mrpAtEntry: "0",
        costPrice: "10.00",
      } as any,
      userId,
      branchId,
    );

    expect(mockInventoryRepo.updateMedicine).not.toHaveBeenCalled();
  });

  it("still creates the batch and logs movement even when not activating", async () => {
    mockInventoryRepo.findMedicineById.mockResolvedValue(inactiveMedicine);

    await service.create(
      {
        medicineId: "med-inactive",
        branchId,
        batchNo: "BATCH04",
        expiryDate: "2027-06-30",
        quantity: 10,
        mrpAtEntry: "0",
        costPrice: "5.00",
      } as any,
      userId,
      branchId,
    );

    expect(mockBatchRepo.createBatch).toHaveBeenCalled();
    expect(mockMovementRepo.log).toHaveBeenCalled();
    expect(mockInventoryRepo.updateMedicine).not.toHaveBeenCalled();
  });
});
