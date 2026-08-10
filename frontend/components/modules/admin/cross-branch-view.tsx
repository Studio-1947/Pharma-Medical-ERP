"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Info } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useBranches, rowsOf } from "@/queries/admin.queries";

const selectCls =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400";

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Loading() {
  return <div className="h-20 rounded-lg bg-slate-100 animate-pulse" />;
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-slate-400 py-4 text-center">{label}</p>;
}

/**
 * Read-only cross-branch inspection.
 *
 * Only endpoints that genuinely accept a branchId are wired here — verified
 * against the controllers. Rendering a branch picker over an endpoint that
 * ignores it would be a filter that silently lies.
 */
export function CrossBranchView() {
  const [branchId, setBranchId] = useState("");
  const [days, setDays] = useState(30);

  const { data: branchesRaw } = useBranches();
  const branches = rowsOf<any>(branchesRaw);

  const branchParam = branchId ? { branchId } : {};

  const summary = useQuery({
    queryKey: ["admin", "xbranch", "summary", branchId, days],
    queryFn: () =>
      apiClient.get("/reports/summary", {
        params: { days, ...branchParam },
      }) as Promise<any>,
  });

  const employees = useQuery({
    queryKey: ["admin", "xbranch", "employees", branchId],
    queryFn: () =>
      apiClient.get("/hr/employees", {
        params: { limit: 10, ...branchParam },
      }) as Promise<any>,
  });

  const expiring = useQuery({
    queryKey: ["admin", "xbranch", "expiring", branchId],
    queryFn: () =>
      apiClient.get("/inventory/batches/expiring", {
        params: { days: 30, ...branchParam },
      }) as Promise<any>,
  });

  const summaryData = ((summary.data as any)?.data ?? summary.data) as any;
  const employeeRows = rowsOf<any>(employees.data);
  const expiringRows = rowsOf<any>(expiring.data);

  const branchLabel =
    branches.find((b: any) => b.id === branchId)?.name ?? "All branches";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Branch
          </label>
          <select
            className={selectCls}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Period
          </label>
          <select
            className={selectCls}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto text-sm text-slate-500">
          <Building2 size={15} />
          {branchLabel}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
        <Info size={15} className="text-emerald-600 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-800">
          Showing branch-scoped data for <strong>{branchLabel}</strong>. Invoices, sales summary, employees, and inventory alerts are dynamically filtered to the selected branch.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sales summary" subtitle={`Last ${days} days`}>
          {summary.isLoading ? (
            <Loading />
          ) : summaryData ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500">Revenue</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">
                  ₹
                  {Number(
                    summaryData.totalRevenue ?? summaryData.revenue ?? 0,
                  ).toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Invoices</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums">
                  {Number(
                    summaryData.invoiceCount ?? summaryData.invoices ?? 0,
                  ).toLocaleString("en-IN")}
                </p>
              </div>
            </div>
          ) : (
            <Empty label="No sales data." />
          )}
        </Panel>

        {/* Warehouses panel removed with the warehouse layer. Side-by-side
            branch figures now live on the Branch Comparison report. */}

        <Panel title="Employees" subtitle="First 10">
          {employees.isLoading ? (
            <Loading />
          ) : employeeRows.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {employeeRows.map((e: any) => (
                <li key={e.id} className="py-2 flex justify-between gap-3">
                  <span className="text-slate-700 truncate">
                    {[e.firstName, e.lastName].filter(Boolean).join(" ") ||
                      e.name ||
                      e.email}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {e.designation ?? e.role ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty label="No employees." />
          )}
        </Panel>

        <Panel title="Batches expiring" subtitle="Within 30 days">
          {expiring.isLoading ? (
            <Loading />
          ) : expiringRows.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {expiringRows.slice(0, 10).map((b: any) => (
                <li key={b.id} className="py-2 flex justify-between gap-3">
                  <span className="text-slate-700 truncate">
                    {b.medicineName ?? b.medicine?.name ?? b.batchNo}
                  </span>
                  <span className="text-xs text-amber-600 shrink-0">
                    {b.expiryDate
                      ? new Date(b.expiryDate).toLocaleDateString("en-IN")
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty label="Nothing expiring in the next 30 days." />
          )}
        </Panel>
      </div>
    </div>
  );
}
