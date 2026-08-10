"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Truck, CheckCircle2, XCircle, Clock, PackageCheck, AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { TransferForm } from "./transfer-form";

interface TransferItem {
  id: string;
  medicineId: string;
  medicineName?: string;
  requestedQty: number;
  receivedQty?: number;
}

interface Transfer {
  id: string;
  transferNo: string;
  fromBranchId: string;
  fromBranchName?: string;
  toBranchId: string;
  toBranchName?: string;
  status: "draft" | "in_transit" | "delivered" | "rejected";
  notes?: string;
  createdAt: string;
  items: TransferItem[];
}

interface ApiListResponse {
  data: Transfer[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_CONFIG: Record<
  Transfer["status"],
  { label: string; className: string; icon: React.ReactNode }
> = {
  draft:      { label: "Draft",      className: "bg-slate-100 text-slate-600", icon: <Clock size={12} /> },
  in_transit: { label: "In Transit", className: "bg-amber-100 text-amber-700", icon: <Truck size={12} /> },
  delivered:  { label: "Delivered",  className: "bg-green-100 text-green-700", icon: <CheckCircle2 size={12} /> },
  rejected:   { label: "Rejected",   className: "bg-red-100 text-red-700",     icon: <XCircle size={12} /> },
};

// ─── Deliver modal ────────────────────────────────────────────────────────────

function DeliverModal({
  transfer,
  open,
  onClose,
}: {
  transfer: Transfer | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [receivedQtys, setReceivedQtys] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, items }: { id: string; items: { itemId: string; receivedQty: number }[] }) =>
      apiClient.patch(`/distribution/transfers/${id}/deliver`, { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      onClose();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to mark transfer as delivered."),
  });

  if (!transfer) return null;

  const handleQtyChange = (itemId: string, val: string) => {
    setReceivedQtys((prev) => ({ ...prev, [itemId]: Math.max(0, Number(val)) }));
  };

  const handleSubmit = () => {
    setError(null);
    const items = transfer.items.map((item) => ({
      itemId: item.id,
      receivedQty: receivedQtys[item.id] ?? item.requestedQty,
    }));
    mutation.mutate({ id: transfer.id, items });
  };

  return (
    <Modal
      title="Confirm Delivery"
      subtitle={`Transfer ${transfer.transferNo} — enter received quantities`}
      icon={<PackageCheck size={16} />}
      open={open}
      onClose={onClose}
      size="lg"
    >
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Enter the actual quantity received for each item. Leave as-is if all stock arrived.
        </p>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Medicine</th>
                <th className="text-right px-4 py-2 font-medium">Requested</th>
                <th className="text-right px-4 py-2 font-medium w-36">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transfer.items.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {item.medicineName ?? item.medicineId}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {item.requestedQty}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={item.requestedQty}
                      value={receivedQtys[item.id] ?? item.requestedQty}
                      onChange={(e) => handleQtyChange(item.id, e.target.value)}
                      className="w-24 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Confirm Delivery
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function TransfersView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<Transfer | null>(null);

  const params = { search, page, limit: 20, ...(statusFilter && { status: statusFilter }) };

  const { data, isLoading, isError } = useQuery<ApiListResponse>({
    queryKey: ["transfers", params],
    queryFn: () =>
      apiClient.get("/distribution/transfers", { params }) as Promise<ApiListResponse>,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/distribution/transfers/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/distribution/transfers/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

  const transfers: Transfer[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta ?? { page: 1, totalPages: 1, total: 0 };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search transfers..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="in_transit">In Transit</option>
          <option value="delivered">Delivered</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          New Transfer
        </button>
      </div>

      {isLoading && <div className="text-center py-16 text-muted-foreground">Loading...</div>}
      {isError && <div className="text-center py-16 text-red-500">Failed to load transfers.</div>}

      {!isLoading && !isError && (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Transfer #</th>
                  <th className="text-left px-4 py-3 font-medium">From</th>
                  <th className="text-left px-4 py-3 font-medium">To</th>
                  <th className="text-center px-4 py-3 font-medium">Items</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfers.map((t) => {
                  const cfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.draft;
                  const isExpanded = expanded === t.id;
                  return (
                    <>
                      <tr
                        key={t.id}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : t.id)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-emerald-600">
                          {t.transferNo}
                        </td>
                        <td className="px-4 py-3 text-sm">{t.fromBranchName ?? t.fromBranchId}</td>
                        <td className="px-4 py-3 text-sm">{t.toBranchName ?? t.toBranchId}</td>
                        <td className="px-4 py-3 text-center">{t.items?.length ?? 0}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString("en-IN")}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {t.status === "draft" && (
                              <>
                                <button
                                  onClick={() => approveMutation.mutate(t.id)}
                                  disabled={approveMutation.isPending}
                                  className="text-xs text-green-600 hover:underline disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => cancelMutation.mutate(t.id)}
                                  disabled={cancelMutation.isPending}
                                  className="text-xs text-red-500 hover:underline disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {t.status === "in_transit" && (
                              <button
                                onClick={() => setDeliverTarget(t)}
                                className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                              >
                                <PackageCheck size={12} />
                                Receive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (t.items?.length ?? 0) > 0 && (
                        <tr key={`${t.id}-exp`} className="bg-slate-50">
                          <td colSpan={7} className="px-8 py-3">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Items</p>
                            <div className="flex flex-wrap gap-2">
                              {t.items.map((item) => (
                                <span key={item.id} className="bg-white border rounded-lg px-3 py-1 text-xs">
                                  {item.medicineName ?? item.medicineId} &times; {item.requestedQty}
                                  {item.receivedQty !== undefined && (
                                    <span className="text-green-600 ml-1">(rcvd: {item.receivedQty})</span>
                                  )}
                                </span>
                              ))}
                            </div>
                            {t.notes && (
                              <p className="text-xs text-muted-foreground mt-2">Note: {t.notes}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {transfers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
                      No transfers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>
              {meta.total ?? 0} total &bull; page {meta.page || 1} of {Math.max(1, meta.totalPages || 1)}
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
                disabled={page >= (meta.totalPages || 1)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create modal */}
      <Modal
        title="New Stock Transfer"
        subtitle="Create an inter-branch stock transfer"
        icon={<Truck size={16} />}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="xl"
      >
        <TransferForm
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ["transfers"] });
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Deliver modal */}
      <DeliverModal
        transfer={deliverTarget}
        open={!!deliverTarget}
        onClose={() => setDeliverTarget(null)}
      />
    </div>
  );
}
