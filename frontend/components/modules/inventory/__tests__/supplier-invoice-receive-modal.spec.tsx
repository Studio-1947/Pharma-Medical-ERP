import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
}));
vi.mock("@/hooks/use-branch", () => ({ useActiveBranchId: () => ({ branchId: "branch-1", needsSelection: false }) }));
vi.mock("tesseract.js", () => ({
  PSM: { SINGLE_BLOCK: "6", AUTO: "3" },
  createWorker: vi.fn().mockResolvedValue({
    setParameters: vi.fn(),
    recognize: vi.fn().mockResolvedValue({
      data: { text: "1. 10+1 10'S MYSCOM-LC TAB BIO RD-6604 11/27 21060909 109.00 83.06 4.00 2.50 2.50 830.60" },
    }),
    terminate: vi.fn(),
  }),
}));

import { SupplierInvoiceReceiveModal } from "../supplier-invoice-receive-modal";

describe("supplier invoice bulk receiving", () => {
  it("keeps OCR rows as a draft and converts confirmed strips to tablet stock", async () => {
    get.mockImplementation((url: string) => url === "/procurement/suppliers"
      ? Promise.resolve({ data: [{ id: "sup-1", name: "Medicus Distributors" }] })
      : Promise.resolve({ data: [{ id: "med-1", name: "Myscom-LC Tablet", dosageForm: "Tablet", unit: "Strip", stripSize: 10 }] }));
    post.mockResolvedValue({ data: { id: "batch-1" } });
    const onComplete = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SupplierInvoiceReceiveModal open onClose={() => {}} onComplete={onComplete} /></QueryClientProvider>);

    const upload = screen.getByLabelText(/Photograph printed bill/i) as HTMLInputElement;
    fireEvent.change(upload, { target: { files: [new File(["image"], "invoice.jpg", { type: "image/jpeg" })] } });

    expect(await screen.findByText(/Will add 110 tablets to stock/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Supplier"), "sup-1");
    await userEvent.type(screen.getByLabelText("Supplier invoice number"), "A000198");

    await userEvent.click(screen.getByRole("button", { name: /review complete.*receive stock/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/procurement/supplier-invoices/receive", expect.objectContaining({
      supplierId: "sup-1",
      branchId: "branch-1",
      supplierInvoiceNo: "A000198",
      items: [expect.objectContaining({
        medicineId: "med-1",
        billedQty: 10,
        freeQty: 1,
        unitsPerPack: 10,
        unitCost: "83.06",
        taxPct: "5",
        batchNo: "RD-6604",
        expiryDate: "2027-11-01",
        mrpAtEntry: "109.00",
      })],
    }));
    expect(onComplete).toHaveBeenCalled();
  });

  it("creates and selects a supplier from the bill when it is not listed", async () => {
    vi.clearAllMocks();
    get.mockImplementation((url: string) => url === "/procurement/suppliers"
      ? Promise.resolve({ data: [] })
      : Promise.resolve({ data: [{ id: "med-1", name: "Myscom-LC Tablet", dosageForm: "Tablet", unit: "Strip", stripSize: 10 }] }));
    post.mockImplementation((url: string) => url === "/procurement/suppliers"
      ? Promise.resolve({ data: { id: "sup-new", name: "Medicus Distributors" } })
      : Promise.resolve({ data: {} }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SupplierInvoiceReceiveModal open onClose={() => {}} onComplete={() => {}} /></QueryClientProvider>);

    fireEvent.change(screen.getByLabelText(/Photograph printed bill/i), {
      target: { files: [new File(["image"], "invoice.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByText(/Will add 110 tablets to stock/);
    await userEvent.click(screen.getByRole("button", { name: /Supplier not listed/i }));
    await userEvent.type(screen.getByLabelText("New supplier name"), "Medicus Distributors");
    await userEvent.type(screen.getByLabelText("New supplier code"), "MEDICUS");
    await userEvent.type(screen.getByLabelText("New supplier phone"), "9832672407");
    await userEvent.click(screen.getByRole("button", { name: /Save and select supplier/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/procurement/suppliers", expect.objectContaining({
      name: "Medicus Distributors",
      code: "MEDICUS",
      phone: "9832672407",
    })));
    expect(await screen.findByText(/was added and selected/i)).toBeInTheDocument();
  });
});
