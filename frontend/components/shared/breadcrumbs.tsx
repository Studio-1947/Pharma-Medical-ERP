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

  // Single segment or root — show nothing (header title is enough)
  if (segments.length <= 1) return null;

  // Build cumulative href per segment
  const crumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <button
        onClick={() => navigate("/dashboard")}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Home"
      >
        <Home size={14} />
      </button>

      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1 min-w-0">
          <ChevronRight size={13} className="text-muted-foreground/50 shrink-0" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground truncate">
              {crumb.label}
            </span>
          ) : (
            <button
              onClick={() => navigate(crumb.href)}
              className="text-muted-foreground hover:text-foreground transition-colors truncate"
            >
              {crumb.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}
