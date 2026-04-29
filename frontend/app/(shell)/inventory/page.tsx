"use client";

import { useState } from "react";
import { StockDashboard } from "@/components/modules/inventory/stock-dashboard";
import { MedicineList } from "@/components/modules/inventory/medicine-list";
import { BatchList } from "@/components/modules/inventory/batch-list";

const tabs = ["Medicines", "Batches", "Warehouses"] as const;
type Tab = (typeof tabs)[number];

export default function InventoryPage() {
  const [active, setActive] = useState<Tab>("Medicines");

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Inventory</h2>

      <StockDashboard />

      {/* Tab bar */}
      <div className="flex border-b mb-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {active === "Medicines" && <MedicineList />}
      {active === "Batches" && <BatchList />}
      {active === "Warehouses" && <WarehouseList />}
    </div>
  );
}

function WarehouseList() {
  const [data, setData] = useState<any[]>([]);
  return (
    <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">
      Warehouse management coming soon. Use{" "}
      <code className="bg-muted px-1 rounded">GET /api/v1/inventory/warehouses</code> to manage warehouses via API.
    </div>
  );
}
