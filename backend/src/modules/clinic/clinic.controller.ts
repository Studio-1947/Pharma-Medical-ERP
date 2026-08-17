import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
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

const addDoctorMedicineSchema = z.object({
  medicineId: z.string().uuid(),
  defaultDosage: z.string().max(100).nullish(),
  defaultFrequency: z.string().max(100).nullish(),
  defaultDuration: z.string().max(100).nullish(),
  defaultQuantity: z.number().int().positive().nullish(),
  notes: z.string().nullish(),
});

const updateDoctorMedicineSchema = z
  .object({
    defaultDosage: z.string().max(100).nullish(),
    defaultFrequency: z.string().max(100).nullish(),
    defaultDuration: z.string().max(100).nullish(),
    defaultQuantity: z.number().int().positive().nullish(),
    notes: z.string().nullish(),
    sortOrder: z.number().int().min(0),
    isActive: z.boolean(),
  })
  .partial();

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

  // ── Doctor medicine list ───────────────────────────────────────────────────
  // Reads are open to the whole counter side on purpose: the point of the
  // feature is that a shop manager can open any doctor and see what they work
  // with. Writes are gated inside the service, where a doctor is held to their
  // own list while admins and shop managers may curate anyone's.

  @Get("doctors/:id/medicines")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({
    summary: "Medicines on a doctor's list, with live stock for a branch",
  })
  listDoctorMedicines(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    // branchId narrows the stock figure only; an unscoped caller simply sees
    // stock across every branch, which is the right answer for a super admin.
    return this.service.listDoctorMedicines(id, resolveBranchScope(user, branchId));
  }

  @Post("doctors/:id/medicines")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Add a catalogue medicine to a doctor's list" })
  addDoctorMedicine(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addDoctorMedicine(
      id,
      addDoctorMedicineSchema.parse(body),
      user,
    );
  }

  @Post("doctors/:id/medicines/import-from-history")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({
    summary:
      "Seed a doctor's list from what they have actually prescribed. Additive and idempotent.",
  })
  importDoctorMedicines(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Query("limit") limit?: string,
  ) {
    const parsed = Number(limit);
    const safeLimit =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    return this.service.importDoctorMedicinesFromHistory(id, safeLimit, user);
  }

  @Patch("doctors/:id/medicines/:itemId")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Edit default dosage, order, or active flag" })
  updateDoctorMedicine(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateDoctorMedicine(
      id,
      itemId,
      updateDoctorMedicineSchema.parse(body),
      user,
    );
  }

  @Delete("doctors/:id/medicines/:itemId")
  @Roles("admin", "shop_manager", "doctor")
  @ApiOperation({ summary: "Remove a medicine from a doctor's list" })
  removeDoctorMedicine(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.removeDoctorMedicine(id, itemId, user);
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
