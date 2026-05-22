"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { apiClient, queryKeys } from "@/lib/api-client";
import { LogOut, User, Bell } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

export function Header() {
  const { user, logout, accessToken } = useAuthStore();
  const router = useRouter();

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
      // Backend logout failed — proceed with client-side cleanup anyway
    } finally {
      logout();
      router.push("/login");
    }
  };

  return (
    <header className="h-16 border-b flex items-center justify-between px-6 bg-card shrink-0">
      <Breadcrumbs />
      <div className="flex items-center gap-3">
        <Link
          href={"/notifications" as any}
          className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Notifications"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>

        <span className="text-sm text-muted-foreground capitalize">
          {user?.role?.replace(/_/g, " ") ?? ""}
        </span>
        <div className="flex items-center gap-2 bg-muted rounded-full px-3 py-1.5">
          <User size={14} />
          <span className="text-sm font-medium">{user?.email ?? ""}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 text-muted-foreground transition-colors text-sm font-medium"
          title="Sign out"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
