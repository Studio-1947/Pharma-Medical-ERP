"use client";

import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { useNavigation } from "@/lib/navigation-context";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard:     "Dashboard",
  inventory:     "Inventory",
  billing:       "Billing & POS",
  pos:           "Point of Sale",
  prescriptions: "Prescriptions",
  patients:      "Patients",
  procurement:   "Procurement",
  hr:            "HR Management",
  distribution:  "Distribution",
  analytics:     "Analytics",
  reports:       "Reports",
  notifications: "Notifications",
  settings:      "Settings",
  staff:         "Staff",
  admin:         "Admin Console",
  users:         "Users",
  audit:         "Audit Log",
  sessions:      "Sessions",
  data:          "Cross-Branch Data",
};

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment.toLowerCase()] ?? segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { navigate } = useNavigation();

  // Strip leading slash, split into segments, filter empty strings
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);

  // Single segment or root — show current top section badge
  if (segments.length === 0) return null;

  // Build cumulative href per segment
  const crumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
      <button
        onClick={() => navigate("/dashboard")}
        className="p-1.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/80 text-slate-500 hover:text-slate-900 transition-colors shrink-0 flex items-center justify-center"
        aria-label="Home"
        title="Dashboard"
      >
        <Home size={13} />
      </button>

      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5 min-w-0">
          <ChevronRight size={13} className="text-slate-400 shrink-0" />
          {crumb.isLast ? (
            <span className="font-bold text-slate-900 bg-emerald-50 text-emerald-800 border border-emerald-200/60 px-2.5 py-1 rounded-lg truncate shadow-2xs">
              {crumb.label}
            </span>
          ) : (
            <button
              onClick={() => navigate(crumb.href)}
              className="font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-lg transition-colors truncate"
            >
              {crumb.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

