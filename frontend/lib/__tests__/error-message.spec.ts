import { describe, it, expect, afterEach } from "vitest";
import { explainError, errorText } from "../error-message";

/**
 * The people using this are not technical. "Request failed with status code
 * 500" tells a cashier mid-sale nothing about whether the money was taken,
 * whether to try again, or who to tell — so every failure has to come out of
 * here as words that answer those questions, plus a code they can read out.
 */

function apiError(code: string, message?: string, extra: Record<string, unknown> = {}) {
  return { response: { status: 500, data: { code, message, reference: "PH-K7X2QM", ...extra } } };
}

const originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}
afterEach(() => {
  if (originalOnLine) Object.defineProperty(navigator, "onLine", originalOnLine);
});

describe("it never shows a machine sentence to a person", () => {
  it.each([
    "Request failed with status code 500",
    "Network Error",
    "Internal server error",
    "timeout of 5000ms exceeded",
  ])("replaces %s", (raw) => {
    const e = explainError(apiError("INTERNAL_ERROR", raw));
    expect(e.message).not.toBe(raw);
    expect(e.whatToDo).toBeTruthy();
  });

  it("keeps a sentence the server wrote for a human", () => {
    const written = "Not enough Amoxicillin 500mg in stock — 20 needed, 8 available.";
    expect(explainError(apiError("CANNOT_COMPLETE", written)).message).toBe(written);
  });
});

describe("it says what to do next", () => {
  it.each([
    ["NOT_PERMITTED", /administrator/i],
    ["NOT_SIGNED_IN", /sign in/i],
    ["VALIDATION_FAILED", /correct/i],
    ["RETRY_SAFE", /try again/i],
    ["SCHEMA_MISMATCH", /manages your system/i],
  ])("%s tells the person the next step", (code, expected) => {
    expect(explainError(apiError(code)).whatToDo).toMatch(expected);
  });

  it("makes clear a server fault is not the user's mistake", () => {
    expect(explainError(apiError("INTERNAL_ERROR")).whatToDo).toMatch(/not something you did/i);
  });

  it("does not tell the counter to fix a schema mismatch themselves", () => {
    const e = explainError(apiError("SCHEMA_MISMATCH"));
    expect(e.whatToDo).toMatch(/nobody at the counter can fix this/i);
  });
});

describe("it carries a reference worth quoting", () => {
  it("passes the server's reference through", () => {
    expect(explainError(apiError("INTERNAL_ERROR")).reference).toBe("PH-K7X2QM");
  });

  it("omits it when the server did not send one", () => {
    const e = explainError({ response: { status: 422, data: { code: "CANNOT_COMPLETE" } } });
    expect(e.reference).toBeUndefined();
  });
});

describe("field errors are readable", () => {
  it("names the field in words, not in camelCase", () => {
    const e = explainError(
      apiError("VALIDATION_FAILED", "Validation failed", {
        errors: { patientPhone: ["must be 10 digits"] },
      }),
    );
    expect(e.message).toBe("Patient Phone: must be 10 digits");
  });

  it("prefers the field detail over the generic sentence", () => {
    const e = explainError(
      apiError("VALIDATION_FAILED", "Validation failed", {
        errors: { name: ["is required"] },
      }),
    );
    expect(e.message).not.toBe("Validation failed");
  });
});

describe("no response at all", () => {
  it("explains an offline device and reassures about queued sales", () => {
    setOnline(false);
    const e = explainError(new Error("Network Error"));
    expect(e.title).toMatch(/no connection/i);
    expect(e.whatToDo).toMatch(/saved on this device/i);
  });

  it("warns to check before re-entering after a timeout", () => {
    setOnline(true);
    const e = explainError({ code: "ECONNABORTED", message: "timeout of 5000ms exceeded" });
    // The sale may have gone through; re-entering blind is how one sale
    // becomes two invoices.
    expect(e.whatToDo).toMatch(/check the invoice list/i);
  });
});

describe("stored failure reasons from the offline queue", () => {
  it("shows a human reason as written", () => {
    const e = explainError("Not enough Paracetamol in stock — 5 needed, 2 available.");
    expect(e.message).toMatch(/Paracetamol/);
  });

  it("replaces a machine reason", () => {
    const e = explainError("Request failed with status code 500");
    expect(e.message).not.toMatch(/status code/);
  });
});

describe("errorText", () => {
  it("joins the detail and the next step into one line", () => {
    const text = errorText(apiError("NOT_PERMITTED"));
    expect(text).toMatch(/access/i);
    expect(text).toMatch(/administrator/i);
  });
});
