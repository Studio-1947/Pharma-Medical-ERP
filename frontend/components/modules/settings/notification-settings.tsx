"use client";

import { useState } from "react";
import { Bell, Mail, MessageSquare, AlertTriangle, Clock } from "lucide-react";

interface NotifToggle {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  email: boolean;
  sms: boolean;
}

const DEFAULT_SETTINGS: NotifToggle[] = [
  {
    id: "low_stock",
    label: "Low Stock Alert",
    description: "Notify when a product falls below its reorder level",
    icon: <AlertTriangle size={16} className="text-amber-500" />,
    email: true,
    sms: false,
  },
  {
    id: "near_expiry",
    label: "Near Expiry Alert",
    description: "Notify 30 days before batch expiry",
    icon: <Clock size={16} className="text-red-500" />,
    email: true,
    sms: true,
  },
  {
    id: "prescription_pending",
    label: "Pending Prescription",
    description: "Notify pharmacists of unverified prescriptions",
    icon: <Bell size={16} className="text-blue-500" />,
    email: false,
    sms: false,
  },
  {
    id: "daily_report",
    label: "Daily Sales Report",
    description: "Send end-of-day sales summary email",
    icon: <Mail size={16} className="text-green-500" />,
    email: true,
    sms: false,
  },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        checked ? "bg-blue-600" : "bg-slate-200"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4.5" : "translate-x-0.5"
        }`}
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotifToggle[]>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  const update = (id: string, channel: "email" | "sms", value: boolean) => {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [channel]: value } : s))
    );
    setSaved(false);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Notification Preferences</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which events trigger email or SMS notifications
            </p>
          </div>
          <div className="flex gap-6 text-xs font-medium text-muted-foreground pr-2">
            <span className="flex items-center gap-1">
              <Mail size={12} /> Email
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare size={12} /> SMS
            </span>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {settings.map((s) => (
            <div key={s.id} className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{s.icon}</div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <Toggle checked={s.email} onChange={(v) => update(s.id, "email", v)} />
                <Toggle checked={s.sms} onChange={(v) => update(s.id, "sms", v)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {saved ? "Saved!" : "Save Preferences"}
        </button>
      </div>
    </div>
  );
}
