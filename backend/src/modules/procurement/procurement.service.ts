import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { DrizzleService } from "../../database/drizzle.service";
import { ProcurementRepository } from "./procurement.repository";
import type {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  CreatePurchaseOrderDto,
  ApprovePurchaseOrderDto,
  CreateGrnDto,
  QueryPurchaseOrderDto,
} from "@pharmerp/types";

@Injectable()
export class ProcurementService {
  constructor(
    private readonly repo: ProcurementRepository,
    private readonly drizzle: DrizzleService,
  ) {}

  // ─── Suppliers ───────────────────────────────────────────────────────────────

  findAllSuppliers(query: QuerySupplierDto) {
    return this.repo.findAllSuppliers(query);
  }

  async findSupplierById(id: string) {
    const supplier = await this.repo.findSupplierById(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return { data: supplier };
  }

  async createSupplier(dto: CreateSupplierDto) {
    const supplier = await this.repo.createSupplier(dto);
    return { data: supplier, message: "Supplier created" };
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    await this.findSupplierById(id);
    const supplier = await this.repo.updateSupplier(id, dto);
    return { data: supplier, message: "Supplier updated" };
  }

  async removeSupplier(id: string) {
    await this.findSupplierById(id);
    await this.repo.softDeleteSupplier(id);
    return { message: "Supplier deleted" };
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────────────

  findAllPOs(query: QueryPurchaseOrderDto) {
    return this.repo.findAllPOs(query);
  }

  async findPOById(id: string) {
    const po = await this.repo.findPOById(id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return { data: po };
  }

  async createPO(dto: CreatePurchaseOrderDto, raisedBy: string) {
    const po = await this.repo.createPO(dto, raisedBy);
    return { data: po, message: "Purchase order created" };
  }

  async approvePO(id: string, dto: ApprovePurchaseOrderDto, userId: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (existing.status !== "pending_approval") {
      throw new UnprocessableEntityException(
        `Purchase order must be in pending_approval status to approve. Current status: ${existing.status}`,
      );
    }

    if (!dto.approved) {
      const po = await this.repo.cancelPO(id);
      return { data: po, message: "Purchase order rejected and cancelled" };
    }

    const po = await this.repo.approvePO(id, userId);
    return { data: po, message: "Purchase order approved" };
  }

  async sendPO(id: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (!["approved", "draft"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Purchase order cannot be sent in status: ${existing.status}`,
      );
    }

    const po = await this.repo.sendPO(id);
    return { data: po, message: "Purchase order sent to supplier" };
  }

  async cancelPO(id: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (["received", "cancelled"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Purchase order cannot be cancelled in status: ${existing.status}`,
      );
    }

    const po = await this.repo.cancelPO(id);
    return { data: po, message: "Purchase order cancelled" };
  }

  async createGRN(poId: string, dto: CreateGrnDto, userId: string) {
    const existing = await this.repo.findPOById(poId);
    if (!existing) throw new NotFoundException(`Purchase order ${poId} not found`);

    if (!["approved", "sent", "partially_received"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Cannot receive goods for purchase order in status: ${existing.status}`,
      );
    }

    const dtoWithPoId: CreateGrnDto = { ...dto, poId };

    const result = await this.drizzle.db.transaction(async (tx) => {
      const grnResult = await this.repo.createGRN(dtoWithPoId, userId, tx);

      // Determine new PO status
      const poItems = await this.repo.getPOItemsReceivingStatus(poId);
      const allFullyReceived = poItems.every((item) => item.receivedQty >= item.orderedQty);
      const newStatus = allFullyReceived ? "received" : "partially_received";
      await this.repo.updatePOStatus(poId, newStatus, tx);

      return grnResult;
    });

    return { data: result, message: "Goods received note created" };
  }
}
