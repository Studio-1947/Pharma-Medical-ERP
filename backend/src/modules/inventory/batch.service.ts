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

  async create(dto: CreateBatchDto, userId?: string) {
    // Verify medicine exists
    const medicine = await this.inventoryRepo.findMedicineById(dto.medicineId);
    if (!medicine) {
      throw new NotFoundException(`Medicine ${dto.medicineId} not found`);
    }

    // If no locationId but branchId provided, auto-assign the branch's default location
    // so selectBatchesForDispense (which joins through locationId) can find this batch.
    let resolvedLocationId = dto.locationId;
    if (!resolvedLocationId && (dto as any).branchId) {
      resolvedLocationId = await this.batchRepo.findOrCreateDefaultLocationForBranch((dto as any).branchId);
    }

    const batch = await this.batchRepo.createBatch({ ...dto, resolvedLocationId } as any);

    // Log the inbound stock movement
    await this.movementRepo.log({
      batchId: batch.id,
      medicineId: dto.medicineId,
      movementType: "purchase",
      quantity: dto.quantity,
      performedBy: userId,
      notes: `Initial batch receipt — batch no. ${dto.batchNo}`,
    });

    return { data: batch, message: "Batch created" };
  }

  async updateStatus(id: string, dto: UpdateBatchStatusDto, userId?: string) {
    const existing = await this.batchRepo.findBatchById(id);
    if (!existing) throw new NotFoundException(`Batch ${id} not found`);

    const batch = await this.batchRepo.updateBatchStatus(id, dto.status);

    if (dto.status === "expired" || dto.status === "recalled") {
      await this.movementRepo.log({
        batchId: id,
        medicineId: existing.medicineId,
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
      movementType: "adjustment",
      quantity: dto.adjustment,
      performedBy: userId,
      notes: dto.notes,
    });

    return { data: updated, message: "Stock adjusted" };
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
}
