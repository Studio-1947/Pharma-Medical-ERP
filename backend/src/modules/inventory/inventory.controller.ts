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

  @Get("low-stock")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Medicines at or below reorder level" })
  getLowStock() {
    return this.service.getLowStock();
  }

  @Get("valuation")
  @Roles("admin", "inventory_manager", "reports_analyst")
  @ApiOperation({ summary: "Stock valuation — cost and MRP value per medicine" })
  getValuation(@Query("warehouseId") warehouseId?: string) {
    return this.service.getStockValuation(warehouseId);
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
  getBatches(@Param("id") id: string) {
    return this.service.getBatchesForDispense(id);
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
  @ApiOperation({ summary: "Bulk-import medicines from CSV rows — deduplicates by SKU" })
  bulkImport(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { rows } = body as { rows: Record<string, string>[] };
    return this.service.bulkImport(rows, user.sub);
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
