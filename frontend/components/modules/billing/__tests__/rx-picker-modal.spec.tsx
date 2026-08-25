import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Logging a paper prescription at the counter.
 *
 * The form used to be replaced by "Please select a patient in POS search"
 * whenever the calling screen had nobody selected — which a counter sale never
 * does, it is a walk-in by definition. So the paper prescription could not be
 * recorded at all, on an ordinary sale or a Schedule H one. The mutation had a
 * walk-in fallback written for exactly this case; the guard meant it could
 * never run.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
  queryKeys: { prescriptions: { all: () => ["prescriptions"] } },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../prescription-scan-upload", () => ({
  PrescriptionScanUpload: () => <div data-testid="scan-upload" />,
}));

import { RxPickerModal } from "../rx-picker-modal";

function renderPicker(props: Partial<React.ComponentProps<typeof RxPickerModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RxPickerModal open onClose={vi.fn()} onSelectRx={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

/** Switches to the paper-prescription tab. */
async function openLogTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Log Details \/ Photo/i }));
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: [] });
  post.mockImplementation((url: string) => {
    if (url === "/patients") return Promise.resolve({ data: { id: "pat-new" } });
    if (url === "/prescriptions") return Promise.resolve({ data: { id: "rx-new" } });
    return Promise.resolve({ data: { id: "ok" } });
  });
});

describe("logging a paper prescription without a patient selected", () => {
  it("shows the form instead of refusing, when nobody is selected", async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLogTab(user);

    // The whole bug: this used to be the only thing on the tab.
    expect(
      screen.queryByText(/select a patient in POS search/i),
    ).not.toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i)).toBeInTheDocument();
  });

  it("files it against the shared walk-in record when the customer is not named", async () => {
    const user = userEvent.setup();
    renderPicker({ context: "optional" });
    await openLogTab(user);

    await user.type(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i), "Dr Rao");
    await user.click(screen.getByRole("button", { name: /Verify & Link/i }));

    await waitFor(() =>
      expect(post.mock.calls.some(([u]) => u === "/prescriptions")).toBe(true),
    );
    // Looked up by the reserved number, not by searching for the word
    // "Walk-in", which would match a real person whose name contains it.
    const lookups = get.mock.calls.filter(([u]) => u === "/patients");
    expect(lookups.some(([, cfg]: any) => cfg?.params?.search === "0000000000")).toBe(true);
  });

  it("files it under the customer when a name and number are given", async () => {
    const user = userEvent.setup();
    renderPicker({ context: "optional" });
    await openLogTab(user);

    await user.type(screen.getByLabelText(/Customer name for this prescription/i), "Ramesh Das");
    await user.type(screen.getByLabelText(/Customer phone for this prescription/i), "9876543210");
    await user.type(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i), "Dr Rao");
    await user.click(screen.getByRole("button", { name: /Verify & Link/i }));

    await waitFor(() =>
      expect(post.mock.calls.some(([u]) => u === "/prescriptions")).toBe(true),
    );
    const created = post.mock.calls.find(([u]) => u === "/patients");
    expect(created?.[1]).toMatchObject({ name: "Ramesh Das", phone: "9876543210" });
  });

  it("does not demand a council number for an ordinary counter sale", async () => {
    const user = userEvent.setup();
    renderPicker({ context: "optional" });
    await openLogTab(user);

    await user.type(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i), "Dr Rao");
    await user.click(screen.getByRole("button", { name: /Verify & Link/i }));

    // The customer's slip often does not carry an MCI number, and there is no
    // Schedule H register behind an ordinary sale that needs one.
    await waitFor(() =>
      expect(post.mock.calls.some(([u]) => u === "/prescriptions")).toBe(true),
    );
  });

  it("still demands a council number for Schedule H", async () => {
    const user = userEvent.setup();
    renderPicker({ context: "schedule-h" });
    await openLogTab(user);

    await user.type(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i), "Dr Rao");
    await user.click(screen.getByRole("button", { name: /Verify & Link/i }));

    // The register has to identify the prescriber; relaxing the optional case
    // must not relax this one.
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls.some(([u]) => u === "/prescriptions")).toBe(false);
  });

  it("keeps the prescription on the account when one is already chosen", async () => {
    const user = userEvent.setup();
    renderPicker({ patientId: "pat-existing", patientName: "Ramesh Das" });
    await openLogTab(user);

    // No need to ask again for someone the sale already names.
    expect(
      screen.queryByLabelText(/Customer name for this prescription/i),
    ).not.toBeInTheDocument();

    await user.type(await screen.findByPlaceholderText(/Dr\. A\. K\. Sharma/i), "Dr Rao");
    await user.type(screen.getByPlaceholderText(/WBMC-84920/i), "WBMC-1");
    await user.click(screen.getByRole("button", { name: /Verify & Link/i }));

    await waitFor(() =>
      expect(post.mock.calls.some(([u]) => u === "/prescriptions")).toBe(true),
    );
    const rx = post.mock.calls.find(([u]) => u === "/prescriptions");
    expect(rx?.[1]).toMatchObject({ patientId: "pat-existing" });
    // And no second patient record invented for someone already on the sale.
    expect(post.mock.calls.some(([u]) => u === "/patients")).toBe(false);
  });
});
