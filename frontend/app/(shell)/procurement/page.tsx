"use client";

import { useState } from "react";
import { SuppliersView } from "@/components/modules/procurement/suppliers-view";
import { PurchaseOrdersView } from "@/components/modules/procurement/purchase-orders-view";
import { PayablesAgingView } from "@/components/modules/procurement/payables-aging-view";
import { ShoppingCart } from "lucide-react";

const TABS = [
  { id: "suppliers", label: "Partners & Suppliers" },
  { id: "orders", label: "Purchase Orders" },
  { id: "payables", label: "Payables Aging" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function ProcurementPage() {
  const [activeTab, setActiveTab] = useState<Tab>("suppliers");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-emerald-600" />
          Procurement Management
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Track, manage, and create Purchase Orders & Supplier partnerships.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-0.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-t-xl font-bold text-sm transition-all border border-b-0 whitespace-nowrap ${
              activeTab === t.id
                ? "bg-white text-emerald-600 border-slate-200"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === "suppliers" && <SuppliersView />}
        {activeTab === "orders" && <PurchaseOrdersView />}
        {activeTab === "payables" && <PayablesAgingView />}
      </div>
    </div>
  );
}
