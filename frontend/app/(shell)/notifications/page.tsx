"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Package,
  Clock,
  AlertTriangle,
  FileText,
  CheckCheck,
  Check,
} from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";

interface Notification {
  id: string;
  type: "low_stock" | "near_expiry" | "expired" | "reorder" | "invoice" | "prescription" | "system";
  title: string;
  message: string;
  isRead: boolean;
  resourceType?: string;
  resourceId?: string;
  createdAt: string;
}

const TYPE_META: Record<
  Notification["type"],
  { icon: React.ReactNode; color: string }
> = {
  low_stock: { icon: <Package size={16} />, color: "text-amber-600 bg-amber-50" },
  near_expiry: { icon: <Clock size={16} />, color: "text-orange-600 bg-orange-50" },
  expired: { icon: <AlertTriangle size={16} />, color: "text-red-600 bg-red-50" },
  reorder: { icon: <Package size={16} />, color: "text-blue-600 bg-blue-50" },
  invoice: { icon: <FileText size={16} />, color: "text-green-600 bg-green-50" },
  prescription: { icon: <FileText size={16} />, color: "text-purple-600 bg-purple-50" },
  system: { icon: <Bell size={16} />, color: "text-slate-600 bg-slate-50" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = { unreadOnly, page, limit: 20 };

  const { data: raw, isLoading } = useQuery<any>({
    queryKey: queryKeys.notifications.list(params),
    queryFn: () => apiClient.get("/notifications", { params }),
  });

  const notifications: Notification[] = raw?.data ?? raw ?? [];
  const meta = raw?.meta;

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiClient.post("/notifications/mark-all-read", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
            <Bell className="w-6 h-6 text-blue-600" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            System alerts, stock warnings, and activity updates.
          </p>
        </div>
        <button
          onClick={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          <CheckCheck size={15} />
          Mark all read
        </button>
      </div>

      {/* Filter toggle */}
      <div className="flex gap-2">
        {[
          { label: "All", value: false },
          { label: "Unread only", value: true },
        ].map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => { setUnreadOnly(opt.value); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              unreadOnly === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border overflow-hidden divide-y bg-white">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-4 p-4 animate-pulse">
              <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 bg-slate-100 rounded" />
                <div className="h-3 w-2/3 bg-slate-100 rounded" />
              </div>
            </div>
          ))
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Bell size={36} className="opacity-20" />
            <p className="text-sm">
              {unreadOnly ? "No unread notifications." : "No notifications yet."}
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const meta = TYPE_META[n.type] ?? TYPE_META.system;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-4 p-4 transition-colors ${
                  n.isRead ? "bg-white" : "bg-blue-50/40"
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`text-sm font-semibold truncate ${n.isRead ? "text-slate-700" : "text-slate-900"}`}>
                      {n.title}
                    </p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                </div>
                {!n.isRead && (
                  <button
                    onClick={() => markReadMutation.mutate(n.id)}
                    title="Mark as read"
                    className="shrink-0 p-1.5 text-blue-500 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <Check size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} total</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
            >
              Prev
            </button>
            <button
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
