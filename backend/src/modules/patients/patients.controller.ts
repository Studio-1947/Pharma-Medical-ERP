import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PatientsService } from "./patients.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { createPatientSchema, updatePatientSchema, queryPatientSchema } from "@pharmerp/types";

@ApiTags("patients")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("patients")
export class PatientsController {
  constructor(private readonly service: PatientsService) {}

  @Get()
  @Roles("admin", "pharmacist", "cashier")
  findAll(@Query() q: unknown) { return this.service.findAll(queryPatientSchema.parse(q)); }

  @Get(":id")
  @Roles("admin", "pharmacist", "cashier")
  findOne(@Param("id") id: string) { return this.service.findOne(id); }

  @Post()
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "Register a new patient" })
  create(@Body() body: unknown) { return this.service.create(createPatientSchema.parse(body)); }

  @Patch(":id")
  @Roles("admin", "pharmacist", "cashier")
  update(@Param("id") id: string, @Body() body: unknown) { return this.service.update(id, updatePatientSchema.parse(body)); }

  @Delete(":id")
  @Roles("admin")
  remove(@Param("id") id: string) { return this.service.remove(id); }
}
