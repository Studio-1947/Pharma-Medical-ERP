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
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import { WarehouseRepository } from "./warehouse.repository";
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
} from "@pharmerp/types";

@ApiTags("inventory / warehouses")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory/warehouses")
export class WarehouseController {
  constructor(private readonly repo: WarehouseRepository) {}

  @Get()
  @Roles("admin", "inventory_manager", "pharmacist", "cashier")
  @ApiOperation({ summary: "List warehouses (optionally filter by branchId)" })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.repo.findAll(scoped);
  }

  @Get(":id")
  @Roles("admin", "inventory_manager")
  findOne(@Param("id") id: string) {
    return this.repo.findById(id);
  }

  @Get(":id/locations")
  @Roles("admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "List storage locations in a warehouse" })
  getLocations(@Param("id") id: string) {
    return this.repo.findLocations(id);
  }

  @Post()
  @Roles("admin")
  @ApiOperation({ summary: "Create a warehouse" })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const dto = createWarehouseSchema.parse(body);
    // Pin to the caller's branch so a branch admin cannot plant a warehouse
    // inside another branch.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.repo.create({ ...dto, branchId });
  }

  @Patch(":id")
  @Roles("admin")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.repo.update(id, updateWarehouseSchema.parse(body));
  }

  @Post("locations")
  @Roles("admin", "inventory_manager")
  @ApiOperation({ summary: "Add a storage location to a warehouse" })
  createLocation(@Body() body: unknown) {
    return this.repo.createLocation(createLocationSchema.parse(body));
  }
}
