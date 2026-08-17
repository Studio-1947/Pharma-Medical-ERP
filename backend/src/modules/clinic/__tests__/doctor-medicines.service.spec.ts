import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ClinicService } from "../clinic.service";
import type { JwtPayload } from "../../../common/decorators/current-user.decorator";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const DOCTOR_ID = "d1";
const OTHER_DOCTOR_ID = "d2";
const MEDICINE_ID = "33333333-3333-3333-3333-333333333333";

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: "u1",
    email: "staff@mederp.com",
    role: "shop_manager",
    branchId: BRANCH_A,
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

const shopManager = user();
const admin = user({ sub: "a1", role: "admin" });
const ownDoctor = user({ sub: DOCTOR_ID, role: "doctor" });
const otherDoctor = user({ sub: OTHER_DOCTOR_ID, role: "doctor" });

describe("ClinicService — doctor medicine list", () => {
  let service: ClinicService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findActiveDoctor: vi.fn().mockResolvedValue({
        id: DOCTOR_ID,
        firstName: "Anu",
        branchId: BRANCH_A,
      }),
      listDoctorMedicines: vi.fn().mockResolvedValue([]),
      findLiveMedicine: vi.fn(),
      findDoctorMedicinePair: vi.fn().mockResolvedValue(undefined),
      findDoctorMedicine: vi.fn(),
      nextDoctorMedicineSortOrder: vi.fn().mockResolvedValue(0),
      addDoctorMedicine: vi.fn(),
      reviveDoctorMedicine: vi.fn(),
      updateDoctorMedicine: vi.fn(),
      softDeleteDoctorMedicine: vi.fn(),
      findMostPrescribedMedicineIds: vi.fn().mockResolvedValue([]),
      findExistingDoctorMedicineIds: vi.fn().mockResolvedValue([]),
      addDoctorMedicinesBulk: vi.fn().mockResolvedValue([]),
    };
    service = new ClinicService(mockRepo);
  });

  function liveMedicine(overrides: Record<string, unknown> = {}) {
    return { id: MEDICINE_ID, name: "Dolo 650", isActive: true, ...overrides };
  }

  describe("read access", () => {
    it("lets a shop manager read any doctor's list", async () => {
      mockRepo.listDoctorMedicines.mockResolvedValue([{ id: "dm1" }]);

      const result = await service.listDoctorMedicines(DOCTOR_ID, BRANCH_A);

      expect(mockRepo.listDoctorMedicines).toHaveBeenCalledWith(
        DOCTOR_ID,
        BRANCH_A,
      );
      expect(result.data).toHaveLength(1);
    });

    it("404s for a doctor id that is not an active doctor", async () => {
      mockRepo.findActiveDoctor.mockResolvedValue(undefined);

      await expect(
        service.listDoctorMedicines("nobody", BRANCH_A),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.listDoctorMedicines).not.toHaveBeenCalled();
    });
  });

  describe("curation ownership", () => {
    it("lets a doctor add to their own list", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(liveMedicine());
      mockRepo.addDoctorMedicine.mockResolvedValue({ id: "dm1" });

      await service.addDoctorMedicine(
        DOCTOR_ID,
        { medicineId: MEDICINE_ID },
        ownDoctor,
      );

      expect(mockRepo.addDoctorMedicine).toHaveBeenCalled();
    });

    it("stops a doctor curating a colleague's list", async () => {
      await expect(
        service.addDoctorMedicine(
          DOCTOR_ID,
          { medicineId: MEDICINE_ID },
          otherDoctor,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.addDoctorMedicine).not.toHaveBeenCalled();
    });

    it("lets a shop manager curate any doctor's list", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(liveMedicine());
      mockRepo.addDoctorMedicine.mockResolvedValue({ id: "dm1" });

      await service.addDoctorMedicine(
        DOCTOR_ID,
        { medicineId: MEDICINE_ID },
        shopManager,
      );

      expect(mockRepo.addDoctorMedicine).toHaveBeenCalled();
    });

    it("stops a doctor removing an entry from a colleague's list", async () => {
      await expect(
        service.removeDoctorMedicine(DOCTOR_ID, "dm1", otherDoctor),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.softDeleteDoctorMedicine).not.toHaveBeenCalled();
    });
  });

  describe("catalogue integrity", () => {
    it("refuses a medicine that is not in the catalogue", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(undefined);

      await expect(
        service.addDoctorMedicine(
          DOCTOR_ID,
          { medicineId: MEDICINE_ID },
          admin,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.addDoctorMedicine).not.toHaveBeenCalled();
    });

    it("refuses a retired medicine", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(
        liveMedicine({ isActive: false }),
      );

      await expect(
        service.addDoctorMedicine(
          DOCTOR_ID,
          { medicineId: MEDICINE_ID },
          admin,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.addDoctorMedicine).not.toHaveBeenCalled();
    });

    it("rejects a medicine already on the list", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(liveMedicine());
      mockRepo.findDoctorMedicinePair.mockResolvedValue({
        id: "dm1",
        deletedAt: null,
      });

      await expect(
        service.addDoctorMedicine(
          DOCTOR_ID,
          { medicineId: MEDICINE_ID },
          admin,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepo.addDoctorMedicine).not.toHaveBeenCalled();
    });

    it("revives a previously removed entry instead of inserting a duplicate", async () => {
      mockRepo.findLiveMedicine.mockResolvedValue(liveMedicine());
      mockRepo.findDoctorMedicinePair.mockResolvedValue({
        id: "dm-old",
        deletedAt: new Date(),
      });
      mockRepo.nextDoctorMedicineSortOrder.mockResolvedValue(4);
      mockRepo.reviveDoctorMedicine.mockResolvedValue({ id: "dm-old" });

      const result = await service.addDoctorMedicine(
        DOCTOR_ID,
        { medicineId: MEDICINE_ID, defaultDosage: "1-0-1" },
        admin,
      );

      expect(mockRepo.reviveDoctorMedicine).toHaveBeenCalledWith(
        "dm-old",
        expect.objectContaining({ defaultDosage: "1-0-1", sortOrder: 4 }),
      );
      expect(mockRepo.addDoctorMedicine).not.toHaveBeenCalled();
      expect(result.data.id).toBe("dm-old");
    });
  });

  describe("editing an entry", () => {
    it("404s when the entry belongs to a different doctor", async () => {
      mockRepo.findDoctorMedicine.mockResolvedValue({
        id: "dm1",
        doctorId: OTHER_DOCTOR_ID,
      });

      await expect(
        service.updateDoctorMedicine(DOCTOR_ID, "dm1", { sortOrder: 2 }, admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.updateDoctorMedicine).not.toHaveBeenCalled();
    });

    it("applies the patch when the entry belongs to the doctor in the path", async () => {
      mockRepo.findDoctorMedicine.mockResolvedValue({
        id: "dm1",
        doctorId: DOCTOR_ID,
      });
      mockRepo.updateDoctorMedicine.mockResolvedValue({
        id: "dm1",
        sortOrder: 2,
      });

      const result = await service.updateDoctorMedicine(
        DOCTOR_ID,
        "dm1",
        { sortOrder: 2 },
        admin,
      );

      expect(mockRepo.updateDoctorMedicine).toHaveBeenCalledWith("dm1", {
        sortOrder: 2,
      });
      expect(result.data.sortOrder).toBe(2);
    });
  });

  describe("import from prescription history", () => {
    it("reports nothing to import when the doctor has no history", async () => {
      mockRepo.findMostPrescribedMedicineIds.mockResolvedValue([]);

      const result = await service.importDoctorMedicinesFromHistory(
        DOCTOR_ID,
        20,
        admin,
      );

      expect(result.data).toEqual({ imported: 0, skipped: 0 });
      expect(mockRepo.addDoctorMedicinesBulk).not.toHaveBeenCalled();
    });

    it("skips medicines already on the list and imports the rest", async () => {
      mockRepo.findMostPrescribedMedicineIds.mockResolvedValue([
        { medicineId: "m1", lastDosage: "1-0-1", lastFrequency: null, lastDuration: "5 days" },
        { medicineId: "m2", lastDosage: null, lastFrequency: null, lastDuration: null },
      ]);
      mockRepo.findExistingDoctorMedicineIds.mockResolvedValue(["m1"]);
      mockRepo.nextDoctorMedicineSortOrder.mockResolvedValue(3);
      mockRepo.addDoctorMedicinesBulk.mockResolvedValue([{ id: "dm2" }]);

      const result = await service.importDoctorMedicinesFromHistory(
        DOCTOR_ID,
        20,
        admin,
      );

      expect(mockRepo.addDoctorMedicinesBulk).toHaveBeenCalledWith([
        expect.objectContaining({ medicineId: "m2", sortOrder: 3 }),
      ]);
      expect(result.data).toEqual({ imported: 1, skipped: 1 });
    });

    it("is a no-op the second time — everything is already listed", async () => {
      mockRepo.findMostPrescribedMedicineIds.mockResolvedValue([
        { medicineId: "m1", lastDosage: null, lastFrequency: null, lastDuration: null },
      ]);
      mockRepo.findExistingDoctorMedicineIds.mockResolvedValue(["m1"]);

      const result = await service.importDoctorMedicinesFromHistory(
        DOCTOR_ID,
        20,
        admin,
      );

      expect(result.data).toEqual({ imported: 0, skipped: 1 });
      expect(mockRepo.addDoctorMedicinesBulk).not.toHaveBeenCalled();
    });

    it("preserves most-prescribed-first ranking as the list order", async () => {
      mockRepo.findMostPrescribedMedicineIds.mockResolvedValue([
        { medicineId: "m1", lastDosage: null, lastFrequency: null, lastDuration: null },
        { medicineId: "m2", lastDosage: null, lastFrequency: null, lastDuration: null },
        { medicineId: "m3", lastDosage: null, lastFrequency: null, lastDuration: null },
      ]);
      mockRepo.nextDoctorMedicineSortOrder.mockResolvedValue(0);
      mockRepo.addDoctorMedicinesBulk.mockResolvedValue([{}, {}, {}]);

      await service.importDoctorMedicinesFromHistory(DOCTOR_ID, 20, admin);

      expect(mockRepo.addDoctorMedicinesBulk).toHaveBeenCalledWith([
        expect.objectContaining({ medicineId: "m1", sortOrder: 0 }),
        expect.objectContaining({ medicineId: "m2", sortOrder: 1 }),
        expect.objectContaining({ medicineId: "m3", sortOrder: 2 }),
      ]);
    });

    it("stops a doctor importing into a colleague's list", async () => {
      await expect(
        service.importDoctorMedicinesFromHistory(DOCTOR_ID, 20, otherDoctor),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.findMostPrescribedMedicineIds).not.toHaveBeenCalled();
    });
  });
});
