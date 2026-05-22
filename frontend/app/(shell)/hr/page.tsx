"use client";

import { useState } from "react";
import { EmployeesView } from "@/components/modules/hr/employees-view";
import { LeavesView } from "@/components/modules/hr/leaves-view";
import { StaffManagementClient } from "@/components/modules/staff/staff-management-client";
import { Users } from "lucide-react";

type Tab = "accounts" | "employees" | "leaves";

export default function HRPage() {
  const [activeTab, setActiveTab] = useState<Tab>("accounts");

  const tabs: { id: Tab; label: string }[] = [
    { id: "accounts", label: "Staff Accounts" },
    { id: "employees", label: "Employee Records" },
    { id: "leaves", label: "Leave & Absence" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
          <Users className="w-6 h-6 text-emerald-600" />
          HR & Staff Management
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage system accounts, employee records, and leave requests in one place.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-t-xl font-bold text-sm transition-all border border-b-0 ${
              activeTab === tab.id
                ? "bg-white text-emerald-600 border-slate-200"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === "accounts" && <StaffManagementClient />}
        {activeTab === "employees" && <EmployeesView />}
        {activeTab === "leaves" && <LeavesView />}
      </div>
    </div>
  );
}
