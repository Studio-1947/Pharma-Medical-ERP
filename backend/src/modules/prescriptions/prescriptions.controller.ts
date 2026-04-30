import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrescriptionsService } from "./prescriptions.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import {
  createPrescriptionSchema,
  verifyPrescriptionSchema,
  queryPrescriptionSchema,
} from "@pharmerp/types";

@ApiTags("prescriptions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("prescriptions")
export class PrescriptionsController {
  constructor(private readonly service: PrescriptionsService) {}

  @Get()
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "List prescriptions with optional filters" })
  findAll(@Query() q: unknown) {
    return this.service.findAll(queryPrescriptionSchema.parse(q));
  }

  @Get(":id")
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "Get prescription by ID with items and patient" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "Create a new prescription" })
  create(@Body() body: unknown) {
    return this.service.create(createPrescriptionSchema.parse(body));
  }

  @Post(":id/verify")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Verify or reject a prescription" })
  verify(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.verify(id, verifyPrescriptionSchema.parse(body), user.sub);
  }

  @Delete(":id")
  @Roles("admin")
  @ApiOperation({ summary: "Soft delete a prescription" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
