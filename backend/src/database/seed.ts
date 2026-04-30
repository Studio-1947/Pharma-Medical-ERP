import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("Seeding database...");

  // 1. Branches
  console.log("Inserting branches...");
  const branchesData = [
    {
      name: "Main Branch",
      code: "BRN01",
      address: "123 Main Street, Mumbai",
      phone: "022-12345678",
      email: "main@mederp.com",
      isHeadOffice: true,
    },
    {
      name: "Branch 2",
      code: "BRN02",
      address: "456 Second Avenue, Mumbai",
      phone: "022-87654321",
      email: "branch2@mederp.com",
      isHeadOffice: false,
    },
  ];

  await db.insert(schema.branches).values(branchesData).onConflictDoNothing();

  const allBranches = await db.select().from(schema.branches);
  const brn01 = allBranches.find((b) => b.code === "BRN01")!;
  const brn02 = allBranches.find((b) => b.code === "BRN02")!;

  // 2. Hash passwords
  console.log("Hashing passwords...");
  const [adminHash, pharmHash, cashHash, invHash] = await Promise.all([
    argon2.hash("Admin@123"),
    argon2.hash("Pharm@123"),
    argon2.hash("Cash@123"),
    argon2.hash("Inv@123"),
  ]);

  // 3. Users
  console.log("Inserting users...");
  const usersData = [
    {
      email: "admin@mederp.com",
      passwordHash: adminHash,
      role: "super_admin" as const,
      branchId: null,
    },
    {
      email: "pharmacist@mederp.com",
      passwordHash: pharmHash,
      role: "pharmacist" as const,
      branchId: brn01.id,
    },
    {
      email: "cashier@mederp.com",
      passwordHash: cashHash,
      role: "cashier" as const,
      branchId: brn01.id,
    },
    {
      email: "inventory@mederp.com",
      passwordHash: invHash,
      role: "inventory_manager" as const,
      branchId: brn02.id,
    },
  ];

  await db.insert(schema.users).values(usersData).onConflictDoNothing();

  // 4. Medicine categories
  console.log("Inserting categories...");
  const categoriesData = [
    { name: "Antibiotics", description: "Drugs that inhibit the growth of or destroy microorganisms" },
    { name: "Analgesics", description: "Pain relievers" },
    { name: "Antacids", description: "Drugs that neutralize stomach acid" },
    { name: "Vitamins", description: "Organic compounds essential for normal growth and nutrition" },
    { name: "Cardiovascular", description: "Drugs related to the heart and blood vessels" },
  ];

  await db.insert(schema.medicineCategories).values(categoriesData).onConflictDoNothing();
  const allCats = await db.select().from(schema.medicineCategories);

  const getCatId = (name: string) => allCats.find((c) => c.name === name)?.id;

  // 5. Medicines
  console.log("Inserting medicines...");
  const medicinesData = [
    // OTC
    { name: "Paracetamol 500mg", sku: "MED-001", categoryId: getCatId("Analgesics"), priceMrp: "45.00", taxPercent: "12", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Ibuprofen 400mg", sku: "MED-002", categoryId: getCatId("Analgesics"), priceMrp: "65.00", taxPercent: "12", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Cipla", unit: "strip" },
    { name: "Cetirizine 10mg", sku: "MED-003", categoryId: getCatId("Antihistamine"), priceMrp: "35.00", taxPercent: "12", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Antacid Syrup", sku: "MED-004", categoryId: getCatId("Antacids"), priceMrp: "120.00", taxPercent: "5", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Cipla", unit: "bottle" },
    { name: "Vitamin C 500mg", sku: "MED-005", categoryId: getCatId("Vitamins"), priceMrp: "80.00", taxPercent: "5", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Vitamin D3", sku: "MED-006", categoryId: getCatId("Vitamins"), priceMrp: "150.00", taxPercent: "5", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Cipla", unit: "strip" },
    { name: "Calcium Carbonate", sku: "MED-007", categoryId: getCatId("Vitamins"), priceMrp: "90.00", taxPercent: "5", scheduleClass: "OTC", requiresPrescription: false, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    // Schedule H
    { name: "Amoxicillin 500mg", sku: "MED-008", categoryId: getCatId("Antibiotics"), priceMrp: "180.00", taxPercent: "12", scheduleClass: "H", requiresPrescription: true, isControlled: false, manufacturer: "Cipla", unit: "strip" },
    { name: "Azithromycin 500mg", sku: "MED-009", categoryId: getCatId("Antibiotics"), priceMrp: "250.00", taxPercent: "12", scheduleClass: "H", requiresPrescription: true, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Metformin 500mg", sku: "MED-010", categoryId: getCatId("Cardiovascular"), priceMrp: "75.00", taxPercent: "12", scheduleClass: "H", requiresPrescription: true, isControlled: false, manufacturer: "Cipla", unit: "strip" },
    { name: "Atenolol 50mg", sku: "MED-011", categoryId: getCatId("Cardiovascular"), priceMrp: "110.00", taxPercent: "12", scheduleClass: "H", requiresPrescription: true, isControlled: false, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Omeprazole 20mg", sku: "MED-012", categoryId: getCatId("Antacids"), priceMrp: "140.00", taxPercent: "12", scheduleClass: "H", requiresPrescription: true, isControlled: false, manufacturer: "Cipla", unit: "strip" },
    // Schedule H1
    { name: "Tramadol 50mg", sku: "MED-013", categoryId: getCatId("Analgesics"), priceMrp: "220.00", taxPercent: "12", scheduleClass: "H1", requiresPrescription: true, isControlled: true, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Alprazolam 0.5mg", sku: "MED-014", categoryId: getCatId("Analgesics"), priceMrp: "190.00", taxPercent: "12", scheduleClass: "H1", requiresPrescription: true, isControlled: true, manufacturer: "Cipla", unit: "strip" },
    { name: "Diazepam 5mg", sku: "MED-015", categoryId: getCatId("Analgesics"), priceMrp: "160.00", taxPercent: "12", scheduleClass: "H1", requiresPrescription: true, isControlled: true, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Clonazepam 0.5mg", sku: "MED-016", categoryId: getCatId("Analgesics"), priceMrp: "210.00", taxPercent: "12", scheduleClass: "H1", requiresPrescription: true, isControlled: true, manufacturer: "Cipla", unit: "strip" },
    // Schedule X
    { name: "Morphine 10mg Injection", sku: "MED-017", categoryId: getCatId("Analgesics"), priceMrp: "450.00", taxPercent: "12", scheduleClass: "X", requiresPrescription: true, isControlled: true, manufacturer: "Sun Pharma", unit: "vial" },
    { name: "Fentanyl 50mcg Patch", sku: "MED-018", categoryId: getCatId("Analgesics"), priceMrp: "500.00", taxPercent: "12", scheduleClass: "X", requiresPrescription: true, isControlled: true, manufacturer: "Cipla", unit: "patch" },
    { name: "Buprenorphine 0.4mg", sku: "MED-019", categoryId: getCatId("Analgesics"), priceMrp: "380.00", taxPercent: "12", scheduleClass: "X", requiresPrescription: true, isControlled: true, manufacturer: "Sun Pharma", unit: "strip" },
    { name: "Oxycodone 10mg", sku: "MED-020", categoryId: getCatId("Analgesics"), priceMrp: "420.00", taxPercent: "12", scheduleClass: "X", requiresPrescription: true, isControlled: true, manufacturer: "Cipla", unit: "strip" },
  ];

  await db.insert(schema.medicines).values(medicinesData).onConflictDoNothing();

  // 6. Suppliers
  console.log("Inserting suppliers...");
  const suppliersData = [
    {
      name: "Global Pharma Distributors",
      code: "SUP-001",
      contactPerson: "John Doe",
      phone: "9876543210",
      email: "sales@globalpharma.com",
      address: "Industrial Area, Mumbai",
      gstNo: "27AAAAA0000A1Z5",
      creditDays: 30,
      creditLimit: "500000.00",
    },
    {
      name: "Apex Healthcare Supplies",
      code: "SUP-002",
      contactPerson: "Jane Smith",
      phone: "9123456789",
      email: "contact@apexhealth.com",
      address: "Bandra Kurla Complex, Mumbai",
      gstNo: "27BBBBB1111B1Z5",
      creditDays: 45,
      creditLimit: "1000000.00",
    },
  ];

  await db.insert(schema.suppliers).values(suppliersData).onConflictDoNothing();

  console.log("Seed complete.");
}

seed()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
