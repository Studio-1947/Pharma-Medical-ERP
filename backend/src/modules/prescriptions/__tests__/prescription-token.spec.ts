import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { PrescriptionsService } from "../prescriptions.service";

/**
 * The printed prescription shows the clinic queue token above the header.
 *
 * The link runs from the token to the prescription, so this is a reverse
 * lookup rather than a column on the prescription itself. Prescriptions that
 * never came through the queue (uploaded scans, counter entries) legitimately
 * have none, and the token box must then be omitted rather than printed empty.
 */
describe("PrescriptionsService — clinic queue token", () => {
  let service: PrescriptionsService;
  let mockRepo: any;
  let mockS3: any;

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      findTokenNo: vi.fn().mockResolvedValue(null),
    };
    mockS3 = {
      getPresignedUrl: vi.fn().mockResolvedValue("https://signed.example/scan.png"),
    };
    service = new PrescriptionsService(mockRepo as any, mockS3 as any);
  });

  it("attaches the token for a prescription written from the queue", async () => {
    mockRepo.findById.mockResolvedValue({ id: "rx-1", fileUrl: null });
    mockRepo.findTokenNo.mockResolvedValue(13);

    const res = await service.findOne("rx-1");

    expect((res.data as any).tokenNo).toBe(13);
    expect(mockRepo.findTokenNo).toHaveBeenCalledWith("rx-1");
  });

  it("attaches null when the prescription has no queue token", async () => {
    mockRepo.findById.mockResolvedValue({ id: "rx-2", fileUrl: null });
    mockRepo.findTokenNo.mockResolvedValue(null);

    const res = await service.findOne("rx-2");

    expect((res.data as any).tokenNo).toBeNull();
  });

  it("still resolves the signed scan URL alongside the token", async () => {
    // Guards against the token lookup being spliced in ahead of the existing
    // presigned-URL work and quietly dropping it.
    mockRepo.findById.mockResolvedValue({ id: "rx-3", fileUrl: "scans/rx-3.png" });
    mockRepo.findTokenNo.mockResolvedValue(4);

    const res = await service.findOne("rx-3");

    expect((res.data as any).displayUrl).toBe("https://signed.example/scan.png");
    expect((res.data as any).tokenNo).toBe(4);
  });

  it("throws for a missing prescription without looking up a token", async () => {
    mockRepo.findById.mockResolvedValue(undefined);

    await expect(service.findOne("nope")).rejects.toThrow(NotFoundException);
    expect(mockRepo.findTokenNo).not.toHaveBeenCalled();
  });
});
