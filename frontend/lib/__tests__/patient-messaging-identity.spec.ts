import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CLINIC_PRINT_DETAILS, PHARMACY_PRINT_DETAILS } from "@pharmerp/types";
import { sendViaWhatsApp, sendViaSms } from "@/lib/patient-messaging";

/**
 * A patient reads the WhatsApp or SMS message next to the printed bill, so the
 * two have to agree on who sold them the medicine. These cases pin the split:
 * a bill carries the selling branch's own name, a prescription always carries
 * the clinic's. Both go out through window.open, which is the only observable
 * output this module has.
 */
function openedText(): string {
  const url = (window.open as any).mock.calls[0][0] as string;
  const query = url.slice(url.indexOf("?") + 1);
  const value = new URLSearchParams(query).get("text") ?? new URLSearchParams(query).get("body");
  return value ?? "";
}

describe("patient messaging carries the same identity as the printed document", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the selling branch on a bill, not the built-in store", () => {
    sendViaWhatsApp({
      phone: "9876543210",
      type: "invoice",
      id: "inv-1",
      storeName: "Bright Star Medico",
    });
    const text = openedText();
    expect(text).toContain("Bright Star Medico");
    expect(text).not.toContain(PHARMACY_PRINT_DETAILS.legalName);
  });

  it("falls back to the built-in store when the invoice has no branch", () => {
    sendViaWhatsApp({ phone: "9876543210", type: "invoice", id: "inv-1" });
    expect(openedText()).toContain(PHARMACY_PRINT_DETAILS.legalName);
  });

  it("keeps a prescription on the clinic identity, ignoring any store name", () => {
    sendViaWhatsApp({
      phone: "9876543210",
      type: "prescription",
      id: "rx-1",
      storeName: "Bright Star Medico",
    });
    const text = openedText();
    expect(text).toContain(CLINIC_PRINT_DETAILS.legalName);
    expect(text).not.toContain("Bright Star Medico");
  });

  it("applies the same split to SMS", () => {
    sendViaSms({
      phone: "9876543210",
      type: "invoice",
      id: "inv-1",
      storeName: "Bright Star Medico",
    });
    expect(openedText()).toContain("Bright Star Medico");

    (window.open as any).mockClear();
    sendViaSms({ phone: "9876543210", type: "prescription", id: "rx-1" });
    expect(openedText()).toContain(CLINIC_PRINT_DETAILS.legalName);
  });
});
