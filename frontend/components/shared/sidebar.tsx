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
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/billing", label: "Billing & POS", icon: Receipt },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart },
  { href: "/distribution", label: "Distribution", icon: Truck },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 bg-gray-900 text-gray-100 flex flex-col">
      <div className="h-16 flex items-center px-5 border-b border-gray-700">
        <span className="text-xl font-bold text-white">PharmERP</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href as any}
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-gray-800 hover:text-white",
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
