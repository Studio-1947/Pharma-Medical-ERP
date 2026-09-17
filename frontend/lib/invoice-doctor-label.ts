export function doctorDisplayName(value?: string | null): string {
  const name = String(value ?? "").trim();
  if (!name) return "";
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
}

export function invoiceDoctorName(invoice: any, checkoutDoctorName?: string | null): string {
  const joined = [invoice?.referredByDoctor?.firstName, invoice?.referredByDoctor?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return doctorDisplayName(joined || checkoutDoctorName);
}

export const INVOICE_DOCTOR_LABEL = "Prescribed / Referred by";
