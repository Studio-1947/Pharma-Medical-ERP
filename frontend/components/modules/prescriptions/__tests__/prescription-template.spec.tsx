import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PrescriptionTemplate,
  toPrescriptionTemplateData,
} from "@/components/modules/prescriptions/prescription-template";

/**
 * The prescription is laid out absolutely over the letterhead artwork, so a
 * misplaced or missing token box is invisible to typecheck and to the build.
 *
 * letterheadSvg is passed explicitly: the component otherwise fetches the
 * artwork from /public, which does not exist under test.
 */
const STUB_LETTERHEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"></svg>';

function renderRx(overrides: Record<string, unknown> = {}) {
  const rx = toPrescriptionTemplateData({
    id: "rx-1",
    prescriptionNumber: "RX-0001",
    patientName: "Test Patient",
    items: [],
    ...overrides,
  });
  return render(<PrescriptionTemplate rx={rx} letterheadSvg={STUB_LETTERHEAD} />);
}

describe("PrescriptionTemplate — clinic queue token", () => {
  it("renders the token, zero-padded, when the visit came from the queue", () => {
    renderRx({ tokenNo: 7 });

    expect(screen.getByText("TOKEN NO.")).toBeInTheDocument();
    expect(screen.getByText("007")).toBeInTheDocument();
  });

  it("omits the token box for a prescription with no queue token", () => {
    // Uploaded scans and counter entries never had a token.
    renderRx({ tokenNo: null });

    expect(screen.queryByText("TOKEN NO.")).not.toBeInTheDocument();
  });

  it("omits the box for a zero token rather than printing 000", () => {
    renderRx({ tokenNo: 0 });

    expect(screen.queryByText("TOKEN NO.")).not.toBeInTheDocument();
    expect(screen.queryByText("000")).not.toBeInTheDocument();
  });

  it("accepts a token arriving as a string from JSON", () => {
    renderRx({ tokenNo: "13" });

    expect(screen.getByText("013")).toBeInTheDocument();
  });

  it("still renders the prescription body alongside the token", () => {
    // Guards against the absolutely-positioned token block being inserted in a
    // way that displaces the rest of the document.
    renderRx({ tokenNo: 4 });

    expect(screen.getByText("Test Patient")).toBeInTheDocument();
    expect(screen.getByText("004")).toBeInTheDocument();
  });
});

describe("toPrescriptionTemplateData", () => {
  it("maps tokenNo through from the API payload", () => {
    expect(toPrescriptionTemplateData({ id: "x", tokenNo: 9 }).tokenNo).toBe(9);
  });

  it("defaults tokenNo to null when the payload omits it", () => {
    expect(toPrescriptionTemplateData({ id: "x" }).tokenNo).toBeNull();
  });

  it("unwraps the nested data envelope the API returns", () => {
    const mapped = toPrescriptionTemplateData({ data: { id: "y", tokenNo: 21 } });
    expect(mapped.id).toBe("y");
    expect(mapped.tokenNo).toBe(21);
  });
});
