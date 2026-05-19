"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Truck, CheckCircle2, XCircle, Clock, PackageCheck } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { TransferForm } from "./transfer-form";

interface TransferItem {
  id: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  receivedQty?: number;
}

interface Transfer {
  id: string;
  transferNo: string;
  fromWarehouseId: string;
  fromWarehouseName?: string;
  toWarehouseId: string;
  toWarehouseName?: string;
  status: "draft" | "in_transit" | "delivered" | "rejected";
  notes?: string;
  createdAt: string;
  dispatchedAt?: string;
  deliveredAt?: string;
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
  draft: {
    label: "Draft",
    className: "bg-slate-100 text-slate-600",
    icon: <Clock size={12} />,
  },
  in_transit: {
    label: "In Transit",
    className: "bg-amber-100 text-amber-700",
    icon: <Truck size={12} />,
  },
  delivered: {
    label: "Delivered",
    className: "bg-green-100 text-green-700",
    icon: <CheckCircle2 size={12} />,
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-100 text-red-700",
    icon: <XCircle size={12} />,
  },
};

export function TransfersView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const deliverMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/distribution/transfers/${id}/deliver`, { items: [] as { itemId: string; receivedQty: number }[] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/distribution/transfers/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

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
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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

      {data && (
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
                {data.data.map((t) => {
                  const cfg = STATUS_CONFIG[t.status];
                  const isExpanded = expanded === t.id;
                  return (
                    <>
                      <tr
                        key={t.id}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : t.id)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-600">
                          {t.transferNo}
                        </td>
                        <td className="px-4 py-3">{t.fromWarehouseName ?? t.fromWarehouseId}</td>
                        <td className="px-4 py-3">{t.toWarehouseName ?? t.toWarehouseId}</td>
                        <td className="px-4 py-3 text-center">{t.items?.length ?? 0}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
                          >
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString("en-IN")}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div
                            className="flex items-center justify-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                                onClick={() => deliverMutation.mutate(t.id)}
                                disabled={deliverMutation.isPending}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
                              >
                                <PackageCheck size={12} />
                                Mark Delivered
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && t.items?.length > 0 && (
                        <tr key={`${t.id}-expanded`} className="bg-slate-50">
                          <td colSpan={7} className="px-8 py-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Items
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {t.items.map((item) => (
                                <span
                                  key={item.id}
                                  className="bg-white border rounded-lg px-3 py-1 text-xs"
                                >
                                  {item.medicineName ?? item.medicineId} &times; {item.quantity}
                                  {item.receivedQty !== undefined && (
                                    <span className="text-green-600 ml-1">
                                      (rcvd: {item.receivedQty})
                                    </span>
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
                {data.data.length === 0 && (
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

      <Modal
        title="New Stock Transfer"
        subtitle="Create an inter-branch or inter-warehouse stock transfer"
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
    </div>
  );
}
