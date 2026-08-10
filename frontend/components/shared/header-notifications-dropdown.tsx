"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Check, ExternalLink, Package, Clock, AlertTriangle, FileText } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useNavigation } from "@/lib/navigation-context";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  low_stock: <Package size={14} className="text-amber-600" />,
  near_expiry: <Clock size={14} className="text-orange-600" />,
  expired: <AlertTriangle size={14} className="text-red-600" />,
  reorder: <Package size={14} className="text-emerald-600" />,
  invoice: <FileText size={14} className="text-green-600" />,
  prescription: <FileText size={14} className="text-teal-600" />,
  system: <Bell size={14} className="text-slate-600" />,
};

export function HeaderNotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { navigate } = useNavigation();

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data: countData } = useQuery<any>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => apiClient.get("/notifications/unread-count"),
    refetchInterval: 30_000,
    retry: false,
  });

  const unread: number = countData?.count ?? 0;

  const { data: listData, isLoading } = useQuery<any>({
    queryKey: queryKeys.notifications.list({ unreadOnly: false, page: 1, limit: 5 }),
    queryFn: () => apiClient.get("/notifications", { params: { limit: 5 } }),
    enabled: open,
  });

  const notifications: Notification[] = listData?.data ?? listData ?? [];

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiClient.post("/notifications/mark-all-read", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`relative p-2 rounded-xl border transition-all ${
          open
            ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm"
            : "border-transparent hover:border-slate-200/60 hover:bg-slate-100 text-slate-500 hover:text-slate-900"
        }`}
        title="Notifications"
        aria-label="Toggle notifications menu"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold flex items-center justify-center leading-none ring-2 ring-white animate-pulse">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/80">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-emerald-600" />
              <span className="font-extrabold text-xs tracking-wider uppercase text-slate-800">Notifications</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs font-medium">
                No notifications right now.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-3 text-xs flex items-start gap-3 transition-colors ${
                    n.isRead ? "bg-white" : "bg-emerald-50/30 font-medium"
                  }`}
                >
                  <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-slate-100">
                    {TYPE_ICONS[n.type] ?? <Bell size={14} className="text-slate-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 truncate">{n.title}</p>
                    <p className="text-slate-500 text-[11px] line-clamp-2 mt-0.5">{n.message}</p>
                  </div>
                  {!n.isRead && (
                    <button
                      onClick={() => markReadMutation.mutate(n.id)}
                      title="Mark as read"
                      className="p-1 text-slate-400 hover:text-emerald-600 rounded hover:bg-emerald-50 transition-colors shrink-0"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-2.5 border-t bg-slate-50 text-center">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/notifications");
              }}
              className="w-full text-center text-xs font-bold text-slate-700 hover:text-emerald-700 hover:underline flex items-center justify-center gap-1.5 py-1"
            >
              <span>View All Notifications</span>
              <ExternalLink size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
