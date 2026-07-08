import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryRepository } from "./inventory.repository";
import { createMedicineSchema } from "@pharmerp/types";
import type { CreateMedicineDto, UpdateMedicineDto, QueryMedicineDto } from "@pharmerp/types";

@Injectable()
export class InventoryService {
  constructor(private readonly repo: InventoryRepository) {}

  findAll(query: QueryMedicineDto) {
    return this.repo.findMedicinesPaginated(query);
  }

  async findOne(id: string) {
    const medicine = await this.repo.findMedicineById(id);
    if (!medicine) throw new NotFoundException(`Medicine ${id} not found`);
    return { data: medicine };
  }

  /** Exact-match barcode lookup for POS/inventory scanning — uses the
   *  medicines_barcode_idx index (O(log n)), unlike the fuzzy `findAll` search. */
  async getByBarcode(code: string) {
    const medicine = await this.repo.findActiveByBarcode(code);
    return { data: medicine ?? null };
  }

  async create(dto: CreateMedicineDto, userId?: string) {
    await this.assertBarcodeUnique(dto.barcode);
    try {
      const medicine = await this.repo.createMedicine(dto, userId);
      return { data: medicine, message: "Medicine created" };
    } catch (e) {
      throw this.mapBarcodeConflict(e, dto.barcode);
    }
  }

  async update(id: string, dto: UpdateMedicineDto) {
    await this.findOne(id);
    await this.assertBarcodeUnique(dto.barcode, id);
    try {
      const medicine = await this.repo.updateMedicine(id, dto);
      return { data: medicine, message: "Medicine updated" };
    } catch (e) {
      throw this.mapBarcodeConflict(e, dto.barcode);
    }
  }

  /** A barcode shared by two medicines would let a POS scan dispense the wrong product. */
  private async assertBarcodeUnique(barcode?: string, excludeId?: string) {
    if (!barcode) return;
    const existing = await this.repo.findMedicineByBarcode(barcode, excludeId);
    if (existing) {
      throw new ConflictException(
        `Barcode ${barcode} is already assigned to "${existing.name}" (SKU ${existing.sku})`,
      );
    }
  }

  /** Backstop for the check-then-insert race: the DB partial-unique index throws
   *  23505; turn that into the same clean 409 instead of a generic 500. */
  private mapBarcodeConflict(e: unknown, barcode?: string): never {
    const err = e as { code?: string; cause?: { code?: string }; message?: string };
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505" && /barcode/i.test(err?.message ?? "")) {
      throw new ConflictException(`Barcode ${barcode ?? ""} is already assigned to another medicine`);
    }
    throw e as Error;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.softDeleteMedicine(id);
    return { message: "Medicine deleted" };
  }

  async bulkImport(
    rawRows: Record<string, string>[],
    userId?: string,
  ): Promise<{ created: number; skipped: number; errors: { row: number; sku: string; reason: string }[] }> {
    const errors: { row: number; sku: string; reason: string }[] = [];
    const valid: CreateMedicineDto[] = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const rowNum = i + 2; // 1-indexed + header row
      if (!raw) continue;
      const sku = (raw.sku ?? "").trim();

      if (!sku) { errors.push({ row: rowNum, sku: "", reason: "SKU is required" }); continue; }
      if (seenSkus.has(sku)) { errors.push({ row: rowNum, sku, reason: "Duplicate SKU in file" }); continue; }
      seenSkus.add(sku);

      const rowBarcode = raw.barcode?.trim();
      if (rowBarcode) {
        if (seenBarcodes.has(rowBarcode)) {
          errors.push({ row: rowNum, sku, reason: `Duplicate barcode in file: ${rowBarcode}` });
          continue;
        }
        seenBarcodes.add(rowBarcode);
      }

      const parsed = createMedicineSchema.safeParse({
        name: raw.name?.trim(),
        genericName: raw.generic_name?.trim() || undefined,
        sku,
        barcode: raw.barcode?.trim() || undefined,
        manufacturer: raw.manufacturer?.trim() || undefined,
        hsnCode: raw.hsn_code?.trim() || undefined,
        unit: raw.unit?.trim() || "strip",
        stripSize: raw.strip_size ? Number(raw.strip_size) : 1,
        priceMrp: raw.price_mrp?.trim(),
        taxPercent: raw.tax_percent?.trim() || "0",
        reorderLevel: raw.reorder_level ? Number(raw.reorder_level) : 10,
        reorderQty: raw.reorder_qty ? Number(raw.reorder_qty) : 50,
        requiresPrescription: raw.requires_prescription?.toLowerCase() === "true",
        isControlled: raw.is_controlled?.toLowerCase() === "true",
        scheduleClass: raw.schedule_class?.trim() || undefined,
        storageConditions: raw.storage_conditions?.trim() || undefined,
        description: raw.description?.trim() || undefined,
      });

      if (!parsed.success) {
        const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        errors.push({ row: rowNum, sku, reason: msg });
      } else {
        valid.push(parsed.data);
      }
    }

    if (valid.length === 0) return { created: 0, skipped: 0, errors };

    const [existingSkus, existingBarcodes] = await Promise.all([
      this.repo.findSkuSet(valid.map((r) => r.sku)),
      this.repo.findBarcodeSet(valid.map((r) => r.barcode).filter((b): b is string => !!b)),
    ]);
    const toInsert = valid.filter(
      (r) => !existingSkus.has(r.sku) && !(r.barcode && existingBarcodes.has(r.barcode)),
    );
    const skipped = valid.length - toInsert.length;

    for (const r of valid.filter((r) => existingSkus.has(r.sku))) {
      errors.push({ row: 0, sku: r.sku, reason: "SKU already exists — skipped" });
    }
    for (const r of valid.filter((r) => !existingSkus.has(r.sku) && r.barcode && existingBarcodes.has(r.barcode))) {
      errors.push({ row: 0, sku: r.sku, reason: `Barcode ${r.barcode} already exists — skipped` });
    }

    const created = await this.repo.bulkCreateMedicines(toInsert, userId);
    return { created, skipped, errors };
  }

  getLowStock() {
    return this.repo.getLowStockMedicines();
  }

  getBatchesForDispense(medicineId: string) {
    return this.repo.getActiveBatchesForDispense(medicineId);
  }

  getStockValuation(warehouseId?: string) {
    return this.repo.getStockValuation(warehouseId);
  }
}
