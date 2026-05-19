"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Package,
  AlertTriangle,
  Clock,
  TrendingUp,
  Receipt,
  IndianRupee,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiClient } from "@/lib/api-client";

function KpiCard({
  label,
  value,
  sub,
  icon,
  colorClass,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <div className={`rounded-xl p-5 ${colorClass} flex items-start justify-between`}>
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

function AlertRow({
  label,
  value,
  href,
  urgent,
}: {
  label: string;
  value: number | string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href as any}
      className="flex items-center justify-between py-2.5 px-1 hover:bg-muted/50 rounded-lg transition-colors group"
    >
      <span className={`text-sm ${urgent ? "text-red-600 font-medium" : "text-slate-700"}`}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {value}
        </span>
        <ArrowRight size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const today = new Date().toISOString().split("T")[0];

  const { data: eodRaw } = useQuery<any>({
    queryKey: ["eod-summary", today],
    queryFn: () =>
      apiClient.get("/billing/reports/end-of-day", { params: { date: today } }),
    retry: 1,
  });

  const { data: salesTrendRaw } = useQuery<any>({
    queryKey: ["dashboard-sales-trend"],
    queryFn: () =>
      apiClient.get("/reports/sales", { params: { days: 14, groupBy: "day" } }),
    retry: 1,
  });

  const { data: lowStockRaw } = useQuery<any>({
    queryKey: ["low-stock"],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock"),
    retry: 1,
  });

  const { data: expiringRaw } = useQuery<any>({
    queryKey: ["expiring-batches", 30],
    queryFn: () =>
      apiClient.get("/inventory/batches/expiring", { params: { days: 30 } }),
    retry: 1,
  });

  const todaySales: number =
    eodRaw?.totalSales ?? eodRaw?.data?.totalSales ?? 0;
  const todayInvoices: number =
    eodRaw?.totalInvoices ?? eodRaw?.data?.totalInvoices ?? 0;

  const lowStockItems: any[] =
    lowStockRaw?.data ?? lowStockRaw?.rows ?? [];
  const expiringBatches: any[] =
    expiringRaw?.data ?? expiringRaw?.rows ?? [];

  const trendRows: Array<{ date: string; revenue: number }> =
    salesTrendRaw?.rows ?? salesTrendRaw?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Today's Sales"
          value={todaySales > 0 ? fmt(todaySales) : "--"}
          sub="Confirmed invoices"
          icon={<IndianRupee size={24} />}
          colorClass="bg-blue-50 text-blue-700"
        />
        <KpiCard
          label="Invoices Today"
          value={todayInvoices > 0 ? todayInvoices : "--"}
          sub="Bills raised today"
          icon={<Receipt size={24} />}
          colorClass="bg-green-50 text-green-700"
        />
        <KpiCard
          label="Low Stock Items"
          value={lowStockItems.length > 0 ? lowStockItems.length : "--"}
          sub="Below reorder level"
          icon={<AlertTriangle size={24} />}
          colorClass="bg-amber-50 text-amber-700"
        />
        <KpiCard
          label="Expiring in 30 Days"
          value={expiringBatches.length > 0 ? expiringBatches.length : "--"}
          sub="Batches near expiry"
          icon={<Clock size={24} />}
          colorClass="bg-red-50 text-red-700"
        />
      </div>

      {/* Charts + alerts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 14-day revenue trend */}
        <div className="xl:col-span-2 rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Revenue — Last 14 Days</h2>
            <Link
              href={"/analytics" as any}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              Full analytics <ArrowRight size={12} />
            </Link>
          </div>
          {trendRows.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No sales data yet. Complete a billing transaction to see the chart.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendRows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
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
                  width={56}
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
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Alerts panel */}
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Action Required</h2>
          <div className="divide-y divide-slate-50">
            <AlertRow
              label="Low stock products"
              value={lowStockItems.length || "None"}
              href="/inventory"
              urgent={lowStockItems.length > 0}
            />
            <AlertRow
              label="Batches expiring in 30d"
              value={expiringBatches.length || "None"}
              href="/inventory"
              urgent={expiringBatches.length > 5}
            />
            <AlertRow
              label="Today's invoices"
              value={todayInvoices || "--"}
              href="/billing"
            />
            <AlertRow
              label="Open transfers"
              value="--"
              href="/distribution"
            />
          </div>

          {/* Quick actions */}
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Quick Actions
            </p>
            <Link
              href={"/billing/pos" as any}
              className="flex items-center gap-2 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Receipt size={14} />
              Open POS Terminal
            </Link>
            <Link
              href={"/procurement" as any}
              className="flex items-center gap-2 w-full px-3 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Package size={14} />
              Create Purchase Order
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
