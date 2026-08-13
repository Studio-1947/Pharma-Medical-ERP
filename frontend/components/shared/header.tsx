"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { apiClient } from "@/lib/api-client";
import { LogOut, Menu, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { BranchSwitcher } from "@/components/shared/branch-switcher";
import { HeaderNotificationsDropdown } from "@/components/shared/header-notifications-dropdown";
import { useNotificationsSocket } from "@/hooks/use-notifications-socket";
import { useNavigation } from "@/lib/navigation-context";

import { useState, useEffect } from "react";
import { GlobalSearchModal } from "@/components/shared/global-search-modal";

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, logout, accessToken } = useAuthStore();
  const router = useRouter();
  const { navigate } = useNavigation();
  const [searchOpen, setSearchOpen] = useState(false);

  // Initialize real-time Socket.IO notification push listener
  useNotificationsSocket();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogout = async () => {
    try {
      if (accessToken) {
        await apiClient.post("/auth/logout", {});
      }
    } catch {
      // proceed with client cleanup regardless
    } finally {
      logout();
      router.push("/login");
    }
  };

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  const roleLabel = user?.role
    ? user.role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  return (
    <>
      <header className="glass-header h-16 flex items-center justify-between gap-2 px-3 sm:px-6 shrink-0 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open menu"
            className="lg:hidden shrink-0 p-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-2xs flex items-center gap-1.5 font-bold text-xs"
          >
            <Menu size={18} />
            <span className="hidden xs:inline">Menu</span>
          </button>
          <div className="hidden md:block min-w-0">
            <Breadcrumbs />
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Quick navigation search indicator button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 sm:px-3 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-all text-xs font-medium"
            title="Quick search pages, medicines & patients (Ctrl+K)"
          >
            <Search size={15} className="text-slate-400 shrink-0" />
            <span className="hidden md:inline">Search pages, medicines, patients...</span>
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 rounded-md shadow-2xs">
              Ctrl+K
            </kbd>
          </button>

          {/* Active branch — renders for super_admin only */}
          <BranchSwitcher />

          {/* Real-time Notifications Popover Dropdown */}
          <HeaderNotificationsDropdown />

          {/* Divider */}
          <div className="w-px h-5 bg-slate-200/80 mx-0.5" />

          {/* User pill */}
          <div className="flex items-center gap-2 bg-slate-50/80 border border-slate-200/80 rounded-full py-1 px-1 sm:pr-3">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white text-[11px] font-extrabold shrink-0 shadow-sm">
              {initials}
            </div>
            <div className="hidden sm:block leading-tight">
              <p className="text-[12px] font-bold text-slate-800 truncate max-w-[140px]">
                {user?.email ?? ""}
              </p>
              <p className="text-[10px] font-medium text-emerald-600">{roleLabel}</p>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center p-2 sm:px-3 sm:py-1.5 rounded-xl hover:bg-rose-50 hover:text-rose-600 text-slate-500 transition-colors text-xs font-semibold border border-transparent hover:border-rose-200/60"
            title="Sign out"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

    <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
