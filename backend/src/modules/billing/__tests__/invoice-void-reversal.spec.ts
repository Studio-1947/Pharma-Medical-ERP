import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../billing.service";

/**
 * Voiding used to reverse the stock and nothing else, so a cancelled sale left
 * behind: loyalty points the patient had not earned, points they had spent and
 * never got back, a balance owing for goods they never kept, and a prescription
 * reading as dispensed — which the Schedule H gate then refuses to dispense
 * against a second time, so the corrected sale could not be entered.
 */

function buildService() {
  const prescriptionUpdates: any[] = [];

  const tx: any = {
    update: vi.fn(() => ({
      set: vi.fn((set: any) => ({
        where: vi.fn(() => {
          // The invoice status claim sets `status`; prescription lines set
          // `quantityDispensed`. Only the latter is of interest here.
          if (set?.quantityDispensed !== undefined) prescriptionUpdates.push(set);
          return { returning: vi.fn().mockResolvedValue([{ id: "inv-1" }]) };
        }),
        returning: vi.fn().mockResolvedValue([{ id: "inv-1" }]),
      })),
    })),
  };

  const repo: any = { findById: vi.fn(), findTokenNoByPrescription: vi.fn().mockResolvedValue(null) };
  const patientsRepo: any = {
    clawBackLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    addLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    deductLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    deductOutstanding: vi.fn().mockResolvedValue(undefined),
  };
  const movementRepo: any = { log: vi.fn().mockResolvedValue(undefined) };
  const audit: any = { writeSafe: vi.fn().mockResolvedValue(undefined) };
  const drizzle: any = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

  const service = new BillingService(
    repo,
    drizzle,
    {} as any,
    {} as any,
    movementRepo,
    patientsRepo,
    {} as any,
    {} as any,
    {} as any,
    audit,
  );

  return { service, repo, patientsRepo, movementRepo, prescriptionUpdates };
}

function invoice(overrides: Record<string, any> = {}) {
  return {
    id: "inv-1",
    invoiceNo: "BR1-001",
    status: "paid",
    branchId: "branch-1",
    patientId: "patient-1",
    prescriptionId: null,
    amountDue: "0.00",
    loyaltyPointsEarned: 0,
    loyaltyPointsRedeemed: 0,
    items: [{ batchId: "batch-1", medicineId: "med-1", quantity: 2 }],
    ...overrides,
  };
}

describe("voidInvoice reverses the loyalty ledger", () => {
  let h: ReturnType<typeof buildService>;
  beforeEach(() => { h = buildService(); });

  it("claws back the points the sale awarded", async () => {
    h.repo.findById.mockResolvedValue(invoice({ loyaltyPointsEarned: 12 }));

    await h.service.voidInvoice("inv-1", { reason: "keyed in error" } as any, "staff-1");

    expect(h.patientsRepo.clawBackLoyaltyPoints).toHaveBeenCalledWith(
      "patient-1", 12, expect.anything(),
    );
  });

  it("claws back rather than strictly deducting, so a spent balance cannot block the void", async () => {
    h.repo.findById.mockResolvedValue(invoice({ loyaltyPointsEarned: 12 }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    // deductLoyaltyPoints throws when the patient is short; using it here would
    // abort the void and leave the cancelled sale standing.
    expect(h.patientsRepo.deductLoyaltyPoints).not.toHaveBeenCalled();
  });

  it("gives back the points the patient redeemed", async () => {
    h.repo.findById.mockResolvedValue(invoice({ loyaltyPointsRedeemed: 300 }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.patientsRepo.addLoyaltyPoints).toHaveBeenCalledWith(
      "patient-1", 300, expect.anything(),
    );
  });

  it("does nothing to points on a legacy invoice that recorded none", async () => {
    h.repo.findById.mockResolvedValue(invoice({ loyaltyPointsEarned: 0, loyaltyPointsRedeemed: 0 }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.patientsRepo.clawBackLoyaltyPoints).not.toHaveBeenCalled();
    expect(h.patientsRepo.addLoyaltyPoints).not.toHaveBeenCalled();
  });

  it("leaves a walk-in alone — there is no account to adjust", async () => {
    h.repo.findById.mockResolvedValue(
      invoice({ patientId: null, loyaltyPointsEarned: 5, amountDue: "50.00" }),
    );

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.patientsRepo.clawBackLoyaltyPoints).not.toHaveBeenCalled();
    expect(h.patientsRepo.deductOutstanding).not.toHaveBeenCalled();
  });
});

describe("voidInvoice cancels the debt", () => {
  it("removes the unpaid balance from the patient's account", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoice({ status: "partially_paid", amountDue: "450.00" }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.patientsRepo.deductOutstanding).toHaveBeenCalledWith(
      "patient-1", "450.00", expect.anything(),
    );
  });

  it("does not touch the balance on a fully-settled invoice", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoice({ amountDue: "0.00" }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.patientsRepo.deductOutstanding).not.toHaveBeenCalled();
  });
});

describe("voidInvoice reopens the prescription", () => {
  it("hands the dispensed quantity back", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoice({ prescriptionId: "rx-1", items: [{ batchId: "b1", medicineId: "med-1", quantity: 6 }] }),
    );

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.prescriptionUpdates).toHaveLength(1);
    expect(h.prescriptionUpdates[0].quantityDispensed).toBeDefined();
    // Recomputed from the prescribed quantity rather than blanked, so a line
    // another invoice genuinely finished stays finished.
    expect(h.prescriptionUpdates[0].isFullyDispensed).toBeDefined();
    expect(typeof h.prescriptionUpdates[0].isFullyDispensed).not.toBe("boolean");
  });

  it("sums two cart lines for the same medicine into one reversal", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoice({
        prescriptionId: "rx-1",
        items: [
          { batchId: "b1", medicineId: "med-1", quantity: 4 },
          { batchId: "b2", medicineId: "med-1", quantity: 3 },
        ],
      }),
    );

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    // One update for the medicine, not one per line — subtracting per line
    // would leave the second line's quantity standing.
    expect(h.prescriptionUpdates).toHaveLength(1);
  });

  it("skips the prescription work entirely for a walk-in sale", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoice({ prescriptionId: null }));

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.prescriptionUpdates).toHaveLength(0);
  });

  it("ignores consultation-fee lines, which have no medicine", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoice({
        prescriptionId: "rx-1",
        items: [{ batchId: null, medicineId: null, quantity: 1 }],
      }),
    );

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.prescriptionUpdates).toHaveLength(0);
  });
});

describe("voidInvoice still returns the stock", () => {
  it("logs one return movement per stock line", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoice({
        items: [
          { batchId: "b1", medicineId: "med-1", quantity: 2 },
          { batchId: "b2", medicineId: "med-2", quantity: 1 },
        ],
      }),
    );

    await h.service.voidInvoice("inv-1", { reason: "x" } as any, "staff-1");

    expect(h.movementRepo.log).toHaveBeenCalledTimes(2);
  });
});
