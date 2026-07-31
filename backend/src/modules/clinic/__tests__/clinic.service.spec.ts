import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ClinicService } from "../clinic.service";
import type { JwtPayload } from "../../../common/decorators/current-user.decorator";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: "u1",
    email: "staff@mederp.com",
    role: "cashier",
    branchId: BRANCH_A,
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

const cashier = user();
const doctor = user({ sub: "d1", role: "doctor" });
const otherDoctor = user({ sub: "d2", role: "doctor" });
const superAdmin = user({ sub: "sa", role: "super_admin", branchId: undefined });

/** Token as findById returns it. */
function token(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    status: "pending",
    doctorId: "d1",
    patientId: "p1",
    branchId: BRANCH_A,
    prescriptionId: null,
    ...overrides,
  };
}

/** Tomorrow, so the backdating guard never fires on a fixture. */
function futureDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("ClinicService", () => {
  let service: ClinicService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findPaginated: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findDoctors: vi.fn(),
      findActiveDoctor: vi.fn(),
      findLivePatient: vi.fn(),
      findOpenTokenForPatient: vi.fn(),
      findPrescriptionPatientId: vi.fn(),
    };
    service = new ClinicService(mockRepo);
  });

  function validCreateSetup() {
    mockRepo.findActiveDoctor.mockResolvedValue({ id: "d1", firstName: "Anu", branchId: BRANCH_A });
    mockRepo.findLivePatient.mockResolvedValue({ id: "p1", name: "Ravi" });
    mockRepo.findOpenTokenForPatient.mockResolvedValue(undefined);
  }

  describe("create", () => {
    it("delegates token generation to the repository with the caller's branch", async () => {
      const dto = { patientId: "p1", doctorId: "d1", date: futureDate() } as any;
      validCreateSetup();
      mockRepo.create.mockResolvedValue({ id: "t1", tokenNo: 1, ...dto });

      const result = await service.create(dto, BRANCH_A);

      expect(mockRepo.create).toHaveBeenCalledWith({ ...dto, branchId: BRANCH_A });
      expect(result.data.tokenNo).toBe(1);
      expect(result.message).toBe("Token generated");
    });

    it("rejects a doctorId that is not an active doctor", async () => {
      const dto = { patientId: "p1", doctorId: "not-a-doctor", date: futureDate() } as any;
      mockRepo.findActiveDoctor.mockResolvedValue(undefined);

      await expect(service.create(dto, BRANCH_A)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a doctor who practises at another branch", async () => {
      const dto = { patientId: "p1", doctorId: "d1", date: futureDate() } as any;
      validCreateSetup();
      mockRepo.findActiveDoctor.mockResolvedValue({ id: "d1", branchId: BRANCH_B });

      await expect(service.create(dto, BRANCH_A)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a patient that does not exist or is soft-deleted", async () => {
      const dto = { patientId: "gone", doctorId: "d1", date: futureDate() } as any;
      validCreateSetup();
      mockRepo.findLivePatient.mockResolvedValue(undefined);

      await expect(service.create(dto, BRANCH_A)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a backdated token", async () => {
      const dto = { patientId: "p1", doctorId: "d1", date: "2020-01-01" } as any;
      validCreateSetup();

      await expect(service.create(dto, BRANCH_A)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a second open token for the same patient and doctor that day", async () => {
      const dto = { patientId: "p1", doctorId: "d1", date: futureDate() } as any;
      validCreateSetup();
      mockRepo.findOpenTokenForPatient.mockResolvedValue({ id: "t0", tokenNo: 3 });

      await expect(service.create(dto, BRANCH_A)).rejects.toThrow(/already holds open token #3/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("pins a doctor to their own queue when no doctorId is supplied", async () => {
      await service.findAll({ page: 1, limit: 50 } as any, doctor);
      expect(mockRepo.findPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: "d1" }),
      );
    });

    it("rejects a doctor asking for a colleague's queue", async () => {
      await expect(
        service.findAll({ page: 1, limit: 50, doctorId: "d2" } as any, doctor),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.findPaginated).not.toHaveBeenCalled();
    });

    it("leaves doctorId as a free filter for reception roles", async () => {
      await service.findAll({ page: 1, limit: 50, doctorId: "d2" } as any, cashier);
      expect(mockRepo.findPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: "d2" }),
      );
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException when the token does not exist", async () => {
      mockRepo.findById.mockResolvedValue(undefined);
      await expect(service.findOne("missing", cashier)).rejects.toThrow(NotFoundException);
    });

    it("returns the token when found", async () => {
      mockRepo.findById.mockResolvedValue(token());
      const result = await service.findOne("t1", cashier);
      expect(result.data.id).toBe("t1");
    });

    it("blocks a token belonging to another branch", async () => {
      mockRepo.findById.mockResolvedValue(token({ branchId: BRANCH_B }));
      await expect(service.findOne("t1", cashier)).rejects.toThrow(ForbiddenException);
    });

    it("blocks a doctor reading another doctor's token", async () => {
      mockRepo.findById.mockResolvedValue(token({ doctorId: "d1" }));
      await expect(service.findOne("t1", otherDoctor)).rejects.toThrow(ForbiddenException);
    });

    it("lets super_admin read across branches", async () => {
      mockRepo.findById.mockResolvedValue(token({ branchId: BRANCH_B }));
      const result = await service.findOne("t1", superAdmin);
      expect(result.data.id).toBe("t1");
    });

    it("hides legacy tokens with no branch from branch-scoped users", async () => {
      mockRepo.findById.mockResolvedValue(token({ branchId: null }));
      await expect(service.findOne("t1", cashier)).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("throws NotFoundException when the token does not exist", async () => {
      mockRepo.findById.mockResolvedValue(undefined);
      await expect(service.update("missing", { status: "called" } as any, cashier)).rejects.toThrow(NotFoundException);
    });

    it("blocks status changes once a token is completed", async () => {
      mockRepo.findById.mockResolvedValue(token({ status: "completed" }));
      await expect(service.update("t1", { status: "called" } as any, cashier)).rejects.toThrow(UnprocessableEntityException);
    });

    it("blocks status changes once a token is cancelled", async () => {
      mockRepo.findById.mockResolvedValue(token({ status: "cancelled" }));
      await expect(service.update("t1", { status: "pending" } as any, cashier)).rejects.toThrow(UnprocessableEntityException);
    });

    it("allows non-status updates on a terminal token (e.g. notes)", async () => {
      mockRepo.findById.mockResolvedValue(token({ status: "completed" }));
      mockRepo.update.mockResolvedValue({ id: "t1", status: "completed", notes: "updated" });
      const result = await service.update("t1", { notes: "updated" } as any, cashier);
      expect(result.data.notes).toBe("updated");
    });

    it("allows status transitions while a token is still pending", async () => {
      mockRepo.findById.mockResolvedValue(token());
      mockRepo.update.mockResolvedValue({ id: "t1", status: "called" });
      const result = await service.update("t1", { status: "called" } as any, doctor);
      expect(result.data.status).toBe("called");
    });

    it("blocks a doctor updating a colleague's token", async () => {
      mockRepo.findById.mockResolvedValue(token({ doctorId: "d1" }));
      await expect(service.update("t1", { status: "called" } as any, otherDoctor)).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("blocks updating a token from another branch", async () => {
      mockRepo.findById.mockResolvedValue(token({ branchId: BRANCH_B }));
      await expect(service.update("t1", { status: "called" } as any, cashier)).rejects.toThrow(ForbiddenException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("rejects linking a prescription belonging to a different patient", async () => {
      mockRepo.findById.mockResolvedValue(token({ patientId: "p1" }));
      mockRepo.findPrescriptionPatientId.mockResolvedValue({ id: "rx1", patientId: "p2" });

      await expect(
        service.update("t1", { prescriptionId: "rx1" } as any, doctor),
      ).rejects.toThrow(/different patient/);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("rejects linking a prescription that does not exist", async () => {
      mockRepo.findById.mockResolvedValue(token());
      mockRepo.findPrescriptionPatientId.mockResolvedValue(null);

      await expect(
        service.update("t1", { prescriptionId: "rx-missing" } as any, doctor),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("links a prescription belonging to the token's own patient", async () => {
      mockRepo.findById.mockResolvedValue(token({ patientId: "p1" }));
      mockRepo.findPrescriptionPatientId.mockResolvedValue({ id: "rx1", patientId: "p1" });
      mockRepo.update.mockResolvedValue({ id: "t1", prescriptionId: "rx1" });

      const result = await service.update("t1", { prescriptionId: "rx1" } as any, doctor);
      expect(result.data.prescriptionId).toBe("rx1");
    });
  });

  describe("findDoctors", () => {
    it("returns the doctor list wrapped in a data envelope", async () => {
      mockRepo.findDoctors.mockResolvedValue([{ id: "d1", firstName: "Anu" }]);
      const result = await service.findDoctors(BRANCH_A);
      expect(result.data).toHaveLength(1);
      expect(mockRepo.findDoctors).toHaveBeenCalledWith(BRANCH_A);
    });
  });
});
