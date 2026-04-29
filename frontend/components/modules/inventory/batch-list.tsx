"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";

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

function expiryLabel(dateStr: string) {
  const expiry = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);

  if (diffDays < 0) return { text: "Expired", cls: "bg-red-100 text-red-700", icon: "red" };
  if (diffDays <= 30) return { text: `${diffDays}d left`, cls: "bg-red-50 text-red-600", icon: "critical" };
  if (diffDays <= 90) return { text: `${diffDays}d left`, cls: "bg-amber-50 text-amber-600", icon: "warn" };
  return { text: `${diffDays}d left`, cls: "bg-green-50 text-green-700", icon: "ok" };
}

interface Props {
  medicineId?: string;
}

export function BatchList({ medicineId }: Props) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const params: Record<string, any> = { page, limit: 20 };
  if (medicineId) params.medicineId = medicineId;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ["batches", params],
    queryFn: () => apiClient.get("/inventory/batches", { params }) as any,
  });

  return (
    <div>
      {/* Filters */}
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
                      No batches found.
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
    </div>
  );
}
