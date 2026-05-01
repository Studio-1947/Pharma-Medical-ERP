import {
  Body,
  Controller,
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
import {
  createBatchSchema,
  updateBatchStatusSchema,
  adjustBatchQuantitySchema,
  queryBatchSchema,
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
  getExpiring(@Query("days") days = "90", @Query("branchId") branchId?: string) {
    return this.service.getExpiringBatches(parseInt(days), branchId);
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
    return this.service.create(createBatchSchema.parse(body), user.sub);
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
}
