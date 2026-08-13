import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PatientsService } from "./patients.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { createPatientSchema, updatePatientSchema, queryPatientSchema } from "@pharmerp/types";

@ApiTags("patients")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("patients")
export class PatientsController {
  constructor(private readonly service: PatientsService) {}

  @Get()
  @Roles("admin", "shop_manager", "doctor")
  findAll(@Query() q: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.findAll(queryPatientSchema.parse(q), user);
  }

  @Get(":id")
  @Roles("admin", "shop_manager", "doctor")
  findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Register a new patient" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(createPatientSchema.parse(body), user);
  }

  @Patch(":id")
  @Roles("admin", "shop_manager", "doctor")
  update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, updatePatientSchema.parse(body), user);
  }

  @Delete(":id")
  @Roles("admin")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
