"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Pencil, Plus, X, Camera } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { BarcodeScannerDialog } from "@/components/shared/barcode-scanner-dialog";
import { Modal } from "@/components/ui/modal";

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
  /** Batch numbers already present for the medicine pre-selected in this list view */
  existingBatchNosForMedicine?: string[];
  /** Pre-select a medicine so the user doesn't have to search when coming from a medicine's batch list */
  lockedMedicine?: Medicine;
}

function AddStockForm({ onClose, onSuccess, existingBatchNosForMedicine = [], lockedMedicine }: AddStockFormProps) {
  const { user } = useAuthStore();
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(lockedMedicine ?? null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [form, setForm] = useState({
    batchNo: "",
    expiryDate: "",
    quantity: "",
    costPrice: lockedMedicine ? parseFloat(lockedMedicine.priceMrp).toFixed(2) : "",
    mrpAtEntry: lockedMedicine ? parseFloat(lockedMedicine.priceMrp).toFixed(2) : "",
  });
  const [error, setError] = useState("");

  const handleBarcodeScan = async (scanCode: string) => {
    if (!scanCode) return;
    try {
      const res: any = await apiClient.get("/inventory/medicines", { params: { search: scanCode, limit: 1 } });
      const medicine = res?.data?.data?.[0] ?? res?.data?.[0];
      if (medicine) {
        setSelectedMedicine(medicine);
        setForm((f) => ({
          ...f,
          mrpAtEntry: parseFloat(medicine.priceMrp).toFixed(2),
          costPrice: parseFloat(medicine.priceMrp).toFixed(2),
        }));
        setMedicineSearch("");
        setError("");
      } else {
        setError(`No medicine found for barcode/SKU: "${scanCode}"`);
      }
    } catch {
      setError("Failed to fetch medicine from barcode scan.");
    }
  };

  useBarcodeScanner(handleBarcodeScan, { enabled: !selectedMedicine });

  // For medicines searched inside the form (not locked), fetch their existing batch numbers
  const { data: dupCheck } = useQuery({
    queryKey: ["batch-dup-check", selectedMedicine?.id],
    queryFn: () =>
      apiClient.get("/inventory/batches", {
        params: { medicineId: selectedMedicine!.id, limit: 200 },
      }) as any,
    enabled: !!selectedMedicine && !lockedMedicine,
    staleTime: 15_000,
  });

  const fetchedBatchNos: string[] = (() => {
    const raw = dupCheck as any;
    const list: Batch[] = Array.isArray(raw?.data?.data) ? raw.data.data : Array.isArray(raw?.data) ? raw.data : [];
    return list.map((b) => b.batchNo.toLowerCase());
  })();

  // Use passed-in list when locked (instant, no extra fetch), otherwise use fetched list
  const knownBatchNos = lockedMedicine
    ? existingBatchNosForMedicine.map((n) => n.toLowerCase())
    : fetchedBatchNos;

  const isDuplicate =
    form.batchNo.trim().length > 0 &&
    knownBatchNos.includes(form.batchNo.trim().toLowerCase());

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
    if (isDuplicate) { setError(`Batch number "${form.batchNo.trim()}" already exists for this medicine.`); return; }
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
    <Modal
      title="Add Stock Batch"
      subtitle={selectedMedicine ? `Adding batch for ${selectedMedicine.name}` : "Search medicine and fill details"}
      open={true}
      onClose={onClose}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Medicine search */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Medicine *</label>
          {selectedMedicine ? (
            <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-emerald-50 border-emerald-200">
              <div>
                <span className="text-sm font-medium text-slate-900">{selectedMedicine.name}</span>
                <span className="text-xs text-emerald-600 ml-2">{selectedMedicine.sku}</span>
              </div>
              <button type="button" onClick={() => { setSelectedMedicine(null); setMedicineSearch(""); form.mrpAtEntry = ""; }}
                className="text-emerald-400 hover:text-emerald-700">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Type name, SKU, or scan barcode..."
                  value={medicineSearch}
                  onChange={(e) => setMedicineSearch(e.target.value)}
                  data-barcode-capture="true"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
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
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition text-slate-600 hover:text-slate-900 bg-white flex items-center justify-center shadow-sm"
                title="Scan Medicine Barcode"
              >
                <Camera size={16} />
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Batch Number *</label>
            <input
              type="text"
              placeholder="e.g. B2024001"
              value={form.batchNo}
              onChange={(e) => setForm((f) => ({ ...f, batchNo: e.target.value }))}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 font-mono ${
                isDuplicate
                  ? "border-red-400 focus:ring-red-200 bg-red-50"
                  : "focus:ring-primary"
              }`}
            />
            {isDuplicate && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                <AlertTriangle size={11} />
                This batch number already exists for the selected medicine.
              </p>
            )}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
      <BarcodeScannerDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => {
          handleBarcodeScan(code);
          setCameraOpen(false);
        }}
      />
    </Modal>
  );
}

interface EditBatchFormProps {
  batch: Batch;
  onClose: () => void;
  onSuccess: () => void;
}

const STATUS_OPTIONS = [
  { value: "active",      label: "Active",      desc: "In stock, available for dispensing" },
  { value: "quarantine",  label: "Quarantine",  desc: "Hold — pending quality check" },
  { value: "recalled",    label: "Recalled",    desc: "Manufacturer recall — remove from stock" },
  { value: "depleted",    label: "Depleted",    desc: "Stock exhausted — retire this batch" },
  { value: "expired",     label: "Expired",     desc: "Past expiry date" },
] as const;

function EditBatchForm({ batch, onClose, onSuccess }: EditBatchFormProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState({
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate.slice(0, 10),
    costPrice: parseFloat(batch.costPrice).toFixed(2),
    mrpAtEntry: parseFloat(batch.mrpAtEntry).toFixed(2),
    status: batch.status,
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: object) => apiClient.patch(`/inventory/batches/${batch.id}`, payload) as any,
    onSuccess: () => {
      toastSuccess("Batch updated", `Batch ${batch.batchNo} has been saved successfully.`);
      onSuccess();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? "Update failed";
      const str = Array.isArray(msg) ? msg.join(", ") : String(msg);
      setError(str);
      toastError("Update failed", str);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.batchNo.trim()) { setError("Batch number is required."); return; }
    if (!form.expiryDate) { setError("Expiry date is required."); return; }
    const cost = parseFloat(form.costPrice);
    if (isNaN(cost) || cost < 0) { setError("Valid cost price is required."); return; }
    const mrp = parseFloat(form.mrpAtEntry);
    if (isNaN(mrp) || mrp < 0) { setError("Valid MRP is required."); return; }

    mutation.mutate({
      batchNo: form.batchNo.trim(),
      expiryDate: form.expiryDate,
      costPrice: cost.toFixed(2),
      mrpAtEntry: mrp.toFixed(2),
      status: form.status,
    });
  };

  return (
    <Modal
      title="Edit Batch"
      subtitle={`Updating batch for medicine ID: ${batch.medicineId.slice(0, 8)}…`}
      open={true}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Batch Number *</label>
            <input
              type="text"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Cost Price (₹) *</label>
            <input
              type="number"
              step="0.01"
              min={0}
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
              value={form.mrpAtEntry}
              onChange={(e) => setForm((f) => ({ ...f, mrpAtEntry: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
            ))}
          </select>
          {(form.status === "recalled" || form.status === "depleted" || form.status === "expired") && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
              Setting status to <strong>{form.status}</strong> will hide this batch from active dispensing. The batch history and audit trail are preserved.
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          To adjust quantity, use the stock adjustment feature — changes are logged in the audit trail.
        </p>

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
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface Props {
  medicineId?: string;
  medicine?: Medicine;
}

export function BatchList({ medicineId, medicine }: Props) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Batch | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, warning: toastWarning } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const params: Record<string, any> = { page, limit: 20 };
  if (medicineId) params.medicineId = medicineId;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ["batches", params],
    queryFn: () => apiClient.get("/inventory/batches", { params }) as any,
  });

  // All batch numbers currently loaded — used for instant duplicate detection in AddStockForm
  const loadedBatchNos: string[] = ((data as any)?.data ?? []).map((b: Batch) => b.batchNo);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/inventory/batches/${id}`) as any,
    onSuccess: (_data, id) => {
      const batch = ((data as any)?.data ?? []).find((b: Batch) => b.id === id);
      toastSuccess(
        "Batch deleted",
        `Batch ${batch?.batchNo ?? id} has been permanently removed.`,
      );
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
    onError: (err: any) => {
      const msg: string = (() => {
        const raw = err?.response?.data?.message ?? err?.message ?? "";
        return Array.isArray(raw) ? raw.join(" ") : String(raw);
      })();

      const isMovementBlock = msg.toLowerCase().includes("stock movement");

      if (isMovementBlock) {
        toastWarning(
          "Batch cannot be deleted",
          "This batch has sales or purchase history attached to it. To retire it, use the Edit button and change its status to Recalled or Depleted — this removes it from active stock without losing the audit trail.",
          9000,
        );
      } else {
        toastWarning("Delete failed", msg, 6000);
      }
      setConfirmDeleteId(null);
    },
  });

  const handleRefresh = () => {
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
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
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
                      <td className="px-4 py-3 text-center">
                        {confirmDeleteId === b.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-red-600 font-medium">Sure?</span>
                            <button
                              onClick={() => deleteMutation.mutate(b.id)}
                              disabled={deleteMutation.isPending}
                              className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deleteMutation.isPending ? "..." : "Yes"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 text-xs border rounded hover:bg-muted transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => setEditTarget(b)}
                              title="Edit batch"
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary border border-primary/20 rounded-md hover:bg-primary/5 transition-colors"
                            >
                              <Pencil size={11} />
                              Edit
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => setConfirmDeleteId(b.id)}
                                title="Delete batch"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                              >
                                <X size={11} />
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(data as any).data?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground">
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
        <AddStockForm
          onClose={() => setAddOpen(false)}
          onSuccess={handleRefresh}
          existingBatchNosForMedicine={medicineId ? loadedBatchNos : []}
          lockedMedicine={medicineId && medicine ? medicine : undefined}
        />
      )}

      {editTarget && (
        <EditBatchForm
          batch={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={handleRefresh}
        />
      )}
    </div>
  );
}
