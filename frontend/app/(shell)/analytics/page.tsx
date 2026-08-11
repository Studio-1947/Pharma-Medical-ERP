"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  BarChart2,
  TrendingUp,
  ShoppingBag,
  IndianRupee,
  Package,
  RefreshCw,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { usePermissions } from "@/hooks/use-permissions";
import { BranchComparison } from "@/components/modules/analytics/branch-comparison";

import { BranchSelect } from "@/components/shared/branch-select";

const PERIOD_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const PIE_COLORS = ["#10b981", "#14b8a6", "#f59e0b", "#ef4444", "#6366f1"];

function KpiCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-5 ${color} flex items-start justify-between`}>
      <div>
        <p className="text-sm font-medium opacity-75 mb-1">{label}</p>
        <p className="text-3xl font-bold">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
      </div>
      <div className="opacity-50 mt-1">{icon}</div>
    </div>
  );
}

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [view, setView] = useState<"overview" | "branches">("overview");
  const { role } = usePermissions();
  const canCompareBranches = role === "super_admin" || role === "admin";

  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const branchParams = selectedBranchId ? { branchId: selectedBranchId } : {};

  const { data: salesData, isLoading: salesLoading, refetch } = useQuery<any>({
    queryKey: ["analytics-sales", period, selectedBranchId],
    queryFn: () =>
      apiClient.get("/reports/sales", { params: { days, groupBy: "day", ...branchParams } }),
    retry: 1,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["analytics-summary", period, selectedBranchId],
    queryFn: () =>
      apiClient.get("/reports/summary", { params: { days, ...branchParams } }),
    retry: 1,
  });

  const { data: topProducts } = useQuery<any>({
    queryKey: ["analytics-top-products", period, selectedBranchId],
    queryFn: () =>
      apiClient.get("/reports/top-products", { params: { days, limit: 5, ...branchParams } }),
    retry: 1,
  });

  const { data: paymentBreakdown } = useQuery<any>({
    queryKey: ["analytics-payments", period, selectedBranchId],
    queryFn: () =>
      apiClient.get("/reports/payment-methods", { params: { days, ...branchParams } }),
    retry: 1,
  });

  const salesRows: Array<{ date: string; revenue: number; invoices: number }> =
    salesData?.rows ?? salesData?.data ?? [];

  const topRows: Array<{ name: string; revenue: number; qty: number }> =
    topProducts?.rows ?? topProducts?.data ?? [];

  const paymentRows: Array<{ method: string; amount: number }> =
    paymentBreakdown?.rows ?? paymentBreakdown?.data ?? [];

  const totalRevenue: number = summaryData?.totalRevenue ?? salesRows.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totalInvoices: number = summaryData?.totalInvoices ?? salesRows.reduce((s, r) => s + (r.invoices ?? 0), 0);
  const avgInvoiceValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-emerald-600" />
            Analytics & Reports
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Sales performance, revenue trends, and business insights.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCompareBranches && (
            <div className="w-48">
              <BranchSelect
                value={selectedBranchId}
                onChange={setSelectedBranchId}
                placeholder="All branches"
              />
            </div>
          )}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 bg-white"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="p-2 border rounded-lg bg-white hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Overview is scoped to the viewer's own branch; comparison is the
          org-wide view and is limited to super_admin and admin server-side. */}
      {canCompareBranches && (
        <div className="flex gap-1 border-b border-slate-200">
          {[
            { key: "overview" as const, label: "Overview" },
            { key: "branches" as const, label: "Branch Comparison" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                view === t.key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {view === "branches" && canCompareBranches && <BranchComparison />}

      {view === "overview" && (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Total Revenue"
          value={fmt(totalRevenue)}
          sub={`Last ${days} days`}
          icon={<IndianRupee size={24} />}
          color="bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-700 border border-emerald-100/80 shadow-sm"
        />
        <KpiCard
          label="Total Invoices"
          value={totalInvoices ? totalInvoices.toLocaleString("en-IN") : "0"}
          sub={`Last ${days} days`}
          icon={<ShoppingBag size={24} />}
          color="bg-gradient-to-br from-green-50 to-emerald-50 text-green-700 border border-green-100/80 shadow-sm"
        />
        <KpiCard
          label="Avg Invoice Value"
          value={avgInvoiceValue > 0 ? fmt(avgInvoiceValue) : "₹0"}
          sub="Per customer bill"
          icon={<TrendingUp size={24} />}
          color="bg-gradient-to-br from-amber-50 to-orange-50 text-amber-700 border border-amber-100/80 shadow-sm"
        />
        <KpiCard
          label="Top Selling Drug"
          value={topRows[0]?.name ?? "—"}
          sub={topRows[0] ? fmt(topRows[0].revenue) + " revenue" : "No sales yet"}
          icon={<Package size={24} />}
          color="bg-gradient-to-br from-teal-50 to-cyan-50 text-teal-700 border border-teal-100/80 shadow-sm"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Sales trend — takes 2/3 width */}
        <div className="xl:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-800">Revenue Performance Trend</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily sales and billing pattern over the last {days} days</p>
            </div>
            {salesRows.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700">
                <TrendingUp size={13} />
                Avg: {fmt(totalRevenue / Math.max(1, salesRows.length))}/day
              </span>
            )}
          </div>
          {salesLoading ? (
            <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
              Loading chart data…
            </div>
          ) : salesRows.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-slate-400 gap-2">
              <TrendingUp size={28} className="opacity-30" />
              <p className="text-sm font-medium">No sales data for this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={salesRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="analyticsRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  }
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmt(v)}
                  width={56}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length || !payload[0]) return null;
                    const r = (payload[0].value as number) ?? 0;
                    const inv = (payload[0].payload as any)?.invoices ?? 0;
                    return (
                      <div className="bg-slate-900 text-white rounded-xl shadow-xl px-4 py-3 text-xs space-y-1">
                        <p className="text-slate-400 font-semibold">
                          {new Date(label).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                        <p className="text-sm font-extrabold text-emerald-400">{fmt(r)}</p>
                        <p className="text-[11px] text-slate-300">{inv} invoice{inv !== 1 ? "s" : ""} raised</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#analyticsRevGrad)"
                  activeDot={{ r: 5, fill: "#10b981", stroke: "#ffffff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment breakdown */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">Payment Breakdown</h2>
            <p className="text-xs text-slate-500 mt-0.5">Distribution across Cash, UPI, and Cards</p>
          </div>

          {paymentRows.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-slate-400 gap-2">
              <p className="text-sm font-medium">No payment data</p>
            </div>
          ) : (
            <div className="space-y-4 my-2">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={paymentRows}
                    dataKey="amount"
                    nameKey="method"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                  >
                    {paymentRows.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [fmt(v), "Total"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {paymentRows.map((r, i) => {
                  const labelStr =
                    typeof r.method === "string"
                      ? r.method === "upi"
                        ? "UPI / Digital"
                        : r.method.charAt(0).toUpperCase() + r.method.slice(1).toLowerCase().replace(/_/g, " ")
                      : String(r.method ?? "");
                  const pct = totalRevenue > 0 ? ((r.amount / totalRevenue) * 100).toFixed(1) : "0";
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="font-medium text-slate-700">{labelStr}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{fmt(r.amount)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-500">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top products bar */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-800">Top 5 Products by Revenue</h2>
              <p className="text-xs text-slate-500 mt-0.5">Highest grossing medicines in selected period</p>
            </div>
          </div>
          {topRows.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
              No product sales recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart
                data={topRows}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmt(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#475569", fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length || !payload[0]) return null;
                    const item = payload[0].payload;
                    if (!item) return null;
                    return (
                      <div className="bg-slate-900 text-white rounded-xl shadow-xl px-3 py-2 text-xs">
                        <p className="font-bold text-slate-200">{item.name}</p>
                        <p className="text-emerald-400 font-extrabold">{fmt(item.revenue)}</p>
                        <p className="text-[11px] text-slate-400">{item.qty?.toLocaleString("en-IN") ?? 0} units sold</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Invoice count trend */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-800">Invoice Volume</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily bill count generated at counter</p>
            </div>
          </div>
          {salesRows.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
              No invoice volume data.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={salesRows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  }
                />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length || !payload[0]) return null;
                    const count = (payload[0].value as number) ?? 0;
                    return (
                      <div className="bg-slate-900 text-white rounded-xl shadow-xl px-3 py-2 text-xs">
                        <p className="text-slate-400 font-semibold">
                          {new Date(label).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </p>
                        <p className="text-emerald-400 font-bold">{count} invoice{count !== 1 ? "s" : ""}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="invoices" fill="#06b6d4" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
