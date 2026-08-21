import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Smoke-tests for the doctor overview cards rendered on the counter desk:
 *
 *  - the medicine count badge shows the correct number once the list loads;
 *  - the "Add medicine" button appears on empty cards;
 *  - the "+" manage button appears on cards with medicines;
 *  - none of the manage affordances appear when the callback is omitted.
 */

vi.mock("@/queries/clinic.queries", () => ({
  useDoctorMedicines: (doctorId: string) => ({
    data: {
      data:
        doctorId === "doc-1"
          ? [
              { id: "dm-1", medicineId: "m1", name: "Dolo 650", strength: "650mg" },
              { id: "dm-2", medicineId: "m2", name: "Cetirizine", strength: "10mg" },
              { id: "dm-3", medicineId: "m3", name: "Pantop", strength: "40mg" },
            ]
          : [],
    },
    isLoading: false,
    isError: false,
  }),
}));

import { DoctorsOverview } from "../doctors-overview";

const DOCTORS = [
  {
    id: "doc-1",
    firstName: "Anu",
    lastName: "Sardar",
    email: "anu@clinic.com",
    doctorProfile: { specialty: "General Medicine", opdRoom: "Cabin 101" },
  },
  {
    id: "doc-2",
    firstName: "Rahul",
    lastName: "Chettri",
    email: "rahul@clinic.com",
    doctorProfile: { specialty: "ENT", opdRoom: "Cabin 102" },
  },
];

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderOverview(
  doctors = DOCTORS,
  opts: { onManageMedicines?: (d: any) => void; onOpenDoctor?: (d: any) => void } = {},
) {
  return render(
    <QueryClientProvider client={qc()}>
      <DoctorsOverview
        doctors={doctors}
        branchId="branch-1"
        onManageMedicines={opts.onManageMedicines}
        onOpenDoctor={opts.onOpenDoctor}
      />
    </QueryClientProvider>,
  );
}

describe("DoctorsOverview", () => {
  it("renders a medicine count badge with the correct number", async () => {
    renderOverview();

    // Badge shows "#3" for doc-1
    expect(await screen.findByText("#3")).toBeInTheDocument();
    // Badge does NOT appear for doc-2 (empty list)
    expect(screen.queryByText("#0")).not.toBeInTheDocument();
  });

  it("shows 'Add medicine' button on empty doctor cards", async () => {
    renderOverview(DOCTORS, { onManageMedicines: vi.fn() });

    expect(await screen.findByText("No medicines listed yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add medicine/i })).toBeInTheDocument();
  });

  it("shows '+' manage button on cards with medicines", async () => {
    renderOverview(DOCTORS, { onManageMedicines: vi.fn() });

    // Wait for the badge to confirm the card loaded
    await screen.findByText("#3");
    // The "+" button should be there
    expect(
      screen.getAllByRole("button", { name: /Add or remove medicines/i }),
    ).toHaveLength(1);
  });

  it("calls onManageMedicines when the add/manage button is clicked", async () => {
    const onManage = vi.fn();
    renderOverview(DOCTORS, { onManageMedicines: onManage });

    // Click "Add medicine" on doc-2 (empty card)
    const addBtn = await screen.findByRole("button", { name: /Add medicine/i });
    addBtn.click();

    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-2" }),
    );
  });

  it("does not render manage buttons when onManageMedicines is not provided", async () => {
    renderOverview(DOCTORS, { onManageMedicines: undefined });

    await screen.findByText("#3");
    expect(screen.queryByRole("button", { name: /Add medicine/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add or remove medicines/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the section header with doctor count", async () => {
    renderOverview();
    expect(
      await screen.findByText(/Doctors today.*usual medicines.*2/i),
    ).toBeInTheDocument();
  });

  it("shows medicine chips for loaded medicines", async () => {
    renderOverview();
    expect(await screen.findByText(/Dolo 650/)).toBeInTheDocument();
    expect(screen.getByText(/Cetirizine/)).toBeInTheDocument();
    expect(screen.getByText(/Pantop/)).toBeInTheDocument();
  });
});
