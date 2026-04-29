"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, Barcode } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { MedicineForm } from "./medicine-form";

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
}

interface ApiListResponse {
  data: Medicine[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function MedicineList() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Medicine | null>(null);

  const params = { search, page, limit: 20 };

  const { data, isLoading, isError } = useQuery<ApiListResponse>({
    queryKey: queryKeys.medicines.list(params),
    queryFn: () =>
      apiClient.get("/inventory/medicines", { params }) as Promise<ApiListResponse>,
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search medicines..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
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
                  <th className="text-right px-4 py-3 font-medium">MRP</th>
                  <th className="text-center px-4 py-3 font-medium">Class</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.data.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.name}</div>
                      {m.genericName && (
                        <div className="text-xs text-muted-foreground">{m.genericName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{m.sku}</td>
                    <td className="px-4 py-3">{m.unit}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ₹{parseFloat(m.priceMrp).toFixed(2)}
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
                          onClick={() => setEditTarget(m)}
                          className="text-xs text-primary hover:underline"
                        >
                          Edit
                        </button>
                        <a
                          href={`${process.env.NEXT_PUBLIC_API_URL}/inventory/medicines/${m.id}/barcode.png`}
                          target="_blank"
                          rel="noreferrer"
                          title="Download barcode"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Barcode size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
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

      {/* Create modal */}
      <Modal
        title="Add Medicine"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="xl"
      >
        <MedicineForm onSuccess={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} />
      </Modal>

      {/* Edit modal */}
      <Modal
        title="Edit Medicine"
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
    </div>
  );
}
