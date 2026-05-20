"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Trash2, Plus, Minus, ShoppingCart, Printer, AlertTriangle, FileText, Star, X } from "lucide-react";
import { useCartStore } from "@/stores/cart.store";
import { PaymentModal } from "./payment-modal";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { queueOfflineInvoice, syncOfflineQueue } from "@/lib/pos-db";

const CONTROLLED_CLASSES = ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"];

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

  // Rehydrate the persisted cart from localStorage on first client render.
  // This prevents the SSR/client mismatch (server sees empty cart, client sees saved items).
  useEffect(() => {
    useCartStore.persist.rehydrate();
  }, []);


  const {
    items, addItem, updateQty, removeItem, clear, totals,
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

  // ── Patient lookup ──────────────────────────────────────────────────────────
  const { data: patientResults } = useQuery({
    queryKey: ["patient-search-pos", patientSearch],
    queryFn: () => apiClient.get("/patients", { params: { search: patientSearch, limit: 5 } }) as any,
    enabled: patientSearch.length >= 3,
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
      } else if (e.key.length === 1) {
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
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); if (items.length > 0) setPayOpen(true); }
      if (e.key === "F6") { e.preventDefault(); if (items.length > 0 && confirm("Clear the entire cart?")) clear(); }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); if (lastInvoice) window.print(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, clear, lastInvoice]);

  // ── Medicine search ──────────────────────────────────────────────────────────
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["medicine-search", search],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search, limit: 8 } }) as any,
    enabled: search.length >= 2,
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
        quantity: i.quantity,
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
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Search patient by name or phone (optional)..."
                  className="w-full border rounded-xl pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background"
                />
                {patientResults_.length > 0 && patientSearch.length >= 3 && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {patientResults_.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => { setPatient(p.id); setPatientSearch(""); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/50 text-sm"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{p.phone}</span>
                        {p.loyaltyPoints > 0 && (
                          <span className="ml-2 text-xs text-yellow-600 font-medium">{p.loyaltyPoints} pts</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
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
                      <span>₹{item.unitPrice.toFixed(2)}</span>
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
                  <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md">
                    <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity - 1)} className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition">
                      <Minus size={10} />
                    </button>
                    <span className="w-8 text-center text-xs font-semibold">{item.quantity}</span>
                    <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity + 1)} className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition">
                      <Plus size={10} />
                    </button>
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
                  {lastReceiptItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 text-xs py-1.5 gap-1 items-start">
                      <div className="col-span-5">
                        <p className="font-semibold text-gray-900 leading-tight">{item.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{item.batchNo}</p>
                      </div>
                      <span className="col-span-1 text-center font-medium text-gray-700">{item.quantity}</span>
                      <span className="col-span-2 text-right text-gray-700">₹{item.unitPrice.toFixed(2)}</span>
                      <span className="col-span-2 text-right text-gray-500">{item.discountPct > 0 ? `${item.discountPct}%` : "—"}</span>
                      <span className="col-span-2 text-right font-semibold text-gray-900">₹{item.lineTotal.toFixed(2)}</span>
                    </div>
                  ))}
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
                onClick={() => window.print()}
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
