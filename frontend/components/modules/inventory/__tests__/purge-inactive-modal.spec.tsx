import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The purge modal deletes catalogue rows outright, so what is checked here is
 * the guard rail rather than the happy path:
 *
 *  - opening previews and never deletes;
 *  - the delete stays locked until the operator types the confirm word;
 *  - the request echoes back the exact count that was displayed, which is what
 *    lets the server refuse a stale preview.
 */

const post = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  queryKeys: { medicines: { all: () => ["medicines"] } },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { PurgeInactiveModal } from "../purge-inactive-modal";

const PREVIEW = {
  candidates: 26000,
  deletable: 25800,
  blocked: 200,
  blockedBy: [{ label: "stock batches", count: 200 }],
  sideEffects: { prescriptionLinksCleared: 0, doctorFavouritesRemoved: 3 },
  sample: [{ sku: "MED09001", name: "Zyrtec 10 mg Tablet", createdAt: "2026-08-21T00:00:00Z" }],
  dryRun: true,
  deleted: 0,
};

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PurgeInactiveModal open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("PurgeInactiveModal", () => {
  beforeEach(() => {
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    post.mockResolvedValue(PREVIEW);
  });

  it("previews on open and does not delete", async () => {
    renderModal();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      "/inventory/medicines/purge-inactive",
      expect.objectContaining({ dryRun: true }),
    );
    // Exactly one call, and it was the preview.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("shows the deletable count and what is held back", async () => {
    renderModal();
    expect(await screen.findByText("25,800")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText(/have stock batches/i)).toBeInTheDocument();
  });

  it("warns about the cascade that would otherwise be silent", async () => {
    renderModal();
    expect(
      await screen.findByText(/doctor favourite-list entries/i),
    ).toBeInTheDocument();
  });

  it("keeps the delete button locked until the confirm word is typed", async () => {
    renderModal();
    const btn = await screen.findByRole("button", { name: /delete 25,800 medicines/i });
    expect(btn).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("DELETE"), "delete me");
    expect(btn).toBeDisabled();
  });

  it("arms on the exact confirm word and echoes back the previewed count", async () => {
    renderModal();
    const btn = await screen.findByRole("button", { name: /delete 25,800 medicines/i });
    await userEvent.type(screen.getByPlaceholderText("DELETE"), "DELETE");
    await waitFor(() => expect(btn).toBeEnabled());

    post.mockResolvedValueOnce({ ...PREVIEW, dryRun: false, deleted: 25800 });
    await userEvent.click(btn);

    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        "/inventory/medicines/purge-inactive",
        // expectedCount is what lets the server reject a preview that has gone
        // stale; sending anything but the displayed number defeats the guard.
        expect.objectContaining({ dryRun: false, expectedCount: 25800 }),
      ),
    );
  });

  it("reports that nothing was deleted when the server refuses", async () => {
    renderModal();
    const btn = await screen.findByRole("button", { name: /delete 25,800 medicines/i });
    await userEvent.type(screen.getByPlaceholderText("DELETE"), "DELETE");
    await waitFor(() => expect(btn).toBeEnabled());

    post.mockRejectedValueOnce({
      response: { data: { message: "The catalogue changed since the preview" } },
    });
    await userEvent.click(btn);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("offers no delete when nothing matches", async () => {
    post.mockResolvedValue({ ...PREVIEW, candidates: 0, deletable: 0, blocked: 0, blockedBy: [], sample: [] });
    renderModal();
    expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("DELETE")).not.toBeInTheDocument();
  });
});
