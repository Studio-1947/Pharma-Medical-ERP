"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, Barcode, Pill, Trash2, Upload, Camera, ShieldAlert } from "lucide-react";
import { BarcodeScannerDialog } from "@/components/shared/barcode-scanner-dialog";
import { apiClient, queryKeys } from "@/lib/api-client";
import { invalidateMedicineViews } from "@/lib/query-invalidation";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { MedicineForm } from "./medicine-form";
import { BulkImportModal } from "./bulk-import-modal";
import { PurgeInactiveModal } from "./purge-inactive-modal";
import { MedicineStockModal } from "./medicine-stock-modal";
import { Layers } from "lucide-react";
import type { CreateMedicineDto } from "@pharmerp/types";

interface Medicine {
  id: string;
  name: string;
  genericName?: string;
  sku: string;
  priceMrp: string;
  unit: string;
  requiresPrescription: boolean;
  isControlled: boolean;
  scheduleClass?: string;
  isActive: boolean;
  /** Where the pack physically sits on the shelf, e.g. "A3". */
  drawerMapping?: string | null;
}

interface ApiListResponse {
  data: Medicine[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function MedicineList() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [search, setSearch] = useState("");
  // Active-only by default, matching what the counter sees. "false" surfaces
  // the medicines a bulk import parked inactive for want of an MRP — they are
  // in the catalogue but sellable nowhere until someone prices them.
  // Defaults to "all". The catalogue is what is IN inventory, and an import
  // that could not parse an MRP parks the row inactive — defaulting to active
  // only meant thousands of real medicines were absent from the one screen
  // that is supposed to list them. The dropdown still narrows to either side.
  const [status, setStatus] = useState<"true" | "false" | "all">("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitial, setCreateInitial] = useState<Partial<CreateMedicineDto> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Medicine | null>(null);
  const [viewStockTarget, setViewStockTarget] = useState<Medicine | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Inline MRP editing
  const [editingMrpId, setEditingMrpId] = useState<string | null>(null);
  const [editingMrpValue, setEditingMrpValue] = useState("");
  // Inline drawer editing. Mapping a catalogue of thousands to physical
  // drawers through the full edit form, one modal at a time, is not something
  // anyone would finish — the point is to be able to walk the shelves and
  // type as you go.
  const [editingDrawerId, setEditingDrawerId] = useState<string | null>(null);
  const [editingDrawerValue, setEditingDrawerValue] = useState("");
  /** Narrows the list to one drawer, for checking it against the shelf. */
  const [drawer, setDrawer] = useState("");

  const mrpMutation = useMutation({
    mutationFn: ({ id, priceMrp, isActive }: { id: string; priceMrp: string; isActive?: boolean }) =>
      apiClient.patch(`/inventory/medicines/${id}`, { priceMrp, ...(isActive !== undefined ? { isActive } : {}) }),
    onSuccess: () => {
      // Not just this list: setting an MRP can flip the medicine active, and
      // the counter and POS searches keep their own cache keys.
      void invalidateMedicineViews(queryClient);
      toastSuccess("MRP updated", "The price has been saved.");
      setEditingMrpId(null);
      setEditingMrpValue("");
    },
    onError: (err: any) => {
      toastError("Update failed", err?.response?.data?.message ?? "Could not update MRP.");
    },
  });

  const drawerMutation = useMutation({
    mutationFn: ({ id, drawerMapping }: { id: string; drawerMapping: string }) =>
      apiClient.patch(`/inventory/medicines/${id}`, { drawerMapping }),
    onSuccess: () => {
      void invalidateMedicineViews(queryClient);
      setEditingDrawerId(null);
      setEditingDrawerValue("");
    },
    onError: (err: any) => {
      toastError("Could not save the drawer", err?.response?.data?.message ?? "Try again.");
      setEditingDrawerId(null);
      setEditingDrawerValue("");
    },
  });

  /** Saves only a real change, so tabbing through the list writes nothing. */
  const commitDrawer = (m: Medicine) => {
    const next = editingDrawerValue.trim();
    if (next !== (m.drawerMapping ?? "").trim()) {
      drawerMutation.mutate({ id: m.id, drawerMapping: next });
    } else {
      setEditingDrawerId(null);
      setEditingDrawerValue("");
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/inventory/medicines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      toastSuccess("Medicine deleted", "The medicine has been removed from the formulary.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete this medicine.");
      setConfirmDeleteId(null);
    },
  });

  // The barcode.png endpoint is JWT-guarded, so a plain <a href> gets a 401 —
  // fetch it through apiClient (which attaches the Bearer token) instead.
  const downloadBarcode = async (m: Medicine) => {
    try {
      const blob = (await apiClient.get(`/inventory/medicines/${m.id}/barcode.png`, {
        responseType: "blob",
      })) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${m.sku}-barcode.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toastError("Download failed", "Could not generate the barcode image.");
    }
  };

  const params = {
    search,
    page,
    limit: 20,
    isActive: status,
    ...(drawer.trim() ? { drawer: drawer.trim() } : {}),
  };

  const { data, isLoading, isError } = useQuery<ApiListResponse>({
    queryKey: queryKeys.medicines.list(params),
    queryFn: () =>
      apiClient.get("/inventory/medicines", { params }) as Promise<ApiListResponse>,
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] sm:max-w-sm flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-in"
            />
            <input
              type="text"
              placeholder="Search medicines by name, barcode..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
          </div>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="p-2 border rounded-lg hover:bg-slate-50 transition text-slate-600 hover:text-slate-900 bg-white shadow-sm flex items-center justify-center"
            title="Scan Medicine Barcode"
          >
            <Camera size={16} />
          </button>
        </div>
        <input
          value={drawer}
          onChange={(e) => { setDrawer(e.target.value); setPage(1); }}
          placeholder="Drawer (e.g. A3)"
          aria-label="Filter by drawer"
          title="Show only the medicines mapped to one drawer"
          className="w-40 border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary text-slate-700"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary text-slate-700"
          title="Filter by status"
        >
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="all">All statuses</option>
        </select>
        {isAdmin && status === "false" && (
          <button
            onClick={() => setPurgeOpen(true)}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
            title="Permanently delete unpriced inactive medicines so a corrected CSV can be re-imported"
          >
            <ShieldAlert size={16} />
            Delete inactive
          </button>
        )}
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors text-slate-700"
        >
          <Upload size={16} />
          Import CSV
        </button>
        <button
          onClick={() => { setCreateInitial(null); setCreateOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          Add Medicine
        </button>
      </div>

      {/* States */}
      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      )}
      {isError && (
        <div className="text-center py-16 text-red-500">Failed to load medicines.</div>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">SKU</th>
                  <th className="text-left px-4 py-3 font-medium">Unit</th>
                  <th className="text-left px-4 py-3 font-medium">Drawer</th>
                  <th className="text-right px-4 py-3 font-medium">MRP</th>
                  <th className="text-right px-4 py-3 font-medium">Stock</th>
                  <th className="text-center px-4 py-3 font-medium">Class</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.data.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setViewStockTarget(m)}
                        className="text-left font-bold text-slate-900 group-hover:text-emerald-700 hover:underline transition-colors"
                      >
                        {m.name}
                      </button>
                      {m.genericName && (
                        <div className="text-xs text-slate-500 font-medium">{m.genericName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{m.sku}</td>
                    <td className="px-4 py-3 text-slate-700">{m.unit}</td>
                    {/* Click to type, Enter or blur to save, Escape to abandon
                        — the same inline pattern as MRP, because mapping a
                        shelf means editing many rows in a row. */}
                    <td className="px-4 py-3">
                      {editingDrawerId === m.id ? (
                        <input
                          value={editingDrawerValue}
                          onChange={(e) => setEditingDrawerValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitDrawer(m);
                            if (e.key === "Escape") {
                              setEditingDrawerId(null);
                              setEditingDrawerValue("");
                            }
                          }}
                          onBlur={() => commitDrawer(m)}
                          placeholder="e.g. A3"
                          aria-label={`Drawer for ${m.name}`}
                          maxLength={50}
                          autoFocus
                          className="w-24 border rounded px-2 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDrawerId(m.id);
                            setEditingDrawerValue(m.drawerMapping ?? "");
                          }}
                          aria-label={`Drawer for ${m.name}`}
                          title={
                            m.drawerMapping
                              ? `In drawer ${m.drawerMapping} — click to change`
                              : "Not mapped to a drawer yet — click to set one"
                          }
                          className={
                            m.drawerMapping
                              ? "px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                              : "text-xs text-slate-300 hover:text-emerald-600 transition-colors"
                          }
                        >
                          {m.drawerMapping || "Set"}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingMrpId === m.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-muted-foreground text-xs">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editingMrpValue}
                            onChange={(e) => setEditingMrpValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editingMrpValue) {
                                const mrp = parseFloat(editingMrpValue);
                                if (mrp > 0) {
                                  const updates: any = { id: m.id, priceMrp: mrp.toFixed(2) };
                                  // If the medicine is inactive and MRP > 0, also activate it
                                  if (!m.isActive && mrp > 0) updates.isActive = true;
                                  mrpMutation.mutate(updates);
                                }
                              }
                              if (e.key === "Escape") { setEditingMrpId(null); setEditingMrpValue(""); }
                            }}
                            onBlur={() => {
                              if (editingMrpValue) {
                                const mrp = parseFloat(editingMrpValue);
                                if (mrp > 0 && mrp !== parseFloat(m.priceMrp)) {
                                  const updates: any = { id: m.id, priceMrp: mrp.toFixed(2) };
                                  if (!m.isActive && mrp > 0) updates.isActive = true;
                                  mrpMutation.mutate(updates);
                                }
                              }
                              setEditingMrpId(null);
                              setEditingMrpValue("");
                            }}
                            autoFocus
                            className="w-24 border rounded px-2 py-1 text-right text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setEditingMrpId(m.id); setEditingMrpValue(parseFloat(m.priceMrp).toFixed(2)); }}
                          className={`font-bold hover:underline transition-colors ${
                            m.isActive
                              ? "text-emerald-700"
                              : "text-amber-600"
                          } ${parseFloat(m.priceMrp) === 0 ? "text-red-600" : ""}`}
                          title="Click to edit MRP"
                        >
                          ₹{parseFloat(m.priceMrp).toFixed(2)}
                          {!m.isActive && parseFloat(m.priceMrp) === 0 && (
                            <span className="ml-1 text-[9px] text-amber-600 font-normal">— set to activate</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setViewStockTarget(m)}
                        className={`font-extrabold text-xs px-2 py-0.5 rounded-md hover:scale-105 transition-transform ${
                          (m as any).totalStock > 0
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-amber-100 text-amber-800 border border-amber-200"
                        }`}
                        title="Click to view batches & receive stock"
                      >
                        {(m as any).totalStock ?? 0} units
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.scheduleClass ? (
                        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded">
                          {m.scheduleClass}
                        </span>
                      ) : m.requiresPrescription ? (
                        <span className="text-amber-600 text-xs font-bold">Rx</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">OTC</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          m.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setViewStockTarget(m)}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1"
                          title="View Batches & Receive Stock"
                        >
                          <Layers size={13} />
                          <span>Batches</span>
                        </button>
                        <button
                          onClick={() => setEditTarget(m)}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => downloadBarcode(m)}
                          title="Download barcode"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Barcode size={14} />
                        </button>
                        {isAdmin && (
                          confirmDeleteId === m.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => deleteMutation.mutate(m.id)}
                                disabled={deleteMutation.isPending}
                                className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                              >
                                {deleteMutation.isPending ? "..." : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-muted-foreground hover:underline"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(m.id)}
                              className="p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete medicine"
                            >
                              <Trash2 size={13} />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-muted-foreground">
                      No medicines found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>
              {data.meta.total} total &bull; page {data.meta.page} of {data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Prev
              </button>
              <button
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk import modal */}
      <BulkImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Purge inactive catalogue rows */}
      <PurgeInactiveModal open={purgeOpen} onClose={() => setPurgeOpen(false)} />

      {/* Create modal */}
      <Modal
        title={createInitial ? "Add Scanned Medicine" : "Add New Medicine"}
        subtitle={
          createInitial
            ? `Barcode ${createInitial.barcode} isn't in your catalog yet — enter name, price and GST to register it.`
            : "Fill in the details below to register a new medicine in the formulary"
        }
        icon={<Pill size={16} />}
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateInitial(null); }}
        size="xl"
      >
        {createInitial && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-bold shrink-0">Schedule check:</span>
            <span>
              This item defaults to <b>prescription required</b>. If it is a Schedule H / H1 / X drug,
              set the correct schedule class below. If it is genuinely OTC, untick &ldquo;Requires Prescription&rdquo;.
            </span>
          </div>
        )}
        <MedicineForm
          initial={createInitial ?? undefined}
          onSuccess={() => { setCreateOpen(false); setCreateInitial(null); }}
          onCancel={() => { setCreateOpen(false); setCreateInitial(null); }}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        title="Edit Medicine"
        subtitle={editTarget ? `Editing: ${editTarget.name}` : undefined}
        icon={<Pill size={16} />}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        size="xl"
      >
        {editTarget && (
          <MedicineForm
            initial={editTarget as any}
            onSuccess={() => setEditTarget(null)}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>

      <BarcodeScannerDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={async (code) => {
          setCameraOpen(false);
          setSearch(code);
          setPage(1);
          try {
            // Indexed exact-barcode lookup (uses medicines_barcode_idx).
            const res: any = await apiClient.get(`/inventory/medicines/barcode/${encodeURIComponent(code)}`);
            const found = res?.data?.data ?? res?.data ?? null;
            if (found) {
              toastSuccess("Already in catalog", `${found.name} is already registered.`);
            } else {
              // Not found — jump straight into a create form with the barcode
              // filled and defaults seeded, so only name + MRP remain to enter.
              // Compliance: default to prescription-required (fail-safe) so a
              // rushed add can't silently register a Schedule H drug as OTC and
              // bypass the POS Rx gate. The manager unticks it for genuine OTC.
              setCreateInitial({
                barcode: code,
                sku: code,
                unit: "strip",
                taxPercent: "12",
                stripSize: 1,
                reorderLevel: 10,
                reorderQty: 50,
                requiresPrescription: true,
                isControlled: false,
              });
              setCreateOpen(true);
            }
          } catch {
            toastError("Lookup failed", "Couldn't check the catalog for that barcode. Try again.");
          }
        }}
      />

      <MedicineStockModal
        open={!!viewStockTarget}
        onClose={() => setViewStockTarget(null)}
        medicineId={viewStockTarget?.id ?? null}
        medicineName={viewStockTarget?.name}
      />
    </div>
  );
}
