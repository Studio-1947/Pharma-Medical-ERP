import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InventoryService } from "./inventory.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@ApiTags("inventory")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory/categories")
export class CategoriesController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  @Roles("admin", "pharmacist", "inventory_manager", "cashier", "doctor")
  @ApiOperation({ summary: "Shelf categories, for the medicine form" })
  listCategories() {
    return this.service.listCategories();
  }
}
