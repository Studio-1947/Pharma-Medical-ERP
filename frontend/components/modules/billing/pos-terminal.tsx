"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { PHARMACY_PRINT_DETAILS, formatTokenNo } from "@pharmerp/types";
import { buildReceiptHeaderHtml, RECEIPT_HEADER_STYLES } from "@/lib/receipt-header";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Plus, Minus, ShoppingCart, Printer, AlertTriangle, FileText, Star, X, UserPlus, Camera, ShieldAlert, ShieldCheck, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, LayoutGrid, Table, Percent, Edit3, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import { useCartStore, CartItem } from "@/stores/cart.store";
import { useUIStore } from "@/stores/ui.store";
import { canSellLooseUnits, formatStockUnit, getUnitLabel } from "@/lib/stock-unit-formatter";
import { isControlledScheduleClass } from "@/lib/schedule-class";
import { PaymentModal } from "./payment-modal";
import { RxPickerModal } from "./rx-picker-modal";
import { OtcSupplyModal } from "./otc-supply-modal";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { usePermissions } from "@/hooks/use-permissions";
import { queueOfflineInvoice, syncOfflineQueue } from "@/lib/pos-db";
import { errorText } from "@/lib/error-message";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useDebounce } from "@/hooks/use-debounce";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { BarcodeScannerDialog } from "@/components/shared/barcode-scanner-dialog";
import { useActiveBranchId } from "@/hooks/use-branch";
import { sendViaWhatsApp } from "@/lib/patient-messaging";
import { isValidPhoneNumber } from "@/lib/phone-validation";
import { invalidateMedicineViews } from "@/lib/query-invalidation";



const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const formInputCls =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition placeholder:text-slate-400";
const formLabelCls = "block text-xs font-semibold text-slate-600 mb-1";

export function PosTerminal({
  paymentOnly = false,
  onFinishedSale,
}: {
  /**
   * Render a focused checkout view instead of the classic POS terminal — used
   * by the new billing flow when the counter desk hands the bill over for
   * payment. The classic chrome (dark Point of Sale bar, medicine search,
   * barcode scanner, scale mode) is hidden; the cart review, totals and the
   * payment modal are identical to the terminal's.
   */
  paymentOnly?: boolean;
  /**
   * Called when the operator finishes with a completed sale and wants the next
   * customer. Only meaningful alongside `paymentOnly`: the counter desk hands
   * the bill over for payment, so "New Sale" belongs back at the desk rather
   * than on an empty payment screen. The standalone terminal passes nothing
   * and stays where it is, which is where a medicine-first cashier wants it.
   */
  onFinishedSale?: () => void;
}) {
  const {
    warning: toastWarning,
    success: toastSuccess,
    info: toastInfo,
    error: toastError,
    fromError: toastFromError,
  } = useToast();
  // Batch lookups are pinned to the selling branch so the packs shown on screen
  // are the packs the checkout will actually allocate. Branch staff are scoped
  // server-side anyway; this is what keeps super_admin's view honest.
  const { branchId: activeBranchId } = useActiveBranchId();
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [rxPickerOpen, setRxPickerOpen] = useState(false);
  // Schedule H in a queue: a manager can vouch for a prescription they have
  // seen and attach it afterwards. The bill still records the debt.
  const [rxAttested, setRxAttested] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Whole medicine row, not just id+name: the OTC modal prices the sale from
  // its MRP, tax rate and strip size.
  const [otcSupplyTarget, setOtcSupplyTarget] = useState<any | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [lastReceiptItems, setLastReceiptItems] = useState<any[]>([]);
  const [lastReceiptPatient, setLastReceiptPatient] = useState<any>(null);
  const [lastReceiptPayments, setLastReceiptPayments] = useState<any[]>([]);
  const [lastReceiptFee, setLastReceiptFee] = useState<{ doctorName: string; amount: number } | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Out-of-stock / unlinked medicines skipped when a prescription is auto-loaded
  // from the clinic queue ("Open in POS"). Shown as a dismissible amber banner.
  const [rxLoadWarnings, setRxLoadWarnings] = useState<string[]>([]);

  const [allowOversell, setAllowOversell] = useState(false);
  const [stockLimitDialog, setStockLimitDialog] = useState<{
    open: boolean;
    itemName: string;
    requestedQty: number;
    maxAvailable: number;
    unit: string;
    item?: CartItem;
  }>({
    open: false,
    itemName: "",
    requestedQty: 0,
    maxAvailable: 0,
    unit: "Strip",
  });

  // When an inactive medicine is picked from search, the operator sets its MRP
  // and the medicine is activated before it enters the cart.
  const [inactiveMrpTarget, setInactiveMrpTarget] = useState<any | null>(null);
  const [inactiveMrpValue, setInactiveMrpValue] = useState("");
  const [inactiveMrpLoading, setInactiveMrpLoading] = useState(false);
  const [inactiveMrpError, setInactiveMrpError] = useState<string | null>(null);

  const confirmInactiveMrp = async () => {
    if (!inactiveMrpTarget) return;
    const mrp = parseFloat(inactiveMrpValue);
    if (!mrp || mrp <= 0) {
      setInactiveMrpError("Enter a valid MRP greater than zero.");
      return;
    }
    setInactiveMrpLoading(true);
    setInactiveMrpError(null);
    try {
      await apiClient.patch(`/inventory/medicines/${inactiveMrpTarget.id}`, {
        priceMrp: mrp.toFixed(2),
        isActive: true,
      });
      // Update the local medicine object so handleAddMedicine sees the new MRP
      // The row was just activated. Every cached list still has it as
      // Inactive at the old price, and nothing else will correct them — this
      // is what used to make a manual page refresh necessary.
      await invalidateMedicineViews(queryClient);
      const patched = { ...inactiveMrpTarget, priceMrp: mrp.toFixed(2), isActive: true };
      setInactiveMrpTarget(null);
      setInactiveMrpValue("");
      toastSuccess("Medicine activated", `"${patched.name}" is now active at MRP ₹${mrp.toFixed(2)}.`);
      await handleAddMedicine(patched);
    } catch (err: any) {
      setInactiveMrpError(err?.response?.data?.message ?? "Failed to update MRP. Try again.");
    } finally {
      setInactiveMrpLoading(false);
    }
  };

  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [patientFormError, setPatientFormError] = useState("");
  const [patientForm, setPatientForm] = useState({
    name: "",
    phone: "",
    email: "",
    gender: "",
    dateOfBirth: "",
    address: "",
    state: "",
    bloodGroup: "",
  });

  const queryClient = useQueryClient();

  const createPatientMutation = useMutation({
    mutationFn: (data: object) => apiClient.post("/patients", data) as any,
    onSuccess: (res: any) => {
      const p = res?.data ?? res;
      queryClient.invalidateQueries({ queryKey: ["patient-search-pos"] });
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      if (p?.id) {
        setPatient(p.id);
      }
      setIsPatientModalOpen(false);
      setPatientSearch("");
      setPatientForm({
        name: "",
        phone: "",
        email: "",
        gender: "",
        dateOfBirth: "",
        address: "",
        state: "",
        bloodGroup: "",
      });
      setPatientFormError("");
    },
    onError: (err: any) => {
      setPatientFormError(errorText(err));
    },
  });

  const handleRegisterPatientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPatientFormError("");
    if (!patientForm.name.trim() || !patientForm.phone.trim()) {
      setPatientFormError("Name and Phone are required.");
      return;
    }
    if (!isValidPhoneNumber(patientForm.phone)) {
      setPatientFormError("Please enter a valid 10-digit mobile number (e.g. 9876543210 or +91 9876543210).");
      return;
    }
    const payload: Record<string, any> = {
      name: patientForm.name.trim(),
      phone: patientForm.phone.trim(),
    };
    if (patientForm.email.trim()) payload.email = patientForm.email.trim();
    if (patientForm.dateOfBirth) payload.dateOfBirth = new Date(patientForm.dateOfBirth).toISOString();
    if (patientForm.gender) payload.gender = patientForm.gender;
    if (patientForm.address.trim()) payload.address = patientForm.address.trim();
    if (patientForm.state.trim()) payload.state = patientForm.state.trim();
    if (patientForm.bloodGroup) payload.bloodGroup = patientForm.bloodGroup;

    createPatientMutation.mutate(payload);
  };

  // Rehydrate the persisted cart from localStorage on first client render.
  // This prevents the SSR/client mismatch (server sees empty cart, client sees saved items).
  useEffect(() => {
    useCartStore.persist.rehydrate();
  }, []);

  // Close print preview on Escape key
  useEffect(() => {
    if (!printOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPrintOpen(false); setLastInvoice(null); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [printOpen]);


  const {
    sidebarCollapsed, setSidebarCollapsed, toggleSidebar,
    posViewMode, setPosViewMode, togglePosViewMode,
  } = useUIStore();

  const {
    items, addItem, updateQty, updateDiscountPct, toggleUnit, removeItem, clear, totals,
    patientId,
    prescriptionId, setPrescriptionId,
    consultationFee, setConsultationFee,
    loyaltyPointsToRedeem, setLoyaltyPointsToRedeem,
    setPatient, hasControlledItems,
  } = useCartStore();
  const { user } = useAuthStore();
  // OTC hand-outs are admin/shop-manager actions on the API; a doctor who sees
  // the button would only get a 403 on click, so hide it for roles without
  // inventory.adjust (super_admin, admin, shop_manager all hold it).
  const { can: canPerm, role: permRole } = usePermissions();
  // The OTC modal now bills by default and only falls back to a free hand-out,
  // so either permission opens it — the modal disables the path you lack.
  const canOtc = canPerm("billing.create") || canPerm("inventory.adjust");
  const { subtotal, tax, discount, total } = totals();

  const needsRx = hasControlledItems();
  // The three roles the server accepts as an override approver. Offering the
  // button to anyone else would only earn them a rejection at checkout.
  const canAttestRx = ["super_admin", "admin", "shop_manager"].includes(String(permRole));
  const currentUserId = user?.id ?? null;
  // Either the prescription is here, or someone senior has put their name to
  // having seen it.
  const rxSettled = !needsRx || !!prescriptionId?.trim() || rxAttested;

  // A manager vouches for the bill in front of them, not for the till. Once the
  // last controlled item is off the cart — removed, cleared, or because the
  // sale went through — the vouching has nothing left to stand behind, so it
  // is dropped.
  //
  // Two things went wrong without this. The bill after an attested sale still
  // carried rxPending and the server rejected it ("Nothing on this bill needs
  // a prescription…"), with no Rx panel on screen to undo it. And swapping one
  // controlled drug for another would have carried the first drug's
  // attestation onto a drug nobody vouched for. Re-attesting is the point.
  useEffect(() => {
    if (!needsRx) setRxAttested(false);
  }, [needsRx]);
  const loyaltyDiscount = loyaltyPointsToRedeem / 10;
  const finalTotal = Math.max(0, total - loyaltyDiscount);

  const handleCartQtyChange = (item: CartItem, targetQty: number) => {
    if (targetQty <= 0) {
      removeItem(item.medicineId, item.batchId);
      return;
    }

    const availableBatchQty = item.batchStock ?? item.totalStock ?? 99999;
    const maxAvailable = item.saleUnit === "loose"
      ? availableBatchQty * (item.stripSize || 1)
      : availableBatchQty;

    if (targetQty > maxAvailable && !allowOversell) {
      setStockLimitDialog({
        open: true,
        itemName: item.name,
        requestedQty: targetQty,
        maxAvailable,
        unit: item.saleUnit === "loose" ? "Loose Pill" : getUnitLabel(maxAvailable, { unit: item.unit, stripSize: item.stripSize }),
        item,
      });
      updateQty(item.medicineId, item.batchId, maxAvailable);
    } else {
      updateQty(item.medicineId, item.batchId, targetQty);
    }
  };

  const printReceipt = () => {
    if (!lastInvoice) return;
    const w = window.open("", "_blank", "width=794,height=1050");
    if (!w) return;
    const itemRows = lastReceiptItems.map((item, i) => {
      const isLoose = item.saleUnit === "loose";
      const displayPrice = isLoose ? item.unitPrice / (item.stripSize || 1) : item.unitPrice;
      const displayQty = isLoose ? `${item.quantity} Tab` : `${item.quantity} Strip`;
      return `
        <tr>
          <td>
            <div class="medicine-name">${i + 1}. ${item.name}</div>
            <div class="batch-label">Batch: ${item.batchNo}</div>
          </td>
          <td class="text-center">${displayQty}</td>
          <td class="text-right">₹${displayPrice.toFixed(2)}</td>
          <td class="text-right">${item.discountPct > 0 ? item.discountPct + "%" : "—"}</td>
          <td class="text-right">${item.taxPct > 0 ? item.taxPct + "%" : "—"}</td>
          <td class="text-right"><b>₹${item.lineTotal.toFixed(2)}</b></td>
        </tr>`;
    }).join("");

    const feeRow = lastReceiptFee
      ? `
        <tr>
          <td>
            <div class="medicine-name">${lastReceiptItems.length + 1}. Doctor Consultation</div>
            <div class="batch-label">${lastReceiptFee.doctorName} · GST-exempt service</div>
          </td>
          <td class="text-center">1</td>
          <td class="text-right">₹${lastReceiptFee.amount.toFixed(2)}</td>
          <td class="text-right">—</td>
          <td class="text-right">—</td>
          <td class="text-right"><b>₹${lastReceiptFee.amount.toFixed(2)}</b></td>
        </tr>`
      : "";

    const payRows = lastReceiptPayments.map(p => `
      <tr>
        <td><span class="badge">${p.mode}</span>${p.referenceNo ? `  <span style="color:#888;font-size:12px">Ref: ${p.referenceNo}</span>` : ""}</td>
        <td class="text-right"><b>₹${parseFloat(p.amount).toFixed(2)}</b></td>
      </tr>`).join("");

    const discountAmt = parseFloat(lastInvoice.discountAmount ?? "0");

    w.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${lastInvoice.invoiceNo}</title>
<style>
  @page { size: A4; margin: 18mm 20mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size:14px; color:#111; width:100%; }
  h1 { font-size:22px; font-weight:900; text-align:center; text-transform:uppercase; letter-spacing:2px; margin-bottom:4px; }
  .subtitle { text-align:center; color:#666; font-size:12px; margin-bottom:16px; }
  .divider { border:none; border-top:1.5px dashed #bbb; margin:14px 0; }
  .divider-solid { border:none; border-top:2px solid #333; margin:14px 0; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; margin-bottom:14px; }
  .meta .label { color:#888; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
  .meta .val { font-weight:700; font-size:14px; margin-top:1px; }
  .meta .right { text-align:right; }
  table { width:100%; border-collapse:collapse; }
  thead th { font-size:11px; text-transform:uppercase; color:#888; letter-spacing:0.5px; padding:7px 6px; border-bottom:2px solid #ddd; font-weight:700; }
  tbody td { padding:9px 6px; vertical-align:top; border-bottom:1px dashed #e5e5e5; font-size:13px; }
  tbody tr:last-child td { border-bottom:none; }
  .totals-table { width:100%; border-collapse:collapse; }
  .totals-table td { padding:5px 6px; font-size:13px; }
  .totals-table .total-row td { font-size:18px; font-weight:900; padding-top:10px; color:#111; }
  .totals-table .total-row td:last-child { font-size:20px; }
  .section-label { font-size:11px; font-weight:700; text-transform:uppercase; color:#888; letter-spacing:0.7px; margin:12px 0 6px; }
  .badge { display:inline-block; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; text-transform:capitalize; }
  .footer { text-align:center; color:#bbb; font-size:11px; margin-top:20px; padding-top:12px; border-top:1px dashed #ddd; line-height:1.7; }
  .medicine-name { font-weight:600; font-size:14px; }
  .batch-label { color:#999; font-size:11px; margin-top:2px; }
  .text-right { text-align:right; }
  .text-center { text-align:center; }
  .text-green { color:#16a34a; }
  ${RECEIPT_HEADER_STYLES}
</style>
</head><body>
${buildReceiptHeaderHtml({
    tokenNo: lastInvoice.tokenNo,
    origin: window.location.origin,
    subtitle: "Tax Invoice / Bill of Supply",
  })}  <hr class="divider-solid"/>

  <div class="meta">
    <div>
      <div class="label">Invoice No</div>
      <div class="val" style="font-family:monospace;letter-spacing:0.5px">${lastInvoice.invoiceNo}</div>
    </div>
    <div class="right">
      <div class="label">Date &amp; Time</div>
      <div class="val">${new Date(lastInvoice.createdAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}</div>
    </div>
    ${lastReceiptPatient ? `
    <div>
      <div class="label">Patient Name</div>
      <div class="val">${lastReceiptPatient.name}</div>
    </div>
    <div class="right">
      <div class="label">Phone</div>
      <div class="val">${lastReceiptPatient.phone}</div>
    </div>
    ${lastReceiptPatient.gender ? `<div><div class="label">Gender</div><div class="val">${lastReceiptPatient.gender}</div></div>` : ""}
    ` : `
    <div style="grid-column:span 2">
      <div class="label">Patient</div>
      <div class="val" style="color:#aaa;font-style:italic">Walk-in Customer</div>
    </div>`}
  </div>

  <hr class="divider"/>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;width:45%">Medicine</th>
        <th class="text-center" style="width:8%">Qty</th>
        <th class="text-right" style="width:15%">MRP/Unit</th>
        <th class="text-right" style="width:10%">Disc</th>
        <th class="text-right" style="width:12%">Tax</th>
        <th class="text-right" style="width:10%">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}${feeRow}</tbody>
  </table>

  <hr class="divider"/>

  <table class="totals-table">
    <tr><td style="color:#666">Subtotal</td><td class="text-right" style="color:#666">₹${parseFloat(lastInvoice.subtotal ?? "0").toFixed(2)}</td></tr>
    <tr><td style="color:#666">Tax (GST)</td><td class="text-right" style="color:#666">₹${parseFloat(lastInvoice.taxAmount ?? "0").toFixed(2)}</td></tr>
    ${discountAmt > 0 ? `<tr class="text-green"><td>Discount Applied</td><td class="text-right">−₹${discountAmt.toFixed(2)}</td></tr>` : ""}
    <tr class="total-row"><td>TOTAL AMOUNT</td><td class="text-right">₹${parseFloat(lastInvoice.totalAmount).toFixed(2)}</td></tr>
  </table>

  <hr class="divider"/>

  <div class="section-label">Payment Details</div>
  <table class="totals-table">${payRows}</table>

  <div class="footer">
    <p><b>Thank you for choosing Radha Madhav Medical Hall</b></p>
    <p>Goods once sold will not be taken back without a valid reason.</p>
    <p>For queries, please contact your shop manager.</p>
  </div>
</body></html>`);
    w.document.close();
    w.focus();

    // Print once the letterhead has actually loaded. The previous fixed delay
    // could fire first and print an invoice with a missing logo. The timeout is
    // kept as a hard cap so a slow or failed image can never leave the counter
    // staring at a print dialog that never opens.
    let printed = false;
    const fire = () => {
      if (printed) return;
      printed = true;
      w.print();
      w.close();
    };

    const logo = w.document.getElementById("brand-logo") as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", fire, { once: true });
      logo.addEventListener("error", fire, { once: true });
      setTimeout(fire, 2000);
    } else {
      setTimeout(fire, 300);
    }
  };

  // ── Patient lookup ──────────────────────────────────────────────────────────
  const debouncedPatientSearch = useDebounce(patientSearch, 300);
  const { data: patientResults } = useQuery({
    queryKey: ["patient-search-pos", debouncedPatientSearch],
    queryFn: () => apiClient.get("/patients", { params: { search: debouncedPatientSearch, limit: 5 } }) as any,
    enabled: (debouncedPatientSearch?.length ?? 0) >= 3,
  });

  const { data: selectedPatientRaw } = useQuery({
    queryKey: ["patient-detail", patientId],
    queryFn: () => apiClient.get(`/patients/${patientId}`),
    enabled: !!patientId,
  });

  const selectedPatient: any = (selectedPatientRaw as any)?.data ?? selectedPatientRaw ?? null;
  const prRaw = patientResults as any;
  const patientResults_: any[] = Array.isArray(prRaw?.data?.data) ? prRaw.data.data : Array.isArray(prRaw?.data) ? prRaw.data : [];

  // ── Barcode scanner ─────────────────────────────────────────────────────────
  const handleBarcodeScan = async (scanCode: string) => {
    if (!scanCode) return;
    // Scanner keystrokes also land in the focused search input; clear them
    // regardless of the lookup outcome so failed scans don't leave garbage.
    setSearch("");
    try {
      // Indexed exact-barcode lookup (uses medicines_barcode_idx), not the fuzzy search.
      const res: any = await apiClient.get(`/inventory/medicines/barcode/${encodeURIComponent(scanCode)}`);
      const medicine = res?.data?.data ?? res?.data ?? null;
      if (medicine) {
        // FEFO dispense endpoint: active, non-expired batches with qty > 0, earliest expiry first
        const batchesRes: any = await apiClient.get(`/inventory/medicines/${medicine.id}/batches`, { params: { branchId: activeBranchId } });
        const batchList: any[] = Array.isArray(batchesRes) ? batchesRes : Array.isArray(batchesRes?.data?.data) ? batchesRes.data.data : Array.isArray(batchesRes?.data) ? batchesRes.data : [];
        const firstBatch = batchList[0];
        if (firstBatch) {
          const availableQty = firstBatch.quantity ?? Number(medicine.totalStock ?? 99999);
          const existing = items.find((i) => i.batchId === firstBatch.id);
          const currentQty = existing ? existing.quantity : 0;

          if (currentQty + 1 > availableQty && !allowOversell) {
            setStockLimitDialog({
              open: true,
              itemName: medicine.name,
              requestedQty: currentQty + 1,
              maxAvailable: availableQty,
              unit: getUnitLabel(availableQty, medicine),
            });
            if (!existing) {
              addItem({
                medicineId: medicine.id,
                batchId: firstBatch.id,
                name: medicine.name,
                sku: medicine.sku,
                batchNo: firstBatch.batchNo,
                unitPrice: parseFloat(medicine.priceMrp),
                stripSize: medicine.stripSize ? parseInt(medicine.stripSize) : 1,
                taxPct: parseFloat(medicine.taxPercent ?? "0"),
                discountPct: 0,
                quantity: availableQty,
                scheduleClass: medicine.scheduleClass,
                requiresPrescription: medicine.requiresPrescription,
                unit: medicine.unit,
                batchStock: availableQty,
                totalStock: Number(medicine.totalStock ?? availableQty),
              });
            }
            return;
          }

          addItem({
            medicineId: medicine.id,
            batchId: firstBatch.id,
            name: medicine.name,
            sku: medicine.sku,
            batchNo: firstBatch.batchNo,
            unitPrice: parseFloat(medicine.priceMrp),
            stripSize: medicine.stripSize ? parseInt(medicine.stripSize) : 1,
            taxPct: parseFloat(medicine.taxPercent ?? "0"),
            discountPct: 0,
            quantity: 1,
            scheduleClass: medicine.scheduleClass,
            requiresPrescription: medicine.requiresPrescription,
            unit: medicine.unit,
            batchStock: availableQty,
            totalStock: Number(medicine.totalStock ?? availableQty),
          });
          toastSuccess("Item added", `${medicine.name} added to checkout.`);
        } else {
          toastWarning("Out of stock", `No active batches found for "${medicine.name}".`);
        }
      } else {
        toastWarning("Not found", `No medicine found for barcode: "${scanCode}"`);
      }
    } catch (err) {
      toastFromError(err, "Could not look up that barcode");
    }
  };

  // Suspend global scan capture while any modal is open so a stray scan
  // can't mutate the cart mid-payment.
  useBarcodeScanner(handleBarcodeScan, {
    enabled: !payOpen && !rxPickerOpen && !cameraOpen && !printOpen && !clearConfirm && !isPatientModalOpen,
  });

  // ── Online/offline ──────────────────────────────────────────────────────────
  useEffect(() => {
    const on = async () => {
      setIsOnline(true);
      // Every queued payload carries a clientRef, so replaying one the server
      // already recorded returns that invoice instead of billing it again.
      const { synced, abandoned } = await syncOfflineQueue(
        (p) => apiClient.post("/billing/invoices", p) as any,
      );
      if (synced > 0) {
        toastInfo(
          "Offline sales synced",
          `${synced} ${synced === 1 ? "sale" : "sales"} saved while offline ${synced === 1 ? "has" : "have"} been recorded.`,
        );
      }
      // Silence here is how a sale used to disappear: the queue retried for
      // ever and nobody was told it was failing.
      if (abandoned > 0) {
        toastError(
          "Some offline sales could not be recorded",
          `${abandoned} queued ${abandoned === 1 ? "sale" : "sales"} failed repeatedly and ${abandoned === 1 ? "is" : "are"} no longer being retried. Re-enter ${abandoned === 1 ? "it" : "them"} at the counter.`,
        );
      }
    };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const handleToggleScaleMode = () => {
    const nextMode = posViewMode === "split" ? "scale" : "split";
    setPosViewMode(nextMode);
    if (nextMode === "scale" && !sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  };

  // ── Hotkeys ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); if (items.length > 0) setPayOpen(true); }
      if (e.key === "F6") { e.preventDefault(); if (items.length > 0) setClearConfirm(true); }
      if (e.key === "F8") { e.preventDefault(); handleToggleScaleMode(); }
      if (e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); toggleSidebar(); }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); if (lastInvoice) printReceipt(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, clear, lastInvoice, posViewMode, sidebarCollapsed]);

  // ── Medicine search ──────────────────────────────────────────────────────────
  const debouncedSearch = useDebounce(search, 300);
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["medicine-search", debouncedSearch],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        // Raised from 8. Relevance ordering ignores status, so the short list
        // was routinely all-active and inactive matches never appeared.
        params: { search: debouncedSearch, limit: 25, isActive: "all" },
      }) as any,
    enabled: (debouncedSearch?.length ?? 0) >= 2,
  });

  // ── Invoice creation ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: object) => apiClient.post("/billing/invoices", payload) as any,
    onSuccess: (data: any) => {
      const invoice = data?.data?.invoice ?? data?.data ?? data;
      setLastInvoice(invoice);
      setLastReceiptItems([...items]);
      setLastReceiptPatient(selectedPatient ?? null);
      setLastReceiptFee(useCartStore.getState().consultationFee);
      clear();
      setPayOpen(false);
      setPrintOpen(true);
    },
    onError: (err: any) => {
      // Routed through the explainer so a 500 or a dropped connection says what
      // to do next, and carries a reference the cashier can read out, instead
      // of showing "Request failed with status code 500".
      toastFromError(err, "Sale not completed");
    },
  });

  const handlePayConfirm = async (mode: string, splits?: { mode: string; amount: number; ref?: string }[]) => {
    if (!rxSettled) {
      toastWarning(
        "Prescription required",
        "This sale includes Schedule H / controlled medicines. Link a verified prescription in the cart, or — if you have seen the paper and the queue is moving — use “I verified it” to bill now and attach it afterwards.",
        8000,
      );
      return;
    }

    const payments = splits?.length
      ? splits.map((s) => ({ mode: s.mode, amount: String(s.amount.toFixed(2)), ...(s.ref ? { referenceNo: s.ref } : {}) }))
      : [{ mode, amount: String(finalTotal.toFixed(2)) }];
    setLastReceiptPayments(payments);

    const payload = {
      patientId: patientId || undefined,
      prescriptionId: prescriptionId?.trim() || undefined,
      // Vouched-for Schedule H sale: the manager's name rides on the existing
      // override fields, and rxPending keeps the missing paper visible until
      // someone attaches it to this bill.
      //
      // needsRx is re-checked here as well as in the effect above: a bill with
      // nothing controlled on it has no prescription to owe, and the server
      // rejects rxPending on such a bill outright. Belt and braces, because
      // the cost of getting it wrong is a till that cannot take money.
      ...(needsRx && rxAttested && !prescriptionId?.trim()
        ? {
            rxPending: true,
            overriddenBy: currentUserId ?? undefined,
            overrideReason:
              "Manager verified the prescription at the counter; prescription to be attached",
          }
        : {}),
      consultationFee: consultationFee
        ? { doctorName: consultationFee.doctorName, amount: String(consultationFee.amount.toFixed(2)) }
        : undefined,
      // Honoured for super_admin only; every other role is pinned server-side.
      // An invoice must name a branch, so without this a super_admin checkout
      // is rejected outright.
      branchId: activeBranchId,
      loyaltyPointsToRedeem,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        quantity: i.saleUnit === "pack" ? i.quantity * (i.stripSize || 1) : i.quantity,
        discountPct: String(i.discountPct ?? "0"),
      })),
      discountAmount: "0",
      payments,
      // Idempotency key for the online path as well: a retry after a timeout
      // is the same hazard as an offline replay.
      clientRef: `POS-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    };

    if (!isOnline) {
      await queueOfflineInvoice(payload);
      clear();
      setPayOpen(false);
      toastInfo("Saved offline", "Invoice queued locally and will sync automatically when your connection is restored.");
      return;
    }

    createMutation.mutate(payload);
  };

  const handleAddMedicine = async (m: any) => {
    // Inactive medicines cannot be sold — prompt the operator to set an MRP
    // and reactivate before they enter the cart.
    if (m.isActive === false) {
      setInactiveMrpTarget(m);
      setInactiveMrpValue(m.priceMrp && parseFloat(m.priceMrp) > 0 ? m.priceMrp : "");
      setInactiveMrpError(null);
      return;
    }
    try {
      const batchRes: any = await apiClient.get(`/inventory/medicines/${m.id}/batches`, { params: { branchId: activeBranchId } });
      const batchArr: any[] = Array.isArray(batchRes) ? batchRes : Array.isArray(batchRes?.data?.data) ? batchRes.data.data : Array.isArray(batchRes?.data) ? batchRes.data : [];
      const first = batchArr[0];
      if (!first) {
        toastWarning("Out of stock", `No active batch found for "${m.name}". Add stock via Inventory before billing.`, 7000);
        return;
      }
      const availableQty = first.quantity ?? Number(m.totalStock ?? 99999);
      const existing = items.find((i) => i.batchId === first.id);
      const currentQty = existing ? existing.quantity : 0;

      if (currentQty + 1 > availableQty && !allowOversell) {
        setStockLimitDialog({
          open: true,
          itemName: m.name,
          requestedQty: currentQty + 1,
          maxAvailable: availableQty,
          unit: getUnitLabel(availableQty, m),
        });
        if (!existing) {
          addItem({
            medicineId: m.id, batchId: first.id, name: m.name, sku: m.sku,
            batchNo: first.batchNo, unitPrice: parseFloat(m.priceMrp),
            stripSize: m.stripSize ? parseInt(m.stripSize) : 1,
            taxPct: parseFloat(m.taxPercent ?? "0"), discountPct: 0, quantity: availableQty,
            scheduleClass: m.scheduleClass, requiresPrescription: m.requiresPrescription,
            unit: m.unit, batchStock: availableQty, totalStock: Number(m.totalStock ?? availableQty),
          });
        }
        return;
      }

      addItem({
        medicineId: m.id, batchId: first.id, name: m.name, sku: m.sku,
        batchNo: first.batchNo, unitPrice: parseFloat(m.priceMrp),
        stripSize: m.stripSize ? parseInt(m.stripSize) : 1,
        taxPct: parseFloat(m.taxPercent ?? "0"), discountPct: 0, quantity: 1,
        scheduleClass: m.scheduleClass, requiresPrescription: m.requiresPrescription,
        unit: m.unit, batchStock: availableQty, totalStock: Number(m.totalStock ?? availableQty),
      });
      setSearch("");
    } catch (err) {
      toastFromError(err, "Could not load stock");
    }
  };

  // ── Rx auto-load from URL (clinic queue "Open in POS") ─────────────────────
  const searchParams = useSearchParams();
  const urlRxId = searchParams.get("rxId");
  const urlPatientId = searchParams.get("patientId");
  // Doctor consultation fee carried from the clinic queue — billed as a
  // GST-exempt service line on the same invoice as the dispense.
  const urlDoctorName = searchParams.get("doctorName");
  const urlFee = searchParams.get("fee");
  // Auto-pay: the counter desk hands the bill over with ?pay=1 so the payment
  // modal opens immediately instead of landing the staff on the empty search
  // screen. Rehydration above has already run by the time this effect fires.
  const urlAutoPay = searchParams.get("pay") === "1";
  const autoPayHandledRef = useRef(false);
  useEffect(() => {
    if (!urlAutoPay || autoPayHandledRef.current) return;
    autoPayHandledRef.current = true;
    // Read the store directly — rehydration above has already merged the
    // persisted cart, so this sees the bill the desk handed over.
    const st = useCartStore.getState();
    if (st.items.length > 0 || !!st.consultationFee) {
      setPayOpen(true);
    } else {
      toastInfo(
        "No bill to pay",
        "The bill was empty when it was handed over. Build it here and press F4 to pay.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAutoPay]);

  // Re-run only when the URL rxId actually changes; identical navigation
  // (e.g. the user returning to the same link) must not re-fill the cart.
  const handledRxRef = useRef<string | null>(null);

  useEffect(() => {
    if (!urlRxId) return;
    if (handledRxRef.current === urlRxId) return;
    handledRxRef.current = urlRxId;
    loadRxIntoCart(urlRxId, urlPatientId ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRxId, urlPatientId]);

  // Patient-only preload from the URL (new patient-first billing flow). The
  // counter desk opens the POS with ?patientId=… but no rxId, so the cart is
  // linked to the patient without loading any prescription. Same guard as the
  // Rx load: identical navigation must not re-run.
  const handledPatientRef = useRef<string | null>(null);
  useEffect(() => {
    if (urlRxId || !urlPatientId) return;
    if (handledPatientRef.current === urlPatientId) return;
    handledPatientRef.current = urlPatientId;
    // Fresh cart for the new patient — same as the Rx auto-load path, so a
    // leftover cart from the previous sale can never land on the wrong bill.
    clear();
    setPatient(urlPatientId);
    toastInfo(
      "Patient selected",
      "Patient linked from the counter desk. Add medicines to build the bill.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRxId, urlPatientId]);

  async function loadRxIntoCart(rxId: string, patientIdFromUrl?: string) {
    setRxLoadWarnings([]);
    try {
      const res: any = await apiClient.get(`/prescriptions/${rxId}`);
      const rx = res?.data?.data ?? res?.data ?? null;
      const rxItems: any[] = Array.isArray(rx?.items) ? rx.items : [];

      // Start a fresh prescription session: drop any persisted cart first, then
      // link patient + Rx so checkout carries them automatically.
      clear();
      if (patientIdFromUrl) setPatient(patientIdFromUrl);
      setPrescriptionId(rxId);
      // Doctor consultation fee from the clinic queue (if the doctor has one).
      if (urlDoctorName && urlFee) {
        const amt = parseFloat(urlFee);
        if (!isNaN(amt) && amt > 0) {
          setConsultationFee({ doctorName: urlDoctorName, amount: amt });
          toastInfo("Consultation fee added", `Doctor consultation fee of ₹${amt.toFixed(2)} added to the bill.`);
        }
      }

      if (rxItems.length === 0) {
        toastInfo("Prescription loaded", "This prescription has no medicine items to add to the cart.");
        return;
      }

      const warnings: string[] = [];
      for (const item of rxItems) {
        const med = item?.medicine ?? null;
        const medId = item.medicineId ?? med?.id;
        const label = med?.name ?? item.medicineName ?? "Medicine";
        if (!medId) {
          // Free-text line the doctor did not link to a catalogue medicine.
          warnings.push(label);
          continue;
        }
        try {
          const batchesRes: any = await apiClient.get(`/inventory/medicines/${medId}/batches`, {
            params: { branchId: activeBranchId },
          });
          const batchList: any[] = Array.isArray(batchesRes) ? batchesRes
            : Array.isArray(batchesRes?.data?.data) ? batchesRes.data.data
            : Array.isArray(batchesRes?.data) ? batchesRes.data
            : [];
          const first = batchList[0];
          const availableQty = first?.quantity ?? 0;
          if (!first || availableQty <= 0) {
            warnings.push(label);
            continue;
          }

          const requestedQty = item.quantityPrescribed || 1;
          const addPayload: any = {
            medicineId: medId,
            batchId: first.id,
            name: label,
            sku: med?.sku ?? item.medicineName ?? "",
            batchNo: first.batchNo,
            unitPrice: parseFloat(med?.priceMrp ?? "0") || 0,
            stripSize: med?.stripSize ? Number(med.stripSize) : 1,
            taxPct: parseFloat(med?.taxPercent ?? "0") || 0,
            discountPct: 0,
            quantity: requestedQty,
            scheduleClass: med?.scheduleClass,
            requiresPrescription: med?.requiresPrescription,
            unit: med?.unit,
            batchStock: availableQty,
            totalStock: availableQty,
          };

          if (requestedQty > availableQty && !allowOversell) {
            // Existing stock-cap behaviour: add what is available and surface
            // the "Stock Limit Exceeded" dialog so the counter staff notice.
            setStockLimitDialog({
              open: true,
              itemName: label,
              requestedQty,
              maxAvailable: availableQty,
              unit: getUnitLabel(availableQty, med ?? {}),
            });
            addItem({ ...addPayload, quantity: availableQty });
          } else {
            addItem(addPayload);
          }
        } catch {
          toastError("Could not load stock", `Failed to check stock for "${label}". Add it manually if needed.`);
        }
      }
      if (warnings.length > 0) {
        setRxLoadWarnings(warnings);
      }
    } catch (err) {
      toastFromError(err, "Could not load the prescription");
    }
  }

  const searchRaw = searchResults as any;
  const medicines: any[] = Array.isArray(searchRaw?.data?.data) ? searchRaw.data.data : Array.isArray(searchRaw?.data) ? searchRaw.data : [];

  if (paymentOnly) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        {/* Bill review — the checkout view of the new billing flow. No classic
            POS chrome: no Point of Sale bar, no search, no barcode scanner. */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header: patient context + bill state */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/70">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black text-sm shrink-0">
                {selectedPatient?.name?.slice(0, 1).toUpperCase() ?? "W"}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-900 truncate">
                  {selectedPatient?.name ?? "Walk-in Customer"}
                </p>
                <p className="text-xs text-slate-500 font-mono truncate">
                  {selectedPatient?.phone ?? "No patient linked — OTC sale"}
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-extrabold">
              {items.length} {items.length === 1 ? "item" : "items"} · ₹{finalTotal.toFixed(2)}
            </span>
          </div>

          {/* Bill lines */}
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.batchId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{item.name}</p>
                  <p className="text-[11px] text-slate-400 font-mono truncate">
                    {item.batchNo} · {item.quantity} × ₹{(item.saleUnit === "loose" ? item.unitPrice / (item.stripSize || 1) : item.unitPrice).toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-black text-slate-900">₹{item.lineTotal.toFixed(2)}</span>
                  <button
                    onClick={() => removeItem(item.medicineId, item.batchId)}
                    className="text-slate-300 hover:text-red-600 p-1 transition-colors"
                    title="Remove item"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {consultationFee && (
              <div className="px-5 py-3 flex items-center justify-between gap-3 bg-teal-50/60">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-teal-900">
                    Doctor Consultation
                    <span className="ml-2 bg-teal-100 text-teal-700 text-[9px] font-extrabold px-1 rounded uppercase align-middle">Fee</span>
                  </p>
                  <p className="text-[11px] text-teal-700 font-medium truncate">{consultationFee.doctorName} · GST-exempt service</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-black text-teal-900">₹{consultationFee.amount.toFixed(2)}</span>
                  <button
                    onClick={() => setConsultationFee(null)}
                    className="text-slate-300 hover:text-red-600 p-1 transition-colors"
                    title="Remove consultation fee"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
            {items.length === 0 && !consultationFee && (
              <div className="px-5 py-12 text-center">
                <ShoppingCart className="w-8 h-8 mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-600">Bill is empty</p>
                <p className="text-xs text-slate-400 mt-1">Add medicines on the counter desk first.</p>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax (GST)</span>
              <span>₹{tax.toFixed(2)}</span>
            </div>
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-amber-700 font-bold">
                <span className="flex items-center gap-1"><Star size={12} /> Loyalty ({loyaltyPointsToRedeem} pts)</span>
                <span>−₹{loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center font-black text-slate-900 pt-2 border-t border-slate-200">
              <span>TOTAL</span>
              <span className="text-emerald-700 text-xl">₹{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Pay action */}
          <div className="px-5 py-4 border-t border-slate-100 bg-white">
            <button
              onClick={() => setPayOpen(true)}
              disabled={items.length === 0 && !consultationFee}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-sm font-black tracking-wide disabled:opacity-40 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>PAY &amp; CHECKOUT</span>
              <span className="bg-white/20 text-white text-[11px] px-1.5 py-0.5 rounded font-mono">[F4]</span>
            </button>
            {needsRx && !prescriptionId?.trim() && (
              <div className="mt-2.5 flex items-center justify-between gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-xs">
                <span className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Controlled meds — verified Rx required
                </span>
                <button
                  onClick={() => setRxPickerOpen(true)}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shrink-0"
                >
                  Select Rx
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Same checkout machinery as the terminal: payment modal, Rx picker, receipt */}
        <PaymentModal
          open={payOpen}
          total={finalTotal}
          hasPatient={!!patientId}
          onClose={() => setPayOpen(false)}
          onConfirm={handlePayConfirm}
          loading={createMutation.isPending}
          needsRx={needsRx}
          prescriptionId={prescriptionId}
          onOpenRxPicker={() => setRxPickerOpen(true)}
        />

        <RxPickerModal
          open={rxPickerOpen}
          onClose={() => setRxPickerOpen(false)}
          onSelectRx={(id) => {
            setPrescriptionId(id);
            toastSuccess("Prescription Linked", `Verified prescription linked to checkout.`);
          }}
          patientId={patientId}
          patientName={selectedPatient?.name}
        />

        {printOpen && lastInvoice && (
          <div className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <h3 className="mt-3 text-base font-black text-slate-900">Payment Successful</h3>
              <p className="mt-1 text-xs text-slate-500">
                Invoice {lastInvoice.invoiceNo} · ₹{parseFloat(lastInvoice.totalAmount ?? "0").toFixed(2)}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => {
                    setPrintOpen(false);
                    setLastInvoice(null);
                    // The cart was already emptied on checkout, so this lands
                    // on a clean "Who is being served?" rather than a stale bill.
                    onFinishedSale?.();
                  }}
                  title={onFinishedSale ? "Start the next customer at the counter desk" : "Start a new sale"}
                  className="flex-1 py-2.5 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  New Sale
                </button>
                <button
                  onClick={() => { printReceipt(); }}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm inline-flex items-center justify-center gap-1.5"
                >
                  <Printer size={14} /> Print Receipt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 lg:h-[calc(100vh-7.5rem)]"
      // Suppresses the background auto-reload used to apply a new app version
      // while a sale is in progress. PwaRegister looks for this attribute; the
      // user still gets the explicit "Update" prompt.
      data-pharmerp-unsaved={
        items.length > 0 || consultationFee ? "pos-cart" : undefined
      }
    >
      {/* Top bar & quick hotkeys */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 bg-slate-900 text-white p-3 rounded-2xl shadow-md border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            <h1 className="font-extrabold text-base tracking-tight text-white">Point of Sale</h1>
          </div>
          <div className="hidden xl:flex items-center gap-1.5 ml-2 border-l border-slate-700 pl-3">
            {(["[F2] Search", "[F4] Pay", "[F6] Clear", "[F8] Scale Mode", "[Ctrl+P] Print"] as const).map((k) => (
              <span key={k} className="text-[11px] bg-slate-800 text-slate-300 border border-slate-700 font-mono font-semibold px-2 py-0.5 rounded-md">{k}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sidebar Collapse Toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand Sidebar (Alt+S)" : "Collapse Sidebar (Alt+S)"}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 text-xs font-semibold transition"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} className="text-emerald-400" /> : <PanelLeftClose size={14} className="text-slate-400" />}
            <span className="hidden sm:inline">{sidebarCollapsed ? "Expand Menu" : "Focus Canvas"}</span>
          </button>

          {/* POS Layout Mode Switcher */}
          <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setPosViewMode("split")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all ${
                posViewMode === "split"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <LayoutGrid size={13} />
              <span>Split View</span>
            </button>
            <button
              type="button"
              onClick={handleToggleScaleMode}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all ${
                posViewMode === "scale"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Table size={13} />
              <span>Scale Mode</span>
              <span className="text-[10px] opacity-75 font-mono">[F8]</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 bg-emerald-500/10 text-emerald-300 px-2.5 py-1 rounded-lg border border-emerald-500/20 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Scanner Active
          </div>

          <div className="flex items-center gap-2 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
            <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-xs font-bold text-slate-200">{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
      </div>

      {/* F6 Clear cart confirm banner */}
      {clearConfirm && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 shadow-sm">
          <span className="text-xs font-bold text-red-700">Clear the entire cart? This cannot be undone.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { clear(); setClearConfirm(false); }}
              className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
            >
              Yes, clear cart
            </button>
            <button
              onClick={() => setClearConfirm(false)}
              className="px-3 py-1 bg-white border text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rx auto-load out-of-stock warning banner */}
      {rxLoadWarnings.length > 0 && (
        <div className="flex flex-col gap-1.5 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 shadow-sm text-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-bold text-amber-900">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              These items from the prescription are out of stock and were NOT added to cart:
            </div>
            <button
              type="button"
              onClick={() => setRxLoadWarnings([])}
              className="text-amber-500 hover:text-amber-800 p-0.5 shrink-0"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pl-6">
            {rxLoadWarnings.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md font-semibold"
              >
                {w}
              </span>
            ))}
          </div>
          <p className="pl-6 text-[11px] text-amber-800 font-medium">
            Please source from another branch or inform the patient.
          </p>
        </div>
      )}

      {/* Compact Schedule H warning banner */}
      {/* Rendered whenever a prescription is attached, not only when the cart
          forces one: a link carried in from an earlier sale used to be
          invisible on an ordinary bill and still printed that visit's token. */}
      {(needsRx || prescriptionId?.trim()) && (
        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl px-3.5 py-2 border transition-all text-xs ${rxSettled ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-300"}`}>
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle size={15} className={rxSettled ? "text-emerald-600 shrink-0" : "text-amber-600 shrink-0"} />
            <span className={rxSettled ? "text-emerald-900" : "text-amber-900"}>
              {!needsRx
                ? "Prescription linked to this bill — its clinic token will print on the receipt"
                : rxAttested && !prescriptionId?.trim()
                  ? "Schedule H — billed on your verification, prescription still to be attached"
                  : "Schedule H / Controlled Meds in cart — Verified Prescription required"}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              value={prescriptionId ?? ""}
              onChange={(e) => setPrescriptionId(e.target.value || null)}
              placeholder="Paste Rx ID (UUID)..."
              className="flex-1 sm:w-56 border border-slate-300 rounded-lg px-2.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40 bg-white font-mono"
            />
            <button
              type="button"
              onClick={() => setRxPickerOpen(true)}
              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-sm transition-all shrink-0 flex items-center gap-1"
            >
              <FileText size={13} />
              <span>{prescriptionId?.trim() ? "Change Rx" : "Select Rx"}</span>
            </button>
            {prescriptionId && (
              <button
                type="button"
                onClick={() => setPrescriptionId(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
                title="Unlink Prescription"
              >
                <X size={14} />
              </button>
            )}
            {rxAttested ? (
              <button
                type="button"
                onClick={() => setRxAttested(false)}
                className="px-3 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] font-bold shrink-0 flex items-center gap-1"
                title="Undo — go back to requiring the prescription up front"
              >
                <ShieldCheck size={13} /> Vouched — undo
              </button>
            ) : (
              canAttestRx && (
                <button
                  type="button"
                  onClick={() => setRxAttested(true)}
                  className="px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold shrink-0 flex items-center gap-1"
                  title="Bill now on your verification and attach the prescription afterwards"
                >
                  <ShieldCheck size={13} /> I verified it
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Dynamic Layout Mode: Scale Mode (Full-width high-density table) vs Split View */}
      {posViewMode === "scale" ? (
        <div className="flex-1 flex flex-col gap-3 lg:h-full lg:overflow-hidden">
          {/* Toolbar for Scale Mode: Patient search & Floating Medicine search */}
          <div className="flex flex-col md:flex-row gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs shrink-0">
            {/* Patient Search / Selected Badge */}
            <div className="md:w-80 shrink-0">
              {selectedPatient ? (
                <div className="flex items-center justify-between border rounded-xl px-3 py-1.5 bg-emerald-50 border-emerald-200 text-xs">
                  <div className="truncate">
                    <p className="font-extrabold text-slate-900 truncate">{selectedPatient.name}</p>
                    <p className="text-[11px] text-emerald-700 font-medium">{selectedPatient.phone}</p>
                  </div>
                  <button
                    onClick={() => { setPatient(null); setLoyaltyPointsToRedeem(0); setPatientSearch(""); }}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search patient by name / phone..."
                    className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white"
                  />
                  {patientSearch.length >= 3 && (
                    <div className="absolute top-full left-0 right-0 z-40 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                      {patientResults_.map((p: any) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setPatient(p.id); setPatientSearch(""); }}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-xs flex justify-between"
                        >
                          <span className="font-bold text-slate-900">{p.name}</span>
                          <span className="text-slate-500 text-[11px]">{p.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Medicine Search with Barcode Support & Camera */}
            <div className="relative flex-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Scan barcode or type medicine name / SKU to add to bill… (F2)"
                    data-barcode-capture="true"
                    className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-medium focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-slate-50 focus:bg-white transition-all shadow-2xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="p-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-700 transition shadow-2xs"
                  title="Open Camera Scanner"
                >
                  <Camera size={16} />
                </button>
              </div>

              {/* Floating Medicine Search Popover Overlay */}
              {search.length >= 2 && (
                <div className="absolute top-full left-0 right-0 z-40 mt-1 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {isFetching && (
                    <div className="p-3 text-xs text-slate-500 text-center animate-pulse">Searching catalog…</div>
                  )}
                  {medicines.map((m: any) => (
                    <div
                      key={m.id}
                      onClick={() => handleAddMedicine(m)}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-50 text-xs cursor-pointer transition-colors"
                    >
                      <div>
                        <span className="font-bold text-slate-900">{m.name}</span>
                        <span className="text-slate-400 ml-2 font-mono text-[11px]">{m.sku}</span>
                        {isControlledScheduleClass(m.scheduleClass) && (
                          <span className="ml-1.5 text-[9px] bg-red-100 text-red-700 font-extrabold px-1 rounded uppercase">
                            {m.scheduleClass} Rx
                          </span>
                        )}
                        {m.isActive === false && (
                          <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 font-extrabold px-1.5 py-0.2 rounded border border-amber-200">
                            Inactive — set MRP to activate
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5">
                        {canOtc && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOtcSupplyTarget(m);
                          }}
                          disabled={Number(m.totalStock || 0) <= 0 || m.isActive === false}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-extrabold transition-colors ${
                            Number(m.totalStock || 0) <= 0 || m.isActive === false
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-700"
                          }`}
                          title={
                            Number(m.totalStock || 0) <= 0
                              ? "Out of stock — nothing left to sell over the counter"
                              : m.isActive === false
                              ? "Medicine is inactive — click the row to set MRP and activate"
                              : "Sell over the counter without a prescription — bills it, or record a free hand-out"
                          }
                        >
                          <Plus size={11} strokeWidth={3} />
                          OTC sale
                        </button>
                        )}
                        <span className="text-[11px] text-emerald-700 font-semibold">{formatStockUnit(Number(m.totalStock || 0), m)}</span>
                        <span className="font-black text-slate-900">₹{parseFloat(m.priceMrp).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                  {!isFetching && medicines.length === 0 && (
                    <div className="p-4 text-xs text-slate-400 text-center">No medicines matched search query.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Scalable High-Density Matrix Table */}
          <div className="flex-1 overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-md min-h-[280px] touch-pan-x touch-pan-y">
            {items.length === 0 ? (
              <div className="text-center py-24 text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                <ShoppingCart className="w-12 h-12 opacity-20 text-slate-500 mb-1" />
                <p className="font-bold text-slate-600 text-sm">Scale Mode Table View Active</p>
                <p className="text-slate-400 max-w-sm">
                  Scan barcode or search medicines in top toolbar. Items will populate this wide high-density matrix table.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-slate-900 text-slate-200 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
                    <th className="py-3 px-3 w-10 text-center">#</th>
                    <th className="py-3 px-3 min-w-[220px]">Medicine &amp; Description</th>
                    <th className="py-3 px-3 w-28">Batch</th>
                    <th className="py-3 px-3 w-28">Unit</th>
                    <th className="py-3 px-3 w-28 text-right">MRP / Unit</th>
                    <th className="py-3 px-3 w-36 text-center">Quantity</th>
                    <th className="py-3 px-3 w-24 text-center">Disc %</th>
                    <th className="py-3 px-3 w-28 text-right">GST Tax</th>
                    <th className="py-3 px-3 w-32 text-right">Line Total</th>
                    <th className="py-3 px-3 w-12 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {items.map((item, idx) => {
                    const unitPrice = item.saleUnit === "loose" ? item.unitPrice / (item.stripSize || 1) : item.unitPrice;
                    const gross = unitPrice * item.quantity;
                    const discAmt = (gross * (item.discountPct || 0)) / 100;
                    const taxable = gross - discAmt;
                    const taxAmt = (taxable * (item.taxPct || 0)) / 100;

                    return (
                      <tr key={item.batchId} className="hover:bg-emerald-50/40 transition-colors group">
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-slate-900 group-hover:text-emerald-900">{item.name}</span>
                            {item.scheduleClass && isControlledScheduleClass(item.scheduleClass) && (
                              <span className="bg-red-100 text-red-700 text-[9px] font-extrabold px-1 rounded uppercase shrink-0">
                                {item.scheduleClass}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{item.sku}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium border border-slate-200">
                            {item.batchNo}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {item.stripSize > 1 && canSellLooseUnits({ unit: item.unit }) ? (
                            <button
                              onClick={() => toggleUnit(item.medicineId, item.batchId)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                              title="Click to toggle Pack/Loose unit"
                            >
                              {item.saleUnit === "pack" ? "Strip" : "Loose Tab"}
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium text-slate-500 uppercase">Unit</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                          ₹{unitPrice.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-1">
                            <div className="flex items-center border border-slate-300 rounded-lg bg-slate-50 overflow-hidden">
                              <button
                                onClick={() => handleCartQtyChange(item, item.quantity - 1)}
                                className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 text-slate-700 transition"
                              >
                                <Minus size={9} />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 1;
                                  handleCartQtyChange(item, Math.max(1, val));
                                }}
                                className="w-10 text-center text-xs font-bold bg-white border-x border-slate-200 py-0.5 focus:outline-none font-mono text-slate-900"
                              />
                              <button
                                onClick={() => handleCartQtyChange(item, item.quantity + 1)}
                                className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 text-slate-700 transition"
                              >
                                <Plus size={9} />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={item.discountPct}
                            onChange={(e) => updateDiscountPct(item.medicineId, item.batchId, parseFloat(e.target.value) || 0)}
                            className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-mono font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500">
                          <span className="text-[11px] font-mono">{item.taxPct}%</span>
                          <span className="block text-[10px] text-slate-400">+₹{taxAmt.toFixed(2)}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-sm text-emerald-700 font-mono">
                          ₹{item.lineTotal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => removeItem(item.medicineId, item.batchId)}
                            className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {consultationFee && (
                    <tr className="bg-teal-50/80 border-t-2 border-teal-200">
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-teal-400 text-[11px]">•</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-teal-900">Doctor Consultation</span>
                          <span className="bg-teal-100 text-teal-700 text-[9px] font-extrabold px-1 rounded uppercase shrink-0">Fee</span>
                        </div>
                        <div className="text-[10px] text-teal-700 font-medium">{consultationFee.doctorName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-[10px] text-teal-600 font-medium" colSpan={6}>
                        GST-exempt service line · no stock deducted
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-sm text-teal-800 font-mono">
                        ₹{consultationFee.amount.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => setConsultationFee(null)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                          title="Remove consultation fee"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Scale Mode Bottom Summary Footer Bar */}
          <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Line Items</p>
                <p className="text-base font-extrabold text-white">{items.length} {items.length === 1 ? "Item" : "Items"}</p>
              </div>
              <div className="border-l border-slate-800 pl-6">
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Subtotal</p>
                <p className="text-sm font-bold text-slate-200">₹{subtotal.toFixed(2)}</p>
              </div>
              <div className="border-l border-slate-800 pl-6">
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tax (GST)</p>
                <p className="text-sm font-bold text-slate-200">₹{tax.toFixed(2)}</p>
              </div>
              {loyaltyDiscount > 0 && (
                <div className="border-l border-slate-800 pl-6">
                  <p className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Loyalty Disc</p>
                  <p className="text-sm font-bold text-amber-400">−₹{loyaltyDiscount.toFixed(2)}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Net Amount Payable</p>
                <p className="text-2xl font-black text-emerald-400 tracking-tight">₹{finalTotal.toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (items.length > 0) setClearConfirm(true); }}
                  disabled={items.length === 0}
                  className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold transition disabled:opacity-40"
                >
                  Clear (F6)
                </button>
                <button
                  onClick={() => setPayOpen(true)}
                  disabled={items.length === 0}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl text-sm font-black tracking-wide shadow-lg disabled:opacity-40 transition-all flex items-center gap-2"
                >
                  <span>PAY &amp; CHECKOUT</span>
                  <span className="bg-white/20 text-white text-[11px] px-1.5 py-0.5 rounded font-mono">[F4]</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main split panes: Left search & catalog + Right ultra-dense cart */
        <div className="flex flex-col lg:flex-row gap-3.5 flex-1 lg:overflow-hidden">
        {/* Left pane: Patient selector & Medicine Search */}
        <div className="flex-1 flex flex-col gap-3 lg:h-full lg:overflow-hidden">
          {/* Patient selector */}
          <div className="relative shrink-0">
            {selectedPatient ? (
              <div className="flex items-center justify-between border rounded-xl px-3.5 py-2 bg-emerald-50/90 border-emerald-200 shadow-2xs">
                <div>
                  <p className="text-xs font-extrabold text-slate-900">{selectedPatient.name}</p>
                  <p className="text-[11px] text-emerald-700 font-medium">
                    {selectedPatient.phone}
                    {selectedPatient.loyaltyPoints != null && (
                      <span className="ml-2 bg-yellow-100 text-yellow-800 px-1.5 py-0.2 rounded font-bold border border-yellow-200">
                        <Star size={9} className="inline mr-0.5" />{selectedPatient.loyaltyPoints} pts
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(selectedPatient.loyaltyPoints ?? 0) >= 100 && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-yellow-800 font-semibold">Redeem:</span>
                      <select
                        value={loyaltyPointsToRedeem}
                        onChange={(e) => setLoyaltyPointsToRedeem(Number(e.target.value))}
                        className="border border-yellow-300 rounded px-1.5 py-0.5 text-xs bg-white font-bold"
                      >
                        <option value={0}>0 pts</option>
                        {Array.from({ length: Math.floor((selectedPatient.loyaltyPoints ?? 0) / 100) }, (_, i) => (i + 1) * 100)
                          .filter((pts) => pts / 10 <= total)
                          .map((pts) => (
                            <option key={pts} value={pts}>{pts} pts (−₹{pts / 10})</option>
                          ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => { setPatient(null); setLoyaltyPointsToRedeem(0); setPatientSearch(""); }}
                    className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search patient by name or phone (optional)..."
                    className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white shadow-2xs font-medium"
                  />
                  {patientSearch.length >= 3 && (
                    <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {patientResults_.length > 0 ? (
                        patientResults_.map((p: any) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setPatient(p.id); setPatientSearch(""); }}
                            className="w-full text-left px-3.5 py-2 hover:bg-emerald-50/50 text-xs flex items-center justify-between transition-colors"
                          >
                            <div>
                              <span className="font-bold text-slate-900">{p.name}</span>
                              <span className="text-slate-500 ml-2 text-[11px]">{p.phone}</span>
                            </div>
                            {p.loyaltyPoints > 0 && (
                              <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                <Star size={9} className="inline mr-0.5 align-middle" />{p.loyaltyPoints} pts
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3.5 py-2 text-xs text-slate-400">No matching patients found.</div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const isPhone = /^[0-9+ \-]+$/.test(patientSearch);
                          setPatientForm({
                            name: isPhone ? "" : patientSearch,
                            phone: isPhone ? patientSearch : "",
                            email: "",
                            gender: "",
                            dateOfBirth: "",
                            address: "",
                            state: "",
                            bloodGroup: "",
                          });
                          setPatientFormError("");
                          setIsPatientModalOpen(true);
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 text-xs text-emerald-700 font-bold flex items-center gap-2 bg-slate-50/80"
                      >
                        <Plus size={13} />
                        <span>Register &quot;{patientSearch}&quot; as a new patient</span>
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPatientForm({
                      name: "",
                      phone: "",
                      email: "",
                      gender: "",
                      dateOfBirth: "",
                      address: "",
                      state: "",
                      bloodGroup: "",
                    });
                    setPatientFormError("");
                    setIsPatientModalOpen(true);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shrink-0 shadow-xs"
                  title="Quick Register Patient"
                >
                  <UserPlus size={14} />
                  <span className="hidden sm:inline">Add Patient</span>
                </button>
              </div>
            )}
          </div>

          {/* Medicine search input */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Scan barcode or type medicine name / SKU… (F2)"
                data-barcode-capture="true"
                className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white shadow-2xs font-medium"
              />
            </div>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-700 transition flex items-center justify-center shadow-xs"
              title="Open Camera Scanner"
            >
              <Camera size={16} />
            </button>
          </div>

          {/* Medicine Catalog Search Results */}
          <div className="flex-1 min-h-[200px] max-h-[45dvh] lg:max-h-none overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            {search.length >= 2 ? (
              <div className="divide-y divide-slate-100">
                {isFetching && (
                  <div className="p-4 text-xs text-slate-500 text-center animate-pulse font-medium">Searching medicine database…</div>
                )}
                {medicines.map((m: any) => (
                  <div
                    key={m.id}
                    onClick={() => handleAddMedicine(m)}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-50/60 text-xs text-left transition-colors cursor-pointer group"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900 group-hover:text-emerald-800">{m.name}</span>
                        {isControlledScheduleClass(m.scheduleClass) && (
                          <span className="text-[9px] bg-red-100 text-red-700 border border-red-200 font-extrabold px-1.5 py-0.2 rounded uppercase">
                            {m.scheduleClass} Rx
                          </span>
                        )}
                        {m.isActive === false && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 font-extrabold px-1.5 py-0.2 rounded">
                            Inactive — set MRP to activate
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="font-mono text-slate-600">{m.sku}</span>
                        {m.hsnCode && <span>· HSN: {m.hsnCode}</span>}
                        {m.totalStock !== undefined && (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                              Number(m.totalStock) <= 0
                                ? "bg-red-50 text-red-700 border-red-200"
                                : Number(m.totalStock) <= Number(m.reorderLevel || 10)
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                Number(m.totalStock) <= 0
                                  ? "bg-red-500"
                                  : Number(m.totalStock) <= Number(m.reorderLevel || 10)
                                  ? "bg-amber-500 animate-pulse"
                                  : "bg-emerald-500"
                              }`}
                            />
                            {Number(m.totalStock) <= 0
                              ? "Out of stock"
                              : formatStockUnit(Number(m.totalStock), m)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {canOtc && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOtcSupplyTarget(m);
                        }}
                        disabled={Number(m.totalStock || 0) <= 0}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition-colors ${
                          Number(m.totalStock || 0) <= 0
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-700"
                        }`}
                        title={
                          Number(m.totalStock || 0) <= 0
                            ? "Out of stock — nothing left to sell over the counter"
                            : "Sell over the counter without a prescription — bills it, or record a free hand-out"
                        }
                      >
                        <Plus size={11} strokeWidth={3} />
                        OTC sale
                      </button>
                      )}
                      <span className="font-extrabold text-sm text-emerald-700">₹{parseFloat(m.priceMrp).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
                {!isFetching && medicines.length === 0 && (
                  <div className="p-6 text-xs text-slate-400 text-center">No matching medicines found in catalog.</div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center h-full">
                <ShoppingCart className="w-10 h-10 mb-2 opacity-20 text-slate-600" />
                <p className="font-semibold text-slate-600">Search or use barcode scanner to add medicines to bill.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono font-bold text-slate-700">F2</kbd> anytime to jump to search input.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Wider, High-Density Cart Display (lg:w-[440px] xl:w-[480px]) */}
        <div className="w-full lg:w-[440px] xl:w-[480px] shrink-0 flex flex-col border border-slate-200 rounded-2xl bg-white shadow-md overflow-hidden">
          {/* Cart Pane Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-emerald-600" />
              <span className="font-extrabold text-sm text-slate-900">Current Cart</span>
              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>
            {items.length > 0 && (
              <button
                onClick={() => setClearConfirm(true)}
                className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline flex items-center gap-1"
              >
                <Trash2 size={12} /> Clear (F6)
              </button>
            )}
          </div>

          {/* High-Density Cart Item List (All items visible at once) */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
            {items.length === 0 && (
              <div className="text-center py-16 text-xs text-slate-400 flex flex-col items-center gap-1.5">
                <ShoppingCart className="w-8 h-8 mb-1 opacity-20 text-slate-400" />
                <span className="font-semibold text-slate-500">Cart is currently empty</span>
                <span className="text-[11px] text-slate-400">Scan barcode or search medicines on left to start checkout.</span>
              </div>
            )}
            {items.map((item) => (
              <div key={item.batchId} className="px-3.5 py-2.5 hover:bg-slate-50/80 transition-colors space-y-1.5">
                {/* Row 1: Name, Badges, Total Price */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-xs font-bold text-slate-900 truncate" title={item.name}>
                      {item.name}
                    </span>
                    {item.scheduleClass && isControlledScheduleClass(item.scheduleClass) && (
                      <span className="bg-red-100 text-red-700 text-[9px] font-extrabold px-1 rounded uppercase shrink-0">
                        {item.scheduleClass}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-black text-slate-900">₹{item.lineTotal.toFixed(2)}</span>
                    <button
                      onClick={() => removeItem(item.medicineId, item.batchId)}
                      className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Row 2: Batch Info, Rates & Compact Quantity Counter */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium truncate">
                    <span className="font-mono bg-slate-100 text-slate-700 px-1 py-0.2 rounded text-[10px]">
                      {item.batchNo}
                    </span>
                    <span>₹{(item.saleUnit === "loose" ? item.unitPrice / (item.stripSize || 1) : item.unitPrice).toFixed(2)} / {item.saleUnit === "loose" ? "Tab" : getUnitLabel(1, { unit: item.unit, stripSize: item.stripSize })}</span>
                    {item.batchStock !== undefined && (
                      <span className="text-[10px] text-slate-400">
                        (Max {item.saleUnit === "loose" ? (item.batchStock * item.stripSize) : item.batchStock})
                      </span>
                    )}
                  </div>

                  {/* Ultra-compact inline counter */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex items-center border border-slate-300 rounded-lg bg-slate-50 overflow-hidden">
                      <button
                        onClick={() => handleCartQtyChange(item, item.quantity - 1)}
                        className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 text-slate-700 transition"
                      >
                        <Minus size={9} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          handleCartQtyChange(item, Math.max(1, val));
                        }}
                        className="w-9 text-center text-xs font-bold bg-white border-x border-slate-200 py-0.5 focus:outline-none font-mono text-slate-900"
                      />
                      <button
                        onClick={() => handleCartQtyChange(item, item.quantity + 1)}
                        className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 text-slate-700 transition"
                      >
                        <Plus size={9} />
                      </button>
                    </div>

                    {item.stripSize > 1 && canSellLooseUnits({ unit: item.unit }) && (
                      <button
                        onClick={() => toggleUnit(item.medicineId, item.batchId)}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                        title="Toggle unit between Strips and Loose Pills"
                      >
                        {item.saleUnit === "pack" ? "Strips" : "Loose"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {consultationFee && (
              <div className="px-3.5 py-2.5 bg-teal-50/80 border-t border-teal-100 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-xs font-bold text-teal-900 truncate">Doctor Consultation</span>
                    <span className="bg-teal-100 text-teal-700 text-[9px] font-extrabold px-1 rounded uppercase shrink-0">Fee</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-black text-teal-900">₹{consultationFee.amount.toFixed(2)}</span>
                    <button
                      onClick={() => setConsultationFee(null)}
                      className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                      title="Remove consultation fee"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-teal-700 font-medium">
                  {consultationFee.doctorName} · GST-exempt service
                </div>
              </div>
            )}
          </div>

          {/* Cart Summary & Checkout Totals Footer */}
          <div className="border-t border-slate-200 p-3.5 space-y-1.5 bg-slate-50/90 text-xs">
            <div className="flex justify-between text-slate-600 font-medium">
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600 font-medium">
              <span>Tax (GST)</span>
              <span>₹{tax.toFixed(2)}</span>
            </div>
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-amber-700 font-bold bg-amber-50 px-2 py-1 rounded border border-amber-200">
                <span className="flex items-center gap-1"><Star size={11} /> Loyalty Discount ({loyaltyPointsToRedeem} pts)</span>
                <span>−₹{loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-slate-900 text-base pt-2 border-t border-slate-200">
              <span>TOTAL</span>
              <span className="text-emerald-700 text-lg">₹{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Checkout Action Buttons */}
          <div className="p-3 bg-white border-t border-slate-200 flex gap-2">
            <button
              onClick={() => {
                if (items.length > 0) setClearConfirm(true);
              }}
              disabled={items.length === 0}
              className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition duration-150 disabled:opacity-40"
            >
              Clear (F6)
            </button>
            <button
              onClick={() => setPayOpen(true)}
              disabled={items.length === 0}
              className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-xs font-black tracking-wide disabled:opacity-40 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>PAY &amp; CHECKOUT</span>
              <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">[F4]</span>
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Mobile sticky checkout bar — positioned above MobileBottomNav (bottom-[52px]) on small screens */}
      {items.length > 0 && (
        <div className="lg:hidden fixed bottom-[52px] left-0 right-0 z-30 px-4 py-2.5 bg-slate-900/95 backdrop-blur text-white border-t border-slate-800 shadow-[0_-4px_16px_rgba(0,0,0,0.2)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium">{items.length} {items.length === 1 ? "item" : "items"} in cart</p>
            <p className="text-base font-black text-emerald-400 leading-tight">₹{finalTotal.toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setClearConfirm(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
            >
              Clear
            </button>
            <button
              onClick={() => setPayOpen(true)}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-extrabold transition shadow-md"
            >
              Pay ₹{finalTotal.toFixed(2)}
            </button>
          </div>
        </div>
      )}

      <PaymentModal
        open={payOpen}
        total={finalTotal}
        hasPatient={!!patientId}
        onClose={() => setPayOpen(false)}
        onConfirm={handlePayConfirm}
        loading={createMutation.isPending}
        needsRx={needsRx}
        prescriptionId={prescriptionId}
        onOpenRxPicker={() => setRxPickerOpen(true)}
      />

      <RxPickerModal
        open={rxPickerOpen}
        onClose={() => setRxPickerOpen(false)}
        onSelectRx={(id) => {
          setPrescriptionId(id);
          toastSuccess("Prescription Linked", `Verified prescription linked to checkout.`);
        }}
        patientId={patientId}
        patientName={selectedPatient?.name}
      />

      <BarcodeScannerDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={handleBarcodeScan}
      />

      <Modal
        title="Quick Register Patient"
        subtitle="Create a new patient profile directly from the POS terminal."
        open={isPatientModalOpen}
        onClose={() => setIsPatientModalOpen(false)}
        size="md"
        icon={<UserPlus size={18} />}
      >
        <form onSubmit={handleRegisterPatientSubmit} className="flex flex-col h-full">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {patientFormError && (
              <div className="px-3 py-2.5 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200 animate-in fade-in duration-150">
                {patientFormError}
              </div>
            )}

            {/* Essential Details */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Essential Information</p>
              <div className="space-y-3">
                <div>
                  <label className={formLabelCls}>Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={patientForm.name}
                    onChange={(e) => setPatientForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. John Doe"
                    className={formInputCls}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={formLabelCls}>Phone Number <span className="text-red-500">*</span></label>
                    <input
                      type="tel"
                      required
                      value={patientForm.phone}
                      onChange={(e) => setPatientForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="e.g. 9876543210"
                      className={formInputCls}
                    />
                  </div>
                  <div>
                    <label className={formLabelCls}>Email Address</label>
                    <input
                      type="email"
                      value={patientForm.email}
                      onChange={(e) => setPatientForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="e.g. patient@domain.com"
                      className={formInputCls}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {/* Secondary Details */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Additional Information (Optional)</p>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={formLabelCls}>Gender</label>
                    <select
                      value={patientForm.gender}
                      onChange={(e) => setPatientForm((f) => ({ ...f, gender: e.target.value }))}
                      className={formInputCls}
                    >
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className={formLabelCls}>Date of Birth</label>
                    <input
                      type="date"
                      value={patientForm.dateOfBirth}
                      onChange={(e) => setPatientForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                      max={new Date().toISOString().split("T")[0]}
                      className={formInputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={formLabelCls}>Blood Group</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {BLOOD_GROUPS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setPatientForm((f) => ({ ...f, bloodGroup: f.bloodGroup === g ? "" : g }))}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                          patientForm.bloodGroup === g
                            ? "bg-red-600 text-white border-red-600 shadow-sm animate-in zoom-in-95 duration-100"
                            : "bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:text-red-600"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={formLabelCls}>Street / City</label>
                    <input
                      type="text"
                      value={patientForm.address}
                      onChange={(e) => setPatientForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="e.g. 12 Park Street"
                      className={formInputCls}
                    />
                  </div>
                  <div>
                    <label className={formLabelCls}>State</label>
                    <input
                      type="text"
                      value={patientForm.state}
                      onChange={(e) => setPatientForm((f) => ({ ...f, state: e.target.value }))}
                      placeholder="e.g. West Bengal"
                      className={formInputCls}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
            <button
              type="button"
              onClick={() => setIsPatientModalOpen(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createPatientMutation.isPending}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/95 active:scale-95 transition-all disabled:opacity-60 min-w-[130px]"
            >
              {createPatientMutation.isPending ? "Registering..." : "Register Patient"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invoice print preview */}
      {printOpen && lastInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 print:bg-white print:p-0 print:items-start print:justify-start" onClick={() => { setPrintOpen(false); setLastInvoice(null); }}>
          <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col print:max-h-none print:shadow-none print:rounded-none" onClick={(e) => e.stopPropagation()}>

            {/* Non-print header */}
            <div className="flex items-center justify-between px-6 py-4 border-b print:hidden">
              <span className="bg-green-100 text-green-700 font-semibold px-3 py-1 rounded-full text-xs">Invoice Completed!</span>
              <button onClick={() => { setPrintOpen(false); setLastInvoice(null); }} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400">
                <X size={15} />
              </button>
            </div>

            {/* Scrollable receipt body */}
            <div id="invoice-print-area" className="overflow-y-auto flex-1 px-6 py-5 space-y-4 print:overflow-visible print:p-6">

              {/* Queue token, above everything else so the patient can match the
                  bill to the number they were called by. Clinic visits only. */}
              {formatTokenNo(lastInvoice.tokenNo) && (
                <div className="text-center">
                  <div className="inline-block rounded-lg border-2 border-gray-900 px-4 py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">
                      Token No.
                    </p>
                    <p className="text-2xl font-black tracking-[0.2em] text-gray-900 leading-tight">
                      {formatTokenNo(lastInvoice.tokenNo)}
                    </p>
                  </div>
                </div>
              )}

              {/* Store header. The lockup carries the trading name, so the legal
                  name is printed as text beneath it alongside the address. */}
              <div className="text-center space-y-1">
                <Image
                  src="/logo-full.svg"
                  alt={PHARMACY_PRINT_DETAILS.legalName}
                  width={129}
                  height={68}
                  className="mx-auto h-12 w-auto"
                  priority
                />
                <h2 className="text-base font-extrabold tracking-tight text-gray-900">
                  {PHARMACY_PRINT_DETAILS.legalName}
                </h2>
                <p className="text-[11px] leading-snug text-gray-500">
                  {PHARMACY_PRINT_DETAILS.addressLine}
                  <br />
                  Ph: {PHARMACY_PRINT_DETAILS.phone}
                </p>
                <p className="text-xs text-gray-500">Tax Invoice / Bill of Supply</p>
              </div>

              <hr className="border-dashed" />

              {/* Invoice meta */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-gray-500">Invoice No</span>
                  <p className="font-bold text-gray-900 font-mono">{lastInvoice.invoiceNo}</p>
                </div>
                <div className="text-right">
                  <span className="text-gray-500">Date & Time</span>
                  <p className="font-semibold text-gray-900">{new Date(lastInvoice.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                {lastReceiptPatient && (
                  <>
                    <div>
                      <span className="text-gray-500">Patient</span>
                      <p className="font-semibold text-gray-900">{lastReceiptPatient.name}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500">Phone</span>
                      <p className="font-semibold text-gray-900">{lastReceiptPatient.phone}</p>
                    </div>
                  </>
                )}
                {!lastReceiptPatient && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Patient</span>
                    <p className="font-semibold text-gray-400 italic">Walk-in Customer</p>
                  </div>
                )}
              </div>

              <hr className="border-dashed" />

              {/* Items table */}
              <div>
                <div className="grid grid-cols-12 text-[10px] font-bold uppercase text-gray-500 pb-1 border-b gap-1">
                  <span className="col-span-5">Medicine</span>
                  <span className="col-span-1 text-center">Qty</span>
                  <span className="col-span-2 text-right">MRP</span>
                  <span className="col-span-2 text-right">Disc</span>
                  <span className="col-span-2 text-right">Amount</span>
                </div>
                <div className="divide-y divide-dashed">
                  {lastReceiptItems.map((item, idx) => {
                    const isLoose = item.saleUnit === "loose";
                    const displayPrice = isLoose ? item.unitPrice / (item.stripSize || 1) : item.unitPrice;
                    const displayQty = isLoose ? `${item.quantity} Tab` : `${item.quantity} Strip`;
                    return (
                      <div key={idx} className="grid grid-cols-12 text-xs py-1.5 gap-1 items-start">
                        <div className="col-span-5">
                          <p className="font-semibold text-gray-900 leading-tight">{item.name}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{item.batchNo}</p>
                        </div>
                        <span className="col-span-1 text-center font-medium text-gray-700">{displayQty}</span>
                        <span className="col-span-2 text-right text-gray-700">₹{displayPrice.toFixed(2)}</span>
                        <span className="col-span-2 text-right text-gray-500">{item.discountPct > 0 ? `${item.discountPct}%` : "—"}</span>
                        <span className="col-span-2 text-right font-semibold text-gray-900">₹{item.lineTotal.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <hr className="border-dashed" />

              {/* Totals */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>₹{parseFloat(lastInvoice.subtotal ?? "0").toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax (GST)</span>
                  <span>₹{parseFloat(lastInvoice.taxAmount ?? "0").toFixed(2)}</span>
                </div>
                {parseFloat(lastInvoice.discountAmount ?? "0") > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount</span>
                    <span>−₹{parseFloat(lastInvoice.discountAmount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base pt-2 border-t border-gray-300 text-gray-900">
                  <span>TOTAL</span>
                  <span>₹{parseFloat(lastInvoice.totalAmount).toFixed(2)}</span>
                </div>
              </div>

              <hr className="border-dashed" />

              {/* Payment */}
              <div className="space-y-1 text-xs">
                <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Payment</p>
                {lastReceiptPayments.map((p, i) => (
                  <div key={i} className="flex justify-between text-gray-700">
                    <span className="capitalize font-medium">{p.mode}{p.referenceNo ? ` — ${p.referenceNo}` : ""}</span>
                    <span>₹{parseFloat(p.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="text-center pt-2">
                <p className="text-[10px] text-gray-400">Thank you for choosing Radha Madhav Medical Hall</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Goods once sold will not be taken back without valid reason</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 px-6 pb-5 pt-3 border-t print:hidden">
              <button
                onClick={() => { setPrintOpen(false); setLastInvoice(null); }}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                New Sale
              </button>
              <button
                onClick={() => {
                  sendViaWhatsApp({
                    phone: lastReceiptPatient?.phone,
                    patientName: lastReceiptPatient?.name,
                    type: "invoice",
                    id: lastInvoice.id,
                    number: lastInvoice.invoiceNo,
                    subtotal: lastInvoice.subtotal,
                    taxAmount: lastInvoice.taxAmount,
                    totalAmount: lastInvoice.totalAmount,
                    items: lastReceiptItems.map((i: any) => ({
                      medicineName: i.medicine?.name || i.medicineName,
                      quantity: i.quantity,
                      unitPrice: i.batch?.sellingPriceMrp || i.unitPrice,
                      lineTotal: i.lineTotal ?? (Number(i.quantity) * Number(i.batch?.sellingPriceMrp || i.unitPrice || 0)),
                    })),
                  });
                }}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold transition inline-flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/10"
              >
                💬 Send WhatsApp
              </button>
              <button
                onClick={printReceipt}
                className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition inline-flex items-center justify-center gap-1.5 shadow-md"
              >
                <Printer size={14} /> Print (Ctrl+P)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Limit Alert Modal */}
      {stockLimitDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in" onClick={() => setStockLimitDialog((s) => ({ ...s, open: false }))}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Stock Limit Exceeded</h3>
                <p className="text-xs text-slate-500 font-medium">Quantity capped at available inventory</p>
              </div>
            </div>

            <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-bold text-sm text-slate-900 truncate">{stockLimitDialog.itemName}</p>
              <div className="flex justify-between items-center text-slate-700 pt-1">
                <span>Requested Quantity:</span>
                <span className="font-mono font-bold text-red-600 line-through">{stockLimitDialog.requestedQty} {stockLimitDialog.unit}</span>
              </div>
              <div className="flex justify-between items-center text-slate-900 font-bold">
                <span>Available Inventory Stock:</span>
                <span className="font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                  {stockLimitDialog.maxAvailable} {stockLimitDialog.unit}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              You requested <strong>{stockLimitDialog.requestedQty}</strong> {stockLimitDialog.unit}, but only <strong>{stockLimitDialog.maxAvailable}</strong> {stockLimitDialog.unit} are available in stock. The cart quantity has been automatically set to <strong>{stockLimitDialog.maxAvailable}</strong>.
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-slate-400" />
                <span className="text-[11px] font-semibold text-slate-500">POS Mode:</span>
              </div>
              <button
                type="button"
                onClick={() => setAllowOversell((prev) => !prev)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                  allowOversell
                    ? "bg-amber-100 border-amber-300 text-amber-800"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700"
                }`}
              >
                {allowOversell ? "Over-Sell Allowed" : "Strict Capping"}
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {allowOversell && (
                <button
                  type="button"
                  onClick={() => {
                    if (stockLimitDialog.item) {
                      updateQty(stockLimitDialog.item.medicineId, stockLimitDialog.item.batchId, stockLimitDialog.requestedQty);
                    }
                    setStockLimitDialog((s) => ({ ...s, open: false }));
                  }}
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-colors"
                >
                  Allow Over-Sell ({stockLimitDialog.requestedQty})
                </button>
              )}
              <button
                type="button"
                onClick={() => setStockLimitDialog((s) => ({ ...s, open: false }))}
                className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition-colors"
              >
                Got it (Cap at {stockLimitDialog.maxAvailable})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inactive medicine MRP edit — set price and reactivate before adding to cart */}
      <Modal
        title="Set MRP & Activate"
        subtitle={inactiveMrpTarget ? `"${inactiveMrpTarget.name}" is currently inactive — enter its MRP to make it sellable.` : undefined}
        open={!!inactiveMrpTarget}
        onClose={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
        size="sm"
      >
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            This medicine has no MRP set, so it cannot be sold. Enter the MRP below to activate it and add it to the cart.
          </p>
          <div className="space-y-1">
            <label className="text-sm font-semibold">MRP (INR) <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={inactiveMrpValue}
                onChange={(e) => { setInactiveMrpValue(e.target.value); setInactiveMrpError(null); }}
                placeholder="e.g. 85.50"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && inactiveMrpValue && !inactiveMrpLoading) confirmInactiveMrp(); }}
                className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>
          {inactiveMrpError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {inactiveMrpError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
              className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmInactiveMrp}
              disabled={!inactiveMrpValue || inactiveMrpLoading}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {inactiveMrpLoading ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Activating…</>
              ) : (
                <>Set MRP & Sell</>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* OTC counter sale (billed by default) — shared with the counter desk */}
      <OtcSupplyModal
        medicine={otcSupplyTarget}
        onClose={() => setOtcSupplyTarget(null)}
      />
    </div>
  );
}
