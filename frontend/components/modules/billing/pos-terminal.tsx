"use client";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Trash2, Plus, Minus, ShoppingCart } from "lucide-react";
import { useCartStore } from "@/stores/cart.store";
import { PaymentModal } from "./payment-modal";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { queueOfflineInvoice, syncOfflineQueue } from "@/lib/pos-db";

export function PosTerminal() {
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const { items, addItem, updateQty, removeItem, clear, totals, patientId, branchId } = useCartStore();
  const { user } = useAuthStore();
  const { subtotal, tax, discount, total } = totals();

  // Online/offline detection
  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineQueue((p) => apiClient.post("/billing/invoices", p) as any); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // F2 = focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); } if (e.key === "F10") { e.preventDefault(); if (items.length) setPayOpen(true); } if (e.key === "Escape") setPayOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items]);

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["medicine-search", search],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search, limit: 8 } }) as any,
    enabled: search.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => apiClient.post("/billing/invoices", payload) as any,
    onSuccess: () => { clear(); setPayOpen(false); alert("Invoice created!"); },
  });

  const handlePayConfirm = async (mode: string) => {
    const payload = {
      branchId: branchId || user?.branchId || "00000000-0000-0000-0000-000000000000",
      patientId: patientId || undefined,
      paymentMode: mode,
      items: items.map((i) => ({ medicineId: i.medicineId, batchId: i.batchId, quantity: i.quantity, unitPrice: String(i.unitPrice), discountPct: String(i.discountPct), taxPct: String(i.taxPct) })),
      discountAmount: "0",
    };
    if (!isOnline) { await queueOfflineInvoice(payload); clear(); setPayOpen(false); alert("Saved offline — will sync when connection restored."); return; }
    createMutation.mutate(payload);
  };

  const medicines: any[] = (searchResults as any)?.data ?? [];

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left: search + results */}
      <div className="flex-1 flex flex-col gap-3">
        {!isOnline && (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs px-3 py-2 rounded-lg font-medium">
            Offline mode — invoices will sync when connection is restored (F10 to pay)
          </div>
        )}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search medicine by name, SKU or barcode… (F2)"
            className="w-full border rounded-xl pl-9 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>

        {search.length >= 2 && (
          <div className="border rounded-xl overflow-hidden">
            {isFetching && <div className="p-4 text-sm text-muted-foreground text-center">Searching…</div>}
            {medicines.map((m: any) => (
              <button key={m.id} onClick={async () => {
                const batches: any[] = await apiClient.get(`/inventory/medicines/${m.id}/batches`) as any;
                const first = Array.isArray(batches) ? batches[0] : (batches as any)?.data?.[0];
                if (!first) { alert("No stock available"); return; }
                addItem({ medicineId: m.id, batchId: first.id, name: m.name, sku: m.sku, batchNo: first.batchNo, unitPrice: parseFloat(m.priceMrp), taxPct: parseFloat(m.taxPercent ?? "0"), discountPct: 0, quantity: 1 });
                setSearch("");
              }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted border-b last:border-0 text-sm text-left transition-colors">
                <div>
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{m.sku}</span>
                </div>
                <span className="font-bold text-primary">₹{parseFloat(m.priceMrp).toFixed(2)}</span>
              </button>
            ))}
            {!isFetching && medicines.length === 0 && <div className="p-4 text-sm text-muted-foreground text-center">No results</div>}
          </div>
        )}
      </div>

      {/* Right: cart */}
      <div className="w-96 flex flex-col border rounded-xl bg-card">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <ShoppingCart size={16} />
          <span className="font-semibold text-sm">Cart</span>
          <span className="ml-auto text-xs text-muted-foreground">{items.length} items</span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y">
          {items.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">Cart is empty</div>}
          {items.map((item) => (
            <div key={item.batchId} className="px-4 py-3">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.batchNo} · ₹{item.unitPrice.toFixed(2)}</p>
                </div>
                <button onClick={() => removeItem(item.medicineId, item.batchId)} className="text-muted-foreground hover:text-red-500 ml-2">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity - 1)} className="w-7 h-7 rounded border flex items-center justify-center hover:bg-muted"><Minus size={12} /></button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <button onClick={() => updateQty(item.medicineId, item.batchId, item.quantity + 1)} className="w-7 h-7 rounded border flex items-center justify-center hover:bg-muted"><Plus size={12} /></button>
                </div>
                <span className="text-sm font-bold">₹{item.lineTotal.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t p-4 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Tax (GST)</span><span>₹{tax.toFixed(2)}</span></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
        </div>

        <div className="px-4 pb-4 flex gap-2">
          <button onClick={clear} className="flex-1 py-2 border rounded-lg text-sm hover:bg-muted transition-colors">Clear</button>
          <button onClick={() => setPayOpen(true)} disabled={items.length === 0}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
            Pay (F10)
          </button>
        </div>
      </div>

      <PaymentModal open={payOpen} total={total} onClose={() => setPayOpen(false)}
        onConfirm={handlePayConfirm} loading={createMutation.isPending} />
    </div>
  );
}
