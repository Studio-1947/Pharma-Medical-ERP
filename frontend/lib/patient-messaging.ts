/**
 * Patient Messaging Dispatcher (WhatsApp & SMS)
 * 
 * Provides instant 1-click dispatch to patients' mobile phones via
 * WhatsApp (wa.me) or SMS without requiring paid API gateways.
 */

export interface DispatchParams {
  phone?: string | null;
  patientName?: string | null;
  type: "prescription" | "invoice";
  id: string;
  number?: string | null;
  doctorName?: string | null;
  totalAmount?: number | string | null;
}

/**
  Formats an Indian/International phone number to standard wa.me format (e.g., 919876543210)
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    cleaned = `91${cleaned}`;
  }
  return cleaned;
}

/**
 * Builds public view link for prescriptions or invoices
 */
export function getPublicViewUrl(type: "prescription" | "invoice", id: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${baseUrl}/p/${type === "prescription" ? "rx" : "inv"}-${id}`;
}

/**
 * Dispatches message to WhatsApp via wa.me protocol
 */
export function sendViaWhatsApp(params: DispatchParams): boolean {
  let rawPhone = params.phone;

  if (!rawPhone) {
    if (typeof window !== "undefined") {
      const input = window.prompt("Enter patient mobile number to send WhatsApp message:");
      if (!input || !input.trim()) return false;
      rawPhone = input.trim();
    } else {
      return false;
    }
  }

  const phone = formatPhoneNumber(rawPhone);
  const link = getPublicViewUrl(params.type, params.id);
  const name = params.patientName ? ` *${params.patientName}*` : "";

  let text = "";
  if (params.type === "prescription") {
    const doc = params.doctorName ? ` from *Dr. ${params.doctorName}*` : "";
    text = `*Radha Madhav Medical Hall* 🏥\n\nHello${name}, your digital prescription${doc} is ready!\n\n📄 *Prescription ID*: #${params.number || params.id.slice(0, 8)}\n\nTap to view your digital prescription & dosage guide:\n🔗 ${link}\n\n*Thank you for choosing Radha Madhav Medical Hall!*`;
  } else {
    const amt = params.totalAmount ? `\n💰 *Total Amount*: ₹${Number(params.totalAmount).toFixed(2)}` : "";
    text = `*Radha Madhav Medical Hall* 🏥\n\nHello${name}, thank you for your visit! Your bill receipt is ready.${amt}\n\n🧾 *Invoice No*: #${params.number || params.id.slice(0, 8)}\n\nTap to view your digital tax receipt & invoice:\n🔗 ${link}\n\n*Get well soon!*`;
  }

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Dispatches SMS via native SMS protocol
 */
export function sendViaSms(params: DispatchParams): boolean {
  if (!params.phone) return false;

  const phone = params.phone.replace(/\D/g, "");
  const link = getPublicViewUrl(params.type, params.id);

  let text = "";
  if (params.type === "prescription") {
    text = `Radha Madhav Medical Hall: Your prescription #${params.number || params.id.slice(0, 8)} is ready. View here: ${link}`;
  } else {
    text = `Radha Madhav Medical Hall: Your bill receipt #${params.number || params.id.slice(0, 8)} is ready. View here: ${link}`;
  }

  const url = `sms:${phone}?body=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
  return true;
}
