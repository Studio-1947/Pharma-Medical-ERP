"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Plus, Minus, ShoppingCart, Printer, AlertTriangle, FileText, Star, X, UserPlus } from "lucide-react";
import { useCartStore } from "@/stores/cart.store";
import { PaymentModal } from "./payment-modal";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { queueOfflineInvoice, syncOfflineQueue } from "@/lib/pos-db";
import { Modal } from "@/components/ui/modal";

const CONTROLLED_CLASSES = ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"];

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const formInputCls =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition placeholder:text-slate-400";
const formLabelCls = "block text-xs font-semibold text-slate-600 mb-1";

export function PosTerminal() {
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [lastReceiptItems, setLastReceiptItems] = useState<any[]>([]);
  const [lastReceiptPatient, setLastReceiptPatient] = useState<any>(null);
  const [lastReceiptPayments, setLastReceiptPayments] = useState<any[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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
      setPatientFormError(err?.response?.data?.message ?? "Failed to register patient.");
    },
  });

  const handleRegisterPatientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPatientFormError("");
    if (!patientForm.name.trim() || !patientForm.phone.trim()) {
      setPatientFormError("Name and Phone are required.");
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


  const {
    items, addItem, updateQty, toggleUnit, removeItem, clear, totals,
    patientId,
    prescriptionId, setPrescriptionId,
    loyaltyPointsToRedeem, setLoyaltyPointsToRedeem,
    setPatient, hasControlledItems,
  } = useCartStore();
  const { user } = useAuthStore();
  const { subtotal, tax, discount, total } = totals();

  const needsRx = hasControlledItems();
  const loyaltyDiscount = loyaltyPointsToRedeem / 10;
  const finalTotal = Math.max(0, total - loyaltyDiscount);

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
</style>
</head><body>
  <h1>MedERP Pharmacy</h1>
  <p class="subtitle">Tax Invoice / Bill of Supply</p>
  <hr class="divider-solid"/>

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
    <tbody>${itemRows}</tbody>
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
    <p><b>Thank you for choosing MedERP Pharmacy</b></p>
    <p>Goods once sold will not be taken back without a valid reason.</p>
    <p>For queries, please contact your pharmacist.</p>
  </div>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  // ── Patient lookup ──────────────────────────────────────────────────────────
  const { data: patientResults } = useQuery({
    queryKey: ["patient-search-pos", patientSearch],
    queryFn: () => apiClient.get("/patients", { params: { search: patientSearch, limit: 5 } }) as any,
    enabled: (patientSearch?.length ?? 0) >= 3,
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
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    const handleGlobalKeydown = async (e: KeyboardEvent) => {
      if (!e.key) return;
      const currentTime = Date.now();
      if (e.key === "Enter") {
        if (buffer && currentTime - lastKeyTime < 50) {
          e.preventDefault();
          const scanCode = buffer.trim();
          buffer = "";
          if (scanCode.length > 2) {
            try {
              const res: any = await apiClient.get("/inventory/medicines", { params: { search: scanCode, limit: 1 } });
              const medicine = res?.data?.data?.[0] ?? res?.data?.[0];
              if (medicine) {
                const batchesRes: any = await apiClient.get("/inventory/batches", { params: { medicineId: medicine.id, status: "active", limit: 50 } });
                const batchList: any[] = Array.isArray(batchesRes) ? batchesRes : Array.isArray(batchesRes?.data?.data) ? batchesRes.data.data : Array.isArray(batchesRes?.data) ? batchesRes.data : [];
                const firstBatch = batchList[0];
                if (firstBatch) {
                  addItem({
                    medicineId: medicine.id, batchId: firstBatch.id,
                    name: medicine.name, sku: medicine.sku, batchNo: firstBatch.batchNo,
                    unitPrice: parseFloat(medicine.priceMrp),
                    stripSize: medicine.stripSize ? parseInt(medicine.stripSize) : 1,
                    taxPct: parseFloat(medicine.taxPercent ?? "0"), discountPct: 0, quantity: 1,
                    scheduleClass: medicine.scheduleClass, requiresPrescription: medicine.requiresPrescription,
                  });
                  setSearch("");
                }
              }
            } catch {}
          }
        } else {
          buffer = "";
        }
      } else if (e.key && e.key.length === 1) {
        buffer = currentTime - lastKeyTime < 50 ? buffer + e.key : e.key;
      }
      lastKeyTime = currentTime;
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, [addItem]);

  // ── Online/offline ──────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineQueue((p) => apiClient.post("/billing/invoices", p) as any); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Hotkeys ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); if (items.length > 0) setPayOpen(true); }
      if (e.key === "F6") { e.preventDefault(); if (items.length > 0 && confirm("Clear the entire cart?")) clear(); }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); if (lastInvoice) printReceipt(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, clear, lastInvoice]);

  // ── Medicine search ──────────────────────────────────────────────────────────
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["medicine-search", search],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search, limit: 8 } }) as any,
    enabled: (search?.length ?? 0) >= 2,
  });

  // ── Invoice creation ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: object) => apiClient.post("/billing/invoices", payload) as any,
    onSuccess: (data: any) => {
      const invoice = data?.data?.invoice ?? data?.data ?? data;
      setLastInvoice(invoice);
      setLastReceiptItems([...items]);
      setLastReceiptPatient(selectedPatient ?? null);
      clear();
      setPayOpen(false);
      setPrintOpen(true);
    },
  });

  const handlePayConfirm = async (mode: string, splits?: { mode: string; amount: number; ref?: string }[]) => {
    if (needsRx && !prescriptionId?.trim()) {
      alert("This sale includes Schedule H/controlled medicines. Please enter a verified Prescription ID before checkout.");
      return;
    }

    const payments = splits?.length
      ? splits.map((s) => ({ mode: s.mode, amount: String(s.amount.toFixed(2)), ...(s.ref ? { referenceNo: s.ref } : {}) }))
      : [{ mode, amount: String(finalTotal.toFixed(2)) }];
    setLastReceiptPayments(payments);

    const payload = {
      patientId: patientId || undefined,
      prescriptionId: prescriptionId?.trim() || undefined,
      loyaltyPointsToRedeem,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        quantity: i.saleUnit === "pack" ? i.quantity * (i.stripSize || 1) : i.quantity,
        discountPct: String(i.discountPct ?? "0"),
      })),
      discountAmount: "0",
      payments,
    };

    if (!isOnline) {
      await queueOfflineInvoice(payload);
      clear();
      setPayOpen(false);
      alert("Saved offline — will sync when connection restored.");
      return;
    }

    createMutation.mutate(payload);
  };

  const searchRaw = searchResults as any;
  const medicines: any[] = Array.isArray(searchRaw?.data?.data) ? searchRaw.data.data : Array.isArray(searchRaw?.data) ? searchRaw.data : [];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-muted/40 p-4 rounded-xl border">
        <div className="flex flex-wrap items-center gap-2">
          {(["[F2] Search", "[F4] Pay", "[F6] Clear", "[Ctrl+P] Print"] as const).map((k) => (
            <span key={k} className="text-xs bg-muted border font-semibold px-2 py-1 rounded-md">{k}</span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-500" : "bg-amber-500"}`} />
          <span className="text-xs font-semibold text-gray-700">{isOnline ? "Online Terminal" : "Offline Storage Mode"}</span>
        </div>
      </div>

      {/* Schedule H warning banner */}
      {needsRx && (
        <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold">
            <AlertTriangle size={15} /> Cart contains Schedule H / controlled medicines — a verified prescription is required
          </div>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-amber-600 shrink-0" />
            <input
              value={prescriptionId ?? ""}
              onChange={(e) => setPrescriptionId(e.target.value || null)}
              placeholder="Paste verified Prescription ID (UUID)..."
              className="flex-1 border border-amber-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white font-mono"
            />
            {prescriptionId && (
              <button onClick={() => setPrescriptionId(null)} className="text-amber-500 hover:text-amber-700">
                <X size={14} />
              </button>
            )}
          </div>
          {prescriptionId?.trim() && (
            <span className="text-xs text-green-700 font-medium">Prescription linked</span>
          )}
        </div>
      )}

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Left: search + patient */}
        <div className="flex-1 flex flex-col gap-3 h-full overflow-hidden">
          {/* Patient selector */}
          <div className="relative">
            {selectedPatient ? (
              <div className="flex items-center justify-between border rounded-xl px-4 py-2.5 bg-blue-50 border-blue-200">
                <div>
                  <p className="text-sm font-semibold text-blue-900">{selectedPatient.name}</p>
                  <p className="text-xs text-blue-600">
                    {selectedPatient.phone}
                    {selectedPatient.loyaltyPoints != null && (
                      <span className="ml-2 bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">
                        <Star size={10} className="inline mr-0.5" />{selectedPatient.loyaltyPoints} pts
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(selectedPatient.loyaltyPoints ?? 0) >= 100 && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-yellow-700 font-medium">Redeem:</span>
                      <select
                        value={loyaltyPointsToRedeem}
                        onChange={(e) => setLoyaltyPointsToRedeem(Number(e.target.value))}
                        className="border border-yellow-300 rounded px-1.5 py-1 text-xs bg-white"
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
                    className="text-blue-400 hover:text-blue-700"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search patient by name or phone (optional)..."
                    className="w-full border rounded-xl pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background"
                  />
                  {patientSearch.length >= 3 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border rounded-xl shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {patientResults_.length > 0 ? (
                        patientResults_.map((p: any) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setPatient(p.id); setPatientSearch(""); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-muted/50 text-sm flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground ml-2 text-xs">{p.phone}</span>
                            </div>
                            {p.loyaltyPoints > 0 && (
                              <span className="text-xs text-yellow-600 font-medium bg-yellow-50 px-1.5 py-0.5 rounded border border-yellow-100">
                                <Star size={10} className="inline mr-0.5 align-middle" />{p.loyaltyPoints} pts
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-2.5 text-xs text-muted-foreground">No matching patients found.</div>
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
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 text-sm text-blue-600 font-medium flex items-center gap-2 bg-slate-50/50"
                      >
                        <Plus size={14} />
                        <span>Register "{patientSearch}" as a new patient</span>
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
                  className="px-4 bg-primary hover:bg-primary/95 active:scale-95 text-primary-foreground rounded-xl text-sm font-semibold transition-all duration-150 inline-flex items-center gap-1.5 shrink-0 shadow-sm border border-transparent"
                  title="Quick Register Patient"
                >
                  <UserPlus size={15} />
                  <span className="hidden sm:inline">Add Patient</span>
                </button>
              </div>
            )}
          </div>

          {/* Medicine search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Scan barcode or type name/SKU… (F2)"
              className="w-full border rounded-xl pl-9 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background shadow-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto rounded-xl border bg-card">
            {search.length >= 2 ? (
              <div className="divide-y">
                {isFetching && (
                  <div className="p-6 text-sm text-muted-foreground text-center animate-pulse">Searching items…</div>
                )}
                {medicines.map((m: any) => (
                  <div
                    key={m.id}
                    onClick={async () => {
                      try {
                        const batchRes: any = await apiClient.get("/inventory/batches", { params: { medicineId: m.id, status: "active", limit: 50 } });
                        const batchArr: any[] = Array.isArray(batchRes) ? batchRes : Array.isArray(batchRes?.data?.data) ? batchRes.data.data : Array.isArray(batchRes?.data) ? batchRes.data : [];
                        const first = batchArr[0];
                        if (!first) { alert("No batch/stock available for this item."); return; }
                        addItem({
                          medicineId: m.id, batchId: first.id, name: m.name, sku: m.sku,
                          batchNo: first.batchNo, unitPrice: parseFloat(m.priceMrp),
                          stripSize: m.stripSize ? parseInt(m.stripSize) : 1,
                          taxPct: parseFloat(m.taxPercent ?? "0"), discountPct: 0, quantity: 1,
                          scheduleClass: m.scheduleClass, requiresPrescription: m.requiresPrescription,
                        });
                        setSearch("");
                      } catch { alert("Error getting batch stock details."); }
                    }}
                    className="flex items-center justify-between px-5 py-4 hover:bg-muted/40 text-sm text-left transition duration-150 cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{m.name}</span>
                        {m.scheduleClass && CONTROLLED_CLASSES.includes(m.scheduleClass) && (
                          <span className="text-[10px] bg-red-50 text-red-700 border border-red-100 font-bold px-1.5 py-0.5 rounded uppercase">
                            {m.scheduleClass} — Rx Required
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{m.sku}</span>
                        {m.hsnCode && <span>· HSN: {m.hsnCode}</span>}
                      </div>
                    </div>
                    <span className="font-bold text-base text-primary">₹{parseFloat(m.priceMrp).toFixed(2)}</span>
                  </div>
                ))}
                {!isFetching && medicines.length === 0 && (
                  <div className="p-6 text-sm text-muted-foreground text-center">No matching medicines.</div>
                )}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground text-sm flex flex-col items-center justify-center h-full">
                <ShoppingCart className="w-12 h-12 mb-3 opacity-25" />
                <p>Search or use a barcode scanner to build checkout.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: cart */}
        <div className="w-96 flex flex-col border rounded-xl bg-card shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3.5 border-b bg-muted/20">
            <ShoppingCart size={16} />
            <span className="font-semibold text-sm">Cart</span>
            <span className="ml-auto text-xs text-muted-foreground bg-muted border px-2 py-0.5 rounded-full">
              {items.length} items
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y bg-white/50">
            {items.length === 0 && (
              <div className="text-center py-16 text-xs text-muted-foreground flex flex-col items-center gap-1">
                <ShoppingCart className="w-8 h-8 mb-1 opacity-25" />
                <span>Cart is empty</span>
              </div>
            )}
            {items.map((item) => (
              <div key={item.batchId} className="px-4 py-3 bg-white/30 backdrop-blur-sm">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-gray-900">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{item.batchNo}</span>
                      <span>·</span>
                      <span>₹{(item.saleUnit === "loose" ? item.unitPrice / (item.stripSize || 1) : item.unitPrice).toFixed(2)} / {item.saleUnit === "loose" ? "Tab" : "Strip"}</span>
                      {item.scheduleClass && CONTROLLED_CLASSES.includes(item.scheduleClass) && (
                        <span className="bg-red-50 text-red-600 text-[10px] font-bold px-1 rounded">{item.scheduleClass}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeItem(item.medicineId, item.batchId)} className="text-muted-foreground hover:text-red-500 ml-2 transition">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-muted/30">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md">
                      <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity - 1)} className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition">
                        <Minus size={10} />
                      </button>
                      <span className="w-8 text-center text-xs font-semibold">{item.quantity}</span>
                      <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity + 1)} className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition">
                        <Plus size={10} />
                      </button>
                    </div>
                    {item.stripSize > 1 && (
                      <button
                        onClick={() => toggleUnit(item.medicineId, item.batchId)}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      >
                        {item.saleUnit === "pack" ? "Strips" : "Loose"}
                      </button>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-900">₹{item.lineTotal.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t p-4 space-y-1.5 text-sm bg-muted/10">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax (GST)</span><span>₹{tax.toFixed(2)}</span>
            </div>
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-yellow-700 text-xs font-medium">
                <span><Star size={10} className="inline mr-1" />Loyalty discount ({loyaltyPointsToRedeem} pts)</span>
                <span>−₹{loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-1.5 border-t">
              <span>Total</span>
              <span className="text-primary text-lg">₹{finalTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="px-4 pb-4 flex gap-2">
            <button onClick={clear} disabled={items.length === 0} className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-muted transition duration-200 disabled:opacity-40">
              Clear (F6)
            </button>
            <button
              onClick={() => setPayOpen(true)}
              disabled={items.length === 0}
              className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition shadow-sm"
            >
              Pay (F4)
            </button>
          </div>
        </div>
      </div>

      <PaymentModal
        open={payOpen}
        total={finalTotal}
        onClose={() => setPayOpen(false)}
        onConfirm={handlePayConfirm}
        loading={createMutation.isPending}
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
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-2 gap-3">
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 print:bg-white print:p-0 print:items-start print:justify-start">
          <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col print:max-h-none print:shadow-none print:rounded-none">

            {/* Non-print header */}
            <div className="flex items-center justify-between px-6 py-4 border-b print:hidden">
              <span className="bg-green-100 text-green-700 font-semibold px-3 py-1 rounded-full text-xs">Invoice Completed!</span>
              <button onClick={() => { setPrintOpen(false); setLastInvoice(null); }} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400">
                <X size={15} />
              </button>
            </div>

            {/* Scrollable receipt body */}
            <div id="invoice-print-area" className="overflow-y-auto flex-1 px-6 py-5 space-y-4 print:overflow-visible print:p-6">

              {/* Store header */}
              <div className="text-center space-y-0.5">
                <h2 className="text-lg font-black tracking-tight text-gray-900 uppercase">MedERP Pharmacy</h2>
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
                <p className="text-[10px] text-gray-400">Thank you for choosing MedERP Pharmacy</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Goods once sold will not be taken back without valid reason</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 px-6 pb-5 pt-3 border-t print:hidden">
              <button
                onClick={() => { setPrintOpen(false); setLastInvoice(null); }}
                className="flex-1 py-2.5 border rounded-lg text-sm font-semibold hover:bg-gray-50 transition"
              >
                New Sale
              </button>
              <button
                onClick={printReceipt}
                className="flex-1 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition inline-flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Print (Ctrl+P)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
