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
  Sparkles,
  Building2,
  GitCompare,
  ShieldCheck,
  Layers,
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
import { usePermissions } from "@/hooks/use-permissions";
import { useAuthStore } from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";
import { BranchSelect } from "@/components/shared/branch-select";
import { DoctorDashboard } from "@/components/modules/dashboard/doctor-dashboard";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  const { navigate } = useNavigation();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center justify-between w-full py-3 px-3 hover:bg-slate-50/80 rounded-xl transition-all border border-transparent hover:border-slate-200/60 group select-none"
    >
      <span className={`text-xs font-semibold ${urgent ? "text-rose-600" : "text-slate-700"}`}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Badge
          variant={urgent ? "error" : "emerald"}
          size="sm"
          dot={urgent}
          pulse={urgent}
        >
          {value}
        </Badge>
        <ArrowRight
          size={14}
          className="text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
        />
      </div>
    </button>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl px-4 py-3 text-xs">
      <p className="text-slate-400 font-semibold mb-1">
        {new Date(label).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
      <p className="font-extrabold text-emerald-700 text-sm">{fmt(payload[0].value)}</p>
    </div>
  );
};

export default function DashboardPage() {
  const { role } = usePermissions();

  if (!role) return <DashboardSkeleton />;
  if (role === "doctor") return <DoctorDashboard />;

  return <PharmacyDashboard />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-60 bg-slate-200/70 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-slate-200/70 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 h-80 bg-slate-200/70 rounded-2xl" />
        <div className="h-80 bg-slate-200/70 rounded-2xl" />
      </div>
    </div>
  );
}

function PharmacyDashboard() {
  const { navigate } = useNavigation();
  const { user } = useAuthStore();
  const { activeBranch, branches, setActiveBranch } = useBranchStore();
  const isSuperAdmin = user?.role === "super_admin";

  const today = new Date().toISOString().slice(0, 10);
  const branchParams = activeBranch?.id ? { branchId: activeBranch.id } : {};

  const { data: eodRaw } = useQuery<any>({
    queryKey: ["eod-summary", today, activeBranch?.id],
    queryFn: () =>
      apiClient.get("/billing/reports/end-of-day", { params: { date: today, ...branchParams } }),
    retry: 1,
  });

  const { data: salesTrendRaw } = useQuery<any>({
    queryKey: ["dashboard-sales-trend", activeBranch?.id],
    queryFn: () =>
      apiClient.get("/reports/sales", { params: { days: 14, groupBy: "day", ...branchParams } }),
    retry: 1,
  });

  const { data: lowStockRaw } = useQuery<any>({
    queryKey: ["low-stock", activeBranch?.id],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock", { params: branchParams }),
    retry: 1,
  });

  const { data: expiringRaw } = useQuery<any>({
    queryKey: ["expiring-batches", 30, activeBranch?.id],
    queryFn: () =>
      apiClient.get("/inventory/batches/expiring", { params: { days: 30, ...branchParams } }),
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Pharmacy Control Center
            </h1>
            <Badge variant="emerald" size="sm" dot pulse>
              Live Sync
            </Badge>
            {activeBranch && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                <Building2 size={13} className="text-emerald-600" />
                {activeBranch.name}
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-slate-500 mt-1">{dateLabel}</p>
        </div>
        <Button
          variant="primary"
          size="md"
          leftIcon={<Receipt size={16} />}
          onClick={() => navigate("/billing/pos")}
        >
          Open POS Terminal
        </Button>
      </div>

      {/* Super Admin Multi-Branch Control Banner */}
      {isSuperAdmin && (
        <div className="rounded-2xl border border-emerald-500/30 bg-slate-900 text-white p-4 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Super Admin Navigation Scope
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                  Full Multi-Branch Access
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Current Active Branch: <strong className="text-emerald-300">{activeBranch?.name ?? "All Branches"}</strong>
                {branches.length > 0 ? ` · ${branches.length} Branches Registered` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
            <div className="w-48 text-slate-900">
              <BranchSelect
                value={activeBranch?.id ?? ""}
                onChange={(id) => {
                  const found = branches.find((b) => b.id === id);
                  if (found) setActiveBranch(found);
                }}
                placeholder="Switch active branch..."
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white text-xs"
              leftIcon={<GitCompare size={14} />}
              onClick={() => navigate("/analytics?view=branches")}
            >
              Compare All Branches
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white text-xs"
              leftIcon={<Building2 size={14} />}
              onClick={() => navigate("/admin/branches")}
            >
              Manage Branches
            </Button>
          </div>
        </div>
      )}

      {/* Modern KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Today's Sales"
          value={todaySales > 0 ? fmt(todaySales) : "₹0"}
          description="Confirmed billing sales"
          icon={<IndianRupee size={22} />}
          color="emerald"
        />
        <StatCard
          title="Invoices Raised"
          value={todayInvoices > 0 ? todayInvoices : "0"}
          description="Bills generated today"
          icon={<Receipt size={22} />}
          color="teal"
        />
        <StatCard
          title="Low Stock Alert"
          value={lowStockItems.length > 0 ? lowStockItems.length : "0"}
          description="Items below reorder limit"
          icon={<AlertTriangle size={22} />}
          color="amber"
        />
        <StatCard
          title="Expiring Batches"
          value={expiringBatches.length > 0 ? expiringBatches.length : "0"}
          description="Batches expiring in 30d"
          icon={<Clock size={22} />}
          color="rose"
        />
      </div>

      {/* Chart + Action Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Revenue area chart */}
        <div className="xl:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Revenue Performance</h2>
              <p className="text-xs font-medium text-slate-500 mt-0.5">Daily sales trend (Last 14 days)</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              rightIcon={<ArrowRight size={14} />}
              onClick={() => navigate("/analytics")}
            >
              Full Analytics
            </Button>
          </div>

          {trendRows.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-slate-400 gap-2.5">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <TrendingUp size={24} />
              </div>
              <p className="text-sm font-semibold text-slate-700">No sales data recorded yet</p>
              <p className="text-xs text-slate-400">Complete a POS billing transaction to render trends.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={trendRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748b" }}
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
                  tick={{ fontSize: 11, fill: "#64748b" }}
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
                  strokeWidth={3}
                  fill="url(#revenueGrad)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#10b981", stroke: "#ffffff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Action Center */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Action Required</h2>
                <p className="text-xs font-medium text-slate-500 mt-0.5">Inventory & sales highlights</p>
              </div>
            </div>

            <div className="space-y-1">
              <AlertRow
                label="Low Stock Medicines"
                value={lowStockItems.length || "0"}
                href="/inventory"
                urgent={lowStockItems.length > 0}
              />
              <AlertRow
                label="Expiring Batches (30d)"
                value={expiringBatches.length || "0"}
                href="/inventory"
                urgent={expiringBatches.length > 5}
              />
              <AlertRow
                label="Today's Invoices"
                value={todayInvoices || "0"}
                href="/billing"
              />
              <AlertRow
                label="Pending Transfers"
                value="0"
                href="/distribution"
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6 pt-5 border-t border-slate-100 space-y-2.5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Quick Management Shortcuts
            </p>
            <Button
              variant="primary"
              size="md"
              className="w-full justify-center"
              leftIcon={<Receipt size={16} />}
              onClick={() => navigate("/billing/pos")}
            >
              Open POS Terminal
            </Button>
            <Button
              variant="outline"
              size="md"
              className="w-full justify-center"
              leftIcon={<Package size={16} />}
              onClick={() => navigate("/procurement")}
            >
              Create Purchase Order
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

