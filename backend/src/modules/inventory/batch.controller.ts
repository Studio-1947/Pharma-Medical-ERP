import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BatchService } from "./batch.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import {
  createBatchSchema,
  updateBatchSchema,
  updateBatchStatusSchema,
  adjustBatchQuantitySchema,
  queryBatchSchema,
  reserveBatchStockSchema,
  releaseBatchStockSchema,
} from "@pharmerp/types";

@ApiTags("inventory / batches")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory/batches")
export class BatchController {
  constructor(private readonly service: BatchService) {}

  @Get()
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "List batches (filter by medicine, status, expiry)" })
  findAll(@Query() query: unknown) {
    return this.service.findAll(queryBatchSchema.parse(query));
  }

  @Get("expiring")
  @Roles("admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "Batches expiring within N days (default 90)" })
  getExpiring(
    @CurrentUser() user: JwtPayload,
    @Query("days") days = "90",
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getExpiringBatches(parseInt(days), scoped);
  }

  @Get(":id")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "Get a single batch" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get(":id/movements")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Stock movement history for a batch" })
  getMovements(@Param("id") id: string) {
    return this.service.getMovements(id);
  }

  @Post()
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Receive a new batch (logs purchase movement)" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createBatchSchema.parse(body);
    // Pins the batch to the caller's branch so an inventory manager cannot
    // deposit stock into another branch by editing the body. super_admin, being
    // unscoped, must name the branch explicitly.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.service.create(dto, user.sub, branchId);
  }

  @Patch(":id")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Update batch details (batch number, expiry, cost, MRP)" })
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.service.update(id, updateBatchSchema.parse(body));
  }

  @Patch(":id/status")
  @Roles("admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "Update batch status (quarantine, recall, etc.)" })
  updateStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateStatus(
      id,
      updateBatchStatusSchema.parse(body),
      user.sub,
    );
  }

  @Delete(":id")
  @Roles("admin")
  @ApiOperation({ summary: "Delete a batch (admin only — blocked if stock movements exist)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Patch(":id/adjust")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Manual stock adjustment with mandatory notes" })
  adjust(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.adjust(
      id,
      adjustBatchQuantitySchema.parse(body),
      user.sub,
    );
  }

  @Post(":id/reserve")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "Reserve stock on a batch for an active cart" })
  reserve(@Param("id") id: string, @Body() body: unknown) {
    const dto = reserveBatchStockSchema.parse(body);
    return this.service.reserveStock(id, dto.quantity);
  }

  @Post(":id/release")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "Release reserved stock on a batch" })
  release(@Param("id") id: string, @Body() body: unknown) {
    const dto = releaseBatchStockSchema.parse(body);
    return this.service.releaseStock(id, dto.quantity);
  }
}
