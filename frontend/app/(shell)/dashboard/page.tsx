"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Package,
  AlertTriangle,
  Clock,
  Receipt,
  IndianRupee,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { useNavigation } from "@/lib/navigation-context";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiClient } from "@/lib/api-client";

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: "emerald" | "teal" | "amber" | "red";
}) {
  const styles = {
    emerald: {
      card: "bg-gradient-to-br from-emerald-500 to-emerald-600",
      icon: "bg-white/20",
      sub: "text-emerald-100",
    },
    teal: {
      card: "bg-gradient-to-br from-teal-500 to-teal-600",
      icon: "bg-white/20",
      sub: "text-teal-100",
    },
    amber: {
      card: "bg-gradient-to-br from-amber-400 to-orange-500",
      icon: "bg-white/20",
      sub: "text-amber-100",
    },
    red: {
      card: "bg-gradient-to-br from-rose-500 to-red-600",
      icon: "bg-white/20",
      sub: "text-rose-100",
    },
  }[accent];

  return (
    <div className={`${styles.card} rounded-2xl p-5 text-white relative overflow-hidden`}>
      <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/5" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/75 mb-1">{label}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          {sub && <p className={`text-xs mt-1 ${styles.sub}`}>{sub}</p>}
        </div>
        <div className={`${styles.icon} p-2.5 rounded-xl`}>{icon}</div>
      </div>
    </div>
  );
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
  const { navigate } = useNavigation();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center justify-between w-full py-2.5 px-2 hover:bg-emerald-50 rounded-lg transition-colors group"
    >
      <span className={`text-sm ${urgent ? "text-red-600 font-medium" : "text-slate-600"}`}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
            urgent
              ? "bg-red-100 text-red-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {value}
        </span>
        <ArrowRight
          size={12}
          className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>
    </button>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-100 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="text-slate-400 text-xs mb-1">
        {new Date(label).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
      <p className="font-semibold text-emerald-700">{fmt(payload[0].value)}</p>
    </div>
  );
};

export default function DashboardPage() {
  const { navigate } = useNavigation();
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

  const todaySales: number = eodRaw?.totalSales ?? eodRaw?.data?.totalSales ?? 0;
  const todayInvoices: number = eodRaw?.totalInvoices ?? eodRaw?.data?.totalInvoices ?? 0;
  const lowStockItems: any[] = lowStockRaw?.data ?? lowStockRaw?.rows ?? [];
  const expiringBatches: any[] = expiringRaw?.data ?? expiringRaw?.rows ?? [];
  const trendRows: Array<{ date: string; revenue: number }> =
    salesTrendRaw?.rows ?? salesTrendRaw?.data ?? [];

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Good morning
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{dateLabel}</p>
        </div>
        <button
          onClick={() => navigate("/billing/pos")}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold rounded-xl shadow-sm hover:from-emerald-700 hover:to-teal-700 transition-all"
        >
          <Receipt size={14} />
          Open POS
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Today's Sales"
          value={todaySales > 0 ? fmt(todaySales) : "--"}
          sub="Confirmed invoices"
          icon={<IndianRupee size={20} />}
          accent="emerald"
        />
        <KpiCard
          label="Invoices Today"
          value={todayInvoices > 0 ? todayInvoices : "--"}
          sub="Bills raised today"
          icon={<Receipt size={20} />}
          accent="teal"
        />
        <KpiCard
          label="Low Stock Items"
          value={lowStockItems.length > 0 ? lowStockItems.length : "--"}
          sub="Below reorder level"
          icon={<AlertTriangle size={20} />}
          accent="amber"
        />
        <KpiCard
          label="Expiring in 30 Days"
          value={expiringBatches.length > 0 ? expiringBatches.length : "--"}
          sub="Batches near expiry"
          icon={<Clock size={20} />}
          accent="red"
        />
      </div>

      {/* Chart + alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Revenue area chart */}
        <div className="xl:col-span-2 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Revenue Trend</h2>
              <p className="text-xs text-slate-400 mt-0.5">Last 14 days</p>
            </div>
            <button
              onClick={() => navigate("/analytics")}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              Full analytics <ArrowRight size={12} />
            </button>
          </div>

          {trendRows.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-slate-300 gap-2">
              <TrendingUp size={32} strokeWidth={1.5} />
              <p className="text-sm">No sales data yet.</p>
              <p className="text-xs">Complete a billing transaction to see the chart.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={trendRows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })
                  }
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmt}
                  width={52}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#revenueGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Alerts + quick actions */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-slate-800 mb-1">Action Required</h2>
          <p className="text-xs text-slate-400 mb-4">Items that need your attention</p>

          <div className="flex-1 space-y-0.5">
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
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Quick Actions
            </p>
            <button
              onClick={() => navigate("/billing/pos")}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-all shadow-sm"
            >
              <Receipt size={14} />
              Open POS Terminal
            </button>
            <button
              onClick={() => navigate("/procurement")}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 hover:border-emerald-200 hover:text-emerald-700 transition-all"
            >
              <Package size={14} />
              Create Purchase Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
