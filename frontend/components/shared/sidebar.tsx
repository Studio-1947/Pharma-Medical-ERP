"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Package,
  Receipt,
  FileText,
  Users,
  ShoppingCart,
  Truck,
  BarChart2,
  ClipboardList,
  Settings,
} from "lucide-react";

import { useAuthStore } from "@/stores/auth.store";
import { UserRole } from "@pharmerp/types";

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/billing", label: "Billing & POS", icon: Receipt },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart },
  { href: "/hr", label: "HR Management", icon: Users },
  { href: "/distribution", label: "Distribution", icon: Truck },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/reports", label: "Reports & Compliance", icon: ClipboardList },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();

  const navItems = [
    ...baseNavItems,
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-gradient-to-b from-emerald-900 via-teal-900 to-cyan-950 text-white relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute bottom-0 -right-12 w-40 h-40 rounded-full bg-teal-600/10 pointer-events-none" />

      {/* Brand */}
      <div className="relative h-16 flex items-center gap-3 px-5 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center font-bold text-sm shrink-0">
          Rx
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-bold leading-tight text-white truncate">
            Radha Madhav
          </p>
          <p className="text-[11px] text-emerald-300/80 leading-tight truncate">
            Medical Hall
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href as any}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-emerald-100/70 hover:bg-white/8 hover:text-white",
              )}
            >
              <Icon
                size={16}
                className={clsx(
                  "shrink-0 transition-colors",
                  active ? "text-emerald-300" : "text-emerald-400/70",
                )}
              />
              {label}
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer tag */}
      <div className="relative px-5 py-3 border-t border-white/10">
        <p className="text-[10px] text-emerald-400/50">
          Pharmacy Management System
        </p>
      </div>
    </aside>
  );
}
