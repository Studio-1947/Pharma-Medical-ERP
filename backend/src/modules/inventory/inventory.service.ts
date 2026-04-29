import { Injectable, NotFoundException } from "@nestjs/common";
import { InventoryRepository } from "./inventory.repository";
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

  async create(dto: CreateMedicineDto, userId?: string) {
    const medicine = await this.repo.createMedicine(dto, userId);
    return { data: medicine, message: "Medicine created" };
  }

  async update(id: string, dto: UpdateMedicineDto) {
    await this.findOne(id);
    const medicine = await this.repo.updateMedicine(id, dto);
    return { data: medicine, message: "Medicine updated" };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.softDeleteMedicine(id);
    return { message: "Medicine deleted" };
  }

  getLowStock() {
    return this.repo.getLowStockMedicines();
  }

  getBatchesForDispense(medicineId: string) {
    return this.repo.getActiveBatchesForDispense(medicineId);
  }
}
