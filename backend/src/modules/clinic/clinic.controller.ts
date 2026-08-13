import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClinicService } from "./clinic.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
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
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "List active doctors available for token allocation" })
  findDoctors(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    return this.service.findDoctors(resolveBranchScope(user, branchId));
  }

  @Patch("doctors/:id/profile")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Update doctor profile (specialty, fee, OPD room, weekly timings, availability)" })
  updateDoctorProfile(
    @Param("id") id: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateDoctorProfile(id, body, user);
  }

  @Get("tokens")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Query the clinic token queue" })
  findAll(@CurrentUser() user: JwtPayload, @Query() q: unknown) {
    const query = queryClinicTokenSchema.parse(q);
    return this.service.findAll(
      { ...query, branchId: resolveBranchScope(user, query.branchId) },
      user,
    );
  }

  // Declared before tokens/:id so "taken-slots" is not captured as an id.
  @Get("tokens/taken-slots")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({
    summary: "Time slots already booked for a doctor on a date",
  })
  takenSlots(
    @Query("doctorId") doctorId: string,
    @Query("date") date: string,
  ) {
    return this.service.takenSlots(doctorId, date);
  }

  @Get("tokens/:id")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Get a single clinic token with patient and prescription detail" })
  findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(id, user);
  }

  @Post("tokens")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Generate a new clinic token for a patient" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createClinicTokenSchema.parse(body);
    // Pin to the caller's branch so a receptionist cannot plant a token in
    // another branch's queue.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.service.create(dto, branchId);
  }

  @Patch("tokens/:id")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Update token status, notes, or linked prescription" })
  update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, updateClinicTokenSchema.parse(body), user);
  }
}
