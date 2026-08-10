import { Injectable, BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export interface UpsertBranchDto {
  name: string;
  code: string;
  address: string;
  phone?: string;
  email?: string;
  state?: string;
  gstin?: string;
  drugLicense20B?: string;
  drugLicense21B?: string;
  licenseeName?: string;
  isHeadOffice?: boolean;
}

@Injectable()
export class BranchesService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  findAll() {
    return this.db
      .select()
      .from(schema.branches)
      .orderBy(schema.branches.name);
  }

  async findById(id: string) {
    const [branch] = await this.db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.id, id))
      .limit(1);
    return branch ?? null;
  }

  async create(dto: UpsertBranchDto) {
    const [branch] = await this.db
      .insert(schema.branches)
      .values({
        name: dto.name,
        code: dto.code.toUpperCase(),
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        state: dto.state,
        gstin: dto.gstin,
        drugLicense20B: dto.drugLicense20B,
        drugLicense21B: dto.drugLicense21B,
        licenseeName: dto.licenseeName,
        isHeadOffice: dto.isHeadOffice ?? false,
      })
      .returning();
    return branch;
  }

  async update(id: string, dto: Partial<UpsertBranchDto>) {
    const [branch] = await this.db
      .update(schema.branches)
      .set({
        ...dto,
        code: dto.code ? dto.code.toUpperCase() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.branches.id, id))
      .returning();
    return branch;
  }

  async toggleActive(id: string, isActive: boolean) {
    const [branch] = await this.db
      .update(schema.branches)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(schema.branches.id, id))
      .returning();
    return branch;
  }

  async remove(id: string) {
    try {
      const [deleted] = await this.db
        .delete(schema.branches)
        .where(eq(schema.branches.id, id))
        .returning();
      return deleted;
    } catch (err: any) {
      if (err?.code === "23503") {
        throw new BadRequestException(
          "Cannot delete branch with active inventory, sales invoices, or assigned staff. Deactivate the branch instead.",
        );
      }
      throw err;
    }
  }
}
