"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, FileImage, Loader2, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { apiClient } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { canSellLooseUnits, getLooseUnitLabel, getUnitLabel } from "@/lib/stock-unit-formatter";
import { parseSupplierInvoiceText, SupplierInvoiceRow } from "@/lib/supplier-invoice-parser";
import { invalidateMedicineViews } from "@/lib/query-invalidation";

type MedicineMatch = {
  id: string;
  name: string;
  dosageForm?: string | null;
  unit?: string | null;
  stripSize?: number | string | null;
};

type DraftRow = SupplierInvoiceRow & {
  id: string;
  medicine: MedicineMatch | null;
  matches: MedicineMatch[];
  status?: "saved" | "error";
  error?: string;
};

function listFrom(response: any): MedicineMatch[] {
  const value = response?.data?.data ?? response?.data ?? response;
  return Array.isArray(value) ? value : [];
}

export function SupplierInvoiceReceiveModal({ open, onClose, onComplete }: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { branchId, needsSelection } = useActiveBranchId();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [rawText, setRawText] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function matchRows(parsed: SupplierInvoiceRow[]) {
    return Promise.all(parsed.map(async (row, index) => {
      try {
        const response = await apiClient.get("/inventory/medicines", {
          params: { search: row.productName, limit: 5, isActive: "all" },
        });
        const matches = listFrom(response);
        return { ...row, id: `${Date.now()}-${index}`, matches, medicine: matches[0] ?? null };
      } catch {
        return { ...row, id: `${Date.now()}-${index}`, matches: [], medicine: null };
      }
    }));
  }

  async function extract(file: File) {
    setBusy(true);
    setMessage("Reading invoice image. This can take up to a minute on the first scan...");
    setProgress(0);
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(file, "eng", {
        logger: (event) => {
          if (event.status === "recognizing text") setProgress(Math.round((event.progress ?? 0) * 100));
        },
      });
      setRawText(result.data.text);
      const parsed = parseSupplierInvoiceText(result.data.text);
      setRows(await matchRows(parsed));
      setMessage(parsed.length
        ? `${parsed.length} invoice row${parsed.length === 1 ? "" : "s"} extracted. Review every field before receiving.`
        : "No complete rows were detected. Retake the photo straight-on with the full table visible, or paste corrected OCR text below.");
    } catch (error: any) {
      setMessage(error?.message ?? "The invoice image could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function reparse() {
    setBusy(true);
    const parsed = parseSupplierInvoiceText(rawText);
    setRows(await matchRows(parsed));
    setMessage(`${parsed.length} row${parsed.length === 1 ? "" : "s"} found in the corrected text.`);
    setBusy(false);
  }

  function patchRow(id: string, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch, status: undefined, error: undefined } : row));
  }

  function stockQuantity(row: DraftRow) {
    const receivedPacks = row.billedQty + row.freeQty;
    if (!row.medicine) return receivedPacks;
    const info = row.medicine;
    return canSellLooseUnits(info) ? receivedPacks * Math.max(1, Number(info.stripSize ?? 1)) : receivedPacks;
  }

  async function receiveAll() {
    if (needsSelection || !branchId) {
      setMessage("Select a branch in the top bar before receiving stock.");
      return;
    }
    const pending = rows.filter((row) => row.status !== "saved");
    if (!pending.length || pending.some((row) => !row.medicine || !row.batchNo || !row.expiryDate || row.billedQty < 0 || row.freeQty < 0)) {
      setMessage("Every pending row needs a matched medicine, batch, expiry, and valid quantities.");
      return;
    }
    setBusy(true);
    for (const row of pending) {
      try {
        await apiClient.post("/inventory/batches", {
          medicineId: row.medicine!.id,
          branchId,
          batchNo: row.batchNo.trim().toUpperCase(),
          expiryDate: row.expiryDate,
          quantity: stockQuantity(row),
          ...(row.freeQty > 0 ? {
            freeQuantity: canSellLooseUnits(row.medicine!)
              ? row.freeQty * Math.max(1, Number(row.medicine!.stripSize ?? 1))
              : row.freeQty,
          } : {}),
          costPrice: row.rate.toFixed(2),
          mrpAtEntry: row.mrp.toFixed(2),
        });
        patchRow(row.id, { status: "saved" });
      } catch (error: any) {
        patchRow(row.id, { status: "error", error: error?.response?.data?.message ?? "Could not receive this row" });
      }
    }
    setBusy(false);
    setMessage("Receiving finished. Saved rows are locked; correct and retry any failed rows.");
    await invalidateMedicineViews(queryClient);
    onComplete();
  }

  return (
    <Modal open={open} onClose={onClose} title="Scan supplier invoice" subtitle="OCR creates a review draft; stock changes only after confirmation" icon={<FileImage size={18} />} size="xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
            <Camera size={18} /> Photograph printed bill
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void extract(e.target.files[0])} />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Upload size={18} /> Upload bill image
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void extract(e.target.files[0])} />
          </label>
        </div>

        {busy && <div className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-700"><Loader2 className="mr-2 inline animate-spin" size={16} />Processing {progress ? `${progress}%` : "..."}</div>}
        {message && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">{message}</p>}

        {rawText && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-600">OCR text (edit if a row was missed)</summary>
            <textarea aria-label="Invoice OCR text" value={rawText} onChange={(e) => setRawText(e.target.value)} rows={7} className="mt-2 w-full rounded-lg border p-2 font-mono text-xs" />
            <button type="button" onClick={() => void reparse()} disabled={busy} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold">Parse corrected text</button>
          </details>
        )}

        {rows.length > 0 && <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, index) => {
            const qty = stockQuantity(row);
            const info = row.medicine;
            const displayInfo = {
              unit: info?.unit ?? null,
              dosageForm: info?.dosageForm ?? null,
              stripSize: Math.max(1, Number(info?.stripSize ?? 1) || 1),
            };
            const qtyLabel = info && canSellLooseUnits(info)
              ? getLooseUnitLabel(qty, displayInfo)
              : getUnitLabel(qty, displayInfo);
            return <div key={row.id} className={`rounded-xl border p-3 ${row.status === "saved" ? "border-emerald-300 bg-emerald-50" : row.status === "error" ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
              <div className="mb-2 flex items-center justify-between"><strong className="text-sm">Row {index + 1}: {row.productName}</strong>{row.status === "saved" ? <CheckCircle2 className="text-emerald-600" size={18} /> : <button aria-label={`Remove row ${index + 1}`} onClick={() => setRows((all) => all.filter((item) => item.id !== row.id))}><Trash2 size={16} /></button>}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[11px] font-bold">Matched medicine<select disabled={row.status === "saved"} value={row.medicine?.id ?? ""} onChange={(e) => patchRow(row.id, { medicine: row.matches.find((m) => m.id === e.target.value) ?? null })} className="mt-1 w-full rounded border p-2 text-xs"><option value="">Select medicine</option>{row.matches.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label className="text-[11px] font-bold">Batch<input disabled={row.status === "saved"} value={row.batchNo} onChange={(e) => patchRow(row.id, { batchNo: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Expiry<input disabled={row.status === "saved"} type="date" value={row.expiryDate} onChange={(e) => patchRow(row.id, { expiryDate: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Pack on bill<input disabled={row.status === "saved"} value={row.pack} onChange={(e) => patchRow(row.id, { pack: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Paid packs<input disabled={row.status === "saved"} type="number" min={0} value={row.billedQty} onChange={(e) => patchRow(row.id, { billedQty: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Free packs<input disabled={row.status === "saved"} type="number" min={0} value={row.freeQty} onChange={(e) => patchRow(row.id, { freeQty: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">MRP / pack<input disabled={row.status === "saved"} type="number" min={0} step="0.01" value={row.mrp} onChange={(e) => patchRow(row.id, { mrp: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Purchase rate / pack<input disabled={row.status === "saved"} type="number" min={0} step="0.01" value={row.rate} onChange={(e) => patchRow(row.id, { rate: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
              </div>
              <p className="mt-2 text-xs font-bold text-emerald-700">Will add {qty} {qtyLabel} to stock{row.freeQty ? ` (${row.freeQty} free pack${row.freeQty === 1 ? "" : "s"} included)` : ""}.</p>
              {row.error && <p className="mt-1 text-xs font-semibold text-red-700">{String(row.error)}</p>}
            </div>;
          })}
        </div>}

        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">Close</button><button type="button" disabled={busy || !rows.some((row) => row.status !== "saved")} onClick={() => void receiveAll()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Review complete — receive stock</button></div>
      </div>
    </Modal>
  );
}
