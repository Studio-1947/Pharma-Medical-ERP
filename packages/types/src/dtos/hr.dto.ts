import { z } from "zod";

export const createEmployeeSchema = z.object({
  userId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  employeeCode: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  address: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  designation: z.string().max(100).optional(),
  licenseNo: z.string().max(100).optional(),
  licenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  baseSalary: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const queryEmployeeSchema = z.object({
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const recordAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkIn: z.string().datetime({ offset: true }).optional(),
  checkOut: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["present", "absent", "half_day", "on_leave", "holiday"]),
  notes: z.string().optional(),
});

export const createLeaveRequestSchema = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.string().min(1).max(50),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1),
  reason: z.string().min(1),
});

export const updateLeaveRequestSchema = createLeaveRequestSchema.partial();

export const reviewLeaveSchema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]),
  reviewNote: z.string().optional(),
});

export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;
export type QueryEmployeeDto = z.infer<typeof queryEmployeeSchema>;
export type RecordAttendanceDto = z.infer<typeof recordAttendanceSchema>;
export type CreateLeaveRequestDto = z.infer<typeof createLeaveRequestSchema>;
export type UpdateLeaveRequestDto = z.infer<typeof updateLeaveRequestSchema>;
export type ReviewLeaveDto = z.infer<typeof reviewLeaveSchema>;
