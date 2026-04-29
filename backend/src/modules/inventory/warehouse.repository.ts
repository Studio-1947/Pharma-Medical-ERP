import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreateWarehouseDto, UpdateWarehouseDto, CreateLocationDto } from "@pharmerp/types";

@Injectable()
export class WarehouseRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(branchId?: string) {
    const rows = await this.db
      .select()
      .from(schema.warehouses)
      .where(
        branchId
          ? eq(schema.warehouses.branchId, branchId)
          : undefined,
      );
    return rows;
  }

  async findById(id: string) {
    return this.db.query.warehouses.findFirst({
      where: eq(schema.warehouses.id, id),
    });
  }

  async create(data: CreateWarehouseDto) {
    const [wh] = await this.db
      .insert(schema.warehouses)
      .values(data)
      .returning();
    return wh!;
  }

  async update(id: string, data: UpdateWarehouseDto) {
    const [wh] = await this.db
      .update(schema.warehouses)
      .set(data)
      .where(eq(schema.warehouses.id, id))
      .returning();
    return wh!;
  }

  // Storage locations
  async findLocations(warehouseId: string) {
    return this.db
      .select()
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.warehouseId, warehouseId));
  }

  async createLocation(data: CreateLocationDto) {
    const [loc] = await this.db
      .insert(schema.storageLocations)
      .values(data)
      .returning();
    return loc!;
  }
}
