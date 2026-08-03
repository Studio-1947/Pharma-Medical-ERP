"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { AdminOverview } from "@/components/modules/admin/admin-overview";

export default function AdminPage() {
  return (
    <AdminPageShell>
      <AdminOverview />
    </AdminPageShell>
  );
}
