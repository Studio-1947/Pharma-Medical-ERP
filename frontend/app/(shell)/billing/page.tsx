"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { apiClient, queryKeys } from "@/lib/api-client";
import { ShoppingCart } from "lucide-react";

export default function BillingPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.invoices.list({ page }),
    queryFn: () => apiClient.get("/billing/invoices", { params: { page, limit: 20 } }) as any,
  });

  const invoices: any[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;

  const statusColor: Record<string, string> = {
    confirmed: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    partially_paid: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
    draft: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Billing</h2>
        <Link href="/billing/pos"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90">
          <ShoppingCart size={16} /> Open POS
        </Link>
      </div>

      {isLoading && <div className="text-center py-16 text-muted-foreground">Loading…</div>}

      {!isLoading && (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Invoice No</th>
                <th className="text-left px-4 py-3 font-medium">Patient</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">Paid</th>
                <th className="text-center px-4 py-3 font-medium">Mode</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoiceNo}</td>
                  <td className="px-4 py-3">{inv.patientId ? inv.patientId.slice(0, 8) + "…" : <span className="text-muted-foreground">Walk-in</span>}</td>
                  <td className="px-4 py-3 text-right font-medium">₹{parseFloat(inv.totalAmount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">₹{parseFloat(inv.amountPaid).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center capitalize text-xs">{inv.paymentMode}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColor[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {inv.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {meta && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>{meta.total} total</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted">Prev</button>
            <button disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
