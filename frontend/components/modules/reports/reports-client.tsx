"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, ShoppingCart, FileText, Calendar, Download,
  IndianRupee, Package, CheckCircle, Clock,
} from "lucide-react";
import axios from "axios";
import { apiClient } from "@/lib/api-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

const PO_STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  sent: "bg-purple-100 text-purple-700",
  received: "bg-green-100 text-green-700",
  partial: "bg-orange-100 text-orange-700",
  cancelled: "bg-red-100 text-red-700",
};

type Tab = "sales" | "purchase" | "compliance";

// ─── Sales Tab ────────────────────────────────────────────────────────────────

function SalesTab() {
  const [days, setDays] = useState(30);

  const { data: summary } = useQuery({
    queryKey: ["reports-summary", days],
    queryFn: () =>
      apiClient.get("/reports/summary", { params: { days } }) as Promise<{
        totalRevenue: number;
        totalInvoices: number;
      }>,
  });

  const { data: trend } = useQuery({
    queryKey: ["reports-sales", days],
    queryFn: () =>
      apiClient.get("/reports/sales", { params: { days } }) as Promise<{
        rows: { date: string; revenue: number; invoices: number }[];
      }>,
  });

  const { data: topProducts } = useQuery({
    queryKey: ["reports-top-products", days],
    queryFn: () =>
      apiClient.get("/reports/top-products", { params: { days, limit: 10 } }) as Promise<{
        rows: { name: string; revenue: number; qty: number }[];
      }>,
  });

  const { data: paymentMethods } = useQuery({
    queryKey: ["reports-payment-methods", days],
    queryFn: () =>
      apiClient.get("/reports/payment-methods", { params: { days } }) as Promise<{
        rows: { method: string; amount: number }[];
      }>,
  });

  const trendRows = trend?.rows ?? [];
  const topRows = (topProducts?.rows ?? []).map((r) => ({
    ...r,
    revenue: Number(r.revenue),
    qty: Number(r.qty),
  }));
  const pieRows = (paymentMethods?.rows ?? []).map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));
  const totalRevenue = Number(summary?.totalRevenue ?? 0);
  const totalInvoices = Number(summary?.totalInvoices ?? 0);
  const avgInvoice = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Period:</span>
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              days === d
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
            <IndianRupee size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-bold text-slate-800">{fmt(totalRevenue)}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 shrink-0">
            <FileText size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Invoices</p>
            <p className="text-lg font-bold text-slate-800">{totalInvoices.toLocaleString("en-IN")}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <TrendingUp size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Invoice Value</p>
            <p className="text-lg font-bold text-slate-800">{fmt(avgInvoice)}</p>
          </div>
        </div>
      </div>

      {/* Revenue trend chart */}
      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue Trend</h3>
        {trendRows.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No sales data for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(l) => `Date: ${l}`} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Revenue"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Bottom row: top products + payment methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top products table */}
        <div className="rounded-xl border bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Products by Revenue</h3>
          {topRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b">
                    <th className="text-left pb-2 font-medium">#</th>
                    <th className="text-left pb-2 font-medium">Medicine</th>
                    <th className="text-right pb-2 font-medium">Qty</th>
                    <th className="text-right pb-2 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {topRows.map((r, i) => (
                    <tr key={r.name} className="hover:bg-muted/30">
                      <td className="py-2 pr-2 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="py-2 font-medium text-slate-800 truncate max-w-[160px]">
                        {r.name}
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        {r.qty.toLocaleString("en-IN")}
                      </td>
                      <td className="py-2 text-right font-medium text-blue-600">{fmt(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment methods pie */}
        <div className="rounded-xl border bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Payment Methods</h3>
          {pieRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieRows}
                  dataKey="amount"
                  nameKey="method"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ method, percent }) =>
                    `${method} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {pieRows.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Purchase Tab ─────────────────────────────────────────────────────────────

function PurchaseTab() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().split("T")[0]);
  const [to, setTo] = useState(new Date().toISOString().split("T")[0]);

  const { data, isLoading } = useQuery({
    queryKey: ["reports-purchase", from, to],
    queryFn: () =>
      apiClient.get("/reports/purchase", { params: { from, to } }) as Promise<{
        summary: {
          totalOrders: number;
          totalValue: number;
          receivedOrders: number;
          pendingOrders: number;
        };
        rows: {
          id: string;
          poNumber: string;
          status: string;
          supplierName: string;
          totalValue: number;
          createdAt: string;
          expectedDelivery: string | null;
        }[];
      }>,
  });

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      {/* Date range */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
            <ShoppingCart size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total POs</p>
            <p className="text-lg font-bold text-slate-800">
              {summary?.totalOrders ?? 0}
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 shrink-0">
            <IndianRupee size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Value</p>
            <p className="text-lg font-bold text-slate-800">
              {fmt(summary?.totalValue ?? 0)}
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="text-lg font-bold text-slate-800">
              {summary?.receivedOrders ?? 0}
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <Clock size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg font-bold text-slate-800">
              {summary?.pendingOrders ?? 0}
            </p>
          </div>
        </div>
      </div>

      {/* PO table */}
      <div className="rounded-xl border overflow-x-auto">
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">PO Number</th>
                <th className="text-left px-4 py-3 font-medium">Supplier</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Value</th>
                <th className="text-right px-4 py-3 font-medium">Created</th>
                <th className="text-right px-4 py-3 font-medium">Expected Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{r.poNumber}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.supplierName}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        PO_STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(r.totalValue)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                    {r.createdAt}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                    {r.expectedDelivery ?? "--"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-muted-foreground">
                    No purchase orders in this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Compliance Tab ───────────────────────────────────────────────────────────

function ComplianceTab() {
  const [gstBranchId, setGstBranchId] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const [schBranchId, setSchBranchId] = useState("");
  const [fromDate, setFromDate] = useState(new Date().toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);

  const downloadCsv = async (url: string, params: object, filename: string) => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
      const token = typeof window !== "undefined" ? localStorage.getItem("pharmerp_access_token") : null;
      const response = await axios.get(`${base}${url}`, {
        params: { ...params, format: "csv" },
        responseType: "blob",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      alert("Download failed. Check console for details.");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* GSTR-1 */}
      <div className="rounded-xl border bg-white p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">GSTR-1 Report</h2>
            <p className="text-xs text-muted-foreground">Detailed sales tax breakdowns for GST filing.</p>
          </div>
        </div>
        <hr />
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Branch ID (optional)</label>
            <input
              type="text"
              placeholder="All branches if empty"
              value={gstBranchId}
              onChange={(e) => setGstBranchId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(0, i).toLocaleString("en", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <option key={i} value={new Date().getFullYear() - 2 + i}>
                    {new Date().getFullYear() - 2 + i}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            downloadCsv(
              "/reports/gst",
              { branchId: gstBranchId || undefined, month, year },
              `gstr1-${year}-${String(month).padStart(2, "0")}.csv`,
            )
          }
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition"
        >
          <Download className="w-4 h-4" /> Download GSTR-1 CSV
        </button>
      </div>

      {/* Schedule H Register */}
      <div className="rounded-xl border bg-white p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Schedule H Register</h2>
            <p className="text-xs text-muted-foreground">Controlled drugs dispensing log for D&C Act compliance.</p>
          </div>
        </div>
        <hr />
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Branch ID (optional)</label>
            <input
              type="text"
              placeholder="All branches if empty"
              value={schBranchId}
              onChange={(e) => setSchBranchId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            downloadCsv(
              "/reports/schedule-h-register",
              { branchId: schBranchId || undefined, from: fromDate, to: toDate },
              `schedule-h-${fromDate}-to-${toDate}.csv`,
            )
          }
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition"
        >
          <Download className="w-4 h-4" /> Download Register CSV
        </button>
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "purchase", label: "Purchase", icon: Package },
  { id: "compliance", label: "Compliance", icon: FileText },
];

export function ReportsClient() {
  const [active, setActive] = useState<Tab>("sales");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reports</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sales analytics, purchase summaries, and compliance exports.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {active === "sales" && <SalesTab />}
      {active === "purchase" && <PurchaseTab />}
      {active === "compliance" && <ComplianceTab />}
    </div>
  );
}
