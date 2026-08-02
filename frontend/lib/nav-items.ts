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
  Ticket,
  Stethoscope,
} from "lucide-react";
import type { Action } from "@/hooks/use-permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Action;
};

/**
 * Single source of truth for which permission each route needs.
 *
 * The sidebar reads it to decide what to render and AppShell reads it to decide
 * what to let through, so hiding a link and blocking the route can't drift
 * apart — previously the link was hidden but typing the URL still loaded the page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/billing", label: "Billing & POS", icon: Receipt, permission: "billing.create" },
  { href: "/inventory", label: "Inventory", icon: Package, permission: "inventory.adjust" },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText, permission: "prescriptions.view" },
  { href: "/patients", label: "Patients", icon: Users, permission: "patients.write" },
  { href: "/clinic/queue", label: "Clinic Queue", icon: Ticket, permission: "clinic.tokens" },
  { href: "/clinic/doctor", label: "Doctor Panel", icon: Stethoscope, permission: "clinic.doctor" },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart, permission: "procurement.write" },
  { href: "/hr", label: "HR Management", icon: Users, permission: "staff.write" },
  { href: "/distribution", label: "Distribution", icon: Truck, permission: "distribution.write" },
  { href: "/analytics", label: "Analytics", icon: BarChart2, permission: "reports.view" },
  { href: "/reports", label: "Reports & Compliance", icon: ClipboardList, permission: "reports.view" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "users.manage" },
];

/**
 * Permission guarding a pathname, or undefined when the route is open to any
 * signed-in user. Longest match wins so /clinic/doctor is not resolved by a
 * shorter /clinic prefix.
 */
export function permissionForPath(pathname: string): Action | undefined {
  const match = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return match?.permission;
}
