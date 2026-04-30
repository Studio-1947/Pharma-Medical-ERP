"use client";

import { StaffList } from "@/components/modules/staff/staff-list";
import { UserPlus, Filter, Download } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { StaffForm } from "@/components/modules/staff/staff-form";

export function StaffManagementClient() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Staff Management</h1>
          <p className="text-muted-foreground mt-1">Manage hospital staff, roles, and system access.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            <Filter className="w-4 h-4" /> Filter
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          <button 
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <UserPlus className="w-4 h-4" /> Add New Staff
          </button>
        </div>
      </div>

      <StaffList />

      <Modal 
        title="Add New Staff Member" 
        open={open} 
        onClose={() => setOpen(false)}
        size="md"
      >
        <StaffForm 
          onSuccess={() => setOpen(false)} 
          onCancel={() => setOpen(false)} 
        />
      </Modal>
    </div>
  );
}
