"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { apiClient, queryKeys } from "@/lib/api-client";
import { LogOut, Bell, Menu, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { BranchSwitcher } from "@/components/shared/branch-switcher";
import { useNavigation } from "@/lib/navigation-context";

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, logout, accessToken } = useAuthStore();
  const router = useRouter();
  const { navigate } = useNavigation();

  const { data: countData } = useQuery<any>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => apiClient.get("/notifications/unread-count"),
    refetchInterval: 60_000,
    retry: false,
  });

  const unread: number = countData?.count ?? 0;

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
    <header className="glass-header h-16 flex items-center justify-between gap-3 px-4 sm:px-6 shrink-0 z-20">
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="lg:hidden shrink-0 p-2 -ml-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
        >
          <Menu size={20} />
        </button>
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {/* Quick navigation search indicator button */}
        <button
          onClick={() => navigate("/inventory")}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-all text-xs font-medium"
        >
          <Search size={14} className="text-slate-400" />
          <span>Quick search inventory...</span>
          <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 rounded-md shadow-2xs">
            Ctrl+K
          </kbd>
        </button>

        {/* Active branch — renders for super_admin only */}
        <BranchSwitcher />

        {/* Notifications */}
        <button
          onClick={() => navigate("/notifications")}
          className="relative p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors border border-transparent hover:border-slate-200/60"
          title="Notifications"
        >
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold flex items-center justify-center leading-none ring-2 ring-white animate-pulse">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200/80 mx-1" />

        {/* User pill */}
        <div className="flex items-center gap-2.5 bg-slate-50/80 border border-slate-200/80 rounded-full py-1 px-1.5 pr-3">
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-rose-50 hover:text-rose-600 text-slate-500 transition-colors text-xs font-semibold border border-transparent hover:border-rose-200/60"
          title="Sign out"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}

