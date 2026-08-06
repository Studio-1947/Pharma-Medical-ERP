"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { useBranchStore } from "@/stores/branch.store";
import {
  Download, Upload, FileText, CheckCircle2, XCircle,
  AlertCircle, Loader2, X, ChevronDown, ChevronUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Sample CSV definition
// ---------------------------------------------------------------------------
// Mirrors the catalogue sheet's column order. The backend normalizes header
// spelling, so older/alternative headers still import — this matches the exact
// 25-column order from the Google Sheets catalogue.
const CSV_COLUMNS = [
  "Medicine_ID", "Drawer Mapping", "Brand_Name", "Medicine_Name", "Generic_Name",
  "Composition", "Strength", "Dosage_Form", "Pack_Size", "Manufacturer",
  "Therapeutic_Class", "Category", "Schedule", "GST_Percent", "HSN_Code",
  "MRP", "Purchase_Rate", "Barcode", "Batch_No", "Manufacture_Date",
  "Expiry_Date", "Stock", "Minimum_Stock", "Location", "Supplier",
] as const;

const SAMPLE_ROWS = [
  [
    "MED00001", "", "Dolo", "Dolo 650 mg Tablet", "Paracetamol",
    "Paracetamol 650 mg", "650 mg", "Tablet", "15 Tablets", "Micro Labs Ltd",
    "Analgesic & Antipyretic", "Analgesics", "", "12", "30049099",
    "31.50", "24.20", "8901234560001", "PB47201", "2026-01-15",
    "2028-01-28", "240", "20", "Rack A-1, Shelf 2", "North Bengal Pharma Agency",
  ],
  [
    "MED00002", "", "Zady", "Zady 250 mg Tablet", "Azithromycin",
    "Azithromycin 250 mg", "250 mg", "Tablet", "10 Tablets", "Albert David Ltd",
    "Macrolide Antibiotic", "Antibiotics", "H", "12", "30049099",
    "29.99", "23.00", "8901234560002", "WC99552", "2026-01-05",
    "2028-01-28", "405", "5", "Rack G-2, Shelf 5", "Siliguri Medical Distributors",
  ],
  [
    "", "", "Alprax", "Alprax 0.25 mg Tablet", "Alprazolam",
    "Alprazolam 0.25 mg", "0.25 mg", "Tablet", "15 Tablets", "Torrent Pharmaceuticals Ltd",
    "Benzodiazepine", "Psychiatry", "H1", "12", "30049099",
    "120.00", "92.00", "8901234560003", "TX10884", "2026-03-02",
    "2028-03-28", "60", "3", "Controlled Cabinet CC-1, Shelf 1", "Teesta Drug House",
  ],
];

function buildSampleCsv(): string {
  const header = CSV_COLUMNS.join(",");
  const rows = SAMPLE_ROWS.map((r) => r.map((v) => `"${v}"`).join(","));
  return [header, ...rows].join("\n");
}

function downloadSampleCsv() {
  const csv = buildSampleCsv();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "medicines-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// CSV parser (no external deps)
// ---------------------------------------------------------------------------
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const result: Record<string, string>[] = [];

  for (let l = 1; l < lines.length; l++) {
    const line = lines[l]!;
    if (!line.trim()) continue; // skip blank lines

    // Handle quoted fields with commas or escaped quotes inside
    const vals: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++; // skip escaped quote
          continue;
        }
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) {
        vals.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    vals.push(cur);

    // Skip rows where every parsed value is empty
    if (vals.every((v) => !v.trim())) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] ?? "").trim();
    });
    result.push(obj);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Header tolerance — must stay in step with headerKey() in inventory.service.ts
// so the preview shows exactly what the backend will read.
// ---------------------------------------------------------------------------
const NULL_SENTINELS = new Set(["n/a", "na", "-", "--", "nil", "none"]);

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First non-empty value among the accepted spellings, with the sheet's
 *  "NA" placeholders treated as empty. */
function field(row: Record<string, string>, ...keys: string[]): string {
  for (const [k, v] of Object.entries(row)) {
    if (!keys.includes(headerKey(k))) continue;
    const value = (v ?? "").trim();
    if (value && !NULL_SENTINELS.has(value.toLowerCase())) return value;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Column info for preview table
// ---------------------------------------------------------------------------
const PREVIEW_COLS: { label: string; keys: string[]; required?: boolean }[] = [
  { label: "Name",         keys: ["name", "medicinename", "brandname", "brand"], required: true },
  { label: "SKU",          keys: ["sku", "medicineid", "medicinecode"] },
  { label: "Drawer",       keys: ["drawermapping", "drawer"] },
  { label: "Generic",      keys: ["genericname"] },
  { label: "Strength",     keys: ["strength"] },
  { label: "Form",         keys: ["dosageform", "form"] },
  { label: "Pack",         keys: ["packsize"] },
  { label: "Manufacturer", keys: ["manufacturer"] },
  { label: "MRP (₹)",      keys: ["pricemrp", "mrp"] },
  { label: "GST %",        keys: ["taxpercent", "gstpercent", "gst"] },
  { label: "Schedule",     keys: ["scheduleclass", "schedule"] },
  { label: "Batch",        keys: ["batchno", "batchnumber", "batch"] },
  { label: "Expiry",       keys: ["expirydate", "expiry", "expdate"] },
  { label: "Stock",        keys: ["stock", "quantity", "qty"] },
  { label: "Location",     keys: ["location", "rack", "shelflocation"] },
  { label: "Supplier",     keys: ["supplier", "distributor", "suppliername"] },
];

interface ImportResult {
  created: number;
  skipped: number;
  batchesCreated: number;
  errors: { row: number; sku: string; reason: string }[];
  warnings: { row: number; sku: string; reason: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function BulkImportModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const activeBranch = useBranchStore((s) => s.activeBranch);
  const { success: toastSuccess, error: toastError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const importMutation = useMutation({
    mutationFn: (data: Record<string, string>[]) =>
      apiClient.post("/inventory/medicines/bulk-import", {
        rows: data,
        // Opening stock has to land in a branch. A branch user is pinned to
        // their own server-side whatever this says; it only takes effect for
        // super_admin, who has no branch of their own.
        branchId: activeBranch?.id,
      }) as Promise<ImportResult>,
    onSuccess: (res: any) => {
      const r: ImportResult = res?.data ?? res;
      setResult(r);
      queryClient.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      if (r.created > 0) {
        const notes = [
          r.batchesCreated ? `${r.batchesCreated} stock batches loaded` : "",
          r.skipped ? `${r.skipped} skipped (duplicates)` : "",
          r.warnings?.length ? `${r.warnings.length} need review` : "",
          r.errors.length ? `${r.errors.length} errors` : "",
        ].filter(Boolean);
        toastSuccess(`${r.created} medicines imported`, notes.join(", ") || "No issues");
      } else {
        toastError("Nothing imported", "All rows were skipped or had errors.");
      }
    },
    onError: (err: any) => {
      toastError("Import failed", err?.response?.data?.message ?? "Server error during import.");
    },
  });

  function loadFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      setParseError("Only .csv files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setParseError("File is empty or has no data rows.");
        return;
      }
      // Only a name is structurally required: the backend mints a SKU when
      // Medicine_ID is blank, and a row with no MRP imports as inactive.
      if (!parsed.some((r) => field(r, "name", "medicinename", "brandname", "brand"))) {
        setParseError("No medicine name column found. Download the sample template to see the correct format.");
        return;
      }
      setParseError("");
      setRows(parsed);
      setFileName(file.name);
      setResult(null);
    };
    reader.readAsText(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  function reset() {
    setRows([]);
    setFileName("");
    setParseError("");
    setResult(null);
    setShowErrors(false);
    setShowWarnings(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  const rowHasName = (r: Record<string, string>) =>
    !!field(r, "name", "medicinename", "brandname", "brand");
  const rowHasPrice = (r: Record<string, string>) => !!field(r, "pricemrp", "mrp");
  const missingNameCount = rows.filter((r) => !rowHasName(r)).length;
  const missingPriceCount = rows.filter((r) => rowHasName(r) && !rowHasPrice(r)).length;

  return (
    <Modal title="Bulk Import Medicines" open={open} onClose={handleClose} size="xl">
      <div className="space-y-5">

        {/* Sample download banner */}
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">Start with the sample template</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              Fill in the CSV and upload it below. Only{" "}
              <span className="font-mono font-bold">Medicine_Name</span> is required —
              a blank <span className="font-mono font-bold">Medicine_ID</span> is assigned on import,
              and a row with no <span className="font-mono font-bold">MRP</span> lands inactive.
              Rows with <span className="font-mono font-bold">Batch_No</span>,{" "}
              <span className="font-mono font-bold">Expiry_Date</span> and{" "}
              <span className="font-mono font-bold">Stock</span> also load opening stock into your branch.
            </p>
          </div>
          <button
            onClick={downloadSampleCsv}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-sm font-semibold hover:bg-emerald-50 transition-colors shadow-sm shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>
        </div>

        {/* Drop zone */}
        {!rows.length && (
          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 cursor-pointer transition-colors ${
              isDragging
                ? "border-emerald-400 bg-emerald-50"
                : "border-slate-200 hover:border-emerald-300 hover:bg-slate-50"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <Upload className="w-5 h-5 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">
                Drop your CSV file here, or <span className="text-emerald-600 underline">browse</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">.csv files only</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{parseError}</p>
          </div>
        )}

        {/* Loaded file + preview */}
        {rows.length > 0 && !result && (
          <>
            {/* File info bar */}
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-700">{fileName}</span>
                <span className="text-slate-400">&bull; {rows.length} rows</span>
              </div>
              <button onClick={reset} className="p-1 hover:bg-slate-200 rounded-lg transition-colors text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {(missingNameCount > 0 || missingPriceCount > 0) && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  {missingNameCount > 0 && (
                    <p>{missingNameCount} rows have no medicine name and will be rejected.</p>
                  )}
                  {missingPriceCount > 0 && (
                    <p>
                      {missingPriceCount} rows have no MRP. They will import as{" "}
                      <span className="font-semibold">inactive</span> so they cannot be sold until priced.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Preview table */}
            <div className="rounded-xl border overflow-hidden">
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground font-semibold border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-8">#</th>
                      {PREVIEW_COLS.map((c) => (
                        <th key={c.label} className="px-3 py-2 whitespace-nowrap">
                          {c.label}{c.required && <span className="text-red-500 ml-0.5">*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row, idx) => {
                      const rejected = !rowHasName(row);
                      const inactive = !rejected && !rowHasPrice(row);
                      return (
                        <tr
                          key={idx}
                          className={
                            rejected ? "bg-red-50" : inactive ? "bg-amber-50" : "hover:bg-muted/20"
                          }
                        >
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          {PREVIEW_COLS.map((c) => {
                            const value = field(row, ...c.keys);
                            return (
                              <td key={c.label} className={`px-3 py-2 max-w-[140px] truncate ${
                                c.required && !value ? "text-red-500 font-semibold" : "text-slate-700"
                              }`}>
                                {value || <span className="text-slate-300 italic">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2.5 pt-1 border-t border-slate-100">
              <button
                onClick={reset}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Change File
              </button>
              <button
                onClick={() => importMutation.mutate(rows)}
                disabled={importMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors shadow-sm"
              >
                {importMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing...</>
                ) : (
                  <><Upload className="w-3.5 h-3.5" /> Import {rows.length} Medicines</>
                )}
              </button>
            </div>
          </>
        )}

        {/* Result summary */}
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="flex flex-col items-center justify-center bg-emerald-50 border border-emerald-100 rounded-xl py-4 gap-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <span className="text-2xl font-bold text-emerald-700">{result.created}</span>
                <span className="text-xs text-emerald-600 font-semibold">Imported</span>
                {result.batchesCreated > 0 && (
                  <span className="text-[11px] text-emerald-500">
                    +{result.batchesCreated} batches
                  </span>
                )}
              </div>
              <div className="flex flex-col items-center justify-center bg-amber-50 border border-amber-100 rounded-xl py-4 gap-1">
                <AlertCircle className="w-6 h-6 text-amber-500" />
                <span className="text-2xl font-bold text-amber-600">{result.skipped}</span>
                <span className="text-xs text-amber-600 font-semibold">Skipped (duplicate)</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-sky-50 border border-sky-100 rounded-xl py-4 gap-1">
                <AlertCircle className="w-6 h-6 text-sky-500" />
                <span className="text-2xl font-bold text-sky-600">{result.warnings?.length ?? 0}</span>
                <span className="text-xs text-sky-600 font-semibold">Need review</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-red-50 border border-red-100 rounded-xl py-4 gap-1">
                <XCircle className="w-6 h-6 text-red-500" />
                <span className="text-2xl font-bold text-red-600">{result.errors.length}</span>
                <span className="text-xs text-red-600 font-semibold">Errors</span>
              </div>
            </div>

            {(result.warnings?.length ?? 0) > 0 && (
              <div className="border border-sky-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowWarnings((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-sky-50 text-sm font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                >
                  <span>{result.warnings.length} imported but need a follow-up edit</span>
                  {showWarnings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showWarnings && (
                  <div className="divide-y max-h-48 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                        {w.row > 0 && <span className="text-slate-400 font-mono shrink-0">Row {w.row}</span>}
                        {w.sku && <span className="font-mono font-semibold text-slate-600 shrink-0">{w.sku}</span>}
                        <span className="text-sky-700">{w.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="border border-red-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowErrors((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <span>{result.errors.length} rows with issues</span>
                  {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showErrors && (
                  <div className="divide-y max-h-48 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                        {e.row > 0 && (
                          <span className="text-slate-400 font-mono shrink-0">Row {e.row}</span>
                        )}
                        {e.sku && (
                          <span className="font-mono font-semibold text-slate-600 shrink-0">{e.sku}</span>
                        )}
                        <span className="text-red-600">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-1 border-t border-slate-100">
              <button
                onClick={reset}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Import Another File
              </button>
              <button
                onClick={handleClose}
                className="px-5 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold hover:bg-slate-900 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
