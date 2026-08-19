import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PaymentModal } from "@/components/modules/billing/payment-modal";

const noop = () => {};

function open(total: number, hasPatient = true) {
  return render(
    <PaymentModal
      open
      total={total}
      hasPatient={hasPatient}
      onConfirm={vi.fn()}
      onClose={noop}
    />,
  );
}

/** The panel's headline figure, read back from the "give back" row. */
const giveBack = () =>
  screen.getByText("Give back to customer").parentElement?.textContent ?? "";

describe("PaymentModal cash panel", () => {
  it("offers the exact amount and round notes above the bill", () => {
    open(507.43);

    // A customer cannot hand over less than the bill and have it work, so
    // every suggestion must be at or above it.
    expect(screen.getByRole("button", { name: "Exact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "₹510" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "₹550" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "₹600" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "₹100" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "₹200" })).not.toBeInTheDocument();
  });

  it("never suggests a note equal to or below the bill", () => {
    // A round total used to collide with its own round-up.
    open(500);

    expect(screen.queryByRole("button", { name: "₹500" })).not.toBeInTheDocument();
    // Every step rounds a round bill back onto itself, so the only note left
    // that is genuinely bigger is the next thousand.
    expect(screen.getByRole("button", { name: "₹1000" })).toBeInTheDocument();
  });

  it("works out the change from the note handed over", () => {
    open(507.43);

    fireEvent.click(screen.getByRole("button", { name: "₹600" }));

    expect(giveBack()).toContain("92.57");
  });

  it("says which way the money moves, not 'due'", () => {
    open(507.43);

    // "Amount Due" over a bill total, and "Change Due" under it, both used a
    // word this app reserves for money still owed after the sale.
    expect(screen.getByText("Amount to Collect")).toBeInTheDocument();
    expect(screen.queryByText("Amount Due")).not.toBeInTheDocument();
    expect(screen.queryByText("Change Due")).not.toBeInTheDocument();
  });

  it("warns when the cash entered does not cover the bill", () => {
    open(507.43);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "400" } });

    // Confirming still bills the full amount, so silence here would let a
    // cashier believe they had recorded a part payment.
    expect(screen.getByText(/107.43 less than the bill/)).toBeInTheDocument();
    expect(screen.getByText(/To leave the rest owing/)).toBeInTheDocument();
  });

  it("stays quiet when the cash covers the bill", () => {
    open(507.43);

    fireEvent.click(screen.getByRole("button", { name: "Exact" }));

    expect(screen.queryByText(/less than the bill/)).not.toBeInTheDocument();
    expect(giveBack()).toContain("0.00");
  });
});
