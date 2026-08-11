"use client";

import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useNavigation } from "@/lib/navigation-context";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/users", label: "Users & Roles" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/audit", label: "Audit Log" },
  { href: "/admin/data", label: "Cross-Branch Data" },
] as const;

export function AdminHeader() {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-emerald-600" />
        Admin Console
      </h1>
      <p className="text-slate-500 mt-1 text-sm">
        Full-system control. Every action here is recorded in the audit log.
      </p>
    </div>
  );
}

/**
 * Tabs navigate rather than toggling local state, so each screen deep-links
 * and produces its own breadcrumb trail.
 */
export function AdminTabs() {
  const pathname = usePathname();
  const { navigate } = useNavigation();

  return (
    <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
      {TABS.map((tab) => {
        // Exact match for /admin so it is not lit up by every subroute.
        const active =
          tab.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(tab.href);

        return (
          <button
            key={tab.href}
            onClick={() => navigate(tab.href)}
            className={`whitespace-nowrap px-4 py-2.5 rounded-t-lg text-sm font-medium transition-all border border-b-0 ${
              active
                ? "bg-white text-emerald-600 border-slate-200"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
