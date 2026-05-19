import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  DistributionRepository,
  CreateTransferDto,
  UpdateTransferStatusDto,
} from "./distribution.repository";

@Injectable()
export class DistributionService {
  constructor(private readonly repo: DistributionRepository) {}

  findAll(params: { page: number; limit: number; status?: string }) {
    return this.repo.findAll(params);
  }

  async findById(id: string) {
    const transfer = await this.repo.findById(id);
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    return transfer;
  }

  async create(data: CreateTransferDto, initiatedBy: string) {
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw new BadRequestException(
        "Source and destination warehouse cannot be the same",
      );
    }
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException("Transfer must have at least one item");
    }
    return this.repo.create(data, initiatedBy);
  }

  async approve(id: string, approvedBy: string) {
    const updated = await this.repo.approve(id, approvedBy);
    if (!updated) {
      throw new BadRequestException(
        "Transfer not found or is not in draft status",
      );
    }
    return updated;
  }

  async deliver(
    id: string,
    dto: UpdateTransferStatusDto,
    receivedItems: { itemId: string; receivedQty: number; rejectedQty?: number }[],
  ) {
    const transfer = await this.repo.findById(id);
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    if (transfer.status !== "in_transit") {
      throw new BadRequestException("Only in-transit transfers can be delivered");
    }

    // Validate: received + rejected cannot exceed dispatched qty per item
    const itemMap = new Map(transfer.items.map((i: any) => [i.id, i]));
    for (const ri of receivedItems) {
      const item = itemMap.get(ri.itemId) as any;
      if (!item) throw new BadRequestException(`Transfer item ${ri.itemId} not found`);
      const total = ri.receivedQty + (ri.rejectedQty ?? 0);
      if (total > item.requestedQty) {
        throw new BadRequestException(
          `Item ${ri.itemId}: received (${ri.receivedQty}) + rejected (${ri.rejectedQty ?? 0}) ` +
          `exceeds dispatched quantity (${item.requestedQty})`,
        );
      }
    }

    return this.repo.deliver(id, dto, receivedItems);
  }

  async cancel(id: string) {
    const updated = await this.repo.cancel(id);
    if (!updated) {
      throw new BadRequestException(
        "Transfer not found or cannot be cancelled (already dispatched)",
      );
    }
    return updated;
  }
}
