import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException, ConflictException } from "@nestjs/common";
import { PatientsService } from "../patients.service";
import type { JwtPayload } from "../../../common/decorators/current-user.decorator";

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: "u1",
    email: "staff@mederp.com",
    role: "cashier",
    branchId: "b1",
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

const cashier = user({ role: "cashier" });
const doctor = user({ sub: "d1", role: "doctor" });

describe("PatientsService", () => {
  let service: PatientsService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findPaginated: vi.fn(),
      findById: vi.fn(),
      findByPhone: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      isPatientServedByDoctor: vi.fn(),
      createDoctorTokenForPatient: vi.fn(),
    };
    service = new PatientsService(mockRepo);
  });

  describe("findAll", () => {
    it("passes doctorId to repository when called by a doctor", async () => {
      mockRepo.findPaginated.mockResolvedValue({ data: [], meta: {} });
      await service.findAll({ page: 1, limit: 20 } as any, doctor);
      expect(mockRepo.findPaginated).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        "d1"
      );
    });

    it("does not pass doctorId when called by a non-doctor role", async () => {
      mockRepo.findPaginated.mockResolvedValue({ data: [], meta: {} });
      await service.findAll({ page: 1, limit: 20 } as any, cashier);
      expect(mockRepo.findPaginated).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        undefined
      );
    });
  });

  describe("findOne", () => {
    it("returns patient if found for non-doctor role", async () => {
      mockRepo.findById.mockResolvedValue({ id: "p1", name: "Patient 1" });
      const res = await service.findOne("p1", cashier);
      expect(res.data.id).toBe("p1");
    });

    it("allows doctor access if patient is served by the doctor", async () => {
      mockRepo.findById.mockResolvedValue({ id: "p1", name: "Patient 1" });
      mockRepo.isPatientServedByDoctor.mockResolvedValue(true);
      const res = await service.findOne("p1", doctor);
      expect(res.data.id).toBe("p1");
    });

    it("rejects doctor access with ForbiddenException if patient is not served by doctor", async () => {
      mockRepo.findById.mockResolvedValue({ id: "p1", name: "Patient 1" });
      mockRepo.isPatientServedByDoctor.mockResolvedValue(false);
      await expect(service.findOne("p1", doctor)).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException if patient does not exist", async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.findOne("missing", doctor)).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("creates patient and auto-links doctor token if registered by a doctor", async () => {
      mockRepo.findByPhone.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({ id: "p_new", name: "New Patient" });

      const dto = { name: "New Patient", phone: "9876543210" } as any;
      const res = await service.create(dto, doctor);

      expect(res.data.id).toBe("p_new");
      expect(mockRepo.createDoctorTokenForPatient).toHaveBeenCalledWith("p_new", "d1", "b1");
    });
  });
});
