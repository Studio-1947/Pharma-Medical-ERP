"use client";

import { useState } from "react";
import { EmployeesView } from "@/components/modules/hr/employees-view";
import { LeavesView } from "@/components/modules/hr/leaves-view";
import { Users, Calendar } from "lucide-react";

export default function HRPage() {
  const [activeTab, setActiveTab] = useState<"employees" | "leaves">("employees");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          HR & Payroll Management
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Track employee records, work schedules, leaves, and payroll details.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-0.5">
        <button
          onClick={() => setActiveTab("employees")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-t-xl font-bold text-sm transition-all border border-b-0 ${
            activeTab === "employees"
              ? "bg-white text-blue-600 border-slate-200"
              : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
          }`}
        >
          Staff & Employees
        </button>
        <button
          onClick={() => setActiveTab("leaves")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-t-xl font-bold text-sm transition-all border border-b-0 ${
            activeTab === "leaves"
              ? "bg-white text-blue-600 border-slate-200"
              : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
          }`}
        >
          Leaves & Absence
        </button>
      </div>

      <div className="pt-2">
        {activeTab === "employees" && <EmployeesView />}
        {activeTab === "leaves" && <LeavesView />}
      </div>
    </div>
  );
}
