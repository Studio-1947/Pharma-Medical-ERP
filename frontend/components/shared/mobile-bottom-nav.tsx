"use client";

import { usePathname } from "next/navigation";
import { useNavigation } from "@/lib/navigation-context";
import { LayoutDashboard, Receipt, Package, Users, Menu } from "lucide-react";

interface Props {
  onOpenMenu: () => void;
}

export function MobileBottomNav({ onOpenMenu }: Props) {
  const pathname = usePathname();
  const { navigate } = useNavigation();

  const navs = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "POS", href: "/billing/pos", icon: Receipt },
    { label: "Inventory", href: "/inventory", icon: Package },
    { label: "Patients", href: "/patients", icon: Users },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 text-slate-300 py-1.5 px-2 flex items-center justify-around shadow-2xl">
      {navs.map(({ label, href, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <button
            key={href}
            onClick={() => navigate(href)}
            className={`flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl transition-all ${
              active
                ? "text-emerald-400 font-extrabold bg-white/10"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon size={18} />
            <span className="text-[10px] font-bold tracking-tight">{label}</span>
          </button>
        );
      })}
      <button
        onClick={onOpenMenu}
        className="flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl text-emerald-400 hover:text-emerald-300 transition-all font-bold"
      >
        <Menu size={18} />
        <span className="text-[10px] tracking-tight">Menu</span>
      </button>
    </nav>
  );
}
