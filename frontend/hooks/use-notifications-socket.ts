"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, Socket } from "socket.io-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { queryKeys } from "@/lib/api-client";

let socket: Socket | null = null;

export function useNotificationsSocket() {
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const { info: toastInfo, warning: toastWarning } = useToast();

  useEffect(() => {
    if (!accessToken || !user) {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const socketUrl = apiUrl.replace(/\/api\/v1\/?$/, "");

    socket = io(`${socketUrl}/notifications`, {
      auth: { token: `Bearer ${accessToken}` },
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
    });

    socket.on("connect", () => {
      // connected cleanly
    });

    socket.on("notification.new", (notification: any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });

      const title = notification?.title ?? "System Alert";
      const message = notification?.message ?? "You have a new update.";
      const isUrgent =
        notification?.type === "expired" ||
        notification?.type === "near_expiry" ||
        notification?.type === "low_stock";

      if (isUrgent) {
        toastWarning(title, message, 6000);
      } else {
        toastInfo(title, message);
      }
    });

    return () => {
      if (socket) {
        socket.off("notification.new");
        socket.disconnect();
        socket = null;
      }
    };
  }, [accessToken, user, queryClient, toastInfo, toastWarning]);
}
