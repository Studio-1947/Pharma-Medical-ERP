"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Trash2, Plus, Minus, ShoppingCart, Printer } from "lucide-react";
import { useCartStore } from "@/stores/cart.store";
import { PaymentModal } from "./payment-modal";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { queueOfflineInvoice, syncOfflineQueue } from "@/lib/pos-db";

export function PosTerminal() {
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  
  const { items, addItem, updateQty, removeItem, clear, totals, patientId, branchId } = useCartStore();
  const { user } = useAuthStore();
  const { subtotal, tax, discount, total } = totals();

  // USB HID Barcode Scanner Buffer hook
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    const handleGlobalKeydown = async (e: KeyboardEvent) => {
      const currentTime = Date.now();
      
      // If the rapid keypress sequence ended in Enter
      if (e.key === "Enter") {
        if (buffer && currentTime - lastKeyTime < 50) {
          e.preventDefault();
          const scanCode = buffer.trim();
          buffer = "";
          
          if (scanCode.length > 2) {
            try {
              // Lookup barcode matching medicine
              const res: any = await apiClient.get("/inventory/medicines", {
                params: { search: scanCode, limit: 1 },
              });
              const medicine = res?.data?.[0];
              if (medicine) {
                const batchesRes: any = await apiClient.get(`/inventory/medicines/${medicine.id}/batches`);
                const firstBatch = Array.isArray(batchesRes) ? batchesRes[0] : (batchesRes as any)?.data?.[0];
                if (firstBatch) {
                  addItem({
                    medicineId: medicine.id,
                    batchId: firstBatch.id,
                    name: medicine.name,
                    sku: medicine.sku,
                    batchNo: firstBatch.batchNo,
                    unitPrice: parseFloat(medicine.priceMrp),
                    taxPct: parseFloat(medicine.taxPercent ?? "0"),
                    discountPct: 0,
                    quantity: 1,
                  });
                  setSearch("");
                } else {
                  alert(`Batch not found for scanned item: ${medicine.name}`);
                }
              }
            } catch (err) {
              console.error("Barcode search failed", err);
            }
          }
        } else {
          buffer = "";
        }
      } else if (e.key.length === 1) {
        // If elapsed time between keypresses is very short, accumulate in the barcode buffer
        if (currentTime - lastKeyTime < 50) {
          buffer += e.key;
        } else {
          buffer = e.key;
        }
      }
      lastKeyTime = currentTime;
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, [addItem]);

  // Network offline detection and Auto-sync queue hook
  useEffect(() => {
    const on = () => {
      setIsOnline(true);
      syncOfflineQueue((p) => apiClient.post("/billing/invoices", p) as any);
    };
    const off = () => setIsOnline(false);

    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Hotkeys hook (F2, F4, F6, Ctrl+P)
  useEffect(() => {
    const hotkeyHandler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        if (items.length > 0) setPayOpen(true);
      }
      if (e.key === "F6") {
        e.preventDefault();
        if (items.length > 0) {
          if (confirm("Are you sure you want to clear the entire cart?")) {
            clear();
          }
        }
      }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (lastInvoice) {
          window.print();
        } else {
          alert("No recent invoice to print yet.");
        }
      }
    };

    window.addEventListener("keydown", hotkeyHandler);
    return () => window.removeEventListener("keydown", hotkeyHandler);
  }, [items, clear, lastInvoice]);

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["medicine-search", search],
    queryFn: () =>
      apiClient.get("/inventory/medicines", { params: { search, limit: 8 } }) as any,
    enabled: search.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) =>
      apiClient.post("/billing/invoices", payload) as any,
    onSuccess: (data: any) => {
      const invoice = data?.data?.invoice ?? data?.data ?? data;
      setLastInvoice(invoice);
      clear();
      setPayOpen(false);
      setPrintOpen(true);
    },
  });

  const handlePayConfirm = async (mode: string, splits?: { mode: string; amount: number; ref?: string }[]) => {
    const resolvedBranchId = branchId || user?.branchId;
    if (!resolvedBranchId) {
      alert("No branch selected. Please log in again.");
      return;
    }

    // Build payments array matching the backend schema
    const payments = splits?.length
      ? splits.map((s) => ({
          mode: s.mode,
          amount: String(s.amount.toFixed(2)),
          ...(s.ref ? { referenceNo: s.ref } : {}),
        }))
      : [{ mode, amount: String(total.toFixed(2)) }];

    const payload = {
      branchId: resolvedBranchId,
      patientId: patientId || undefined,
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

  const medicines: any[] = (searchResults as any)?.data ?? [];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      {/* Top Banner and Quick actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-muted/40 p-4 rounded-xl border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs bg-muted border font-semibold px-2 py-1 rounded-md">
            [F2] Search Bar
          </span>
          <span className="text-xs bg-muted border font-semibold px-2 py-1 rounded-md">
            [F4] Pay Modal
          </span>
          <span className="text-xs bg-muted border font-semibold px-2 py-1 rounded-md">
            [F6] Clear Cart
          </span>
          <span className="text-xs bg-muted border font-semibold px-2 py-1 rounded-md">
            [Ctrl+P] Print Invoice
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-500" : "bg-amber-500"}`} />
          <span className="text-xs font-semibold text-gray-700">
            {isOnline ? "Online Terminal" : "Offline Storage Mode"}
          </span>
        </div>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Left: search + results */}
        <div className="flex-1 flex flex-col gap-3 h-full overflow-hidden">
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
                  <div className="p-6 text-sm text-muted-foreground text-center animate-pulse">
                    Searching items…
                  </div>
                )}
                {medicines.map((m: any) => (
                  <div
                    key={m.id}
                    onClick={async () => {
                      try {
                        const batches: any[] = await apiClient.get(`/inventory/medicines/${m.id}/batches`) as any;
                        const first = Array.isArray(batches) ? batches[0] : (batches as any)?.data?.[0];
                        if (!first) {
                          alert("No batch/stock available for this item.");
                          return;
                        }
                        addItem({
                          medicineId: m.id,
                          batchId: first.id,
                          name: m.name,
                          sku: m.sku,
                          batchNo: first.batchNo,
                          unitPrice: parseFloat(m.priceMrp),
                          taxPct: parseFloat(m.taxPercent ?? "0"),
                          discountPct: 0,
                          quantity: 1,
                        });
                        setSearch("");
                      } catch (err) {
                        alert("Error getting batch stock details.");
                      }
                    }}
                    className="flex items-center justify-between px-5 py-4 hover:bg-muted/40 text-sm text-left transition duration-150 cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{m.name}</span>
                        {m.scheduleClass && (
                          <span className="text-[10px] bg-red-50 text-red-700 border border-red-100 font-bold px-1.5 py-0.5 rounded uppercase">
                            {m.scheduleClass}
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
                <p className="text-xs mt-1">Try searching for any medicine name by F2 key focus.</p>
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
                      <span>·</span>
                      <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-semibold">
                        GST {item.taxPct}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(item.medicineId, item.batchId)}
                    className="text-muted-foreground hover:text-red-500 ml-2 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-muted/30">
                  <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md">
                    <button
                      onClick={() => updateQty(item.medicineId, item.batchId, item.quantity - 1)}
                      className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="w-8 text-center text-xs font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => updateQty(item.medicineId, item.batchId, item.quantity + 1)}
                      className="w-6 h-6 rounded border bg-white flex items-center justify-center hover:bg-muted text-gray-600 transition"
                    >
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
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax (GST)</span>
              <span>₹{tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-1.5 border-t">
              <span>Total</span>
              <span className="text-primary text-lg">₹{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={clear}
              disabled={items.length === 0}
              className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-muted transition duration-200 disabled:opacity-40"
            >
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
        total={total}
        onClose={() => setPayOpen(false)}
        onConfirm={handlePayConfirm}
        loading={createMutation.isPending}
      />

      {/* Invoice Print Preview Drawer / Dialog */}
      {printOpen && lastInvoice && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="text-center">
              <span className="bg-green-100 text-green-700 font-semibold px-3 py-1 rounded-full text-xs">
                Invoice Completed!
              </span>
              <h3 className="text-lg font-bold text-gray-900 mt-2">Print & Review</h3>
            </div>
            <hr />
            <div className="space-y-1 text-xs text-gray-800">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice No:</span>
                <span className="font-bold">{lastInvoice.invoiceNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span>{new Date(lastInvoice.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-1 font-bold border-t">
                <span>Total Amount:</span>
                <span>₹{parseFloat(lastInvoice.totalAmount).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setPrintOpen(false);
                  setLastInvoice(null);
                }}
                className="flex-1 py-2 border rounded-lg text-xs font-semibold hover:bg-muted transition"
              >
                Dismiss
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition inline-flex items-center justify-center gap-1.5"
              >
                <Printer size={12} /> Print Invoice (Ctrl+P)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
