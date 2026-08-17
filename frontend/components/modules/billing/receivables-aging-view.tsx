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
  type AgingBucket,
  type AgingRow,
  type AgingTotals,
} from "@/components/shared/aging-report";
import { PatientLedgerModal } from "@/components/modules/patients/patient-ledger-modal";
import { BookOpen } from "lucide-react";

interface ReceivablesRow extends AgingRow {
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  invoiceCount: number;
  overdueInvoiceCount: number;
  oldestInvoiceDate: string | null;
}

interface ReceivablesAging {
  asOf: string;
  branchId: string | null;
  buckets: AgingBucket[];
  totals: AgingTotals & { patientCount: number; overdueInvoiceCount: number };
  patients: ReceivablesRow[];
}

export function ReceivablesAgingView() {
  const { user } = useAuthStore();
  const canPickBranch = user?.role === "super_admin";
  const [branchId, setBranchId] = useState("");
  const [drilldown, setDrilldown] = useState<ReceivablesRow | null>(null);

  const params = branchId ? { branchId } : {};

  const { data, isLoading } = useQuery({
    queryKey: ["receivables-aging", branchId],
    queryFn: () => apiClient.get("/billing/receivables/aging", { params }) as Promise<any>,
  });

  const aging = (data as any)?.data as ReceivablesAging | undefined;

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
          url="/billing/receivables/aging"
          params={params}
          filename="receivables-aging.csv"
          className="ml-auto flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
        />
      </div>

      {/* Patients carry no credit terms, so a due is payable on the day of sale
          and the ladder counts days since the invoice. Said plainly here so the
          columns are not misread as contractual terms. */}
      <p className="text-xs text-slate-500 bg-slate-50 border rounded-lg px-3 py-2">
        Customer dues are payable on the day of sale — these bands count days since the invoice was raised.
      </p>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      ) : !aging ? (
        <div className="text-center py-14 text-sm text-muted-foreground">Could not load receivables.</div>
      ) : (
        <>
          <AgingBucketCards buckets={aging.buckets} totals={aging.totals} overdueLabel="Past 30 days+" />

          <AgingTable
            rows={aging.patients}
            buckets={aging.buckets}
            totals={aging.totals}
            rowKey={(r) => r.patientId ?? "__unassigned__"}
            // An unassigned row has no patient to open a statement for; it is
            // shown so the total stays honest, not so it can be drilled into.
            onRowClick={(r) => {
              if (r.patientId) setDrilldown(r);
            }}
            actionLabel={(r) => (r.patientId ? "Open ledger" : null)}
            emptyMessage="No customer dues outstanding"
            columns={[
              {
                header: "Patient",
                render: (r) => (
                  <div>
                    <p className="font-semibold text-slate-800">{r.patientName}</p>
                    {r.patientPhone && <p className="text-[11px] text-slate-400">{r.patientPhone}</p>}
                  </div>
                ),
              },
              {
                header: "Invoices",
                render: (r) => (
                  <div className="text-xs">
                    <p className="text-slate-600">
                      {r.invoiceCount} open
                      {r.overdueInvoiceCount > 0 && (
                        <span className="ml-1.5 font-bold text-red-600">{r.overdueInvoiceCount} aged</span>
                      )}
                    </p>
                    {r.oldestInvoiceDate && (
                      <p className="text-[11px] text-slate-400">since {r.oldestInvoiceDate.slice(0, 10)}</p>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      {drilldown?.patientId && (
        <PatientLedgerModal
          open
          patientId={drilldown.patientId}
          patientName={drilldown.patientName}
          onClose={() => setDrilldown(null)}
        />
      )}

      {!isLoading && aging && aging.patients.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <BookOpen className="w-3 h-3" />
          Click any patient to open their account statement.
        </p>
      )}
    </div>
  );
}
