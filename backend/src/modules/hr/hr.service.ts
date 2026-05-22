import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { HrRepository } from "./hr.repository";
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  QueryEmployeeDto,
  RecordAttendanceDto,
  CreateLeaveRequestDto,
  ReviewLeaveDto,
} from "@pharmerp/types";

@Injectable()
export class HrService {
  constructor(private readonly repo: HrRepository) {}

  // ─── Employees ────────────────────────────────────────────────────────────────

  findAllEmployees(query: QueryEmployeeDto) {
    return this.repo.findAllEmployees(query);
  }

  async findEmployeeById(id: string) {
    const employee = await this.repo.findEmployeeById(id);
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);
    return { data: employee };
  }

  async createEmployee(dto: CreateEmployeeDto) {
    const employee = await this.repo.createEmployee(dto);
    return { data: employee, message: "Employee created" };
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    await this.findEmployeeById(id);
    const employee = await this.repo.updateEmployee(id, dto);
    return { data: employee, message: "Employee updated" };
  }

  async deactivateEmployee(id: string) {
    await this.findEmployeeById(id);
    await this.repo.deactivateEmployee(id);
    return { message: "Employee deactivated" };
  }

  // ─── Departments ──────────────────────────────────────────────────────────────

  async findAllDepartments(branchId?: string) {
    const departments = await this.repo.findAllDepartments(branchId);
    return { data: departments };
  }

  async createDepartment(data: { name: string; branchId: string; managerId?: string }) {
    const dept = await this.repo.createDepartment(data);
    return { data: dept, message: "Department created" };
  }

  // ─── Attendance ───────────────────────────────────────────────────────────────

  async recordAttendance(dto: RecordAttendanceDto) {
    const employee = await this.repo.findEmployeeById(dto.employeeId);
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const record = await this.repo.recordAttendance(dto);
    return { data: record, message: "Attendance recorded" };
  }

  async findAttendance(employeeId: string, from: string, to: string) {
    await this.findEmployeeById(employeeId);
    const records = await this.repo.findAttendance(employeeId, from, to);
    return { data: records };
  }

  // ─── Leave Requests ───────────────────────────────────────────────────────────

  async createLeaveRequest(dto: CreateLeaveRequestDto) {
    const employee = await this.repo.findEmployeeById(dto.employeeId);
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const leave = await this.repo.createLeaveRequest(dto);
    return { data: leave, message: "Leave request submitted" };
  }

  async findLeaveRequests(params: { employeeId?: string; status?: string; branchId?: string }) {
    const leaves = await this.repo.findLeaveRequests(params);
    return { data: leaves };
  }

  async deleteLeaveRequest(id: string) {
    const leave = await this.repo.findLeaveById(id);
    if (!leave) throw new NotFoundException(`Leave request ${id} not found`);
    await this.repo.deleteLeaveRequest(id);
    return { message: "Leave request deleted" };
  }

  async reviewLeave(id: string, dto: ReviewLeaveDto, reviewedBy: string) {
    const leave = await this.repo.findLeaveById(id);
    if (!leave) throw new NotFoundException(`Leave request ${id} not found`);

    if (leave.status !== "pending") {
      throw new UnprocessableEntityException(
        `Leave request has already been reviewed. Current status: ${leave.status}`,
      );
    }

    const updated = await this.repo.reviewLeave(id, dto, reviewedBy);
    return { data: updated, message: `Leave request ${dto.status}` };
  }
}
