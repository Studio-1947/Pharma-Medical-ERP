"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Plus, X } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";

interface Batch {
  id: string;
  medicineId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  mrpAtEntry: string;
  status: string;
}

interface Medicine {
  id: string;
  name: string;
  sku: string;
  priceMrp: string;
}

function expiryLabel(dateStr: string) {
  const expiry = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);

  if (diffDays < 0) return { text: "Expired", cls: "bg-red-100 text-red-700", icon: "red" };
  if (diffDays <= 30) return { text: `${diffDays}d left`, cls: "bg-red-50 text-red-600", icon: "critical" };
  if (diffDays <= 90) return { text: `${diffDays}d left`, cls: "bg-amber-50 text-amber-600", icon: "warn" };
  return { text: `${diffDays}d left`, cls: "bg-green-50 text-green-700", icon: "ok" };
}

interface AddStockFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

function AddStockForm({ onClose, onSuccess }: AddStockFormProps) {
  const { user } = useAuthStore();
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [form, setForm] = useState({
    batchNo: "",
    expiryDate: "",
    quantity: "",
    costPrice: "",
    mrpAtEntry: "",
  });
  const [error, setError] = useState("");

  const { data: medicineResults } = useQuery({
    queryKey: ["medicine-search-form", medicineSearch],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search: medicineSearch, limit: 8 } }) as any,
    enabled: medicineSearch.length >= 2 && !selectedMedicine,
  });

  const medicines: Medicine[] = (() => {
    const raw = medicineResults as any;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    return [];
  })();

  const mutation = useMutation({
    mutationFn: (payload: object) => apiClient.post("/inventory/batches", payload) as any,
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? "Failed to add stock";
      setError(Array.isArray(msg) ? msg.join(", ") : String(msg));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selectedMedicine) { setError("Select a medicine first."); return; }
    if (!form.batchNo.trim()) { setError("Batch number is required."); return; }
    if (!form.expiryDate) { setError("Expiry date is required."); return; }
    const qty = parseInt(form.quantity);
    if (!qty || qty < 1) { setError("Quantity must be at least 1."); return; }
    const cost = parseFloat(form.costPrice);
    if (!cost || cost < 0) { setError("Cost price is required."); return; }
    const mrp = parseFloat(form.mrpAtEntry || selectedMedicine.priceMrp);
    if (!mrp || mrp < 0) { setError("MRP is required."); return; }

    mutation.mutate({
      medicineId: selectedMedicine.id,
      branchId: user?.branchId,
      batchNo: form.batchNo.trim(),
      expiryDate: form.expiryDate,
      quantity: qty,
      costPrice: cost.toFixed(2),
      mrpAtEntry: mrp.toFixed(2),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-base font-semibold">Add Stock Batch</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Medicine search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Medicine *</label>
            {selectedMedicine ? (
              <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-blue-50 border-blue-200">
                <div>
                  <span className="text-sm font-medium text-blue-900">{selectedMedicine.name}</span>
                  <span className="text-xs text-blue-600 ml-2">{selectedMedicine.sku}</span>
                </div>
                <button type="button" onClick={() => { setSelectedMedicine(null); setMedicineSearch(""); form.mrpAtEntry = ""; }}
                  className="text-blue-400 hover:text-blue-700">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Type medicine name to search..."
                  value={medicineSearch}
                  onChange={(e) => setMedicineSearch(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {medicines.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {medicines.map((m) => (
                      <button key={m.id} type="button"
                        onClick={() => {
                          setSelectedMedicine(m);
                          setForm((f) => ({ ...f, mrpAtEntry: parseFloat(m.priceMrp).toFixed(2) }));
                          setMedicineSearch("");
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/50 text-sm border-b last:border-b-0">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{m.sku} — MRP ₹{parseFloat(m.priceMrp).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Batch Number *</label>
              <input
                type="text"
                placeholder="e.g. B2024001"
                value={form.batchNo}
                onChange={(e) => setForm((f) => ({ ...f, batchNo: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Expiry Date *</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Quantity *</label>
              <input
                type="number"
                min={1}
                placeholder="100"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Cost Price (₹) *</label>
              <input
                type="number"
                step="0.01"
                min={0}
                placeholder="6.50"
                value={form.costPrice}
                onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">MRP (₹) *</label>
              <input
                type="number"
                step="0.01"
                min={0}
                placeholder="8.00"
                value={form.mrpAtEntry}
                onChange={(e) => setForm((f) => ({ ...f, mrpAtEntry: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {mutation.isPending ? "Adding..." : "Add Stock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface Props {
  medicineId?: string;
}

export function BatchList({ medicineId }: Props) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const params: Record<string, any> = { page, limit: 20 };
  if (medicineId) params.medicineId = medicineId;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ["batches", params],
    queryFn: () => apiClient.get("/inventory/batches", { params }) as any,
  });

  const handleStockAdded = () => {
    queryClient.invalidateQueries({ queryKey: ["batches"] });
  };

  return (
    <div>
      {/* Filters + Add Stock */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="quarantine">Quarantine</option>
          <option value="expired">Expired</option>
          <option value="depleted">Depleted</option>
          <option value="recalled">Recalled</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={15} />
          Add Stock
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Batch No</th>
                  <th className="text-left px-4 py-3 font-medium">Expiry</th>
                  <th className="text-right px-4 py-3 font-medium">Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Cost</th>
                  <th className="text-right px-4 py-3 font-medium">MRP</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-center px-4 py-3 font-medium">Expiry Alert</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data as any).data?.map((b: Batch) => {
                  const exp = expiryLabel(b.expiryDate);
                  return (
                    <tr key={b.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{b.batchNo}</td>
                      <td className="px-4 py-3 text-xs">
                        {new Date(b.expiryDate).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{b.quantity}</td>
                      <td className="px-4 py-3 text-right">
                        ₹{parseFloat(b.costPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        ₹{parseFloat(b.mrpAtEntry).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            b.status === "active"
                              ? "bg-green-100 text-green-700"
                              : b.status === "expired"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${exp.cls}`}>
                          {exp.icon === "ok" ? (
                            <CheckCircle size={11} />
                          ) : exp.icon === "critical" || exp.icon === "red" ? (
                            <AlertTriangle size={11} />
                          ) : (
                            <Clock size={11} />
                          )}
                          {exp.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {(data as any).data?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No batches found. Use "Add Stock" to receive inventory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>
              {(data as any).meta?.total ?? 0} total
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Prev
              </button>
              <button
                disabled={page >= ((data as any).meta?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {addOpen && (
        <AddStockForm onClose={() => setAddOpen(false)} onSuccess={handleStockAdded} />
      )}
    </div>
  );
}
