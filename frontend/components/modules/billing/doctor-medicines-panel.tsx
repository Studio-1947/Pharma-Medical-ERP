"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Pill,
  AlertCircle,
  Plus,
  ArrowLeft,
  Stethoscope,
  PackageX,
  Loader2,
} from "lucide-react";
import { useDoctorMedicines } from "@/queries/clinic.queries";
import { formatStockUnit } from "@/lib/stock-unit-formatter";

/** Schedule classes that cannot leave the counter without a verified Rx. */
const CONTROLLED = ["H", "H1", "X"];

/**
 * The catalogue stores bare schedule letters ("H", "H1", "OTC"), while parts of
 * the cart layer use the "SCHEDULE_H" spelling. Normalising both ways here
 * keeps the badge honest whichever form a row arrives in.
 */
export function normalizeSchedule(raw?: string | null): string | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/^SCHEDULE[_\s-]?/, "");
  return s && s !== "NA" ? s : null;
}

/** True when the row may not be dispensed without a prescription on record. */
export function isControlledRow(m: {
  scheduleClass?: string | null;
  requiresPrescription?: boolean;
}): boolean {
  const s = normalizeSchedule(m.scheduleClass);
  return !!m.requiresPrescription || (!!s && CONTROLLED.includes(s));
}

export interface DoctorMedicineRow {
  id: string;
  medicineId: string;
  name: string;
  brandName?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  sku: string;
  manufacturer?: string | null;
  unit?: string | null;
  stripSize?: number | null;
  priceMrp: string;
  taxPercent?: string | null;
  requiresPrescription?: boolean;
  scheduleClass?: string | null;
  drawerMapping?: string | null;
  defaultDosage?: string | null;
  defaultFrequency?: string | null;
  defaultDuration?: string | null;
  defaultQuantity?: number | null;
  notes?: string | null;
  totalStock?: number | string;
}

interface Props {
  doctor: any;
  branchId?: string;
  /** Adds the medicine to the counter bill. Undefined renders a read-only list. */
  onAdd?: (row: DoctorMedicineRow) => void | Promise<void>;
  /** Medicine currently being added, so its row can show a spinner. */
  addingId?: string | null;
  onBack: () => void;
}

/**
 * The medicines a doctor keeps on their list, as seen from the counter.
 *
 * Read-only here on purpose: the counter reads a doctor's list to find what
 * they work with quickly, but curating it belongs to the doctor (or an admin
 * or shop manager) in the doctor panel, not mid-sale.
 *
 * Adding a row puts it in the cart exactly as the OTC search would, which means
 * Schedule H/H1/X items stay subject to the prescription check the POS runs at
 * checkout — being on a doctor's list is not a prescription. Rows carry a
 * warning badge so the counter knows before adding rather than at payment.
 */
export function DoctorMedicinesPanel({
  doctor,
  branchId,
  onAdd,
  addingId,
  onBack,
}: Props) {
  const [search, setSearch] = useState("");
  const doctorId: string | null = doctor?.id ?? null;
  const { data: raw, isLoading, isError } = useDoctorMedicines(doctorId, branchId);

  const rows: DoctorMedicineRow[] = useMemo(() => {
    const r = raw as any;
    if (Array.isArray(r?.data)) return r.data;
    if (Array.isArray(r?.data?.data)) return r.data.data;
    return [];
  }, [raw]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) =>
      [m.name, m.brandName, m.genericName, m.sku]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const doctorName =
    [doctor?.firstName, doctor?.lastName].filter(Boolean).join(" ") ||
    doctor?.email ||
    "Doctor";
  const specialty = doctor?.doctorProfile?.specialty ?? "General Medicine";

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-sm shrink-0">
            {doctorName.replace("Dr. ", "").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">
              {doctorName}
            </p>
            <p className="text-xs text-slate-400 truncate">
              {specialty} · {rows.length} medicine{rows.length === 1 ? "" : "s"} listed
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0"
        >
          <ArrowLeft size={13} /> All doctors
        </button>
      </div>

      {rows.length > 6 && (
        <div className="relative mb-3">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter this doctor's medicines…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-purple-400 focus:outline-none"
          />
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center">
          <Loader2 size={22} className="mx-auto text-slate-300 animate-spin" />
          <p className="mt-2 text-xs text-slate-400">Loading the list…</p>
        </div>
      ) : isError ? (
        <div className="py-10 text-center">
          <AlertCircle size={26} className="mx-auto text-red-300" />
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Could not load this doctor&apos;s medicines
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Check the connection and try again.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <Stethoscope size={26} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {rows.length === 0
              ? "No medicines listed for this doctor yet"
              : "Nothing matches that filter"}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {rows.length === 0
              ? "The doctor can build the list from their panel, or import it from their prescription history."
              : "Try a different name or SKU."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((m) => {
            const stock = Number(m.totalStock ?? 0);
            const outOfStock = stock <= 0;
            const controlled = isControlledRow(m);
            const schedule = normalizeSchedule(m.scheduleClass);
            const busy = addingId === m.medicineId;

            return (
              <div
                key={m.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 hover:border-purple-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {m.name}
                        {m.strength ? (
                          <span className="text-slate-500 font-semibold">
                            {" "}
                            {m.strength}
                          </span>
                        ) : null}
                      </p>
                      {controlled && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">
                          <AlertCircle size={10} />
                          {schedule ? `Schedule ${schedule}` : "Rx"} — Rx needed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {[m.brandName, m.genericName, m.manufacturer]
                        .filter(Boolean)
                        .join(" · ") || m.sku}
                    </p>

                    {(m.defaultDosage || m.defaultFrequency || m.defaultDuration) && (
                      <p className="text-[11px] text-purple-600 font-semibold mt-1">
                        Usual:{" "}
                        {[m.defaultDosage, m.defaultFrequency, m.defaultDuration]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {m.notes && (
                      <p className="text-[11px] text-slate-400 italic mt-0.5 truncate">
                        {m.notes}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5">
                      <span
                        className={`text-[11px] font-bold ${
                          outOfStock ? "text-red-500" : "text-emerald-600"
                        }`}
                      >
                        {outOfStock ? (
                          <span className="inline-flex items-center gap-1">
                            <PackageX size={11} /> Out of stock
                          </span>
                        ) : (
                          formatStockUnit(stock, m)
                        )}
                      </span>
                      {m.drawerMapping && (
                        <span className="text-[11px] text-slate-400 font-medium">
                          Drawer {m.drawerMapping}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-slate-900">
                      ₹{Number(m.priceMrp).toFixed(2)}
                    </p>
                    {onAdd && (
                      <button
                        type="button"
                        disabled={outOfStock || busy}
                        onClick={() => onAdd(m)}
                        title={
                          outOfStock
                            ? "No stock at this branch"
                            : "Add to the bill"
                        }
                        className="mt-2 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
                      >
                        {busy ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Adding
                          </>
                        ) : (
                          <>
                            <Plus size={12} />
                            Add
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && onAdd && (
        <p className="mt-3 text-[11px] text-slate-400 flex items-start gap-1.5">
          <Pill size={12} className="mt-0.5 shrink-0" />
          Adding a medicine here fills the bill only. Schedule H, H1 and X items
          still need a verified prescription before the POS will take payment.
        </p>
      )}
    </div>
  );
}
