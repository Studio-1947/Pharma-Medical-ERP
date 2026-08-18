import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination, readPageMeta } from "../pagination";

/**
 * Procurement fetched its lists with no page and rendered whatever came back,
 * so it showed the first 20 purchase orders and the first 100 suppliers with
 * nothing on screen admitting more existed. The row count is part of this
 * control for that reason: "20 of 20" and "20 of 253" look identical without it.
 */

const meta = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({ page: 1, limit: 20, total: 253, totalPages: 13 });

describe("Pagination", () => {
  it("says how many records exist, not just the page number", () => {
    render(<Pagination meta={meta()} onPageChange={() => {}} noun="purchase orders" />);
    expect(screen.getByText(/253 purchase orders/)).toBeInTheDocument();
  });

  it("shows which slice of the list is on screen", () => {
    render(<Pagination meta={meta({ page: 3 })} onPageChange={() => {}} />);
    expect(screen.getByText(/Showing 41–60 of 253/)).toBeInTheDocument();
  });

  it("does not overstate the range on the last page", () => {
    render(<Pagination meta={meta({ page: 13, total: 253 })} onPageChange={() => {}} />);
    expect(screen.getByText(/Showing 241–253 of 253/)).toBeInTheDocument();
  });

  it("renders nothing when everything fits on one page", () => {
    const { container } = render(
      <Pagination meta={meta({ total: 8, totalPages: 1 })} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the first response arrives", () => {
    const { container } = render(<Pagination meta={undefined} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("moves forward and back", async () => {
    const onPageChange = vi.fn();
    render(<Pagination meta={meta({ page: 5 })} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(6);

    await userEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("cannot page off either end", () => {
    const { rerender } = render(<Pagination meta={meta({ page: 1 })} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();

    rerender(<Pagination meta={meta({ page: 13 })} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("readPageMeta", () => {
  it("reads meta at the top level", () => {
    expect(readPageMeta({ data: [], meta: base() })?.total).toBe(253);
  });

  it("reads meta nested under data, as some endpoints return it", () => {
    expect(readPageMeta({ data: { data: [], meta: base() } })?.total).toBe(253);
  });

  it("returns undefined for a response that does not paginate", () => {
    expect(readPageMeta({ data: [1, 2, 3] })).toBeUndefined();
    expect(readPageMeta(undefined)).toBeUndefined();
    expect(readPageMeta({ meta: { page: 1 } })).toBeUndefined();
  });
});
