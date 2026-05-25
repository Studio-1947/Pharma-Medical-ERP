"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { apiClient, queryKeys } from "@/lib/api-client";
import { LogOut, Bell } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { useNavigation } from "@/lib/navigation-context";

export function Header() {
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
    <header className="h-16 border-b border-slate-100 flex items-center justify-between px-6 bg-white shrink-0">
      <Breadcrumbs />

      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button
          onClick={() => navigate("/notifications")}
          className="relative p-2 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition-colors"
          title="Notifications"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-100 mx-1" />

        {/* User pill */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
            {initials}
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-[13px] font-semibold text-slate-800 truncate max-w-[160px]">
              {user?.email ?? ""}
            </p>
            <p className="text-[11px] text-slate-400">{roleLabel}</p>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          className="ml-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 text-slate-400 transition-colors text-sm font-medium"
          title="Sign out"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline text-[13px]">Sign out</span>
        </button>
      </div>
    </header>
  );
}
