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
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount?: number | string | null;
  paymentMode?: string | null;
  items?: {
    medicineName?: string | null;
    quantity: number | string;
    unitPrice?: number | string | null;
    lineTotal?: number | string | null;
    dosage?: string | null;
    frequency?: string | null;
    duration?: string | null;
  }[];
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
  const name = params.patientName ? `\n👤 *Patient*: ${params.patientName}` : "";

  let text = "";
  if (params.type === "prescription") {
    const doc = params.doctorName ? `\n🩺 *Doctor*: Dr. ${params.doctorName}` : "";
    let itemsText = "";
    if (Array.isArray(params.items) && params.items.length > 0) {
      const list = params.items
        .map((it) => `• *${it.medicineName || "Item"}* (${it.dosage || ""}) × ${it.quantity}`)
        .join("\n");
      itemsText = `\n\n*PRESCRIBED MEDICINES*:\n${list}`;
    }

    text = `*Radha Madhav Medical Hall* 🏥\n*Digital Prescription Record*\n\n📄 *Prescription ID*: #${params.number || params.id.slice(0, 8)}${name}${doc}${itemsText}\n\n🔗 *View Digital Copy*: Contact the pharmacy counter for a secure copy.\n\n*Thank you for choosing Radha Madhav Medical Hall!*`;
  } else {
    let itemsText = "";
    if (Array.isArray(params.items) && params.items.length > 0) {
      const list = params.items
        .map((it) => {
          const nameStr = it.medicineName || "Item";
          const qtyStr = it.quantity;
          const totStr = Number(it.lineTotal || (Number(it.quantity || 1) * Number(it.unitPrice || 0))).toFixed(2);
          return `• *${nameStr}* × ${qtyStr} = ₹${totStr}`;
        })
        .join("\n");
      itemsText = `\n\n*PURCHASED ITEMS*:\n${list}`;
    }

    const sub = params.subtotal ? `\n*Subtotal*: ₹${Number(params.subtotal).toFixed(2)}` : "";
    const tax = Number(params.taxAmount || 0) > 0 ? `\n*GST Tax*: ₹${Number(params.taxAmount).toFixed(2)}` : "";
    const total = params.totalAmount ? `\n💰 *TOTAL PAID*: ₹${Number(params.totalAmount).toFixed(2)}` : "";

    text = `*Radha Madhav Medical Hall* 🏥\n*Tax Invoice / Bill of Supply*\n\n🧾 *Invoice No*: #${params.number || params.id.slice(0, 8)}${name}${itemsText}\n──────────────────${sub}${tax}${total}\n\n📄 *View / Download Digital Receipt*:\n🔗 Contact the pharmacy counter for a secure copy.\n\n*Thank you for choosing Radha Madhav Medical Hall!*\n_Goods once sold will not be taken back without valid reason._`;
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

  let text = "";
  if (params.type === "prescription") {
    text = `Radha Madhav Medical Hall: Your prescription #${params.number || params.id.slice(0, 8)} is ready. Contact the pharmacy counter for a secure copy.`;
  } else {
    text = `Radha Madhav Medical Hall: Your bill receipt #${params.number || params.id.slice(0, 8)} is ready. Contact the pharmacy counter for a secure copy.`;
  }

  const url = `sms:${phone}?body=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
  return true;
}
