"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import { useNavigation } from "@/lib/navigation-context";
import { usePermissions } from "@/hooks/use-permissions";
import { NAV_ITEMS } from "@/lib/nav-items";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, X, Sparkles } from "lucide-react";

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const { isPending } = useNavigation();
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
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
    <aside
      className={clsx(
        "flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950 text-white border-r border-slate-800/60 shadow-xl overflow-visible",
        // Mobile: fixed off-canvas drawer. Desktop (lg+): static column.
        "fixed inset-y-0 left-0 z-50 w-72 sm:w-64 transition-all duration-300 ease-in-out",
        mobileOpen ? "translate-x-0 shadow-2xl ring-1 ring-white/10" : "-translate-x-full",
        "lg:relative lg:translate-x-0 lg:shrink-0",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      {/* Background ambient lighting */}
      <div className="absolute top-0 -left-12 w-48 h-48 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
      <div className="absolute bottom-0 -right-12 w-40 h-40 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />

      {/* Brand header */}
      <div className="relative h-16 flex items-center border-b border-white/10 px-4 shrink-0 overflow-hidden">
        {collapsed ? (
          /* Collapsed: logo icon only */
          <div className="flex w-full justify-center">
            <Image
              src="/logo.svg"
              alt="Radha Madhav Medical Hall"
              width={34}
              height={34}
              className="rounded-xl ring-2 ring-emerald-500/30 shadow-md"
              priority
            />
          </div>
        ) : (
          /* Expanded: logo + name + collapse button */
          <div className="flex items-center gap-3 w-full">
            <Image
              src="/logo.svg"
              alt="Radha Madhav Medical Hall"
              width={34}
              height={34}
              className="rounded-xl ring-2 ring-emerald-500/30 shadow-md shrink-0"
              priority
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-extrabold tracking-tight leading-tight text-white truncate">
                Radha Madhav
              </p>
              <p className="text-[10px] font-semibold text-emerald-400 leading-tight uppercase tracking-wider">
                Medical Hall ERP
              </p>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="hidden lg:flex shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              onClick={onMobileClose}
              aria-label="Close menu"
              className="lg:hidden shrink-0 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors flex items-center gap-1 font-bold text-xs"
            >
              <X size={16} />
              <span>Close</span>
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="relative flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          const isNavigatingHere = isPending && active;
          return (
            <Link
              key={href}
              href={href as any}
              onClick={() => { onMobileClose?.(); }}
              title={collapsed ? label : undefined}
              className={clsx(
                "relative w-full flex items-center rounded-xl text-xs font-semibold transition-all group select-none",
                collapsed ? "justify-center px-0 py-3" : "justify-start text-left gap-3 px-3 py-2.5",
                active
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-white border border-emerald-500/30 shadow-sm"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent",
              )}
            >
              <Icon
                size={17}
                className={clsx(
                  "shrink-0 transition-colors",
                  active ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-200",
                  isNavigatingHere && "animate-pulse",
                )}
              />
              {!collapsed && (
                <>
                  <span className="truncate flex-1 tracking-wide">{label}</span>
                  {active && (
                    <span
                      className={clsx(
                        "w-2 h-2 rounded-full bg-emerald-400 shadow-glow shrink-0",
                        isNavigatingHere && "animate-ping",
                      )}
                    />
                  )}
                </>
              )}
              {collapsed && active && (
                <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-full bg-emerald-400 shadow-glow" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="relative px-4 py-3 border-t border-white/10 bg-slate-950/40">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span>PharmaERP v1.0</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
        </div>
      )}

      {/* Expand tab — floats on the right edge when collapsed (desktop only) */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="hidden lg:flex absolute top-1/2 -translate-y-1/2 -right-3 z-50 items-center justify-center w-6 h-10 bg-slate-800 hover:bg-emerald-600 rounded-r-xl shadow-xl transition-colors border border-slate-700 text-slate-300 hover:text-white"
        >
          <PanelLeftOpen size={13} />
        </button>
      )}
    </aside>
    </>
  );
}

