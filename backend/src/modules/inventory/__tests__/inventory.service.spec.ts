import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException } from "@nestjs/common";
import { InventoryService } from "../inventory.service";
import { createMedicineSchema } from "@pharmerp/types";

const baseDto = {
  name: "Paracetamol 500mg",
  sku: "PARA-500",
  priceMrp: "30.00",
} as any;

describe("InventoryService - barcode uniqueness", () => {
  let service: InventoryService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findMedicineByBarcode: vi.fn().mockResolvedValue(null),
      findMedicineById: vi.fn().mockResolvedValue({ id: "med-1", name: "Existing" }),
      createMedicine: vi.fn((data) => Promise.resolve({ id: "med-new", ...data })),
      updateMedicine: vi.fn((id, data) => Promise.resolve({ id, ...data })),
    };
    service = new InventoryService(mockRepo);
  });

  it("creates a medicine when the barcode is unused", async () => {
    const res = await service.create({ ...baseDto, barcode: "8901030865275" });
    expect(mockRepo.findMedicineByBarcode).toHaveBeenCalledWith("8901030865275", undefined);
    expect(res.data.id).toBe("med-new");
  });

  it("rejects create when another medicine already has the barcode", async () => {
    mockRepo.findMedicineByBarcode.mockResolvedValue({
      id: "med-other",
      name: "Crocin Advance",
      sku: "CRO-ADV",
    });
    await expect(service.create({ ...baseDto, barcode: "8901030865275" })).rejects.toThrow(
      ConflictException,
    );
    expect(mockRepo.createMedicine).not.toHaveBeenCalled();
  });

  it("skips the barcode check when no barcode is provided", async () => {
    await service.create(baseDto);
    expect(mockRepo.findMedicineByBarcode).not.toHaveBeenCalled();
  });

  it("excludes the medicine itself when updating", async () => {
    await service.update("med-1", { barcode: "8901030865275" });
    expect(mockRepo.findMedicineByBarcode).toHaveBeenCalledWith("8901030865275", "med-1");
  });
});

describe("createMedicineSchema - barcode EAN-13 checksum", () => {
  it("accepts a 13-digit barcode with a valid checksum", () => {
    const res = createMedicineSchema.safeParse({ ...baseDto, barcode: "8901030865275" });
    expect(res.success).toBe(true);
  });

  it("rejects a 13-digit barcode with a bad checksum", () => {
    const res = createMedicineSchema.safeParse({ ...baseDto, barcode: "8901030865278" });
    expect(res.success).toBe(false);
  });

  it("accepts non-EAN-13 formats without checksum validation", () => {
    const res = createMedicineSchema.safeParse({ ...baseDto, barcode: "CODE128-ABC-01" });
    expect(res.success).toBe(true);
  });
});
