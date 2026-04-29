"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, AlertTriangle, Clock, TrendingUp } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  colorClass: string;
}

function KpiCard({ label, value, icon, colorClass }: KpiCardProps) {
  return (
    <div className={`rounded-xl p-5 ${colorClass} flex items-start justify-between`}>
      <div>
        <p className="text-sm font-medium opacity-75 mb-1">{label}</p>
        <p className="text-3xl font-bold">{value}</p>
      </div>
      <div className="opacity-60 mt-1">{icon}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: lowStockRaw } = useQuery({
    queryKey: ["low-stock"],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock") as any,
  });

  const { data: expiringRaw } = useQuery({
    queryKey: ["expiring-batches", 30],
    queryFn: () =>
      apiClient.get("/inventory/batches/expiring", { params: { days: 30 } }) as any,
  });

  const lowStockCount =
    lowStockRaw?.data?.rows?.length ?? lowStockRaw?.rows?.length ?? "--";
  const expiringCount = Array.isArray(expiringRaw?.data)
    ? expiringRaw.data.length
    : "--";

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Today's Sales"
          value="--"
          icon={<TrendingUp size={24} />}
          colorClass="bg-blue-50 text-blue-700"
        />
        <KpiCard
          label="Invoices Today"
          value="--"
          icon={<Package size={24} />}
          colorClass="bg-green-50 text-green-700"
        />
        <KpiCard
          label="Low Stock Items"
          value={lowStockCount}
          icon={<AlertTriangle size={24} />}
          colorClass="bg-amber-50 text-amber-700"
        />
        <KpiCard
          label="Expiring in 30 Days"
          value={expiringCount}
          icon={<Clock size={24} />}
          colorClass="bg-red-50 text-red-700"
        />
      </div>

      <div className="rounded-xl border bg-card p-6">
        <p className="text-muted-foreground text-sm">
          Sales charts and analytics will appear here in Phase 6 (ClickHouse
          integration). Use the sidebar to navigate to Inventory or Billing.
        </p>
      </div>
    </div>
  );
}
