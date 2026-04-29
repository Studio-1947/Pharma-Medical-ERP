"use client";
import { PosTerminal } from "@/components/modules/billing/pos-terminal";

export default function PosPage() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Point of Sale</h2>
      <PosTerminal />
    </div>
  );
}
