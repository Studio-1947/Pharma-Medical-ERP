"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
  const [view, setView] = useState<"overview" | "branches">("overview");
  const { role } = usePermissions();
  const canCompareBranches = role === "super_admin" || role === "admin";

  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;

  const { data: salesData, isLoading: salesLoading, refetch } = useQuery<any>({
    queryKey: ["analytics-sales", period],
    queryFn: () =>
      apiClient.get("/reports/sales", { params: { days, groupBy: "day" } }),
    retry: 1,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["analytics-summary", period],
    queryFn: () =>
      apiClient.get("/reports/summary", { params: { days } }),
    retry: 1,
  });

  const { data: topProducts } = useQuery<any>({
    queryKey: ["analytics-top-products", period],
    queryFn: () =>
      apiClient.get("/reports/top-products", { params: { days, limit: 5 } }),
    retry: 1,
  });

  const { data: paymentBreakdown } = useQuery<any>({
    queryKey: ["analytics-payments", period],
    queryFn: () =>
      apiClient.get("/reports/payment-methods", { params: { days } }),
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
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="p-2 border rounded-lg hover:bg-muted transition-colors"
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
          color="bg-emerald-50 text-emerald-700"
        />
        <KpiCard
          label="Total Invoices"
          value={totalInvoices || "--"}
          sub={`Last ${days} days`}
          icon={<ShoppingBag size={24} />}
          color="bg-green-50 text-green-700"
        />
        <KpiCard
          label="Avg Invoice Value"
          value={avgInvoiceValue > 0 ? fmt(avgInvoiceValue) : "--"}
          icon={<TrendingUp size={24} />}
          color="bg-amber-50 text-amber-700"
        />
        <KpiCard
          label="Top Product"
          value={topRows[0]?.name ?? "--"}
          sub={topRows[0] ? fmt(topRows[0].revenue) + " revenue" : undefined}
          icon={<Package size={24} />}
          color="bg-teal-50 text-teal-700"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Sales trend — takes 2/3 width */}
        <div className="xl:col-span-2 rounded-xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Revenue Trend</h2>
          {salesLoading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
              Loading...
            </div>
          ) : salesRows.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
              No sales data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={salesRows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  }
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v) => fmt(v)}
                  width={60}
                />
                <Tooltip
                  formatter={(v: number) => [fmt(v), "Revenue"]}
                  labelFormatter={(l) =>
                    new Date(l).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  }
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment breakdown */}
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Payment Methods</h2>
          {paymentRows.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={paymentRows}
                  dataKey="amount"
                  nameKey="method"
                  cx="50%"
                  cy="45%"
                  outerRadius={75}
                  label={({ method, percent }) => {
                    const labelStr =
                      typeof method === "string"
                        ? method === "upi"
                          ? "UPI"
                          : method.charAt(0).toUpperCase() + method.slice(1).toLowerCase().replace(/_/g, " ")
                        : String(method ?? "");
                    return `${labelStr} ${(percent * 100).toFixed(0)}%`;
                  }}
                  labelLine={false}
                >
                  {paymentRows.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top products bar */}
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Top 5 Products by Revenue</h2>
          {topRows.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={topRows}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v) => fmt(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  width={110}
                />
                <Tooltip formatter={(v: number) => [fmt(v), "Revenue"]} />
                <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Invoice count trend */}
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Invoice Volume</h2>
          {salesRows.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesRows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  }
                />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                <Tooltip
                  formatter={(v: number) => [v, "Invoices"]}
                  labelFormatter={(l) =>
                    new Date(l).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })
                  }
                />
                <Bar dataKey="invoices" fill="#10b981" radius={[4, 4, 0, 0]} />
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
