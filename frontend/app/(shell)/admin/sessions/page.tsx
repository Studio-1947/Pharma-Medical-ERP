"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { SessionsView } from "@/components/modules/admin/sessions-view";

export default function AdminSessionsPage() {
  return (
    <AdminPageShell>
      <SessionsView />
    </AdminPageShell>
  );
}
