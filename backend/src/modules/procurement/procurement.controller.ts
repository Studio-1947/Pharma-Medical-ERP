import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { parse } from "json2csv";
import { ProcurementService } from "./procurement.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { requireBranchScope } from "../../common/auth/branch-scope";
import {
  createSupplierSchema,
  updateSupplierSchema,
  querySupplierSchema,
  createPurchaseOrderSchema,
  approvePurchaseOrderSchema,
  createGrnSchema,
  queryPurchaseOrderSchema,
  createSupplierPaymentSchema,
  querySupplierBillsSchema,
  querySupplierLedgerSchema,
  createSupplierReturnSchema,
  resolveReturnReplacementSchema,
  resolveReturnCreditNoteSchema,
} from "@pharmerp/types";

@ApiTags("procurement")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("procurement")
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  // ─── Suppliers ───────────────────────────────────────────────────────────────

  @Get("suppliers")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "List all suppliers" })
  findAllSuppliers(@Query() q: unknown) {
    return this.service.findAllSuppliers(querySupplierSchema.parse(q));
  }

  @Get("suppliers/:id")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Get supplier by ID" })
  findSupplierById(@Param("id") id: string) {
    return this.service.findSupplierById(id);
  }

  @Post("suppliers")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Create a new supplier" })
  createSupplier(@Body() body: unknown) {
    return this.service.createSupplier(createSupplierSchema.parse(body));
  }

  @Patch("suppliers/:id")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Update supplier details" })
  updateSupplier(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateSupplier(id, updateSupplierSchema.parse(body));
  }

  @Delete("suppliers/:id")
  @Roles("admin")
  @ApiOperation({ summary: "Soft delete a supplier" })
  removeSupplier(@Param("id") id: string) {
    return this.service.removeSupplier(id);
  }

  // ─── Supplier bills, payments & ledger ─────────────────────────────────────────

  @Get("suppliers/:id/bills")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "List a supplier's bills (one per delivery), with paid/unpaid status" })
  listSupplierBills(@Param("id") id: string, @Query() q: unknown) {
    return this.service.listSupplierBills(id, querySupplierBillsSchema.parse(q));
  }

  @Get("suppliers/:id/bills/:grnId")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Get a single supplier bill with itemized medicines and payment status" })
  getSupplierBill(@Param("id") id: string, @Param("grnId") grnId: string) {
    return this.service.getSupplierBill(id, grnId);
  }

  @Post("suppliers/:id/payments")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Record a payment made to a supplier, optionally against a specific bill" })
  recordSupplierPayment(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordSupplierPayment(id, createSupplierPaymentSchema.parse(body), user.sub);
  }

  @Get("suppliers/:id/ledger")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Supplier account statement — bills and payments with running balance" })
  async getSupplierLedger(
    @Param("id") id: string,
    @Query() q: unknown,
    @Res() res: FastifyReply,
  ) {
    const query = querySupplierLedgerSchema.parse(q);
    const ledger = await this.service.getSupplierLedger(id, query);

    if (query.format === "csv") {
      const fields = ["date", "type", "reference", "debit", "credit", "balance"];
      const csv = parse(ledger.entries, { fields });
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="ledger-${id}.csv"`);
      return res.send(csv);
    }

    return res.send({ data: ledger });
  }

  @Get("suppliers/:id/returns")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "List expiry/damage returns for every batch delivered by this supplier" })
  listSupplierReturns(@Param("id") id: string) {
    return this.service.listSupplierReturns(id);
  }

  // ─── Supplier returns (expiry/damage) ──────────────────────────────────────────

  @Post("returns")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Record expired/damaged stock being returned to its supplier" })
  recordSupplierReturn(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.recordSupplierReturn(createSupplierReturnSchema.parse(body), user.sub);
  }

  @Post("returns/:id/replace")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Resolve a return: supplier sent replacement stock" })
  resolveReturnReplacement(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.resolveReturnAsReplacement(
      id,
      resolveReturnReplacementSchema.parse(body),
      user.sub,
    );
  }

  @Post("returns/:id/credit-note")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Resolve a return: supplier issued a credit note" })
  resolveReturnCreditNote(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.resolveReturnAsCreditNote(
      id,
      resolveReturnCreditNoteSchema.parse(body),
      user.sub,
    );
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────────────

  @Get("purchase-orders")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "List purchase orders with filters" })
  findAllPOs(@Query() q: unknown) {
    return this.service.findAllPOs(queryPurchaseOrderSchema.parse(q));
  }

  @Get("purchase-orders/:id")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Get purchase order by ID with items and GRNs" })
  findPOById(@Param("id") id: string) {
    return this.service.findPOById(id);
  }

  @Post("purchase-orders")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Create a draft purchase order" })
  createPO(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createPurchaseOrderSchema.parse(body);
    // The ordering branch is stamped onto every batch the GRN later creates,
    // so it is resolved from the caller rather than trusted from the body.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.service.createPO(dto, user.sub, branchId);
  }

  @Post("auto-draft-pos")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Auto-generate draft POs for all low stock items in current branch" })
  autoGenerateDraftPOs(@Body() body: any, @CurrentUser() user: JwtPayload) {
    const branchId = requireBranchScope(user, body?.branchId);
    return this.service.autoGenerateDraftPOs(branchId, user.sub);
  }

  @Patch("purchase-orders/:id")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Update a draft purchase order (replaces line items)" })
  updatePO(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updatePO(id, createPurchaseOrderSchema.parse(body));
  }

  @Post("purchase-orders/:id/approve")
  @Roles("admin")
  @ApiOperation({ summary: "Approve or reject a purchase order pending approval" })
  approvePO(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.approvePO(id, approvePurchaseOrderSchema.parse(body), user.sub);
  }

  @Post("purchase-orders/:id/send")
  @Roles("admin")
  @ApiOperation({ summary: "Mark purchase order as sent to supplier" })
  sendPO(@Param("id") id: string) {
    return this.service.sendPO(id);
  }

  @Post("purchase-orders/:id/cancel")
  @Roles("admin")
  @ApiOperation({ summary: "Cancel a purchase order" })
  cancelPO(@Param("id") id: string) {
    return this.service.cancelPO(id);
  }

  @Post("purchase-orders/:id/grn")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Create goods received note — receives stock into warehouse" })
  createGRN(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createGRN(id, createGrnSchema.parse(body), user.sub);
  }
}
