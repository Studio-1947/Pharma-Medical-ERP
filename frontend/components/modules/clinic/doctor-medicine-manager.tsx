"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Pill,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  useDoctorMedicines,
  useAddDoctorMedicine,
  useUpdateDoctorMedicine,
  useRemoveDoctorMedicine,
  useImportDoctorMedicines,
} from "@/queries/clinic.queries";
import {
  MedicineAutocomplete,
  type MedicineOption,
} from "@/components/modules/prescriptions/medicine-autocomplete";
import { useToast } from "@/components/ui/toast";
import {
  isControlledRow,
  normalizeSchedule,
} from "@/components/modules/billing/doctor-medicines-panel";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Whose list is being edited. */
  doctorId: string;
  doctorName: string;
  branchId?: string;
  /**
   * False for a viewer who may read but not curate — a counter user looking at
   * someone else's list. The API enforces this too; this only hides controls
   * that would fail.
   */
  canEdit?: boolean;
}

/**
 * Builds and maintains a doctor's medicine list.
 *
 * The list is a shortcut, not a formulary of record: every entry points at a
 * catalogue medicine a store manager already seeded through Inventory, and
 * nothing in here can create one. Removing an entry is a soft delete, so
 * re-adding the same medicine later revives the original row.
 *
 * "Import from history" exists because hand-building a list for every doctor is
 * work nobody does. It reads what the doctor has actually prescribed through
 * the clinic queue, is additive, and skips anything already listed — so running
 * it twice changes nothing and never overwrites a hand-edited dosage.
 */
export function DoctorMedicineManager({
  open,
  onClose,
  doctorId,
  doctorName,
  branchId,
  canEdit = true,
}: Props) {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();

  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<MedicineOption | null>(null);
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");

  const { data: raw, isLoading } = useDoctorMedicines(
    open ? doctorId : null,
    branchId,
  );
  const rows: any[] = useMemo(() => {
    const r = raw as any;
    if (Array.isArray(r?.data)) return r.data;
    if (Array.isArray(r?.data?.data)) return r.data.data;
    return [];
  }, [raw]);

  const addMutation = useAddDoctorMedicine(doctorId);
  const updateMutation = useUpdateDoctorMedicine(doctorId);
  const removeMutation = useRemoveDoctorMedicine(doctorId);
  const importMutation = useImportDoctorMedicines(doctorId);

  if (!open) return null;

  const resetForm = () => {
    setPicked(null);
    setSearch("");
    setDosage("");
    setFrequency("");
    setDuration("");
  };

  const handleAdd = async () => {
    if (!picked) {
      toastInfo("Pick a medicine", "Search the catalogue and select a medicine first.");
      return;
    }
    try {
      await addMutation.mutateAsync({
        medicineId: picked.id,
        defaultDosage: dosage.trim() || null,
        defaultFrequency: frequency.trim() || null,
        defaultDuration: duration.trim() || null,
      });
      toastSuccess(`${picked.name} added`, "It is now on the list.");
      resetForm();
    } catch (e: any) {
      toastError(
        "Could not add the medicine",
        e?.response?.data?.message ?? "Try again.",
      );
    }
  };

  const handleRemove = async (row: any) => {
    try {
      await removeMutation.mutateAsync(row.id);
      toastSuccess(`${row.name} removed`, "It is off the list.");
    } catch {
      toastError("Could not remove", "Try again.");
    }
  };

  /**
   * Swaps sortOrder with the neighbour. Two writes rather than one bulk
   * reorder: the list is a handful of rows, and a swap cannot leave a gap the
   * way reindexing the whole list on a failed request would.
   */
  const move = async (index: number, direction: -1 | 1) => {
    const target = rows[index + direction];
    const current = rows[index];
    if (!target || !current) return;
    try {
      await Promise.all([
        updateMutation.mutateAsync({
          itemId: current.id,
          sortOrder: target.sortOrder,
        }),
        updateMutation.mutateAsync({
          itemId: target.id,
          sortOrder: current.sortOrder,
        }),
      ]);
    } catch {
      toastError("Could not reorder", "Try again.");
    }
  };

  const handleImport = async () => {
    try {
      const res: any = await importMutation.mutateAsync(20);
      const imported = res?.data?.imported ?? 0;
      if (imported > 0) {
        toastSuccess(
          `Imported ${imported} medicine${imported === 1 ? "" : "s"}`,
          "Pulled from consultations this doctor has prescribed for.",
        );
      } else {
        toastInfo(
          "Nothing new to import",
          res?.message ??
            "Everything from the prescription history is already listed.",
        );
      }
    } catch {
      toastError("Import failed", "Could not read the prescription history.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-xl border max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Pill size={17} className="text-emerald-600 shrink-0" />
              <span className="truncate">Medicine list — {doctorName}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rows.length} listed. The counter desk sees this when it opens this
              doctor.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {canEdit && (
            <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Add a medicine
                </p>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importMutation.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 transition-colors"
                >
                  {importMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  Import from history
                </button>
              </div>

              <MedicineAutocomplete
                value={search}
                onChange={(t) => {
                  setSearch(t);
                  if (picked) setPicked(null);
                }}
                onSelect={(m) => {
                  setPicked(m);
                  setSearch(m.name);
                }}
                linked={!!picked}
                branchId={branchId}
                placeholder="Search the catalogue by name, brand or SKU…"
              />

              <div className="grid grid-cols-3 gap-2">
                <input
                  value={dosage}
                  onChange={(e) => setDosage(e.target.value)}
                  placeholder="Dosage (1-0-1)"
                  className="px-2.5 py-2 text-sm rounded-lg border bg-background"
                />
                <input
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  placeholder="Frequency"
                  className="px-2.5 py-2 text-sm rounded-lg border bg-background"
                />
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="Duration (5 days)"
                  className="px-2.5 py-2 text-sm rounded-lg border bg-background"
                />
              </div>

              <button
                type="button"
                onClick={handleAdd}
                disabled={!picked || addMutation.isPending}
                className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground transition-colors"
              >
                {addMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Add to list
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center">
              <Loader2 size={20} className="mx-auto animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center">
              <Pill size={26} className="mx-auto text-muted-foreground/40" />
              <p className="mt-2 text-sm font-semibold">Nothing on the list yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {canEdit
                  ? "Add medicines above, or import them from past consultations in one click."
                  : "This doctor has not built their list yet."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((m: any, i: number) => (
                <SwipeableMedicineRow
                  key={m.id}
                  onDelete={() => handleRemove(m)}
                  disabled={removeMutation.isPending}
                  canEdit={canEdit}
                >
                  <div className="flex items-center gap-2">
                  {canEdit && (
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || updateMutation.isPending}
                        className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === rows.length - 1 || updateMutation.isPending}
                        className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold truncate">
                        {m.name}
                        {m.strength ? (
                          <span className="text-muted-foreground font-semibold">
                            {" "}
                            {m.strength}
                          </span>
                        ) : null}
                      </p>
                      {isControlledRow(m) && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">
                          <AlertCircle size={10} />
                          {normalizeSchedule(m.scheduleClass) ?? "Rx"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[m.brandName, m.genericName].filter(Boolean).join(" · ") ||
                        m.sku}
                    </p>
                    {(m.defaultDosage || m.defaultFrequency || m.defaultDuration) && (
                      <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                        {[m.defaultDosage, m.defaultFrequency, m.defaultDuration]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleRemove(m)}
                      disabled={removeMutation.isPending}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 shrink-0 hidden md:flex"
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  </div>
                </SwipeableMedicineRow>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t shrink-0 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Being on this list is not a prescription — Schedule H items still
            need one to be dispensed.
          </p>
          <button
            onClick={onClose}
            className="text-sm font-semibold px-4 py-2 rounded-lg border hover:bg-muted shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Swipe-to-delete (mobile only) ─────────────────────────────────────────
 *
 * On touch devices a left-swipe reveals a red "Delete" zone behind the
 * medicine row. On desktop the wrapper is a transparent passthrough — the
 * trash button inside the row handles deletion.
 *
 * Threshold: 80 px of leftward drag. Releasing past it triggers onDelete;
 * releasing before it snaps back.
 */
const SWIPE_THRESHOLD = 80;

function SwipeableMedicineRow({
  onDelete,
  disabled,
  canEdit,
  children,
}: {
  onDelete: () => void;
  disabled?: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canEdit || disabled) return;
    startX.current = e.touches[0]!.clientX;
    tracking.current = true;
  }, [canEdit, disabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!tracking.current) return;
    const dx = e.touches[0]!.clientX - startX.current;
    const clamped = Math.min(0, Math.max(-(SWIPE_THRESHOLD + 20), dx));
    setOffset(clamped);
  }, []);

  const onTouchEnd = useCallback(() => {
    tracking.current = false;
    if (offset < -SWIPE_THRESHOLD) {
      onDelete();
    }
    setOffset(0);
  }, [offset, onDelete]);

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ touchAction: "pan-y" }}>
      {/* Red delete zone revealed behind the content */}
      {canEdit && (
        <div
          className="absolute inset-y-0 right-0 flex items-center gap-1.5 px-3 bg-red-500 text-white text-xs font-bold rounded-r-xl"
          style={{ width: SWIPE_THRESHOLD }}
          aria-hidden="true"
        >
          <Trash2 size={14} />
        </div>
      )}
      {/* Draggable content */}
      <div
        data-testid="swipeable-row"
        className="relative z-10 bg-background border rounded-xl p-2.5"
        style={{
          transform: `translateX(${offset}px)`,
          transition: tracking.current ? "none" : "transform 200ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
