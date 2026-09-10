"use client";

import { Pill } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { scheduleLabel } from "@/lib/schedule-class";
import { OtcCounterSale, type OtcMedicine } from "./otc-counter-sale";

/**
 * The OTC counter sale in a dialog, for screens that have no room to give it —
 * the POS terminal opens it over the till.
 *
 * Used by both the counter desk and classic POS. The counter desk opens it from
 * the medicine row so the operator can match the physical pack to its batch
 * before that batch and its own price are added to the bill.
 */
export function OtcSupplyModal({
  medicine,
  onClose,
}: {
  medicine: OtcMedicine | null;
  onClose: () => void;
}) {
  // Titled from the medicine the till opened it with. Anything added inside
  // announces its own schedule on its line and in the prescription gate.
  const schedule = scheduleLabel(medicine?.scheduleClass);
  const controlled = !!medicine?.requiresPrescription || !!schedule;

  return (
    <Modal
      title={
        controlled
          ? `${schedule ?? "Prescription"} Sale — Prescription Required`
          : "OTC Sale — No Prescription"
      }
      subtitle={`${medicine?.name ?? "Medicine"}${medicine?.sku ? ` · ${medicine.sku}` : ""}`}
      icon={<Pill size={16} />}
      open={!!medicine}
      onClose={onClose}
      size="2xl"
    >
      <OtcCounterSale medicine={medicine} onClose={onClose} variant="modal" />
    </Modal>
  );
}
