import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyReply } from "fastify";
import { InventoryService } from "./inventory.service";
import { BarcodeService } from "./barcode.service";
import { StockMovementRepository } from "./stock-movement.repository";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope } from "../../common/auth/branch-scope";
import {
  createMedicineSchema,
  updateMedicineSchema,
  queryMedicineSchema,
} from "@pharmerp/types";

@ApiTags("inventory")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory/medicines")
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly barcodeService: BarcodeService,
    private readonly movementRepo: StockMovementRepository,
  ) {}

  @Get()
  @Roles("admin", "pharmacist", "inventory_manager", "cashier", "doctor")
  @ApiOperation({ summary: "List medicines with pagination and search" })
  findAll(@Query() query: unknown) {
    return this.service.findAll(queryMedicineSchema.parse(query));
  }

  // Declared before :id so "categories" is not captured as a medicine id.
  @Get("categories")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier", "doctor")
  @ApiOperation({ summary: "Shelf categories, for the medicine form" })
  listCategories() {
    return this.service.listCategories();
  }

  @Get("low-stock")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Medicines at or below reorder level" })
  getLowStock(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getLowStock(resolveBranchScope(user, branchId));
  }

  @Get("valuation")
  @Roles("admin", "inventory_manager", "reports_analyst")
  @ApiOperation({ summary: "Stock valuation — cost and MRP value per medicine" })
  getValuation(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    // Was unscoped: a branch admin could read every branch's stock value simply
    // by omitting the parameter. resolveBranchScope pins them to their own and
    // still lets super_admin ask for all branches by passing nothing.
    return this.service.getStockValuation(resolveBranchScope(user, branchId));
  }

  @Get("barcode/:code")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "Exact-match medicine lookup by barcode (indexed, for scanning)" })
  getByBarcode(@Param("code") code: string) {
    return this.service.getByBarcode(code);
  }

  @Get(":id")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier", "doctor")
  @ApiOperation({ summary: "Get a medicine by ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get(":id/batches")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier", "doctor")
  @ApiOperation({ summary: "FEFO-ordered active batches for dispense" })
  getBatches(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getBatchesForDispense(id, resolveBranchScope(user, branchId));
  }

  @Get(":id/movements")
  @Roles("admin", "pharmacist", "inventory_manager")
  @ApiOperation({ summary: "Full stock movement history for a medicine" })
  async getMovements(@Param("id") id: string) {
    const movements = await this.movementRepo.findByMedicine(id);
    return { data: movements };
  }

  @Get(":id/barcode.png")
  @Roles("admin", "pharmacist", "inventory_manager", "cashier")
  @ApiOperation({ summary: "Generate barcode PNG for a medicine" })
  async getBarcode(@Param("id") id: string, @Res() reply: FastifyReply) {
    const png = await this.barcodeService.generateForMedicine(id);
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(png);
  }

  @Post("bulk-import")
  @Roles("admin", "inventory_manager")
  @ApiOperation({
    summary:
      "Bulk-import medicines from CSV rows — deduplicates by SKU. Rows carrying " +
      "Batch_No/Expiry_Date/Stock also load opening stock into the caller's branch.",
  })
  bulkImport(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { rows, branchId } = body as {
      rows: Record<string, string>[];
      branchId?: string;
    };
    // A branch user is pinned to their own branch whatever they send, so an
    // admin of one branch cannot write stock into another's warehouse. Only
    // super_admin — the one role with no branch of its own, and the one most
    // likely to run the initial catalogue load — may name the target branch.
    return this.service.bulkImport(rows, user.sub, {
      branchId: resolveBranchScope(user, branchId),
    });
  }

  @Post()
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Create a new medicine" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(createMedicineSchema.parse(body), user.sub);
  }

  @Patch(":id")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Update a medicine" })
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.service.update(id, updateMedicineSchema.parse(body));
  }

  @Delete(":id")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Soft-delete a medicine" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
