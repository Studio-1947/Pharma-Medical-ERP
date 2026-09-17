import { describe, expect, it } from "vitest";
import { doctorDisplayName, invoiceDoctorName } from "../invoice-doctor-label";

describe("invoice doctor attribution", () => {
  it("uses the doctor joined onto a historical invoice", () => {
    expect(invoiceDoctorName({ referredByDoctor: { firstName: "Sourav", lastName: "Sardar" } })).toBe("Dr. Sourav Sardar");
  });

  it("uses the checkout selection for the immediate receipt response", () => {
    expect(invoiceDoctorName({}, "Dr. Sourav Sardar")).toBe("Dr. Sourav Sardar");
  });

  it("leaves an untagged sale blank and does not duplicate Dr", () => {
    expect(invoiceDoctorName({})).toBe("");
    expect(doctorDisplayName("Dr Rao")).toBe("Dr Rao");
  });
});
