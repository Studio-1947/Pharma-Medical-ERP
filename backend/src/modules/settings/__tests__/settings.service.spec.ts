import { describe, it, expect, vi } from "vitest";
import { SettingsService } from "../settings.service";
import * as schema from "../../../database/schema";

/**
 * Smoke tests for the billing-flow setting — the switch that decides whether
 * /billing lands on the patient-first counter desk ("new", the default) or the
 * legacy medicine-first POS ("old").
 *
 * The default matters: every consumer (billing page, POS page, shell layout,
 * settings UI) falls back to "new" when the row is missing, and the backend
 * service must agree — otherwise a fresh install would render the counter desk
 * while the API reports the old flow.
 */
describe("SettingsService (billing flow)", () => {
  function buildService(row?: { value: unknown } | undefined) {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(row ? [row] : []),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const drizzle = { db: mockDb };
    return { service: new SettingsService(drizzle as any), mockDb };
  }

  describe("getBillingFlow", () => {
    it("defaults to NEW when no row exists (fresh install)", async () => {
      const { service } = buildService();
      await expect(service.getBillingFlow()).resolves.toBe("new");
    });

    it("returns OLD when the stored value is old", async () => {
      const { service } = buildService({ value: { flow: "old" } });
      await expect(service.getBillingFlow()).resolves.toBe("old");
    });

    it("returns NEW when the stored value is new", async () => {
      const { service } = buildService({ value: { flow: "new" } });
      await expect(service.getBillingFlow()).resolves.toBe("new");
    });

    it("defaults to NEW for any unexpected stored shape", async () => {
      const { service } = buildService({ value: { flow: "weird" } });
      await expect(service.getBillingFlow()).resolves.toBe("new");
      const { service: empty } = buildService({ value: null });
      await expect(empty.getBillingFlow()).resolves.toBe("new");
    });
  });

  describe("setBillingFlow", () => {
    it("upserts the flow with the acting user and returns it", async () => {
      const { service, mockDb } = buildService();
      const result = await service.setBillingFlow("old", "user-1");

      expect(mockDb.insert).toHaveBeenCalledWith(schema.appSettings);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "billing_flow",
          value: { flow: "old" },
          updatedBy: "user-1",
        }),
      );
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: schema.appSettings.key,
          set: expect.objectContaining({ value: { flow: "old" } }),
        }),
      );
      expect(result).toEqual({ billingFlow: "old" });
    });

    it("round-trips: set then get returns the same flow", async () => {
      const row: { value: unknown } = { value: { flow: "old" } };
      // getBillingFlow reads whatever the "row" currently holds
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(async () => [row]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockImplementation((v: any) => {
          row.value = v.value;
          return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
        }),
      };
      const service = new SettingsService({ db: mockDb } as any);
      await service.setBillingFlow("new", "user-1");
      await expect(service.getBillingFlow()).resolves.toBe("new");
    });
  });
});
