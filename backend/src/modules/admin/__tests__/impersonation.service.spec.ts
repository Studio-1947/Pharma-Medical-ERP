import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  ImpersonationService,
  IMPERSONATION_MAX_MINUTES,
} from "../impersonation.service";
import { AuditAction } from "../../../common/audit/audit-actions";
import type { JwtPayload } from "../../../common/decorators/current-user.decorator";
import type { ImpersonateDto } from "@pharmerp/types";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";

function actor(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: "super-admin-id",
    email: "root@pharmacy.com",
    role: "super_admin",
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

/**
 * impersonateSchema applies .default(15), so the parsed DTO the controller
 * hands the service always carries a duration. Tests that do not care about
 * the TTL use this rather than an empty object.
 */
const DTO: ImpersonateDto = { durationMinutes: 15 };

/** The service's own `?? 15` fallback, reachable only by bypassing the schema. */
const NO_DURATION = {} as ImpersonateDto;

const cashier = {
  id: "cashier-id",
  email: "cashier@pharmacy.com",
  firstName: "Cash",
  lastName: "Ier",
  role: "cashier",
  branchId: BRANCH_A,
  isActive: true,
};

describe("ImpersonationService.start", () => {
  let service: ImpersonationService;
  let jwt: { sign: ReturnType<typeof vi.fn> };
  let usersRepo: { findById: ReturnType<typeof vi.fn> };
  let audit: { write: ReturnType<typeof vi.fn>; writeSafe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwt = { sign: vi.fn().mockReturnValue("signed.jwt.token") };
    usersRepo = { findById: vi.fn().mockResolvedValue(cashier) };
    audit = {
      write: vi.fn().mockResolvedValue(undefined),
      writeSafe: vi.fn().mockResolvedValue(undefined),
    };
    service = new ImpersonationService(
      jwt as any,
      usersRepo as any,
      audit as any,
    );
  });

  it("mints a token carrying the target as sub and the operator as act", async () => {
    const res = await service.start(cashier.id, actor(), { durationMinutes: 15 });

    expect(res.accessToken).toBe("signed.jwt.token");
    const [payload] = jwt.sign.mock.calls[0]!;
    expect(payload.sub).toBe(cashier.id);
    expect(payload.role).toBe("cashier");
    expect(payload.act.sub).toBe("super-admin-id");
    expect(payload.act.email).toBe("root@pharmacy.com");
    expect(payload.act.sid).toEqual(expect.any(String));
  });

  // The load-bearing guarantee: a refresh token would rotate into an ordinary
  // session via the public /auth/refresh, dropping `act` and the TTL cap.
  it("returns no refresh token", async () => {
    const res = await service.start(cashier.id, actor(), DTO);
    expect(res).not.toHaveProperty("refreshToken");
  });

  it("passes the TTL as numeric seconds so a bad duration string cannot reach ms()", async () => {
    await service.start(cashier.id, actor(), { durationMinutes: 15 });
    const [, options] = jwt.sign.mock.calls[0]!;
    expect(options).toEqual({ expiresIn: 900 });
  });

  it("caps the duration at the hard ceiling", async () => {
    await service.start(cashier.id, actor(), { durationMinutes: 600 as any });
    const [, options] = jwt.sign.mock.calls[0]!;
    expect(options.expiresIn).toBe(IMPERSONATION_MAX_MINUTES * 60);
  });

  it("defaults to 15 minutes when no duration is given", async () => {
    await service.start(cashier.id, actor(), NO_DURATION);
    const [, options] = jwt.sign.mock.calls[0]!;
    expect(options.expiresIn).toBe(900);
  });

  it("writes the START audit row before minting the token", async () => {
    await service.start(cashier.id, actor(), DTO);

    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0]![0]).toMatchObject({
      actorId: "super-admin-id",
      action: AuditAction.IMPERSONATION_START,
      entity: "users",
      entityId: cashier.id,
    });
    expect(audit.write.mock.invocationCallOrder[0]!).toBeLessThan(
      jwt.sign.mock.invocationCallOrder[0]!,
    );
  });

  // An impersonation nobody can trace must not happen at all.
  it("does not issue a token when the audit write fails", async () => {
    audit.write.mockRejectedValue(new Error("db down"));
    await expect(service.start(cashier.id, actor(), DTO)).rejects.toThrow("db down");
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("rejects a non-super_admin caller even though @Roles would be bypassed", async () => {
    await expect(
      service.start(cashier.id, actor({ role: "admin", branchId: BRANCH_A }), DTO),
    ).rejects.toThrow(ForbiddenException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("refuses to chain a second impersonation", async () => {
    const nested = actor({
      act: { sub: "other-admin", email: "o@x.com", sid: "sid-1" },
    });
    await expect(service.start(cashier.id, nested, DTO)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("refuses to impersonate another super_admin", async () => {
    usersRepo.findById.mockResolvedValue({
      ...cashier,
      id: "other-root",
      role: "super_admin",
      branchId: null,
    });
    await expect(service.start("other-root", actor(), DTO)).rejects.toThrow(
      ForbiddenException,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("refuses to impersonate an inactive account", async () => {
    usersRepo.findById.mockResolvedValue({ ...cashier, isActive: false });
    await expect(service.start(cashier.id, actor(), DTO)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("refuses to impersonate yourself", async () => {
    usersRepo.findById.mockResolvedValue({
      ...cashier,
      id: "super-admin-id",
      role: "cashier",
    });
    await expect(service.start("super-admin-id", actor(), DTO)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("404s on a missing target", async () => {
    usersRepo.findById.mockResolvedValue(null);
    await expect(service.start("nope", actor(), DTO)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("ImpersonationService.stop", () => {
  let service: ImpersonationService;
  let audit: { write: ReturnType<typeof vi.fn>; writeSafe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    audit = {
      write: vi.fn().mockResolvedValue(undefined),
      writeSafe: vi.fn().mockResolvedValue(undefined),
    };
    service = new ImpersonationService(
      { sign: vi.fn() } as any,
      { findById: vi.fn() } as any,
      audit as any,
    );
  });

  it("records the STOP row against the real operator, not the target", async () => {
    const impersonated = actor({
      sub: cashier.id,
      email: cashier.email,
      role: "cashier",
      act: { sub: "super-admin-id", email: "root@pharmacy.com", sid: "sid-9" },
    });

    await service.stop(impersonated);

    expect(audit.writeSafe.mock.calls[0]![0]).toMatchObject({
      actorId: "super-admin-id",
      action: AuditAction.IMPERSONATION_STOP,
      entityId: cashier.id,
    });
  });

  it("rejects a caller that is not impersonating", async () => {
    await expect(service.stop(actor())).rejects.toThrow(BadRequestException);
  });
});
