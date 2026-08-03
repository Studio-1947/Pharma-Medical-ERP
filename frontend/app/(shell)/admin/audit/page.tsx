"use client";

import { AdminPageShell } from "@/components/modules/admin/admin-page-shell";
import { AuditLogView } from "@/components/modules/admin/audit-log-view";

export default function AdminAuditPage() {
  return (
    <AdminPageShell>
      <AuditLogView />
    </AdminPageShell>
  );
}
