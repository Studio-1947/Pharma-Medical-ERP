import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HrService } from "./hr.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  queryEmployeeSchema,
  recordAttendanceSchema,
  createLeaveRequestSchema,
  reviewLeaveSchema,
} from "@pharmerp/types";

@ApiTags("hr")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("hr")
export class HrController {
  constructor(private readonly service: HrService) {}

  // ─── Employees ────────────────────────────────────────────────────────────────

  @Get("employees")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "List employees with filters" })
  findAllEmployees(@Query() q: unknown) {
    return this.service.findAllEmployees(queryEmployeeSchema.parse(q));
  }

  @Get("employees/:id")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Get employee by ID" })
  findEmployeeById(@Param("id") id: string) {
    return this.service.findEmployeeById(id);
  }

  @Post("employees")
  @Roles("admin")
  @ApiOperation({ summary: "Create a new employee record" })
  createEmployee(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const dto = createEmployeeSchema.parse(body);
    // Pin to the caller's branch so a branch admin cannot staff another branch.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.service.createEmployee({ ...dto, branchId });
  }

  @Patch("employees/:id")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Update employee details" })
  updateEmployee(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const dto = updateEmployeeSchema.parse(body);
    // Reject an attempt to move an employee into a branch the caller can't touch.
    if (dto.branchId) requireBranchScope(user, dto.branchId);
    return this.service.updateEmployee(id, dto);
  }

  @Delete("employees/:id")
  @Roles("admin")
  @ApiOperation({ summary: "Deactivate and soft delete an employee" })
  deactivateEmployee(@Param("id") id: string) {
    return this.service.deactivateEmployee(id);
  }

  // ─── Departments ──────────────────────────────────────────────────────────────

  @Get("departments")
  @Roles("admin", "hr_manager", "pharmacist")
  @ApiOperation({ summary: "List departments, optionally filtered by branch" })
  findAllDepartments(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.findAllDepartments(scoped);
  }

  @Post("departments")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Create a department" })
  createDepartment(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; branchId: string; managerId?: string },
  ) {
    // Pin the department to the caller's branch so an hr_manager cannot create
    // one inside another branch by posting a foreign branchId.
    const branchId = requireBranchScope(user, body.branchId);
    return this.service.createDepartment({ ...body, branchId });
  }

  // ─── Attendance ───────────────────────────────────────────────────────────────

  @Post("attendance")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Record or update attendance for an employee on a given date" })
  recordAttendance(@Body() body: unknown) {
    return this.service.recordAttendance(recordAttendanceSchema.parse(body));
  }

  @Get("attendance/:employeeId")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Get attendance records for an employee within a date range" })
  findAttendance(
    @Param("employeeId") employeeId: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.service.findAttendance(employeeId, from, to);
  }

  // ─── Leave Requests ───────────────────────────────────────────────────────────

  @Post("leaves")
  @Roles("admin", "hr_manager", "pharmacist")
  @ApiOperation({ summary: "Submit a leave request" })
  createLeaveRequest(@Body() body: unknown) {
    return this.service.createLeaveRequest(createLeaveRequestSchema.parse(body));
  }

  @Get("leaves")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "List leave requests with optional filters" })
  findLeaveRequests(
    @CurrentUser() user: JwtPayload,
    @Query("employeeId") employeeId?: string,
    @Query("status") status?: string,
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.findLeaveRequests({ employeeId, status, branchId: scoped });
  }

  @Patch("leaves/:id/review")
  @Roles("admin", "hr_manager")
  @ApiOperation({ summary: "Approve, reject, or cancel a pending leave request" })
  reviewLeave(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reviewLeave(id, reviewLeaveSchema.parse(body), user.sub);
  }

  @Delete("leaves/:id")
  @Roles("admin", "hr_manager")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Soft-delete a leave request" })
  deleteLeaveRequest(@Param("id") id: string) {
    return this.service.deleteLeaveRequest(id);
  }
}
