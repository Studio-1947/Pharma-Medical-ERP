import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ClinicService } from "../clinic.service";

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
    };
    service = new ClinicService(mockRepo);
  });

  describe("create", () => {
    it("delegates token generation to the repository", async () => {
      const dto = { patientId: "p1", doctorId: "d1", date: "2026-07-09" } as any;
      mockRepo.findActiveDoctor.mockResolvedValue({ id: "d1", firstName: "Anu" });
      mockRepo.create.mockResolvedValue({ id: "t1", tokenNo: 1, ...dto });

      const result = await service.create(dto);

      expect(mockRepo.create).toHaveBeenCalledWith(dto);
      expect(result.data.tokenNo).toBe(1);
      expect(result.message).toBe("Token generated");
    });

    it("rejects a doctorId that is not an active doctor", async () => {
      const dto = { patientId: "p1", doctorId: "not-a-doctor", date: "2026-07-09" } as any;
      mockRepo.findActiveDoctor.mockResolvedValue(undefined);

      await expect(service.create(dto)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException when the token does not exist", async () => {
      mockRepo.findById.mockResolvedValue(undefined);
      await expect(service.findOne("missing")).rejects.toThrow(NotFoundException);
    });

    it("returns the token when found", async () => {
      mockRepo.findById.mockResolvedValue({ id: "t1", status: "pending" });
      const result = await service.findOne("t1");
      expect(result.data.id).toBe("t1");
    });
  });

  describe("update", () => {
    it("throws NotFoundException when the token does not exist", async () => {
      mockRepo.findById.mockResolvedValue(undefined);
      await expect(service.update("missing", { status: "called" } as any)).rejects.toThrow(NotFoundException);
    });

    it("blocks status changes once a token is completed", async () => {
      mockRepo.findById.mockResolvedValue({ id: "t1", status: "completed" });
      await expect(service.update("t1", { status: "called" } as any)).rejects.toThrow(UnprocessableEntityException);
    });

    it("blocks status changes once a token is cancelled", async () => {
      mockRepo.findById.mockResolvedValue({ id: "t1", status: "cancelled" });
      await expect(service.update("t1", { status: "pending" } as any)).rejects.toThrow(UnprocessableEntityException);
    });

    it("allows non-status updates on a terminal token (e.g. notes)", async () => {
      mockRepo.findById.mockResolvedValue({ id: "t1", status: "completed" });
      mockRepo.update.mockResolvedValue({ id: "t1", status: "completed", notes: "updated" });
      const result = await service.update("t1", { notes: "updated" } as any);
      expect(result.data.notes).toBe("updated");
    });

    it("allows status transitions while a token is still pending", async () => {
      mockRepo.findById.mockResolvedValue({ id: "t1", status: "pending" });
      mockRepo.update.mockResolvedValue({ id: "t1", status: "called" });
      const result = await service.update("t1", { status: "called" } as any);
      expect(result.data.status).toBe("called");
    });
  });

  describe("findDoctors", () => {
    it("returns the doctor list wrapped in a data envelope", async () => {
      mockRepo.findDoctors.mockResolvedValue([{ id: "d1", firstName: "Anu" }]);
      const result = await service.findDoctors();
      expect(result.data).toHaveLength(1);
    });
  });
});
