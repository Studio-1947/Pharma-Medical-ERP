"use client";

import { useState } from "react";
import { Settings, Users, Building2, Bell, Lock } from "lucide-react";
import { UsersSettings } from "@/components/modules/settings/users-settings";
import { BranchSettings } from "@/components/modules/settings/branch-settings";
import { NotificationSettings } from "@/components/modules/settings/notification-settings";
import { SecuritySettings } from "@/components/modules/settings/security-settings";

type Tab = "users" | "branches" | "notifications" | "security";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "users", label: "Users & Roles", icon: <Users size={16} /> },
  { id: "branches", label: "Branches", icon: <Building2 size={16} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
  { id: "security", label: "Security", icon: <Lock size={16} /> },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("users");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-emerald-600" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage users, branches, and system configuration.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-all border border-b-0 ${
              activeTab === tab.id
                ? "bg-white text-emerald-600 border-slate-200"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === "users" && <UsersSettings />}
        {activeTab === "branches" && <BranchSettings />}
        {activeTab === "notifications" && <NotificationSettings />}
        {activeTab === "security" && <SecuritySettings />}
      </div>
    </div>
  );
}
