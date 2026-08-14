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
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "List medicines with pagination and search" })
  findAll(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = queryMedicineSchema.parse(query);
    const branchId = resolveBranchScope(user, dto.branchId);
    return this.service.findAll({ ...dto, branchId });
  }

  // Declared before :id so "categories" is not captured as a medicine id.
  @Get("categories")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Shelf categories, for the medicine form" })
  listCategories() {
    return this.service.listCategories();
  }

  @Get("low-stock")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Medicines at or below reorder level" })
  getLowStock(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getLowStock(resolveBranchScope(user, branchId));
  }

  @Get("otc-supplies")
  @Roles("admin", "shop_manager")
  @ApiOperation({
    summary: "OTC supplies (hand-outs without a bill) on a date — count + units from the stock ledger",
  })
  async getOtcSupplies(
    @CurrentUser() user: JwtPayload,
    @Query("date") date: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.movementRepo.findOtcSupplies(
      date,
      resolveBranchScope(user, branchId),
    );
    return { data };
  }

  @Get("valuation")
  @Roles("admin", "shop_manager")
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
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Exact-match medicine lookup by barcode (indexed, for scanning)" })
  getByBarcode(@Param("code") code: string) {
    return this.service.getByBarcode(code);
  }

  @Get(":id")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Get a medicine by ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get(":id/batches")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "FEFO-ordered active batches for dispense" })
  getBatches(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getBatchesForDispense(id, resolveBranchScope(user, branchId));
  }

  @Get(":id/movements")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Full stock movement history for a medicine" })
  async getMovements(@Param("id") id: string) {
    const movements = await this.movementRepo.findByMedicine(id);
    return { data: movements };
  }

  @Get(":id/barcode.png")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Generate barcode PNG for a medicine" })
  async getBarcode(@Param("id") id: string, @Res() reply: FastifyReply) {
    const png = await this.barcodeService.generateForMedicine(id);
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(png);
  }

  @Post("bulk-import")
  @Roles("admin", "shop_manager")
  @ApiOperation({
    summary:
      "Bulk-import medicines from CSV rows — deduplicates by SKU. Rows carrying " +
      "Batch_No/Expiry_Date/Stock also load opening stock into the caller's branch.",
  })
  bulkImport(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query("dryRun") dryRunQuery?: string,
  ) {
    const { rows, branchId, dryRun: dryRunBody } = body as {
      rows: Record<string, string>[];
      branchId?: string;
      dryRun?: boolean;
    };
    const isDryRun = dryRunBody === true || dryRunQuery === "true";
    return this.service.bulkImport(rows, user.sub, {
      branchId: resolveBranchScope(user, branchId),
      dryRun: isDryRun,
    });
  }

  @Post()
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Create a new medicine" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(createMedicineSchema.parse(body), user.sub);
  }

  @Patch(":id")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Update a medicine" })
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.service.update(id, updateMedicineSchema.parse(body));
  }

  @Delete(":id")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Soft-delete a medicine" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
