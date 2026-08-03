"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { CrossBranchView } from "@/components/modules/admin/cross-branch-view";

export default function AdminDataPage() {
  return (
    <AdminPageShell>
      <CrossBranchView />
    </AdminPageShell>
  );
}
