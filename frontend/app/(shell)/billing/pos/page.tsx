"use client";

import { Suspense } from "react";
import { PosTerminal } from "@/components/modules/billing/pos-terminal";

export default function PosPage() {
  return (
    <div className="w-full">
      <Suspense
        fallback={
          <div className="p-8 text-sm text-slate-500 animate-pulse">Loading Point of Sale…</div>
        }
      >
        <PosTerminal />
      </Suspense>
    </div>
  );
}
