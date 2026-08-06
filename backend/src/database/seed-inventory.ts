try {
  require("dotenv/config");
} catch {
  // Environment variables are injected directly in Cloud Run
}
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });

export async function runInventorySeed(dbInstance?: any) {
  const targetDb = dbInstance ?? db;
  console.log("=========================================");
  console.log("  SEEDING MEDICINE CATALOG & INVENTORY   ");
  console.log("=========================================\n");

  // 1. Ensure Branches Exist
  let branches = await targetDb.select().from(schema.branches);
  if (branches.length === 0) {
    console.log("No branches found. Inserting default branches...");
    await targetDb.insert(schema.branches).values([
      { name: "Main Branch", code: "BRN01", address: "123 Main Street, Mumbai", phone: "022-12345678", email: "main@pharmerp.com", isHeadOffice: true },
      { name: "Branch 2", code: "BRN02", address: "456 Second Avenue, Mumbai", phone: "022-87654321", email: "branch2@pharmerp.com", isHeadOffice: false },
    ]).onConflictDoNothing();
    branches = await targetDb.select().from(schema.branches);
  }

  const brn01 = branches.find((b: any) => b.code === "BRN01") ?? branches[0]!;
  const brn02 = branches.find((b: any) => b.code === "BRN02") ?? branches[1] ?? brn01;

  console.log(`Using Branches: ${brn01.name} (${brn01.code}) & ${brn02.name} (${brn02.code})`);

  // 2. Ensure Storage Locations
  console.log("\n1. Seeding Storage Locations...");
  const locationsData = [
    { branchId: brn01.id, aisle: "A", shelf: "1", bin: "1", label: "Rack A-1 (Main Till)", isRefrigerated: false },
    { branchId: brn01.id, aisle: "B", shelf: "2", bin: "1", label: "Cold Storage B-2", isRefrigerated: true },
    { branchId: brn02.id, aisle: "A", shelf: "1", bin: "1", label: "Branch 2 Storage Shelf A-1", isRefrigerated: false },
  ];

  for (const loc of locationsData) {
    const [existing] = await targetDb
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(and(eq(schema.storageLocations.branchId, loc.branchId), eq(schema.storageLocations.label, loc.label)))
      .limit(1);

    if (!existing) {
      await targetDb.insert(schema.storageLocations).values(loc);
    }
  }

  const allLocations = await targetDb.select().from(schema.storageLocations);
  const mainLocation = allLocations.find((l: any) => l.branchId === brn01.id) ?? allLocations[0]!;
  const coldLocation = allLocations.find((l: any) => l.isRefrigerated) ?? mainLocation;
  const brn02Location = allLocations.find((l: any) => l.branchId === brn02.id) ?? mainLocation;

  // 3. Medicine Categories
  console.log("2. Seeding Medicine Categories...");
  const categoriesData = [
    { name: "Antibiotics", description: "Broad and narrow spectrum anti-infective medications" },
    { name: "Analgesics & Antipyretics", description: "Pain relievers and fever reducers" },
    { name: "Cardiovascular & Antihypertensives", description: "Heart health and blood pressure regulation" },
    { name: "Antidiabetics", description: "Blood sugar management medications" },
    { name: "Gastrointestinal & Antacids", description: "Acid reflux, ulcers, and digestive health" },
    { name: "Antihistamines & Allergy", description: "Allergy and symptom control" },
    { name: "Vitamins & Supplements", description: "Nutritional supplements and minerals" },
    { name: "Respiratory & Asthma", description: "Bronchodilators and respiratory therapeutics" },
  ];

  for (const cat of categoriesData) {
    await targetDb.insert(schema.medicineCategories).values(cat).onConflictDoNothing();
  }

  const categories = await targetDb.select().from(schema.medicineCategories);
  const getCatId = (name: string) => categories.find((c: any) => c.name === name)?.id;

  // 4. Comprehensive Medicines Catalog
  console.log("3. Seeding Medicines Catalog...");
  const medicinesCatalog = [
    // OTC Products
    {
      name: "Dolo 650mg Tablet",
      brandName: "Dolo",
      genericName: "Paracetamol 650mg",
      composition: "Paracetamol 650mg",
      strength: "650mg",
      dosageForm: "Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-DOLO-650",
      barcode: "8901234500018",
      categoryId: getCatId("Analgesics & Antipyretics"),
      manufacturer: "Micro Labs Ltd",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "34.00",
      purchaseRate: "24.00",
      taxPercent: "12.00",
      reorderLevel: 20,
      reorderQty: 100,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Rack A-1",
    },
    {
      name: "Combiflam Tablet",
      brandName: "Combiflam",
      genericName: "Ibuprofen 400mg + Paracetamol 325mg",
      composition: "Ibuprofen 400mg, Paracetamol 325mg",
      strength: "400mg/325mg",
      dosageForm: "Tablet",
      packSize: "20 Tablets per Strip",
      sku: "MED-COMBIFLAM",
      barcode: "8901234500025",
      categoryId: getCatId("Analgesics & Antipyretics"),
      manufacturer: "Sanofi India",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 20,
      priceMrp: "48.50",
      purchaseRate: "35.00",
      taxPercent: "12.00",
      reorderLevel: 25,
      reorderQty: 100,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Rack A-2",
    },
    {
      name: "Gelusil MPS Liquid 200ml",
      brandName: "Gelusil",
      genericName: "Aluminum Hydroxide + Magnesium Hydroxide + Simethicone",
      composition: "Aluminum Hydroxide 250mg, Magnesium Hydroxide 250mg, Simethicone 50mg",
      strength: "200ml",
      dosageForm: "Syrup",
      packSize: "1 Bottle 200ml",
      sku: "MED-GELUSIL-200ML",
      barcode: "8901234500032",
      categoryId: getCatId("Gastrointestinal & Antacids"),
      manufacturer: "Pfizer India",
      hsnCode: "30049099",
      unit: "bottle",
      stripSize: 1,
      priceMrp: "145.00",
      purchaseRate: "105.00",
      taxPercent: "12.00",
      reorderLevel: 10,
      reorderQty: 40,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Shelf B-1",
    },
    {
      name: "Allegra 120mg Tablet",
      brandName: "Allegra",
      genericName: "Fexofenadine Hydrochloride 120mg",
      composition: "Fexofenadine Hydrochloride 120mg",
      strength: "120mg",
      dosageForm: "Tablet",
      packSize: "10 Tablets per Strip",
      sku: "MED-ALLEGRA-120",
      barcode: "8901234500049",
      categoryId: getCatId("Antihistamines & Allergy"),
      manufacturer: "Sanofi India",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 10,
      priceMrp: "215.00",
      purchaseRate: "160.00",
      taxPercent: "12.00",
      reorderLevel: 15,
      reorderQty: 60,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Rack C-1",
    },
    {
      name: "Limcee 500mg Chewable Tablet",
      brandName: "Limcee",
      genericName: "Vitamin C (Ascorbic Acid) 500mg",
      composition: "Ascorbic Acid 500mg",
      strength: "500mg",
      dosageForm: "Chewable Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-LIMCEE-500",
      barcode: "8901234500056",
      categoryId: getCatId("Vitamins & Supplements"),
      manufacturer: "Abbott Healthcare",
      hsnCode: "30045020",
      unit: "strip",
      stripSize: 15,
      priceMrp: "25.50",
      purchaseRate: "18.00",
      taxPercent: "5.00",
      reorderLevel: 30,
      reorderQty: 150,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Rack A-3",
    },
    {
      name: "Evion 400mg Capsule",
      brandName: "Evion",
      genericName: "Vitamin E 400mg",
      composition: "Tocopheryl Acetate 400mg",
      strength: "400mg",
      dosageForm: "Softgel Capsule",
      packSize: "10 Capsules per Strip",
      sku: "MED-EVION-400",
      barcode: "8901234500063",
      categoryId: getCatId("Vitamins & Supplements"),
      manufacturer: "Procter & Gamble",
      hsnCode: "30045020",
      unit: "strip",
      stripSize: 10,
      priceMrp: "38.00",
      purchaseRate: "27.00",
      taxPercent: "5.00",
      reorderLevel: 20,
      reorderQty: 100,
      requiresPrescription: false,
      isControlled: false,
      scheduleClass: "OTC",
      drawerMapping: "Rack A-4",
    },

    // Schedule H Medicines
    {
      name: "Augmentin 625 Duo Tablet",
      brandName: "Augmentin",
      genericName: "Amoxicillin 500mg + Clavulanic Acid 125mg",
      composition: "Amoxicillin Trihydrate 500mg, Potassium Clavulanate 125mg",
      strength: "625mg",
      dosageForm: "Tablet",
      packSize: "10 Tablets per Strip",
      sku: "MED-AUGMENTIN-625",
      barcode: "8901234500070",
      categoryId: getCatId("Antibiotics"),
      manufacturer: "GlaxoSmithKline",
      hsnCode: "30041010",
      unit: "strip",
      stripSize: 10,
      priceMrp: "223.50",
      purchaseRate: "165.00",
      taxPercent: "12.00",
      reorderLevel: 15,
      reorderQty: 80,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack H-1",
    },
    {
      name: "Azee 500mg Tablet",
      brandName: "Azee",
      genericName: "Azithromycin 500mg",
      composition: "Azithromycin Dihydrate 500mg",
      strength: "500mg",
      dosageForm: "Tablet",
      packSize: "5 Tablets per Strip",
      sku: "MED-AZEE-500",
      barcode: "8901234500087",
      categoryId: getCatId("Antibiotics"),
      manufacturer: "Cipla Ltd",
      hsnCode: "30042010",
      unit: "strip",
      stripSize: 5,
      priceMrp: "119.00",
      purchaseRate: "88.00",
      taxPercent: "12.00",
      reorderLevel: 20,
      reorderQty: 100,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack H-2",
    },
    {
      name: "Pantocid 40mg Tablet",
      brandName: "Pantocid",
      genericName: "Pantoprazole 40mg",
      composition: "Pantoprazole Sodium 40mg",
      strength: "40mg",
      dosageForm: "Gastro-resistant Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-PANTOCID-40",
      barcode: "8901234500094",
      categoryId: getCatId("Gastrointestinal & Antacids"),
      manufacturer: "Sun Pharma",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "162.00",
      purchaseRate: "118.00",
      taxPercent: "12.00",
      reorderLevel: 25,
      reorderQty: 120,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack H-3",
    },
    {
      name: "Glycomet GP 2 Tablet",
      brandName: "Glycomet GP",
      genericName: "Glimepiride 2mg + Metformin Hydrochloride 500mg SR",
      composition: "Glimepiride 2mg, Metformin 500mg",
      strength: "2mg/500mg",
      dosageForm: "Sustained Release Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-GLYCOMET-GP2",
      barcode: "8901234500100",
      categoryId: getCatId("Antidiabetics"),
      manufacturer: "USV Pvt Ltd",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "185.00",
      purchaseRate: "135.00",
      taxPercent: "12.00",
      reorderLevel: 20,
      reorderQty: 100,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack D-1",
    },
    {
      name: "Telma 40mg Tablet",
      brandName: "Telma",
      genericName: "Telmisartan 40mg",
      composition: "Telmisartan 40mg",
      strength: "40mg",
      dosageForm: "Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-TELMA-40",
      barcode: "8901234500117",
      categoryId: getCatId("Cardiovascular & Antihypertensives"),
      manufacturer: "Glenmark Pharmaceuticals",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "142.00",
      purchaseRate: "102.00",
      taxPercent: "12.00",
      reorderLevel: 20,
      reorderQty: 100,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack C-2",
    },
    {
      name: "Atorva 10mg Tablet",
      brandName: "Atorva",
      genericName: "Atorvastatin 10mg",
      composition: "Atorvastatin Calcium 10mg",
      strength: "10mg",
      dosageForm: "Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-ATORVA-10",
      barcode: "8901234500124",
      categoryId: getCatId("Cardiovascular & Antihypertensives"),
      manufacturer: "Zydus Cadila",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "98.00",
      purchaseRate: "70.00",
      taxPercent: "12.00",
      reorderLevel: 15,
      reorderQty: 80,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack C-3",
    },
    {
      name: "Montair LC Tablet",
      brandName: "Montair LC",
      genericName: "Montelukast 10mg + Levocetirizine 5mg",
      composition: "Montelukast Sodium 10mg, Levocetirizine Dihydrochloride 5mg",
      strength: "10mg/5mg",
      dosageForm: "Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-MONTAIR-LC",
      barcode: "8901234500131",
      categoryId: getCatId("Respiratory & Asthma"),
      manufacturer: "Cipla Ltd",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "310.00",
      purchaseRate: "225.00",
      taxPercent: "12.00",
      reorderLevel: 15,
      reorderQty: 60,
      requiresPrescription: true,
      isControlled: false,
      scheduleClass: "H",
      drawerMapping: "Rack R-1",
    },

    // Schedule H1 Controlled Substances
    {
      name: "Alprax 0.5mg Tablet",
      brandName: "Alprax",
      genericName: "Alprazolam 0.5mg",
      composition: "Alprazolam 0.5mg",
      strength: "0.5mg",
      dosageForm: "Tablet",
      packSize: "15 Tablets per Strip",
      sku: "MED-ALPRAX-05",
      barcode: "8901234500148",
      categoryId: getCatId("Analgesics & Antipyretics"),
      manufacturer: "Torrent Pharmaceuticals",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 15,
      priceMrp: "65.00",
      purchaseRate: "46.00",
      taxPercent: "12.00",
      reorderLevel: 10,
      reorderQty: 50,
      requiresPrescription: true,
      isControlled: true,
      scheduleClass: "H1",
      drawerMapping: "Lockbox H1-1",
    },
    {
      name: "Tramazac 50mg Capsule",
      brandName: "Tramazac",
      genericName: "Tramadol Hydrochloride 50mg",
      composition: "Tramadol Hydrochloride 50mg",
      strength: "50mg",
      dosageForm: "Capsule",
      packSize: "10 Capsules per Strip",
      sku: "MED-TRAMAZAC-50",
      barcode: "8901234500155",
      categoryId: getCatId("Analgesics & Antipyretics"),
      manufacturer: "Zydus Cadila",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 10,
      priceMrp: "140.00",
      purchaseRate: "100.00",
      taxPercent: "12.00",
      reorderLevel: 10,
      reorderQty: 40,
      requiresPrescription: true,
      isControlled: true,
      scheduleClass: "H1",
      drawerMapping: "Lockbox H1-2",
    },

    // Schedule X Narcotic Substances
    {
      name: "Morphine Sulphate 10mg Tablet",
      brandName: "Morphine",
      genericName: "Morphine Sulphate 10mg",
      composition: "Morphine Sulphate 10mg",
      strength: "10mg",
      dosageForm: "Tablet",
      packSize: "10 Tablets per Strip",
      sku: "MED-MORPHINE-10",
      barcode: "8901234500162",
      categoryId: getCatId("Analgesics & Antipyretics"),
      manufacturer: "Government Opium & Alkaloid Works",
      hsnCode: "30049099",
      unit: "strip",
      stripSize: 10,
      priceMrp: "380.00",
      purchaseRate: "280.00",
      taxPercent: "12.00",
      reorderLevel: 5,
      reorderQty: 20,
      requiresPrescription: true,
      isControlled: true,
      scheduleClass: "X",
      drawerMapping: "Safe Vault X-1",
    },
  ];

  for (const medData of medicinesCatalog) {
    const [existing] = await db
      .select({ id: schema.medicines.id })
      .from(schema.medicines)
      .where(eq(schema.medicines.sku, medData.sku))
      .limit(1);

    if (!existing) {
      await targetDb.insert(schema.medicines).values(medData);
    } else {
      await targetDb.update(schema.medicines).set(medData).where(eq(schema.medicines.id, existing.id));
    }
  }

  const allMedicines = await targetDb.select().from(schema.medicines);
  console.log(`Total Medicines in Catalog: ${allMedicines.length}`);

  // 5. Multi-Batch Inventory Seeding (FEFO)
  console.log("\n4. Seeding FEFO Batches & Initial Stock...");

  const today = new Date();
  
  // Expiry date helpers
  const getFutureDateStr = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0]!;
  };

  let totalBatchesCreated = 0;

  for (const branch of [brn01, brn02]) {
    const loc = branch.code === "BRN01" ? mainLocation : brn02Location;

    for (let i = 0; i < allMedicines.length; i++) {
      const med = allMedicines[i]!;
      const isCold = med.name.toLowerCase().includes("vitamin") || med.dosageForm === "Syrup";
      const targetLocation = isCold && branch.code === "BRN01" ? coldLocation.id : loc.id;

      // 3 Batches per medicine: Near-Expiry, Main Active, Fresh Reserve
      const batchesConfig = [
        {
          batchNo: `BAT-${branch.code}-${String(i + 1).padStart(3, "0")}-NE`,
          expiryDate: getFutureDateStr(25), // Near expiry (<30 days)
          quantity: 30,
          costPrice: String((parseFloat(med.purchaseRate ?? "0") || parseFloat(med.priceMrp) * 0.7).toFixed(2)),
          mrpAtEntry: med.priceMrp,
          status: "active" as const,
        },
        {
          batchNo: `BAT-${branch.code}-${String(i + 1).padStart(3, "0")}-A1`,
          expiryDate: getFutureDateStr(365), // Active main batch (~1 year)
          quantity: 150,
          costPrice: String((parseFloat(med.purchaseRate ?? "0") || parseFloat(med.priceMrp) * 0.7).toFixed(2)),
          mrpAtEntry: med.priceMrp,
          status: "active" as const,
        },
        {
          batchNo: `BAT-${branch.code}-${String(i + 1).padStart(3, "0")}-F2`,
          expiryDate: getFutureDateStr(730), // Fresh reserve batch (~2 years)
          quantity: 300,
          costPrice: String((parseFloat(med.purchaseRate ?? "0") || parseFloat(med.priceMrp) * 0.7).toFixed(2)),
          mrpAtEntry: med.priceMrp,
          status: "active" as const,
        },
      ];

      for (const bCfg of batchesConfig) {
        const [existingBatch] = await db
          .select({ id: schema.inventoryBatches.id })
          .from(schema.inventoryBatches)
          .where(
            and(
              eq(schema.inventoryBatches.medicineId, med.id),
              eq(schema.inventoryBatches.batchNo, bCfg.batchNo),
              eq(schema.inventoryBatches.branchId, branch.id)
            )
          )
          .limit(1);

        let batchId: string;
        if (!existingBatch) {
          const [inserted] = await db
            .insert(schema.inventoryBatches)
            .values({
              medicineId: med.id,
              branchId: branch.id,
              locationId: targetLocation,
              batchNo: bCfg.batchNo,
              expiryDate: bCfg.expiryDate,
              quantity: bCfg.quantity,
              reservedQty: 0,
              costPrice: bCfg.costPrice,
              mrpAtEntry: bCfg.mrpAtEntry,
              status: bCfg.status,
            })
            .returning({ id: schema.inventoryBatches.id });
          batchId = inserted!.id;
          totalBatchesCreated++;
        } else {
          batchId = existingBatch.id;
        }

        // Log initial stock movement if not already logged
        const [existingMov] = await db
          .select({ id: schema.stockMovements.id })
          .from(schema.stockMovements)
          .where(and(eq(schema.stockMovements.batchId, batchId), eq(schema.stockMovements.movementType, "purchase")))
          .limit(1);

        if (!existingMov) {
          await targetDb.insert(schema.stockMovements).values({
            batchId,
            medicineId: med.id,
            branchId: branch.id,
            movementType: "purchase",
            quantity: bCfg.quantity,
            notes: `Initial stock seed for ${med.name} (Batch ${bCfg.batchNo})`,
          });
        }
      }
    }
  }

  console.log(`\n=========================================`);
  console.log(`  INVENTORY SEED COMPLETE               `);
  console.log(`  Medicines Processed: ${allMedicines.length}`);
  console.log(`  Batches Processed: ${totalBatchesCreated}`);
  console.log(`=========================================\n`);
}

if (require.main === module) {
  runInventorySeed()
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch((err: any) => {
      console.error("Inventory seed failed:", err);
      pool.end();
      process.exit(1);
    });
}
