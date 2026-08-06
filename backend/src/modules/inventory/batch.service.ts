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
} from "@pharmerp/types";

@Injectable()
export class BatchService {
  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
    private readonly inventoryRepo: InventoryRepository,
  ) {}

  findAll(query: QueryBatchDto) {
    return this.batchRepo.findBatches(query);
  }

  async findOne(id: string) {
    const batch = await this.batchRepo.findBatchById(id);
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);
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

    const batch = await this.batchRepo.createBatch({
      ...dto,
      branchId: resolvedBranchId,
      resolvedLocationId,
    });

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

  async update(id: string, dto: UpdateBatchDto) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);
    const batch = await this.batchRepo.updateBatch(id, dto);
    return { data: batch, message: "Batch updated" };
  }

  async updateStatus(id: string, dto: UpdateBatchStatusDto, userId?: string) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);

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
    userId?: string,
  ) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);

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

  async remove(id: string) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);

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

  async getMovements(batchId: string) {
    const batch = await this.batchRepo.findBatchById(batchId);
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    const movements = await this.movementRepo.findByBatch(batchId);
    return { data: movements };
  }

  async reserveStock(id: string, quantity: number) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);
    const updated = await this.batchRepo.reserveStock(id, quantity);
    return { data: updated, message: "Stock reserved" };
  }

  async releaseStock(id: string, quantity: number) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);
    const updated = await this.batchRepo.releaseStock(id, quantity);
    return { data: updated, message: "Stock reservation released" };
  }
}
