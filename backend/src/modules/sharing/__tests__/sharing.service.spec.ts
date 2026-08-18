import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { SharingService, maskPatientName } from "../sharing.service";

/**
 * This is the only unauthenticated surface in the API and it returns patient
 * health information, so the refusal paths matter more than the happy path.
 */
describe("maskPatientName", () => {
  it("reduces a full name to first name plus initial", () => {
    expect(maskPatientName("Anita Sharma")).toBe("Anita S.");
    expect(maskPatientName("ravi kumar singh")).toBe("ravi S.");
  });

  it("leaves a single name alone, since there is nothing to mask", () => {
    expect(maskPatientName("Anita")).toBe("Anita");
  });

  it("handles missing and blank names", () => {
    expect(maskPatientName(null)).toBeNull();
    expect(maskPatientName(undefined)).toBeNull();
    expect(maskPatientName("   ")).toBeNull();
  });
});

describe("SharingService.resolvePublic", () => {
  let service: SharingService;
  let findFirst: any;

  function build(link: any) {
    findFirst = vi.fn().mockResolvedValue(link);
    service = new SharingService({} as any);
    (service as any).drizzle = {
      db: {
        query: {
          recordShareLinks: { findFirst },
          prescriptions: { findFirst: vi.fn().mockResolvedValue(null) },
          salesInvoices: { findFirst: vi.fn().mockResolvedValue(null) },
          clinicTokens: { findFirst: vi.fn().mockResolvedValue(null) },
        },
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      },
    };
    return service;
  }

  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it("refuses an unknown token", async () => {
    const s = build(null);
    await expect(s.resolvePublic("a".repeat(32))).rejects.toThrow(NotFoundException);
  });

  it("refuses a revoked link", async () => {
    const s = build({
      id: "l1", token: "t", resourceType: "prescription", resourceId: "rx1",
      expiresAt: future, revokedAt: new Date(), viewCount: 0,
    });
    await expect(s.resolvePublic("a".repeat(32))).rejects.toThrow(NotFoundException);
  });

  it("refuses an expired link even when never revoked", async () => {
    const s = build({
      id: "l2", token: "t", resourceType: "prescription", resourceId: "rx1",
      expiresAt: past, revokedAt: null, viewCount: 0,
    });
    await expect(s.resolvePublic("a".repeat(32))).rejects.toThrow(NotFoundException);
  });

  it("refuses a short token without touching the database", async () => {
    // Blocks trivial enumeration attempts before they cost a query.
    const s = build(null);
    await expect(s.resolvePublic("abc")).rejects.toThrow(NotFoundException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("gives revoked, expired and unknown links the same message", async () => {
    // Distinguishable errors would confirm to a prober that a token was once
    // real, which is itself a disclosure.
    const messages: string[] = [];
    for (const link of [
      null,
      { id: "l", token: "t", resourceType: "prescription", resourceId: "r", expiresAt: future, revokedAt: new Date(), viewCount: 0 },
      { id: "l", token: "t", resourceType: "prescription", resourceId: "r", expiresAt: past, revokedAt: null, viewCount: 0 },
    ]) {
      const s = build(link);
      await s.resolvePublic("a".repeat(32)).catch((e) => messages.push(e.message));
    }
    expect(new Set(messages).size).toBe(1);
  });
});

describe("SharingService branch scoping", () => {
  function serviceWithRecord(branchId: string | null) {
    const service = new SharingService({} as any);
    (service as any).drizzle = {
      db: {
        query: {
          prescriptions: {
            findFirst: vi.fn().mockResolvedValue({ id: "rx1", patientId: "p1", branchId }),
          },
        },
        insert: () => ({
          values: () => ({
            returning: () =>
              Promise.resolve([
                { token: "tok", expiresAt: new Date(Date.now() + 1000) },
              ]),
          }),
        }),
      },
    };
    return service;
  }

  it("refuses to mint a link for another branch's record", async () => {
    const s = serviceWithRecord("branch-B");
    await expect(
      s.createLink("prescription", "rx1", { sub: "u1", role: "shop_manager", branchId: "branch-A" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows staff to share their own branch's record", async () => {
    const s = serviceWithRecord("branch-A");
    const res = await s.createLink("prescription", "rx1", {
      sub: "u1", role: "shop_manager", branchId: "branch-A",
    });
    expect(res.path).toBe("/p/tok");
  });

  it("lets a super admin share across branches", async () => {
    const s = serviceWithRecord("branch-B");
    const res = await s.createLink("prescription", "rx1", { sub: "u1", role: "super_admin" });
    expect(res.token).toBe("tok");
  });
});
