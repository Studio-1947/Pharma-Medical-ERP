try {
  require("dotenv/config");
} catch {
  // Environment variables are injected directly in Cloud Run
}
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
  const [rkmcHash, adminHash, shopHash, doctorHash] = await Promise.all([
    argon2.hash("RadhaMadhav@123"),
    argon2.hash("Admin@123"),
    argon2.hash("Shop@123"),
    argon2.hash("Doctor@123"),
  ]);

  // 3. Users
  console.log("Inserting users...");
  const usersData = [
    {
      email: "rkmc@email.com",
      passwordHash: rkmcHash,
      role: "super_admin" as const,
      branchId: null,
    },
    {
      email: "admin@mederp.com",
      passwordHash: adminHash,
      role: "super_admin" as const,
      branchId: null,
    },
    {
      email: "shopmanager@mederp.com",
      passwordHash: shopHash,
      role: "shop_manager" as const,
      branchId: brn01.id,
    },
    {
      email: "shopmanager2@mederp.com",
      passwordHash: shopHash,
      role: "shop_manager" as const,
      branchId: brn02.id,
    },
    {
      email: "doctor@mederp.com",
      passwordHash: doctorHash,
      firstName: "Anjali",
      lastName: "Rao",
      role: "doctor" as const,
      branchId: brn01.id,
      doctorProfile: {
        specialty: "General Medicine",
        consultationFee: 400,
        opdRoom: "OPD-1",
      },
    },
    {
      email: "vikram.singh@mederp.com",
      passwordHash: doctorHash,
      firstName: "Vikram",
      lastName: "Singh",
      role: "doctor" as const,
      branchId: brn01.id,
      doctorProfile: {
        specialty: "Cardiology",
        consultationFee: 700,
        opdRoom: "OPD-2",
      },
    },
    {
      email: "priya.menon@mederp.com",
      passwordHash: doctorHash,
      firstName: "Priya",
      lastName: "Menon",
      role: "doctor" as const,
      branchId: brn01.id,
      doctorProfile: {
        specialty: "Pediatrics",
        consultationFee: 500,
        opdRoom: "OPD-3",
      },
    },
  ];

  await db.insert(schema.users).values(usersData).onConflictDoNothing();

  // Backfill doctorProfile on existing rows in case seed ran previously
  // without profiles. onConflictDoNothing above only inserts new rows.
  const doctorRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, "doctor"));
  for (const doc of doctorRows) {
    if (doc.doctorProfile) continue;
    const seeded = usersData.find(
      (u) => u.email === doc.email && u.role === "doctor",
    ) as { doctorProfile?: Record<string, unknown> } | undefined;
    if (seeded?.doctorProfile) {
      await db
        .update(schema.users)
        .set({ doctorProfile: seeded.doctorProfile })
        .where(eq(schema.users.id, doc.id));
    }
  }

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

  // 7. Doctor medicines — each doctor's preferred formulary.
  // Uses SKUs seeded above (MED-001..MED-020) to keep the mapping declarative.
  console.log("Inserting doctor medicines...");
  const allMedicines = await db.select().from(schema.medicines);
  const medBySku = new Map(allMedicines.map((m) => [m.sku, m]));

  const allDoctors = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, "doctor"));
  const doctorByEmail = new Map(allDoctors.map((d) => [d.email, d]));

  const preferredBySpecialty: Record<
    string,
    Array<{ sku: string; dosage?: string; frequency?: string; duration?: string; qty?: number }>
  > = {
    "doctor@mederp.com": [
      // General Medicine — everyday complaints
      { sku: "MED-001", dosage: "500mg", frequency: "1-0-1", duration: "3 days", qty: 6 },
      { sku: "MED-003", dosage: "10mg", frequency: "0-0-1", duration: "5 days", qty: 5 },
      { sku: "MED-004", dosage: "10ml", frequency: "1-1-1", duration: "5 days", qty: 1 },
      { sku: "MED-008", dosage: "500mg", frequency: "1-0-1", duration: "5 days", qty: 10 },
      { sku: "MED-012", dosage: "20mg", frequency: "1-0-0", duration: "7 days", qty: 7 },
    ],
    "vikram.singh@mederp.com": [
      // Cardiology
      { sku: "MED-010", dosage: "500mg", frequency: "1-0-1", duration: "30 days", qty: 30 },
      { sku: "MED-011", dosage: "50mg", frequency: "1-0-0", duration: "30 days", qty: 30 },
      { sku: "MED-012", dosage: "20mg", frequency: "1-0-0", duration: "30 days", qty: 30 },
      { sku: "MED-005", dosage: "500mg", frequency: "0-1-0", duration: "30 days", qty: 30 },
    ],
    "priya.menon@mederp.com": [
      // Pediatrics
      { sku: "MED-001", dosage: "125mg", frequency: "1-1-1", duration: "3 days", qty: 3 },
      { sku: "MED-003", dosage: "5mg", frequency: "0-0-1", duration: "5 days", qty: 5 },
      { sku: "MED-004", dosage: "5ml", frequency: "1-1-1", duration: "5 days", qty: 1 },
      { sku: "MED-006", dosage: "400IU", frequency: "1-0-0", duration: "30 days", qty: 30 },
      { sku: "MED-007", dosage: "250mg", frequency: "1-0-1", duration: "30 days", qty: 30 },
    ],
  };

  const doctorMedRows: Array<typeof schema.doctorMedicines.$inferInsert> = [];
  for (const [email, meds] of Object.entries(preferredBySpecialty)) {
    const doc = doctorByEmail.get(email);
    if (!doc) continue;
    meds.forEach((m, index) => {
      const med = medBySku.get(m.sku);
      if (!med) return;
      doctorMedRows.push({
        doctorId: doc.id,
        medicineId: med.id,
        defaultDosage: m.dosage,
        defaultFrequency: m.frequency,
        defaultDuration: m.duration,
        defaultQuantity: m.qty ?? null,
        sortOrder: index,
        createdBy: doc.id,
      });
    });
  }

  if (doctorMedRows.length > 0) {
    await db
      .insert(schema.doctorMedicines)
      .values(doctorMedRows)
      .onConflictDoNothing();
  }

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
