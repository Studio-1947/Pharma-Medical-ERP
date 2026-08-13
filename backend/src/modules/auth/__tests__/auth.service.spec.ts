import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../auth.service";
import { ForbiddenException, ConflictException } from "@nestjs/common";
import { UserRole } from "@pharmerp/types";

vi.mock("argon2", () => ({
  argon2id: 2,
  hash: vi.fn().mockResolvedValue("mocked_hash"),
  verify: vi.fn().mockResolvedValue(true),
}));

describe("AuthService - register", () => {
  let service: AuthService;
  let mockRepo: any;
  let mockJwt: any;
  let mockConfig: any;

  beforeEach(() => {
    mockRepo = {
      findUserByEmail: vi.fn(),
      createUser: vi.fn((data) => Promise.resolve({ id: "new-user-id", ...data })),
    };
    mockJwt = {
      sign: vi.fn().mockReturnValue("mocked-jwt"),
    };
    mockConfig = {
      get: vi.fn((key) => {
        if (key === "REFRESH_TOKEN_EXPIRES_IN") return "7d";
        return undefined;
      }),
    };

    service = new AuthService(mockRepo, mockJwt as any, mockConfig as any);
  });

  const callerAdmin = {
    sub: "admin-id",
    email: "admin@pharmacy.com",
    role: "admin",
    branchId: "branch-uuid-1",
    iat: 12345,
    exp: 67890,
  };

  const callerSuperAdmin = {
    sub: "super-admin-id",
    email: "superadmin@pharmacy.com",
    role: "super_admin",
    iat: 12345,
    exp: 67890,
  };

  it("should successfully register branch staff for an admin, inheriting the admin's branchId", async () => {
    const dto = {
      email: "shopmanager@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager" as any,
    };

    mockRepo.findUserByEmail.mockResolvedValue(null);

    const result = await service.register(dto, callerAdmin);

    expect(mockRepo.findUserByEmail).toHaveBeenCalledWith("shopmanager@example.com");
    expect(mockRepo.createUser).toHaveBeenCalledWith({
      email: "shopmanager@example.com",
      passwordHash: "mocked_hash",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager",
      branchId: "branch-uuid-1",
    });
    expect(result.user.role).toBe("shop_manager");
    expect(result.user.branchId).toBe("branch-uuid-1");
  });

  it("should throw ForbiddenException if branch admin attempts to register a non-branch-level role", async () => {
    const dto = {
      email: "newadmin@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "admin" as any,
    };

    await expect(service.register(dto, callerAdmin)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.createUser).not.toHaveBeenCalled();
  });

  it("should throw ForbiddenException if branch admin attempts to register user in a different branch", async () => {
    const dto = {
      email: "staff@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager" as any,
      branchId: "different-branch-uuid",
    };

    await expect(service.register(dto, callerAdmin)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.createUser).not.toHaveBeenCalled();
  });

  it("should throw ForbiddenException if caller admin has no branchId assigned", async () => {
    const dto = {
      email: "staff@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager" as any,
    };

    const adminWithoutBranch = { ...callerAdmin, branchId: undefined };

    await expect(service.register(dto, adminWithoutBranch)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.createUser).not.toHaveBeenCalled();
  });

  it("should throw ForbiddenException if caller attempts to register a super_admin", async () => {
    const dto = {
      email: "super@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "super_admin" as any,
    };

    await expect(service.register(dto, callerSuperAdmin)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.createUser).not.toHaveBeenCalled();
  });

  it("should allow super_admin to register any valid role with any branchId", async () => {
    const dto = {
      email: "shopmanager2@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager" as any,
      branchId: "any-branch-uuid",
    };

    mockRepo.findUserByEmail.mockResolvedValue(null);

    const result = await service.register(dto, callerSuperAdmin);

    expect(mockRepo.createUser).toHaveBeenCalledWith({
      email: "shopmanager2@example.com",
      passwordHash: "mocked_hash",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager",
      branchId: "any-branch-uuid",
    });
    expect(result.user.role).toBe("shop_manager");
    expect(result.user.branchId).toBe("any-branch-uuid");
  });

  it("should throw ConflictException if email is already registered", async () => {
    const dto = {
      email: "existing@example.com",
      password: "Password123",
      firstName: "Jane",
      lastName: "Doe",
      role: "shop_manager" as any,
    };

    mockRepo.findUserByEmail.mockResolvedValue({ id: "existing-id" });

    await expect(service.register(dto, callerAdmin)).rejects.toThrow(ConflictException);
    expect(mockRepo.createUser).not.toHaveBeenCalled();
  });
});
