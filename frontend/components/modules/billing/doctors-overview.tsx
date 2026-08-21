"use client";

import { Loader2, Pill, Stethoscope, AlertCircle, Plus } from "lucide-react";
import { useDoctorMedicines } from "@/queries/clinic.queries";
import {
  isControlledRow,
  normalizeSchedule,
  type DoctorMedicineRow,
} from "@/components/modules/billing/doctor-medicines-panel";

interface Doctor {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  doctorProfile?: {
    specialty?: string | null;
    consultationFee?: number | null;
    opdRoom?: string | null;
  } | null;
}

interface Props {
  doctors: Doctor[];
  branchId?: string;
  /** Adds the medicine to the counter bill. When absent the chips are read-only. */
  onAddMedicine?: (row: DoctorMedicineRow) => void | Promise<void>;
  /** Medicine currently being added — its chip shows a spinner. */
  addingId?: string | null;
  /** Open the full per-doctor panel (existing DoctorMedicinesPanel flow). */
  onOpenDoctor?: (doctor: Doctor) => void;
  /** Open the medicine manager so the operator can curate this doctor's list. */
  onManageMedicines?: (doctor: Doctor) => void;
}

/**
 * A read-at-a-glance grid of every doctor available today with the medicines
 * they usually prescribe shown inline as chips. Rendered above the path
 * picker on the counter so the operator can jump straight from "who's on"
 * to "what they usually want" without drilling into any menu.
 *
 * Each card fires its own useDoctorMedicines query. That's N requests for N
 * doctors, which is fine at a clinic-sized N (typically < 6). If we ever
 * outgrow that we should introduce a bulk endpoint rather than batching on
 * the client.
 */
export function DoctorsOverview({
  doctors,
  branchId,
  onAddMedicine,
  addingId,
  onOpenDoctor,
  onManageMedicines,
}: Props) {
  if (doctors.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <Stethoscope size={13} className="text-purple-600" />
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Doctors today &amp; their usual medicines ({doctors.length})
        </p>
      </div>

      {/* Bounded scroll so the pane keeps its footprint no matter how many
          doctors are on today. Cards themselves stay compact — the operator
          reads at a glance, drills into a doctor's full list via "Open list". */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-1">
        {doctors.map((doc) => (
          <DoctorOverviewCard
            key={doc.id}
            doctor={doc}
            branchId={branchId}
            onAddMedicine={onAddMedicine}
            addingId={addingId}
            onOpenDoctor={onOpenDoctor}
            onManageMedicines={onManageMedicines}
          />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  doctor: Doctor;
  branchId?: string;
  onAddMedicine?: (row: DoctorMedicineRow) => void | Promise<void>;
  addingId?: string | null;
  onOpenDoctor?: (doctor: Doctor) => void;
  onManageMedicines?: (doctor: Doctor) => void;
}

function DoctorOverviewCard({
  doctor,
  branchId,
  onAddMedicine,
  addingId,
  onOpenDoctor,
  onManageMedicines,
}: CardProps) {
  const { data: raw, isLoading, isError } = useDoctorMedicines(
    doctor.id,
    branchId,
  );

  const rows: DoctorMedicineRow[] = (() => {
    const r = raw as any;
    if (Array.isArray(r?.data)) return r.data;
    if (Array.isArray(r?.data?.data)) return r.data.data;
    return [];
  })();

  // Six chips is what fits on one row on a typical 1280px counter screen
  // without wrapping onto a second line. The rest are reachable via the
  // "see full list" affordance so nothing is hidden.
  const shown = rows.slice(0, 6);
  const remaining = Math.max(0, rows.length - shown.length);

  const name =
    [doctor.firstName, doctor.lastName].filter(Boolean).join(" ") ||
    doctor.email ||
    "Doctor";
  const specialty = doctor.doctorProfile?.specialty ?? "General Medicine";
  const opdRoom = doctor.doctorProfile?.opdRoom ?? "OPD";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 hover:border-purple-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs shrink-0">
            {name.replace("Dr. ", "").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {specialty} · {opdRoom}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isLoading && rows.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-purple-100 text-purple-700 border border-purple-200">
              #{rows.length}
            </span>
          )}
          {onOpenDoctor && rows.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenDoctor(doctor)}
              className="text-[11px] font-semibold text-purple-600 hover:text-purple-800"
            >
              Open list
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 min-h-[38px]">
        {isLoading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 size={11} className="animate-spin" />
            Loading list…
          </div>
        ) : isError ? (
          <div className="flex items-center gap-1.5 text-[11px] text-red-500">
            <AlertCircle size={11} />
            Could not load
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Pill size={11} />
              No medicines listed yet
            </div>
            {onManageMedicines && (
              <button
                type="button"
                onClick={() => onManageMedicines(doctor)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors"
              >
                <Plus size={10} />
                Add medicine
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((m) => (
              <MedicineChip
                key={m.id}
                med={m}
                busy={addingId === m.medicineId}
                onAdd={onAddMedicine}
              />
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => onOpenDoctor?.(doctor)}
                className="inline-flex items-center px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                +{remaining} more
              </button>
            )}
            {onManageMedicines && (
              <button
                type="button"
                onClick={() => onManageMedicines(doctor)}
                className="inline-flex items-center px-2 py-1 text-[11px] font-bold rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors"
                title="Add or remove medicines for this doctor"
              >
                <Plus size={10} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MedicineChip({
  med,
  busy,
  onAdd,
}: {
  med: DoctorMedicineRow;
  busy: boolean;
  onAdd?: (row: DoctorMedicineRow) => void | Promise<void>;
}) {
  const stock = Number(med.totalStock ?? 0);
  const outOfStock = stock <= 0;
  const controlled = isControlledRow(med);
  const schedule = normalizeSchedule(med.scheduleClass);

  const label = med.strength ? `${med.name} ${med.strength}` : med.name;
  const tooltip = [
    label,
    med.defaultDosage && `Usual: ${med.defaultDosage}`,
    controlled && `Schedule ${schedule ?? "Rx"} — Rx required at checkout`,
    outOfStock && "Out of stock at this branch",
  ]
    .filter(Boolean)
    .join(" · ");

  const disabled = !onAdd || outOfStock || busy;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAdd?.(med)}
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg border transition-colors ${
        outOfStock
          ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
          : controlled
          ? "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
          : "border-purple-100 bg-purple-50 text-purple-700 hover:bg-purple-100"
      } disabled:opacity-70`}
    >
      {busy && <Loader2 size={10} className="animate-spin" />}
      <span className="truncate max-w-[160px]">{label}</span>
      {controlled && (
        <span className="text-[9px] font-black uppercase tracking-wide">
          Rx
        </span>
      )}
    </button>
  );
}
