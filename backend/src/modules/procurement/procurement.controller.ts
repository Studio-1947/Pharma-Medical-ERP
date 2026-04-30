import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProcurementService } from "./procurement.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import {
  createSupplierSchema,
  updateSupplierSchema,
  querySupplierSchema,
  createPurchaseOrderSchema,
  approvePurchaseOrderSchema,
  createGrnSchema,
  queryPurchaseOrderSchema,
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
  @Roles("admin")
  @ApiOperation({ summary: "Create a new supplier" })
  createSupplier(@Body() body: unknown) {
    return this.service.createSupplier(createSupplierSchema.parse(body));
  }

  @Patch("suppliers/:id")
  @Roles("admin")
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
    return this.service.createPO(createPurchaseOrderSchema.parse(body), user.sub);
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
