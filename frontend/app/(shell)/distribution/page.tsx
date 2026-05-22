"use client";

import { useState } from "react";
import { TransfersView } from "@/components/modules/distribution/transfers-view";
import { Truck } from "lucide-react";

export default function DistributionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
          <Truck className="w-6 h-6 text-emerald-600" />
          Distribution & Stock Transfers
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage inter-branch stock transfers, approve dispatch, and confirm deliveries.
        </p>
      </div>
      <TransfersView />
    </div>
  );
}
