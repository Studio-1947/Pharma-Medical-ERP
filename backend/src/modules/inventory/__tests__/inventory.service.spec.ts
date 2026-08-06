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
    expect(res.data?.id).toBe("med-new");
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

// ---------------------------------------------------------------------------
// Bulk import: values the catalogue writes twice, and duplicates across rows.
// The rule throughout is "the last one wins" — the later text is the more
// recent edit. Cases are the real strings from the supplier catalogue.
// ---------------------------------------------------------------------------
function importStub() {
  const created: any[] = [];
  const repo = {
    getMaxSequentialSku: vi.fn().mockResolvedValue(0),
    findOrCreateCategoryIds: vi.fn().mockResolvedValue(new Map()),
    findSkuSet: vi.fn().mockResolvedValue(new Set()),
    findBarcodeSet: vi.fn().mockResolvedValue(new Set()),
    findNaturalKeys: vi.fn().mockResolvedValue(new Set()),
    persistCatalogueImport: vi.fn(async ({ medicines, batches }: any) => {
      created.push(...medicines);
      return {
        idsBySku: new Map(medicines.map((r: any, i: number) => [r.sku, `med-${i}`])),
        batchesCreated: batches.length,
      };
    }),
  } as any;
  return { repo, created, service: new InventoryService(repo) };
}

describe("bulkImport - values written twice keep the last copy", () => {
  const collapses: [string, string, string, string][] = [
    ["exact repeat", "Brand_Name", "XYCOVIT GOLD  XYCOVIT GOLD", "XYCOVIT GOLD"],
    ["single space", "Brand_Name", "CONTIZOLE-100 CONTIZOLE-100", "CONTIZOLE-100"],
    ["wide gap", "Brand_Name", "Adiphylin 400      Adiphylin 400", "Adiphylin 400"],
    ["hyphen spacing differs", "Brand_Name", "BIOSOLIV-300     BIOSOLIV -300", "BIOSOLIV -300"],
    ["hyphen spacing differs", "Brand_Name", "Primogen -E Primogen-E", "Primogen-E"],
    ["hyphenation differs", "Brand_Name", "Calci Pure-XT Calci-Pure-XT", "Calci-Pure-XT"],
    [
      "missing space differs",
      "Generic_Name",
      "Levosalbutamol,Ambroxol Hydrochloride & Guaiphenesin syrup  Levosalbutamol,Ambroxol Hydrochloride& Guaiphenesin syrup",
      "Levosalbutamol,Ambroxol Hydrochloride& Guaiphenesin syrup",
    ],
  ];
  const field: Record<string, string> = {
    Brand_Name: "brandName",
    Generic_Name: "genericName",
    Strength: "strength",
    Composition: "composition",
  };

  it.each(collapses)("collapses %s to the last copy", async (_label, col, value, expected) => {
    const { service, created } = importStub();
    await service.bulkImport(
      [{ Medicine_ID: "T1", Medicine_Name: "Probe", MRP: "10.00", [col]: value }] as any,
      "u",
    );
    expect(created[0][field[col]!]).toBe(expected);
  });

  // A repeat around a joining operator is a real combination. Collapsing
  // "10 mg + 10 mg" would halve the recorded strength of the product.
  const keeps: [string, string, string][] = [
    ["plus-joined strength", "Strength", "10 mg + 10 mg"],
    ["plus-joined strength", "Strength", "500 mg + 500 mg"],
    ["plus-joined composition", "Composition", "Paracetamol 325 mg + Paracetamol 325 mg"],
    ["word-joined generic", "Generic_Name", "Vitamin D3 with Vitamin D3"],
    ["not a repeat", "Brand_Name", "Neo Neo Forte"],
    ["tripled, not a clean repeat", "Brand_Name", "Tablet Tablet Tablet"],
  ];

  it.each(keeps)("leaves %s untouched", async (_label, col, value) => {
    const { service, created } = importStub();
    await service.bulkImport(
      [{ Medicine_ID: "T1", Medicine_Name: "Probe", MRP: "10.00", [col]: value }] as any,
      "u",
    );
    expect(created[0][field[col]!]).toBe(value);
  });
});

describe("bulkImport - duplicates across rows resolve to the last row", () => {
  it("gives a shared barcode to the last row that claims it", async () => {
    const { service, created } = importStub();
    const res = await service.bulkImport(
      [
        { Medicine_ID: "A1", Medicine_Name: "Evion 400", MRP: "10.00", Barcode: "8901030865275" },
        { Medicine_ID: "A2", Medicine_Name: "Evion 600", MRP: "20.00", Barcode: "8901030865275" },
      ] as any,
      "u",
    );
    expect(created.find((m) => m.sku === "A2").barcode).toBe("8901030865275");
    expect(created.find((m) => m.sku === "A1").barcode).toBeUndefined();
    // The earlier product still imports — it just cannot be scanned yet.
    expect(res.created).toBe(2);
    expect(res.warnings).toHaveLength(1);
    expect(res.errors).toHaveLength(0);
  });

  it("keeps the last row's values when a SKU repeats", async () => {
    const { service, created } = importStub();
    const res = await service.bulkImport(
      [
        { Medicine_ID: "B1", Medicine_Name: "Old name", MRP: "10.00" },
        { Medicine_ID: "B1", Medicine_Name: "Corrected name", MRP: "25.00" },
      ] as any,
      "u",
    );
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("Corrected name");
    expect(created[0].priceMrp).toBe("25.00");
    expect(res.warnings.some((w) => /Superseded by a later row/.test(w.reason))).toBe(true);
  });
});

describe("bulkImport - re-importing the same sheet is idempotent", () => {
  // A row with no Medicine_ID gets a minted SKU, so on a second run its SKU
  // cannot match. Without a natural-key check the product imports again under
  // a fresh SKU, silently duplicating part of the catalogue.
  it("skips an ID-less row whose product is already stored", async () => {
    const { repo, created, service } = importStub();
    repo.findNaturalKeys.mockResolvedValue(new Set(["xycovitgold|orkopharma"]));
    const res = await service.bulkImport(
      [{ Brand_Name: "XYCOVIT GOLD", Manufacturer: "ORKO Pharma", MRP: "10.00" }] as any,
      "u",
    );
    expect(created).toHaveLength(0);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("mints a SKU when the product is not stored yet", async () => {
    const { created, service } = importStub();
    const res = await service.bulkImport(
      [{ Brand_Name: "XYCOVIT GOLD", Manufacturer: "ORKO Pharma", MRP: "10.00" }] as any,
      "u",
    );
    expect(res.created).toBe(1);
    expect(created[0].sku).toMatch(/^MED\d{5}$/);
  });

  it("collapses two ID-less rows for the same product to the last one", async () => {
    const { created, service } = importStub();
    await service.bulkImport(
      [
        { Brand_Name: "Zinc Plus", Manufacturer: "Acme", MRP: "10.00", Strength: "10 mg" },
        { Brand_Name: "Zinc Plus", Manufacturer: "Acme", MRP: "12.00", Strength: "20 mg" },
      ] as any,
      "u",
    );
    expect(created).toHaveLength(1);
    expect(created[0].strength).toBe("20 mg");
    expect(created[0].priceMrp).toBe("12.00");
  });

  it("reports an already-imported SKU as skipped, not as an error", async () => {
    const { repo, service } = importStub();
    repo.findSkuSet.mockResolvedValue(new Set(["MED00001"]));
    const res = await service.bulkImport(
      [{ Medicine_ID: "MED00001", Medicine_Name: "Dolo 650", MRP: "31.50" }] as any,
      "u",
    );
    expect(res.errors).toHaveLength(0);
    expect(res.skipped).toBe(1);
    expect(res.warnings.some((w) => /Already imported/.test(w.reason))).toBe(true);
  });
});

describe("bulkImport - Google Sheets schemas validation", () => {
  it("imports Sheet 1 (gid=202758680) rows cleanly", async () => {
    const { service, created } = importStub();
    const sheet1Rows = [
      {
        Brand_Name: "Flowyou Eye Drops",
        Medicine_Name: "Flowyou Eye Drops",
        Generic_Name: "Moxifloxacin",
        Composition: "Moxifloxacin Hydrochloride IP",
        Strength: "0.5% w/v",
      },
      {
        Brand_Name: "Resumeg-10",
        Medicine_Name: "Resumeg-10",
        Generic_Name: "Rosuvastatin 10 Tablet",
        Composition: "Rosuvastatin 10 Tablet",
        Strength: "10mg",
        Dosage_Form: "tablet",
        Pack_Size: "10",
        Manufacturer: "Salus Pharmaceuticals",
      },
      { Brand_Name: "", Medicine_Name: "", Generic_Name: "" }, // blank separator row
    ];

    const res = await service.bulkImport(sheet1Rows as any, "u");
    expect(res.errors).toHaveLength(0);
    expect(res.created).toBe(2);
    expect(created[0].name).toBe("Flowyou Eye Drops");
    expect(created[0].genericName).toBe("Moxifloxacin");
    expect(created[1].name).toBe("Resumeg-10");
    expect(created[1].manufacturer).toBe("Salus Pharmaceuticals");
  });

  it("imports Sheet 2 (gid=43138005) 25-column rows with Drawer Mapping cleanly", async () => {
    const { service, created } = importStub();
    const sheet2Rows = [
      {
        Medicine_ID: "MED00001",
        "Drawer Mapping": "Cabinet A-1",
        Brand_Name: "Emgrast",
        Medicine_Name: "Emgrast 300 mcg Injection",
        Generic_Name: "Filgrastim",
        Composition: "Filgrastim (G-CSF) 300 mcg",
        Strength: "300 mcg",
        Dosage_Form: "Injection",
        Pack_Size: "1 Vial",
        Manufacturer: "Eris Lifesciences Ltd",
        Therapeutic_Class: "Colony Stimulating Factor",
        Category: "Oncology",
        Schedule: "H",
        GST_Percent: "5",
        HSN_Code: "30049099",
        MRP: "34866.11",
        Purchase_Rate: "25397.48",
        Barcode: "8900000079193",
        Batch_No: "JV17827",
        Manufacture_Date: "2025-03-07",
        Expiry_Date: "2027-09-28",
        Stock: "389",
        Minimum_Stock: "15",
        Location: "Injection Rack IV-3, Shelf 3",
        Supplier: "Himalayan Healthcare Distributors, Siliguri",
      },
    ];

    const res = await service.bulkImport(sheet2Rows as any, "u");
    expect(res.errors).toHaveLength(0);
    expect(res.created).toBe(1);
    expect(created[0].sku).toBe("MED00001");
    expect(created[0].drawerMapping).toBe("Cabinet A-1");
    expect(created[0].brandName).toBe("Emgrast");
    expect(created[0].name).toBe("Emgrast 300 mcg Injection");
    expect(created[0].priceMrp).toBe("34866.11");
    expect(created[0].purchaseRate).toBe("25397.48");
    expect(res.batchesCreated).toBe(1);
  });
});
