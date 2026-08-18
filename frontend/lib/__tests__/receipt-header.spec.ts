import { describe, expect, it } from "vitest";
import { PHARMACY_PRINT_DETAILS } from "@pharmerp/types";
import {
  buildReceiptHeaderHtml,
  RECEIPT_HEADER_STYLES,
} from "@/lib/receipt-header";

/**
 * The printed receipt is written into a detached window with document.write, so
 * nothing else exercises this markup. It also carries the legal identity that
 * appears on a tax invoice, which makes a silent regression here a compliance
 * problem rather than a cosmetic one.
 *
 * Assertions go through a parsed DOM rather than string matching, so they test
 * the structure a browser will actually build.
 */
function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

const ORIGIN = "https://pharmacy.example";

describe("buildReceiptHeaderHtml — clinic patient", () => {
  const html = buildReceiptHeaderHtml({
    tokenNo: 42,
    origin: ORIGIN,
    subtitle: "Tax Invoice / Bill of Supply",
  });
  const dom = parse(html);

  it("prints the token, zero-padded, above everything else", () => {
    const value = dom.querySelector(".token-value");
    expect(value?.textContent).toBe("042");
  });

  it("puts the token before the logo in document order", () => {
    // "Above the invoice" is the whole point of the feature; if the block were
    // emitted after the brand it would still be present but in the wrong place.
    const nodes = Array.from(dom.querySelectorAll(".token-wrap, .brand"));
    expect(nodes[0]?.className).toBe("token-wrap");
    expect(nodes[1]?.className).toBe("brand");
  });

  it("labels the token so the number is not ambiguous", () => {
    expect(dom.querySelector(".token-label")?.textContent).toBe("Token No.");
  });
});

describe("buildReceiptHeaderHtml — walk-in customer", () => {
  const dom = parse(
    buildReceiptHeaderHtml({
      tokenNo: null,
      origin: ORIGIN,
      subtitle: "Tax Invoice / Bill of Supply",
    }),
  );

  it("omits the token block entirely rather than printing an empty box", () => {
    expect(dom.querySelector(".token-wrap")).toBeNull();
    expect(dom.querySelector(".token-box")).toBeNull();
    expect(dom.textContent).not.toContain("Token No.");
  });

  it("still prints the full letterhead", () => {
    expect(dom.querySelector(".legal-name")?.textContent).toBe(
      PHARMACY_PRINT_DETAILS.legalName,
    );
    expect(dom.querySelector(".brand img")).not.toBeNull();
  });
});

describe("buildReceiptHeaderHtml — letterhead identity", () => {
  const dom = parse(
    buildReceiptHeaderHtml({ tokenNo: 1, origin: ORIGIN, subtitle: "Receipt" }),
  );

  it("bills under the legal name, carrying the honorific", () => {
    const name = dom.querySelector(".legal-name")?.textContent ?? "";
    expect(name).toBe("Shree Radha Madhav Medical Hall");
    expect(name.startsWith("Shree ")).toBe(true);
  });

  it("prints the address and phone", () => {
    const addr = dom.querySelector(".legal-addr")?.textContent ?? "";
    expect(addr).toContain("Krishna Nagar, Near Mirik BPHC, Mirik-734214");
    expect(addr).toContain("73844 57427, 97759 31980");
  });

  it("resolves the logo against an absolute origin", () => {
    // The print window is opened blank and has no base URL, so a relative src
    // would silently fail to load and print a bill with no logo.
    const src = dom.querySelector("img")?.getAttribute("src");
    expect(src).toBe(`${ORIGIN}/logo-full.svg`);
  });

  it("keeps the id the print routine waits on before firing", () => {
    // printReceipt() defers window.print() until #brand-logo loads. Renaming
    // this id would reinstate the race that printed logo-less invoices.
    expect(dom.querySelector("#brand-logo")).not.toBeNull();
  });

  it("carries the document subtitle through", () => {
    expect(dom.querySelector(".subtitle")?.textContent).toBe("Receipt");
  });
});

describe("buildReceiptHeaderHtml — escaping and styles", () => {
  it("escapes interpolated values instead of emitting raw markup", () => {
    const dom = parse(
      buildReceiptHeaderHtml({
        tokenNo: 5,
        origin: ORIGIN,
        subtitle: '"><script>alert(1)</script>',
      }),
    );
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector(".subtitle")?.textContent).toContain("<script>");
  });

  it("ships styles for every class the markup uses", () => {
    for (const cls of [
      "token-wrap",
      "token-box",
      "token-label",
      "token-value",
      "brand",
      "legal-name",
      "legal-addr",
    ]) {
      expect(RECEIPT_HEADER_STYLES).toContain(`.${cls}`);
    }
  });
});
