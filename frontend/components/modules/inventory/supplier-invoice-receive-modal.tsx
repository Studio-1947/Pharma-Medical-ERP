"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, FileImage, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { apiClient } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { canSellLooseUnits, getLooseUnitLabel, getUnitLabel } from "@/lib/stock-unit-formatter";
import { parseSupplierInvoiceMetadata, parseSupplierInvoiceText, SupplierInvoiceRow } from "@/lib/supplier-invoice-parser";
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

type SupplierMatch = { id: string; name: string; gstNo?: string | null };

function listFrom<T = MedicineMatch>(response: any): T[] {
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
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: "", code: "", phone: "", gstNo: "", address: "" });
  const [supplierError, setSupplierError] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  const { data: supplierResponse } = useQuery({
    queryKey: ["supplier-invoice-suppliers"],
    queryFn: () => apiClient.get("/procurement/suppliers", { params: { limit: 1000 } }),
    enabled: open,
  });
  const suppliers = listFrom<SupplierMatch>(supplierResponse);

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
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", undefined, {
        logger: (event) => {
          if (event.status === "recognizing text") setProgress(Math.round((event.progress ?? 0) * 100));
        },
      });
      let result;
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        result = await worker.recognize(file, { rotateAuto: true });
        if (parseSupplierInvoiceText(result.data.text).length === 0) {
          setMessage("The table pass found no complete rows. Trying automatic layout detection…");
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            preserve_interword_spaces: "1",
          });
          const fallback = await worker.recognize(file, { rotateAuto: true });
          if (
            parseSupplierInvoiceText(fallback.data.text).length >=
            parseSupplierInvoiceText(result.data.text).length
          ) {
            result = fallback;
          }
        }
      } finally {
        await worker.terminate();
      }
      setRawText(result.data.text);
      const metadata = parseSupplierInvoiceMetadata(result.data.text);
      setInvoiceNo(metadata.invoiceNo);
      setInvoiceDate(metadata.invoiceDate);
      const supplier = suppliers.find((candidate) =>
        (metadata.gstNo && candidate.gstNo?.toUpperCase() === metadata.gstNo) ||
        (metadata.supplierName && candidate.name.toLowerCase().includes(metadata.supplierName.toLowerCase())),
      );
      if (supplier) setSupplierId(supplier.id);
      setNewSupplier((current) => ({
        name: metadata.supplierName || current.name,
        code: current.code || metadata.supplierName.replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase(),
        phone: metadata.phone || current.phone,
        gstNo: metadata.gstNo || current.gstNo,
        address: metadata.address || current.address,
      }));
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
    const metadata = parseSupplierInvoiceMetadata(rawText);
    if (metadata.invoiceNo) setInvoiceNo(metadata.invoiceNo);
    if (metadata.invoiceDate) setInvoiceDate(metadata.invoiceDate);
    setNewSupplier((current) => ({
      name: metadata.supplierName || current.name,
      code: current.code || metadata.supplierName.replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase(),
      phone: metadata.phone || current.phone,
      gstNo: metadata.gstNo || current.gstNo,
      address: metadata.address || current.address,
    }));
    setRows(await matchRows(parsed));
    setMessage(`${parsed.length} row${parsed.length === 1 ? "" : "s"} found in the corrected text.`);
    setBusy(false);
  }

  async function createSupplierFromBill() {
    if (!newSupplier.name.trim() || !newSupplier.code.trim() || !newSupplier.phone.trim()) {
      setSupplierError("Supplier name, code and phone are required. Correct any OCR mistakes before saving.");
      return;
    }
    setSavingSupplier(true);
    setSupplierError("");
    try {
      const response: any = await apiClient.post("/procurement/suppliers", {
        name: newSupplier.name.trim(),
        code: newSupplier.code.trim().toUpperCase(),
        phone: newSupplier.phone.trim(),
        ...(newSupplier.gstNo.trim() ? { gstNo: newSupplier.gstNo.trim().toUpperCase() } : {}),
        ...(newSupplier.address.trim() ? { address: newSupplier.address.trim() } : {}),
      });
      const created = response?.data?.data ?? response?.data ?? response;
      if (!created?.id) throw new Error("Supplier was created but no ID was returned.");
      setSupplierId(created.id);
      setNewSupplierOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["supplier-invoice-suppliers"] });
      setMessage(`${created.name ?? newSupplier.name} was added and selected. Continue reviewing the bill.`);
    } catch (error: any) {
      const errors = error?.response?.data?.errors;
      const first = errors && Object.entries(errors)[0] as [string, string[]] | undefined;
      setSupplierError(first ? `${first[0]}: ${first[1]?.[0] ?? "invalid"}` : error?.response?.data?.message ?? error?.message ?? "Could not create supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  function addBlankRow() {
    setRows((current) => [...current, {
      id: `${Date.now()}-${current.length}`,
      sourceLine: "",
      productName: "",
      billedQty: 1,
      freeQty: 0,
      pack: "",
      manufacturer: "",
      batchNo: "",
      expiryDate: "",
      hsn: "",
      mrp: 0,
      rate: 0,
      discountPct: 0,
      taxPct: 0,
      amount: 0,
      matches: [],
      medicine: null,
    }]);
  }

  async function rematchRow(row: DraftRow) {
    if (!row.productName.trim()) return;
    const response = await apiClient.get("/inventory/medicines", {
      params: { search: row.productName.trim(), limit: 10, isActive: "all" },
    });
    const matches = listFrom(response);
    patchRow(row.id, { matches, medicine: matches[0] ?? null });
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
    if (!supplierId || !invoiceNo.trim()) {
      setMessage("Select the supplier and enter the supplier invoice number.");
      return;
    }
    if (!pending.length || pending.some((row) => !row.medicine || !row.batchNo || !row.expiryDate || row.billedQty <= 0 || row.freeQty < 0 || row.rate < 0 || row.mrp <= 0)) {
      setMessage("Every pending row needs a matched medicine, batch, expiry, and valid quantities.");
      return;
    }
    setBusy(true);
    try {
      await apiClient.post("/procurement/supplier-invoices/receive", {
        supplierId,
        branchId,
        supplierInvoiceNo: invoiceNo.trim(),
        ...(invoiceDate ? { invoiceDate } : {}),
        items: pending.map((row) => {
          const unitsPerPack = row.medicine && canSellLooseUnits(row.medicine)
            ? Math.max(1, Number(row.medicine.stripSize ?? 1))
            : 1;
          return {
            medicineId: row.medicine!.id,
            billedQty: row.billedQty,
            freeQty: row.freeQty,
            unitsPerPack,
            unitCost: row.rate.toFixed(2),
            taxPct: ([0, 5, 12, 18].includes(row.taxPct) ? row.taxPct : 0).toString(),
            discountPct: row.discountPct.toFixed(2),
            mrpAtEntry: row.mrp.toFixed(2),
            batchNo: row.batchNo.trim().toUpperCase(),
            expiryDate: row.expiryDate,
          };
        }),
      });
      setRows((current) => current.map((row) => ({ ...row, status: "saved" })));
      setMessage("Supplier bill saved. Stock, GRN, purchase record and supplier payable were posted together.");
      await Promise.all([
        invalidateMedicineViews(queryClient),
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["payables-aging"] }),
      ]);
      onComplete();
    } catch (error: any) {
      setMessage(error?.response?.data?.message ?? "Nothing was posted. Correct the bill and try again.");
    } finally {
      setBusy(false);
    }
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

        {(rawText || rows.length > 0) && (
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
            <label className="text-[11px] font-bold text-slate-700">
              Supplier
              <select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs">
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.gstNo ? ` · ${supplier.gstNo}` : ""}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-bold text-slate-700">
              Supplier invoice number
              <input aria-label="Supplier invoice number" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs" />
            </label>
            <label className="text-[11px] font-bold text-slate-700">
              Invoice date
              <input aria-label="Invoice date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs" />
            </label>
            <div className="sm:col-span-3 flex justify-start">
              <button type="button" onClick={() => setNewSupplierOpen((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800">
                <Plus size={13} /> Supplier not listed? Add from this bill
              </button>
            </div>
            {newSupplierOpen && (
              <div className="sm:col-span-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                <p className="mb-2 text-xs font-bold text-emerald-900">Review extracted supplier details before saving</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-[11px] font-bold">Supplier name *<input aria-label="New supplier name" value={newSupplier.name} onChange={(e) => setNewSupplier((value) => ({ ...value, name: e.target.value }))} className="mt-1 w-full rounded border bg-white p-2 text-xs" /></label>
                  <label className="text-[11px] font-bold">Supplier code *<input aria-label="New supplier code" value={newSupplier.code} onChange={(e) => setNewSupplier((value) => ({ ...value, code: e.target.value.toUpperCase() }))} className="mt-1 w-full rounded border bg-white p-2 text-xs" /></label>
                  <label className="text-[11px] font-bold">Phone *<input aria-label="New supplier phone" value={newSupplier.phone} onChange={(e) => setNewSupplier((value) => ({ ...value, phone: e.target.value }))} className="mt-1 w-full rounded border bg-white p-2 text-xs" /></label>
                  <label className="text-[11px] font-bold">GSTIN<input aria-label="New supplier GSTIN" value={newSupplier.gstNo} onChange={(e) => setNewSupplier((value) => ({ ...value, gstNo: e.target.value.toUpperCase() }))} className="mt-1 w-full rounded border bg-white p-2 text-xs" /></label>
                  <label className="text-[11px] font-bold sm:col-span-2">Address<input aria-label="New supplier address" value={newSupplier.address} onChange={(e) => setNewSupplier((value) => ({ ...value, address: e.target.value }))} className="mt-1 w-full rounded border bg-white p-2 text-xs" /></label>
                </div>
                {supplierError && <p className="mt-2 text-xs font-semibold text-red-700">{supplierError}</p>}
                <button type="button" disabled={savingSupplier} onClick={() => void createSupplierFromBill()} className="mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{savingSupplier ? "Saving supplier…" : "Save and select supplier"}</button>
              </div>
            )}
          </div>
        )}

        {rawText && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-600">OCR text (edit if a row was missed)</summary>
            <textarea aria-label="Invoice OCR text" value={rawText} onChange={(e) => setRawText(e.target.value)} rows={7} className="mt-2 w-full rounded-lg border p-2 font-mono text-xs" />
            <button type="button" onClick={() => void reparse()} disabled={busy} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold">Parse corrected text</button>
          </details>
        )}

        {(rawText || rows.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Unmatched medicines must be searched and selected before anything is posted.</p>
            <button type="button" onClick={addBlankRow} className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold"><Plus size={14} /> Add bill row</button>
          </div>
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
              <div className="mb-2 flex items-center justify-between"><strong className="text-sm">Row {index + 1}: {row.productName || "Unmatched bill item"}</strong>{row.status === "saved" ? <CheckCircle2 className="text-emerald-600" size={18} /> : <button aria-label={`Remove row ${index + 1}`} onClick={() => setRows((all) => all.filter((item) => item.id !== row.id))}><Trash2 size={16} /></button>}</div>
              {row.status !== "saved" && <div className="mb-2 flex gap-2"><input aria-label={`Product name row ${index + 1}`} value={row.productName} onChange={(e) => patchRow(row.id, { productName: e.target.value, medicine: null, matches: [] })} placeholder="Medicine name from printed bill" className="min-w-0 flex-1 rounded border p-2 text-xs" /><button type="button" onClick={() => void rematchRow(row)} className="inline-flex items-center gap-1 rounded border px-3 text-xs font-bold"><Search size={13} /> Match database</button></div>}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[11px] font-bold">Matched medicine<select disabled={row.status === "saved"} value={row.medicine?.id ?? ""} onChange={(e) => patchRow(row.id, { medicine: row.matches.find((m) => m.id === e.target.value) ?? null })} className="mt-1 w-full rounded border p-2 text-xs"><option value="">Select medicine</option>{row.matches.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label className="text-[11px] font-bold">Batch<input disabled={row.status === "saved"} value={row.batchNo} onChange={(e) => patchRow(row.id, { batchNo: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Expiry<input disabled={row.status === "saved"} type="date" value={row.expiryDate} onChange={(e) => patchRow(row.id, { expiryDate: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Pack on bill<input disabled={row.status === "saved"} value={row.pack} onChange={(e) => patchRow(row.id, { pack: e.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Paid packs<input disabled={row.status === "saved"} type="number" min={0} value={row.billedQty} onChange={(e) => patchRow(row.id, { billedQty: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Free packs<input disabled={row.status === "saved"} type="number" min={0} value={row.freeQty} onChange={(e) => patchRow(row.id, { freeQty: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">MRP / pack<input disabled={row.status === "saved"} type="number" min={0} step="0.01" value={row.mrp} onChange={(e) => patchRow(row.id, { mrp: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">Purchase rate / pack<input disabled={row.status === "saved"} type="number" min={0} step="0.01" value={row.rate} onChange={(e) => patchRow(row.id, { rate: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
                <label className="text-[11px] font-bold">GST %<select disabled={row.status === "saved"} value={row.taxPct} onChange={(e) => patchRow(row.id, { taxPct: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs">{[0, 5, 12, 18].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select></label>
                <label className="text-[11px] font-bold">Discount %<input disabled={row.status === "saved"} type="number" min={0} max={100} step="0.01" value={row.discountPct} onChange={(e) => patchRow(row.id, { discountPct: Number(e.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label>
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
