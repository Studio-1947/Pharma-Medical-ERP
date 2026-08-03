"use client";

import {
  Users,
  Building2,
  KeyRound,
  ScrollText,
  Pill,
  PackageX,
  Receipt,
  HeartPulse,
  Truck,
  ShieldCheck,
} from "lucide-react";
import { useAdminOverview } from "@/queries/admin.queries";

interface StatProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ElementType;
  tone?: "default" | "warn" | "danger";
}

function Stat({ label, value, hint, icon: Icon, tone = "default" }: StatProps) {
  const toneCls =
    tone === "danger"
      ? "text-red-600 bg-red-50"
      : tone === "warn"
        ? "text-amber-600 bg-amber-50"
        : "text-emerald-600 bg-emerald-50";

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">
            {typeof value === "number" ? value.toLocaleString("en-IN") : value}
          </p>
          {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>
          <Icon size={17} />
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

export function AdminOverview() {
  const { data: raw, isLoading, error } = useAdminOverview();

  if (isLoading) return <SkeletonGrid />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load the system overview. {(error as any)?.message ?? ""}
      </div>
    );
  }

  // Two unwrap layers: the axios interceptor returns res.data, and the server
  // spreads the payload alongside a `data` key.
  const o = ((raw as any)?.data ?? raw) as any;
  if (!o?.users) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Users"
          value={o.users.total}
          hint={`${o.users.active} active · ${o.users.inactive} inactive`}
          icon={Users}
        />
        <Stat
          label="Super admins"
          value={o.users.superAdmins}
          hint={
            o.users.superAdmins <= 1
              ? "Only one — no recovery account"
              : "Recovery account available"
          }
          icon={ShieldCheck}
          tone={o.users.superAdmins <= 1 ? "warn" : "default"}
        />
        <Stat
          label="Branches"
          value={o.branches.total}
          hint={`${o.branches.active} active`}
          icon={Building2}
        />
        <Stat
          label="Active sessions"
          value={o.sessions.active}
          hint="Devices able to renew"
          icon={KeyRound}
        />
        <Stat
          label="Audit entries"
          value={o.audit.total}
          hint={`${o.audit.last24h} in the last 24h`}
          icon={ScrollText}
        />
        <Stat
          label="Medicines"
          value={o.catalogue.medicines}
          hint={`${o.catalogue.activeMedicines} active`}
          icon={Pill}
        />
        <Stat
          label="Batches expiring"
          value={o.inventory.expiringIn30Days}
          hint={`within 30 days · ${o.inventory.batches} total`}
          icon={PackageX}
          tone={o.inventory.expiringIn30Days > 0 ? "warn" : "default"}
        />
        <Stat
          label="Invoices today"
          value={o.billing.invoicesToday}
          hint={`${o.billing.invoices} all time`}
          icon={Receipt}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Patients" value={o.people.patients} icon={HeartPulse} />
        <Stat label="Employees" value={o.people.employees} icon={Users} />
        <Stat label="Suppliers" value={o.people.suppliers} icon={Truck} />
        <Stat
          label="Purchase orders"
          value={o.procurement.purchaseOrders}
          icon={Receipt}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">
            Accounts by role
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          {(o.users.byRole ?? []).map((r: any) => {
            const pct = o.users.total ? (r.total / o.users.total) * 100 : 0;
            return (
              <div key={r.role} className="px-4 py-2.5 flex items-center gap-3">
                <span className="w-44 shrink-0 text-sm text-slate-700 capitalize">
                  {r.role.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-slate-500 tabular-nums">
                  {r.total} total · {r.active} active
                </span>
              </div>
            );
          })}
          {(o.users.byRole ?? []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              No accounts yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
