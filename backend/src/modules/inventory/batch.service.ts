import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { BatchRepository } from "./batch.repository";
import { StockMovementRepository } from "./stock-movement.repository";
import { InventoryRepository } from "./inventory.repository";
import type {
  CreateBatchDto,
  UpdateBatchDto,
  UpdateBatchStatusDto,
  AdjustBatchQuantityDto,
  QueryBatchDto,
  OtcSupplyBatchDto,
} from "@pharmerp/types";
import { BarcodeService } from "./barcode.service";
import { assertBranchAccess } from "../../common/auth/branch-scope";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";

@Injectable()
export class BatchService {
  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
    private readonly inventoryRepo: InventoryRepository,
    private readonly barcodeService: BarcodeService,
  ) {}

  /**
   * Loads a batch and refuses it if it belongs to another branch.
   *
   * Every by-id route here takes a bare UUID, and a batch id is not a secret —
   * it is returned by list endpoints and printed on labels. Without this check
   * a shop manager could read another branch's cost prices, and worse, write:
   * adjust its quantity, quarantine or recall it, reserve it, or delete it.
   *
   * Made the only way to load a batch by id rather than a check each method
   * remembers to make, so a route added later inherits the guard.
   */
  private async loadOwnedBatch(id: string, user: JwtPayload) {
    const batch = await this.batchRepo.findBatchById(id);
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);
    assertBranchAccess(user, batch.branchId);
    return batch;
  }

  findAll(query: QueryBatchDto) {
    return this.batchRepo.findBatches(query);
  }

  async findOne(id: string, user: JwtPayload) {
    const batch = await this.loadOwnedBatch(id, user);
    return { data: batch };
  }

  async create(dto: CreateBatchDto, userId?: string, branchId?: string) {
    // Verify medicine exists
    const medicine = await this.inventoryRepo.findMedicineById(dto.medicineId);
    if (!medicine) {
      throw new NotFoundException(`Medicine ${dto.medicineId} not found`);
    }

    // Stock cannot exist outside a branch. The caller resolves this through
    // requireBranchScope, so a branch user always has one and a super_admin is
    // forced to name the branch rather than have one guessed for them.
    const resolvedBranchId = branchId ?? dto.branchId;
    if (!resolvedBranchId) {
      throw new UnprocessableEntityException(
        "branchId is required — a batch must belong to a branch.",
      );
    }

    // Shelf is cosmetic for ownership now, but staff still need somewhere to
    // physically find the pack, so fall back to the branch's default shelf.
    let resolvedLocationId = dto.locationId;
    if (!resolvedLocationId) {
      resolvedLocationId =
        await this.batchRepo.findOrCreateDefaultLocationForBranch(resolvedBranchId);
    }

    // Cost price is optional on the way in: a pack routinely reaches the shelf
    // before its invoice does. inventory_batches.cost_price is NOT NULL and
    // feeds stock valuation, so an omitted cost falls back to the medicine's
    // catalogue purchase rate, then to the batch MRP — the same ladder the CSV
    // import walks. Only a medicine with neither lands at zero.
    const costPrice =
      dto.costPrice ?? medicine.purchaseRate ?? dto.mrpAtEntry ?? "0";

    const batch = await this.batchRepo.createBatch({
      ...dto,
      costPrice,
      branchId: resolvedBranchId,
      resolvedLocationId,
    });

    // If the medicine was inactive (no MRP set during CSV import) and this
    // batch carries a valid MRP, promote it: set the medicine's priceMrp and
    // flip isActive so it becomes sellable through the POS without a separate
    // edit step.
    const batchMrp = parseFloat(dto.mrpAtEntry ?? "0");
    if (!medicine.isActive && batchMrp > 0) {
      await this.inventoryRepo.updateMedicine(medicine.id, {
        priceMrp: batchMrp.toFixed(2),
        isActive: true,
      });
    }

    // Log the inbound stock movement
    await this.movementRepo.log({
      batchId: batch.id,
      medicineId: dto.medicineId,
      branchId: resolvedBranchId,
      movementType: "purchase",
      quantity: dto.quantity,
      performedBy: userId,
      notes: `Initial batch receipt — batch no. ${dto.batchNo}`,
    });

    return { data: batch, message: "Batch created" };
  }

  async update(id: string, dto: UpdateBatchDto, user: JwtPayload) {
    await this.loadOwnedBatch(id, user);
    const batch = await this.batchRepo.updateBatch(id, dto);
    return { data: batch, message: "Batch updated" };
  }

  async updateStatus(id: string, dto: UpdateBatchStatusDto, user: JwtPayload) {
    const existing = await this.loadOwnedBatch(id, user);
    const userId = user.sub;

    const batch = await this.batchRepo.updateBatchStatus(id, dto.status);

    if (dto.status === "expired" || dto.status === "recalled") {
      await this.movementRepo.log({
        batchId: id,
        medicineId: existing.medicineId,
        // The movement inherits the batch's branch — stock cannot leave a
        // branch it was never in.
        branchId: existing.branchId,
        movementType: "expiry_write_off",
        quantity: -existing.quantity,
        performedBy: userId,
        notes: dto.notes ?? `Status changed to ${dto.status}`,
      });
    }

    return { data: batch, message: "Batch status updated" };
  }

  /**
   * Manual stock adjustment (inventory count correction).
   * Logs the delta as an audit movement.
   */
  async adjust(
    id: string,
    dto: AdjustBatchQuantityDto,
    user: JwtPayload,
  ) {
    const existing = await this.loadOwnedBatch(id, user);
    const userId = user.sub;

    if (dto.adjustment < 0 && existing.quantity + dto.adjustment < 0) {
      throw new UnprocessableEntityException(
        `Cannot reduce below zero. Current: ${existing.quantity}`,
      );
    }

    const updated = await this.batchRepo.adjustQuantity(id, dto.adjustment);
    if (!updated) {
      throw new UnprocessableEntityException("Adjustment failed — stock guard prevented it");
    }

    await this.movementRepo.log({
      batchId: id,
      medicineId: existing.medicineId,
      branchId: existing.branchId,
      movementType: "adjustment",
      quantity: dto.adjustment,
      performedBy: userId,
      notes: dto.notes,
    });

    return { data: updated, message: "Stock adjusted" };
  }

  /**
   * OTC supply — a medicine handed over from the counter without an invoice.
   * Decrements the batch (atomic, guarded against negative stock) and logs a
   * ledger movement so the supply stays traceable. No bill is generated.
   */
  async recordOtcSupply(
    id: string,
    dto: OtcSupplyBatchDto,
    user: JwtPayload,
  ) {
    const existing = await this.loadOwnedBatch(id, user);
    const userId = user.sub;

    if (dto.quantity > existing.quantity) {
      throw new UnprocessableEntityException(
        `Only ${existing.quantity} units available on batch ${existing.batchNo}`,
      );
    }

    const updated = await this.batchRepo.adjustQuantity(id, -dto.quantity);
    if (!updated) {
      throw new UnprocessableEntityException(
        "Supply failed — stock guard prevented it. Refresh and try again.",
      );
    }

    await this.movementRepo.log({
      batchId: id,
      medicineId: existing.medicineId,
      branchId: existing.branchId,
      movementType: "otc_supply",
      quantity: -dto.quantity,
      performedBy: userId,
      notes: dto.notes ?? "OTC supply without billing",
    });

    return {
      data: {
        batchId: id,
        batchNo: existing.batchNo,
        quantitySupplied: dto.quantity,
        remainingQuantity: updated.quantity,
      },
      message: "OTC supply recorded — stock updated, no bill generated.",
    };
  }

  async remove(id: string, user: JwtPayload) {
    await this.loadOwnedBatch(id, user);

    const hasMovements = await this.batchRepo.hasMovements(id);
    if (hasMovements) {
      throw new UnprocessableEntityException(
        "Cannot delete a batch that has stock movement history. Set its status to \"recalled\" or \"depleted\" instead.",
      );
    }

    await this.batchRepo.deleteBatch(id);
    return { message: "Batch deleted" };
  }

  async getExpiringBatches(days: number, branchId?: string) {
    const batches = await this.batchRepo.findExpiringBatches(days, branchId);
    return { data: batches };
  }

  async getMovements(batchId: string, user: JwtPayload) {
    await this.loadOwnedBatch(batchId, user);
    const movements = await this.movementRepo.findByBatch(batchId);
    return { data: movements };
  }

  async reserveStock(id: string, quantity: number, user: JwtPayload) {
    await this.loadOwnedBatch(id, user);
    const updated = await this.batchRepo.reserveStock(id, quantity);
    return { data: updated, message: "Stock reserved" };
  }

  async releaseStock(id: string, quantity: number, user: JwtPayload) {
    await this.loadOwnedBatch(id, user);
    const updated = await this.batchRepo.releaseStock(id, quantity);
    return { data: updated, message: "Stock reservation released" };
  }

  async getBarcodeLabel(id: string, user: JwtPayload) {
    const batch = await this.loadOwnedBatch(id, user);

    const code = batch.batchNo;
    const pngBuffer = await this.barcodeService.generateRaw(code);
    const base64Image = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    return {
      data: {
        batchId: batch.id,
        batchNo: batch.batchNo,
        medicineName: (batch as any).medicine?.name ?? "Medicine",
        brandName: (batch as any).medicine?.brandName ?? (batch as any).medicine?.name ?? "",
        expiryDate: batch.expiryDate,
        mrpAtEntry: batch.mrpAtEntry,
        barcodeBase64: base64Image,
      },
    };
  }
}
