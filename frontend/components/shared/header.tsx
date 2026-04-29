"use client";

import { useAuthStore } from "@/stores/auth.store";
import { LogOut, User } from "lucide-react";

export function Header() {
  const { user, logout } = useAuthStore();

  return (
    <header className="h-16 border-b flex items-center justify-between px-6 bg-card shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground capitalize">
          {user?.role?.replace("_", " ") ?? ""}
        </span>
        <div className="flex items-center gap-2 bg-muted rounded-full px-3 py-1.5">
          <User size={14} />
          <span className="text-sm font-medium">{user?.email ?? "Guest"}</span>
        </div>
        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Logout"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
