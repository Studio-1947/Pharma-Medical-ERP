"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import { useNavigation } from "@/lib/navigation-context";
import { usePermissions } from "@/hooks/use-permissions";
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
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Parameters<ReturnType<typeof usePermissions>["can"]>[0];
  roles?: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/billing", label: "Billing & POS", icon: Receipt, permission: "billing.create" },
  { href: "/inventory", label: "Inventory", icon: Package, permission: "inventory.adjust" },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText, permission: "prescriptions.verify" },
  { href: "/patients", label: "Patients", icon: Users, permission: "patients.write" },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart, permission: "procurement.write" },
  { href: "/hr", label: "HR Management", icon: Users, permission: "staff.write" },
  { href: "/distribution", label: "Distribution", icon: Truck, permission: "distribution.write" },
  { href: "/analytics", label: "Analytics", icon: BarChart2, permission: "reports.view" },
  { href: "/reports", label: "Reports & Compliance", icon: ClipboardList, permission: "reports.view" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "users.manage" },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const { navigate, isPending } = useNavigation();
  const { can } = usePermissions();

  // The collapse feature only exists on desktop; the mobile drawer always
  // shows the full menu.
  const collapsed = desktopCollapsed && !mobileOpen;
  const setCollapsed = setDesktopCollapsed;

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || can(item.permission),
  );

  return (
    <>
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
    <aside
      className={clsx(
        "flex flex-col bg-gradient-to-b from-emerald-900 via-teal-900 to-cyan-950 text-white overflow-visible",
        // Mobile: fixed off-canvas drawer. Desktop (lg+): static column.
        "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-300 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "lg:relative lg:translate-x-0 lg:shrink-0 lg:transition-all",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      {/* Decorative orbs */}
      <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute bottom-0 -right-12 w-40 h-40 rounded-full bg-teal-600/10 pointer-events-none" />

      {/* Brand header */}
      <div className="relative h-16 flex items-center border-b border-white/10 overflow-hidden">
        {collapsed ? (
          /* Collapsed: logo icon only */
          <div className="flex w-full justify-center">
            <Image
              src="/logo.svg"
              alt="Radha Madhav Medical Hall"
              width={32}
              height={32}
              className="rounded-lg"
              priority
            />
          </div>
        ) : (
          /* Expanded: logo + name + collapse button */
          <div className="flex items-center gap-3 px-4 w-full">
            <Image
              src="/logo.svg"
              alt="Radha Madhav Medical Hall"
              width={32}
              height={32}
              className="rounded-lg shrink-0"
              priority
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold leading-tight text-white truncate">
                Radha Madhav
              </p>
              <p className="text-[11px] text-emerald-300/80 leading-tight">
                Medical Hall
              </p>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="hidden lg:block shrink-0 p-1.5 rounded-lg hover:bg-white/15 text-emerald-300/70 hover:text-white transition-colors"
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              onClick={onMobileClose}
              aria-label="Close menu"
              className="lg:hidden shrink-0 p-1.5 rounded-lg hover:bg-white/15 text-emerald-300/70 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="relative flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          // "optimistic active" — treat the item as active the instant it is
          // clicked, before the route commits, so the sidebar never looks stale.
          const isNavigatingHere = isPending && active;
          return (
            <button
              key={href}
              onClick={() => { navigate(href); onMobileClose?.(); }}
              title={collapsed ? label : undefined}
              className={clsx(
                "relative w-full flex items-center rounded-lg text-sm font-medium transition-all group",
                collapsed ? "justify-center px-0 py-2.5" : "justify-start text-left gap-3 px-3 py-2.5",
                active
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-emerald-100/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon
                size={16}
                className={clsx(
                  "shrink-0 transition-colors",
                  active ? "text-emerald-300" : "text-emerald-400/70 group-hover:text-emerald-300",
                  isNavigatingHere && "animate-pulse",
                )}
              />
              {!collapsed && (
                <>
                  <span className="truncate flex-1">{label}</span>
                  {active && (
                    <span
                      className={clsx(
                        "w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0",
                        isNavigatingHere && "animate-pulse",
                      )}
                    />
                  )}
                </>
              )}
              {collapsed && active && (
                <span className="absolute right-0.5 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="relative px-4 py-3 border-t border-white/10">
          <p className="text-[10px] text-emerald-400/50">
            Pharmacy Management System
          </p>
        </div>
      )}

      {/* Expand tab — floats on the right edge when collapsed (desktop only) */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="hidden lg:flex absolute top-1/2 -translate-y-1/2 -right-3 z-50 items-center justify-center w-6 h-10 bg-emerald-700 hover:bg-emerald-600 rounded-r-lg shadow-lg transition-colors border border-white/10"
        >
          <PanelLeftOpen size={13} className="text-white" />
        </button>
      )}
    </aside>
    </>
  );
}
