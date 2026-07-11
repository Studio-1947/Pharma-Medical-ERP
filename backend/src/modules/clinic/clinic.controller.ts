import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClinicService } from "./clinic.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  createClinicTokenSchema,
  updateClinicTokenSchema,
  queryClinicTokenSchema,
} from "@pharmerp/types";

@ApiTags("clinic")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("clinic")
export class ClinicController {
  constructor(private readonly service: ClinicService) {}

  @Get("doctors")
  @Roles("admin", "cashier", "doctor")
  @ApiOperation({ summary: "List active doctors available for token allocation" })
  findDoctors() {
    return this.service.findDoctors();
  }

  @Get("tokens")
  @Roles("admin", "cashier", "doctor")
  @ApiOperation({ summary: "Query the clinic token queue" })
  findAll(@Query() q: unknown) {
    return this.service.findAll(queryClinicTokenSchema.parse(q));
  }

  @Get("tokens/:id")
  @Roles("admin", "cashier", "doctor")
  @ApiOperation({ summary: "Get a single clinic token with patient and prescription detail" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post("tokens")
  @Roles("admin", "cashier")
  @ApiOperation({ summary: "Generate a new clinic token for a patient" })
  create(@Body() body: unknown) {
    return this.service.create(createClinicTokenSchema.parse(body));
  }

  @Patch("tokens/:id")
  @Roles("admin", "cashier", "doctor")
  @ApiOperation({ summary: "Update token status, notes, or linked prescription" })
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.service.update(id, updateClinicTokenSchema.parse(body));
  }
}
