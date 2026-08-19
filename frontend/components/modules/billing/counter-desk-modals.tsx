"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  FileText,
  Phone,
  Stethoscope,
  Ticket,
  ArrowRight,
  Clock,
  Loader2,
  Users,
  PackageX,
  Pill,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { localDateString } from "@/lib/date";
import { Modal } from "@/components/ui/modal";
import { MedicineStockModal } from "@/components/modules/inventory/medicine-stock-modal";
import { PrescriptionDetailModal } from "@/components/modules/prescriptions/prescription-detail-modal";

/**
 * Stat-card drill-downs for the counter desk.
 *
 * Each stat card on the desk opens a modal instead of navigating away to a
 * separate page, so the counter staff never leaves the desk. The modals reuse
 * the existing detail views (medicine stock, prescription detail) for the
 * deeper drill-down.
 */
export type DeskModalView =
  | "low-stock"
  | "rx-today"
  | "otc-today"
  | "patients-visited"
  | "ongoing"
  | "next"
  | null;

function unwrap<T>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (Array.isArray(raw?.data?.data)) return raw.data.data as T[];
  if (Array.isArray(raw?.data)) return raw.data as T[];
  return [];
}

function PatientRow({ name, phone }: { name: string; phone?: string }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0 border border-slate-200">
        {(name ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{name || "—"}</p>
        {phone && (
          <p className="text-xs text-slate-400 font-mono flex items-center gap-1">
            <Phone size={10} /> {phone}
          </p>
        )}
      </div>
    </div>
  );
}

export function CounterDeskModals({
  view,
  onClose,
}: {
  view: DeskModalView;
  onClose: () => void;
}) {
  const { branchId: activeBranchId } = useActiveBranchId();
  const today = localDateString();
  const branchParams = activeBranchId ? { branchId: activeBranchId } : {};

  // Low-stock medicines — drives both the count and the drill-down list.
  const { data: lowStockRaw, isFetching: lowStockLoading } = useQuery({
    queryKey: ["counter-low-stock", activeBranchId],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock", { params: branchParams }) as any,
    enabled: view === "low-stock",
    retry: 1,
  });
  const lowStock: any[] = unwrap(lowStockRaw);

  // OTC supplies today (count + units from the ledger).
  const { data: otcRaw, isFetching: otcLoading } = useQuery({
    queryKey: ["counter-otc-today", today, activeBranchId],
    queryFn: () =>
      apiClient.get("/inventory/medicines/otc-supplies", {
        params: { date: today, ...branchParams },
      }) as any,
    enabled: view === "otc-today",
    retry: 1,
  });
  const otcSummary: { supplies: number; units: number; records: any[] } = (() => {
    const raw = otcRaw as any;
    const d = raw?.data ?? raw;
    return {
      supplies: Number(d?.supplies ?? 0),
      units: Number(d?.units ?? 0),
      records: Array.isArray(d?.records) ? d.records : [],
    };
  })();

  // Prescriptions created today.
  const { data: rxRaw, isFetching: rxLoading } = useQuery({
    queryKey: ["counter-rx-today", activeBranchId],
    queryFn: () =>
      apiClient.get("/prescriptions", {
        params: { ...branchParams, limit: 100 },
      }) as any,
    enabled: view === "rx-today",
    retry: 1,
  });
  const rxRows: any[] = unwrap(rxRaw).filter((r: any) => {
    const d = r?.createdAt ?? r?.issuedDate;
    return d ? String(d).slice(0, 10) === today : false;
  });

  // Today's clinic queue — patients visited by doctors, ongoing, next.
  const { data: queueRaw, isFetching: queueLoading } = useQuery({
    queryKey: ["counter-clinic-queue", today, activeBranchId],
    queryFn: () =>
      apiClient.get("/clinic/tokens", {
        params: { date: today, ...branchParams, limit: 100 },
      }) as any,
    enabled:
      view === "patients-visited" || view === "ongoing" || view === "next",
    retry: 1,
  });
  const queueRows: any[] = unwrap(queueRaw);
  const docDisplay = (t: any) => {
    const d = t?.doctor;
    if (!d) return t?.doctorName ?? "—";
    return [d.firstName, d.lastName].filter(Boolean).join(" ") || d.email || "Doctor";
  };

  const [stockTarget, setStockTarget] = useState<{ id: string; name: string } | null>(null);
  const [rxTarget, setRxTarget] = useState<string | null>(null);

  const open = !!view;

  return (
    <>
      {/* Low-stock medicines */}
      <Modal
        title="Low-stock medicines"
        subtitle="Medicines at or below their reorder level — click any row for batch details"
        icon={<PackageX size={16} />}
        open={open && view === "low-stock"}
        onClose={onClose}
        size="lg"
      >
        {lowStockLoading ? (
          <Loading />
        ) : lowStock.length === 0 ? (
          <Empty text="No medicines are low on stock right now." />
        ) : (
          <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
            {lowStock.map((m: any) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setStockTarget({ id: m.id, name: m.name ?? "Medicine" })}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-orange-50/60 transition-colors text-left group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{m.name ?? "—"}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {m.sku ? `${m.sku} · ` : ""}Reorder at {m.reorderLevel ?? 0}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                    {m.totalStock ?? 0} left
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-orange-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    View <ArrowRight size={13} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Prescriptions filled today */}
      <Modal
        title="Prescriptions filled today"
        subtitle={`${rxRows.length} prescription${rxRows.length === 1 ? "" : "s"} recorded today`}
        icon={<FileText size={16} />}
        open={open && view === "rx-today"}
        onClose={onClose}
        size="lg"
      >
        {rxLoading ? (
          <Loading />
        ) : rxRows.length === 0 ? (
          <Empty text="No prescriptions were recorded today." />
        ) : (
          <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
            {rxRows.map((rx: any) => (
              <button
                key={rx.id}
                type="button"
                onClick={() => setRxTarget(rx.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-emerald-50/50 transition-colors text-left group"
              >
                <PatientRow
                  name={rx.patient?.name ?? rx.patientName ?? "—"}
                  phone={rx.patient?.phone}
                />
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-400">
                    {rx.doctorName ? `Dr. ${rx.doctorName}` : ""}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                      rx.status === "verified"
                        ? "bg-green-100 text-green-700"
                        : rx.status === "fully_dispensed"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {(rx.status ?? "").replace(/_/g, " ")}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    View <ArrowRight size={13} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}      </Modal>

      {/* Free hand-outs today — billed OTC sales are ordinary invoices and
          appear in the sales figures instead. */}
      <Modal
        title="Free hand-outs today (no bill)"
        subtitle={`${otcSummary.supplies} record${otcSummary.supplies === 1 ? "" : "s"} · ${otcSummary.units} unit${otcSummary.units === 1 ? "" : "s"} given free — paid OTC sales are billed and counted under sales`}
        icon={<Pill size={16} />}
        open={open && view === "otc-today"}
        onClose={onClose}
        size="md"
      >
        {otcLoading ? (
          <Loading />
        ) : otcSummary.supplies === 0 ? (
          <Empty text="Nothing was given away free today. Free samples and staff medicine are recorded from the OTC sale button on the desk, under &ldquo;Free — no charge&rdquo;; paid OTC sales are billed and show under sales." />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 px-5 pt-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-center">
                <p className="text-2xl font-black text-emerald-700">{otcSummary.supplies}</p>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Free hand-outs</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-center">
                <p className="text-2xl font-black text-emerald-700">{otcSummary.units}</p>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Units given free</p>
              </div>
            </div>

            {/* Per-supply records from the stock ledger */}
            <div className="border-t border-slate-100">
              <p className="px-5 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Records today ({otcSummary.records.length})
              </p>
              <div className="divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
                {otcSummary.records.map((r: any) => (
                  <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {r.medicineName ?? "Medicine"}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">
                        {r.batchNo ? `Batch ${r.batchNo}` : ""}
                        {r.performedByName ? ` · ${r.performedByName}` : ""}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-slate-400">
                        {r.createdAt
                          ? new Date(r.createdAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[11px] font-extrabold">
                        {r.quantity} unit{r.quantity === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="px-5 pb-4 text-[11px] text-slate-400 leading-relaxed">
              Stock-ledger movements of type <strong>otc_supply</strong> — medicine
              given away without payment (free samples, staff medicine). No invoice
              is generated, so none of this reaches the day-end takings; each
              hand-out stays traceable through the ledger. A paid OTC sale is
              billed instead and appears in the sales figures and the GST return.
            </p>
          </div>
        )}
      </Modal>

      {/* Patients visited by doctors */}
      <Modal
        title="Patients visited by doctors"
        subtitle="Distinct patients on called or completed consultations today"
        icon={<Stethoscope size={16} />}
        open={open && view === "patients-visited"}
        onClose={onClose}
        size="md"
      >
        {queueLoading ? (
          <Loading />
        ) : (
          <VisitedList rows={queueRows} docDisplay={docDisplay} />
        )}
      </Modal>

      {/* Ongoing consultation */}
      <Modal
        title="Ongoing consultation"
        subtitle="The patient currently in the doctor's room"
        icon={<Clock size={16} />}
        open={open && view === "ongoing"}
        onClose={onClose}
        size="md"
      >
        {queueLoading ? (
          <Loading />
        ) : (
          <TokenDetail rows={queueRows} token="called" docDisplay={docDisplay} />
        )}
      </Modal>

      {/* Next appointment */}
      <Modal
        title="Next appointment"
        subtitle="The next patient waiting in the queue"
        icon={<Ticket size={16} />}
        open={open && view === "next"}
        onClose={onClose}
        size="md"
      >
        {queueLoading ? (
          <Loading />
        ) : (
          <TokenDetail rows={queueRows} token="pending" docDisplay={docDisplay} />
        )}
      </Modal>

      {/* Deeper drill-downs reuse the existing detail modals */}
      {stockTarget && (
        <MedicineStockModal
          open={!!stockTarget}
          onClose={() => setStockTarget(null)}
          medicineId={stockTarget.id}
          medicineName={stockTarget.name}
        />
      )}
      {rxTarget && (
        <PrescriptionDetailModal
          prescriptionId={rxTarget}
          onClose={() => setRxTarget(null)}
        />
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-slate-400 text-sm">
      <Loader2 className="animate-spin" size={20} />
      <span className="text-xs">Loading…</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-12 text-center">
      <AlertTriangle size={22} className="mx-auto text-slate-300" />
      <p className="mt-2 text-sm font-semibold text-slate-600">{text}</p>
    </div>
  );
}

function VisitedList({ rows, docDisplay }: { rows: any[]; docDisplay: (t: any) => string }) {
  const visited = rows.filter((t: any) => t.status === "called" || t.status === "completed");
  const seen = new Set<string>();
  const uniq: any[] = [];
  for (const t of visited) {
    const pid = t.patientId ?? t.patient?.id;
    if (pid && seen.has(pid)) continue;
    if (pid) seen.add(pid);
    uniq.push(t);
  }
  if (uniq.length === 0) {
    return <Empty text="No patient has been called in for a consultation today." />;
  }
  return (
    <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
      {uniq.map((t: any, i: number) => (
        <div key={t.id ?? i} className="flex items-center justify-between gap-3 px-4 py-3">
          <PatientRow name={t.patient?.name ?? "—"} phone={t.patient?.phone} />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-400">{docDisplay(t)}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
              Token {t.tokenNo}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TokenDetail({
  rows,
  token,
  docDisplay,
}: {
  rows: any[];
  token: "called" | "pending";
  docDisplay: (t: any) => string;
}) {
  const t = rows.find((r: any) => r.status === token) ?? null;
  if (!t) {
    return (
      <Empty
        text={
          token === "called"
            ? "No consultation is ongoing right now."
            : "No patient is waiting in the queue."
        }
      />
    );
  }
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
        <PatientRow name={t.patient?.name ?? "—"} phone={t.patient?.phone} />
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[11px] font-bold shrink-0">
          <Ticket size={11} /> Token {t.tokenNo}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Doctor</p>
          <p className="mt-1 font-bold text-slate-800 flex items-center gap-1.5">
            <Users size={12} className="text-purple-600" /> {docDisplay(t)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {token === "called" ? "Started" : "Time slot"}
          </p>
          <p className="mt-1 font-bold text-slate-800">
            {t.timeSlot ?? (t.calledAt ? new Date(t.calledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—")}
          </p>
        </div>
      </div>
      {t.visitType && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold capitalize">
            {t.visitType.replace(/_/g, " ")} visit
          </span>
        </div>
      )}
    </div>
  );
}
