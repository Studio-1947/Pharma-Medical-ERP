"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { BranchSelect } from "@/components/shared/branch-select";
import { ExportButton } from "@/components/shared/export-button";
import {
  AgingBucketCards,
  AgingTable,
  inr,
  type AgingBucket,
  type AgingRow,
  type AgingTotals,
} from "@/components/shared/aging-report";
import { SupplierLedgerModal } from "@/components/modules/procurement/supplier-ledger-modal";
import { Wallet } from "lucide-react";

interface PayablesRow extends AgingRow {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  creditDays: number;
  openBillCount: number;
  overdueBillCount: number;
  oldestDueDate: string | null;
  consignmentPayable: string;
}

interface PayablesAging {
  asOf: string;
  branchId: string | null;
  buckets: AgingBucket[];
  totals: AgingTotals & { consignmentPayable: string; supplierCount: number; overdueBillCount: number };
  suppliers: PayablesRow[];
}

export function PayablesAgingView() {
  const { user } = useAuthStore();
  // Only super_admin may look across branches; every other role is pinned
  // server-side, so showing them a branch picker would only offer a choice the
  // API rejects.
  const canPickBranch = user?.role === "super_admin";
  const [branchId, setBranchId] = useState("");
  const [drilldown, setDrilldown] = useState<PayablesRow | null>(null);

  const params = branchId ? { branchId } : {};

  const { data, isLoading } = useQuery({
    queryKey: ["payables-aging", branchId],
    queryFn: () => apiClient.get("/procurement/payables/aging", { params }) as Promise<any>,
  });

  const aging = (data as any)?.data as PayablesAging | undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {canPickBranch && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Branch</label>
            <BranchSelect
              value={branchId}
              onChange={setBranchId}
              placeholder="All branches"
              className="border rounded-lg px-3 py-1.5 text-sm bg-background min-w-[200px]"
            />
          </div>
        )}
        {aging && (
          <p className="text-xs text-slate-400 self-end pb-1">
            As of {new Date(aging.asOf).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
        <ExportButton
          url="/procurement/payables/aging"
          params={params}
          filename="payables-aging.csv"
          className="ml-auto flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
        />
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      ) : !aging ? (
        <div className="text-center py-14 text-sm text-muted-foreground">Could not load payables.</div>
      ) : (
        <>
          <AgingBucketCards buckets={aging.buckets} totals={aging.totals} overdueLabel="Overdue" />

          {parseFloat(aging.totals.consignmentPayable) > 0 && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              Includes {inr(aging.totals.consignmentPayable)} of consignment stock, which falls due only as
              units sell.
            </p>
          )}

          <AgingTable
            rows={aging.suppliers}
            buckets={aging.buckets}
            totals={aging.totals}
            rowKey={(r) => r.supplierId}
            onRowClick={setDrilldown}
            actionLabel="Open ledger"
            emptyMessage="No supplier balances outstanding"
            columns={[
              {
                header: "Supplier",
                render: (r) => (
                  <div>
                    <p className="font-semibold text-slate-800">{r.supplierName}</p>
                    <p className="text-[11px] text-slate-400">
                      {r.supplierCode} · {r.creditDays} day terms
                    </p>
                  </div>
                ),
              },
              {
                header: "Bills",
                render: (r) => (
                  <div className="text-xs">
                    <p className="text-slate-600">
                      {r.openBillCount} open
                      {r.overdueBillCount > 0 && (
                        <span className="ml-1.5 font-bold text-red-600">{r.overdueBillCount} overdue</span>
                      )}
                    </p>
                    {r.oldestDueDate && (
                      <p className="text-[11px] text-slate-400">
                        oldest due {r.oldestDueDate.slice(0, 10)}
                      </p>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      {drilldown && (
        <SupplierLedgerModal
          open
          // The aging row is the balance summary; the bills tab is where it can
          // be acted on, so the drill-down lands there rather than on the
          // statement the user just summarised.
          initialTab="bills"
          supplier={{
            id: drilldown.supplierId,
            name: drilldown.supplierName,
            code: drilldown.supplierCode,
            creditDays: drilldown.creditDays,
            outstandingBalance: drilldown.total,
          }}
          onClose={() => setDrilldown(null)}
        />
      )}

      {!isLoading && aging && aging.suppliers.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Wallet className="w-3 h-3" />
          Click any supplier to open their bills and record a payment.
        </p>
      )}
    </div>
  );
}
