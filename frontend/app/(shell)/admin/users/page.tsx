"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { AdminUsersView } from "@/components/modules/admin/admin-users-view";

export default function AdminUsersPage() {
  return (
    <AdminPageShell>
      <AdminUsersView />
    </AdminPageShell>
  );
}
