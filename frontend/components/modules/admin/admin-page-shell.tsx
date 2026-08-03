"use client";

import { ShieldAlert } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { AdminHeader, AdminTabs } from "./admin-tabs";

/**
 * Chrome shared by every console screen.
 *
 * The permission check is redundant with AppShell's route gate, but AppShell
 * lets the page through while the auth store is still rehydrating (role is ""
 * for a tick). Repeating it here matches the pattern in settings/page.tsx.
 * Neither is the real boundary — @Roles(SUPER_ADMIN) on the API is.
 */
export function AdminPageShell({ children }: { children: React.ReactNode }) {
  const { can } = usePermissions();

  if (!can("admin.console")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
        <ShieldAlert size={32} className="text-red-400" />
        <p className="font-medium">
          You do not have permission to access the Admin Console.
        </p>
        <p className="text-sm text-slate-400">
          This area is restricted to super admins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminHeader />
      <AdminTabs />
      <div className="pt-2">{children}</div>
    </div>
  );
}
