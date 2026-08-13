import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotificationsService } from "../notifications.service";

describe("NotificationsService", () => {
  let service: NotificationsService;
  let mockDb: any;
  let mockGateway: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([{ id: "notif-1", title: "Test", isRead: false }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };

    mockGateway = {
      emitToUser: vi.fn(),
      broadcast: vi.fn(),
    };

    const mockDrizzle = { db: mockDb } as any;
    service = new NotificationsService(mockDrizzle, mockGateway);
  });

  it("should create a user-targeted notification and emit to user room", async () => {
    const newNotif = {
      id: "notif-1",
      userId: "user-123",
      type: "invoice" as const,
      title: "Invoice Issued",
      message: "Invoice #INV-001 created",
      isRead: false,
    };
    mockDb.returning.mockResolvedValue([newNotif]);

    const result = await service.create({
      userId: "user-123",
      type: "invoice",
      title: "Invoice Issued",
      message: "Invoice #INV-001 created",
    });

    expect(result).toEqual(newNotif);
    expect(mockGateway.emitToUser).toHaveBeenCalledWith("user-123", "notification.new", newNotif);
    expect(mockGateway.broadcast).not.toHaveBeenCalled();
  });

  it("should broadcast system-wide notifications when userId is omitted", async () => {
    const sysNotif = {
      id: "notif-2",
      type: "low_stock" as const,
      title: "Low Stock Alert",
      message: "Paracetamol is low",
      isRead: false,
    };
    mockDb.returning.mockResolvedValue([sysNotif]);

    const result = await service.create({
      type: "low_stock",
      title: "Low Stock Alert",
      message: "Paracetamol is low",
    });

    expect(result).toEqual(sysNotif);
    expect(mockGateway.broadcast).toHaveBeenCalledWith("notification.new", sysNotif);
    expect(mockGateway.emitToUser).not.toHaveBeenCalled();
  });

  it("should return unread count for a user", async () => {
    mockDb.where.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);

    const count = await service.unreadCount("user-123");
    expect(count).toBe(2);
  });

  it("should mark a specific notification as read", async () => {
    mockDb.where.mockResolvedValue({ success: true });

    const result = await service.markRead("notif-1", "user-123");
    expect(result).toEqual({ success: true });
    expect(mockDb.update).toHaveBeenCalled();
  });
});
