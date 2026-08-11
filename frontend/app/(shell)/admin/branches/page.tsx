"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { AdminBranchesView } from "@/components/modules/admin/admin-branches-view";

export default function AdminBranchesPage() {
  return (
    <AdminPageShell>
      <AdminBranchesView />
    </AdminPageShell>
  );
}
