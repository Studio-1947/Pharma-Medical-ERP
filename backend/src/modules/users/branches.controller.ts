import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BranchesService, UpsertBranchDto } from "./branches.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@pharmerp/types";

@ApiTags("branches")
@Controller("branches")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.PHARMACIST,
    UserRole.INVENTORY_MANAGER,
    UserRole.CASHIER,
    UserRole.REPORTS_ANALYST,
  )
  @ApiOperation({ summary: "List all branches" })
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Get branch by ID" })
  findOne(@Param("id") id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Create a new branch" })
  create(@Body() body: UpsertBranchDto) {
    return this.service.create(body);
  }

  @Patch(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Update branch details" })
  update(@Param("id") id: string, @Body() body: Partial<UpsertBranchDto>) {
    return this.service.update(id, body);
  }

  @Patch(":id/deactivate")
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Deactivate a branch" })
  deactivate(@Param("id") id: string) {
    return this.service.toggleActive(id, false);
  }

  @Patch(":id/activate")
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Reactivate a branch" })
  activate(@Param("id") id: string) {
    return this.service.toggleActive(id, true);
  }
}
