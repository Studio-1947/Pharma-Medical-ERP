"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import {
  Download, Upload, FileText, CheckCircle2, XCircle,
  AlertCircle, Loader2, X, ChevronDown, ChevronUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Sample CSV definition
// ---------------------------------------------------------------------------
const CSV_COLUMNS = [
  "name", "generic_name", "sku", "barcode", "manufacturer",
  "hsn_code", "unit", "strip_size", "price_mrp", "tax_percent",
  "reorder_level", "reorder_qty", "requires_prescription",
  "is_controlled", "schedule_class", "storage_conditions", "description",
] as const;

const SAMPLE_ROWS = [
  [
    "Paracetamol 500mg", "Paracetamol", "PCM-500-001", "8901234560001",
    "Sun Pharma", "3004", "strip", "10", "45.50", "5",
    "10", "50", "false", "false", "", "Cool & Dry",
    "Common analgesic and antipyretic",
  ],
  [
    "Amoxicillin 250mg Capsule", "Amoxicillin", "AMX-250-001", "8901234560002",
    "Cipla", "2941", "strip", "10", "85.00", "12",
    "5", "30", "true", "false", "H", "Cool & Dry",
    "Broad spectrum antibiotic — requires prescription",
  ],
  [
    "Alprazolam 0.25mg", "Alprazolam", "ALP-025-001", "8901234560003",
    "Torrent", "2933", "strip", "10", "120.00", "12",
    "3", "20", "true", "true", "X", "Cool & Dry",
    "Anxiolytic — Schedule X controlled substance",
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
  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const vals: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { vals.push(cur); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim(); });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Column info for preview table
// ---------------------------------------------------------------------------
const PREVIEW_COLS: { key: string; label: string; required?: boolean }[] = [
  { key: "name",                  label: "Name",          required: true },
  { key: "sku",                   label: "SKU",           required: true },
  { key: "generic_name",          label: "Generic" },
  { key: "manufacturer",          label: "Manufacturer" },
  { key: "unit",                  label: "Unit" },
  { key: "price_mrp",             label: "MRP (₹)",       required: true },
  { key: "tax_percent",           label: "Tax %" },
  { key: "schedule_class",        label: "Schedule" },
  { key: "requires_prescription", label: "Rx?" },
];

interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; sku: string; reason: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function BulkImportModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const importMutation = useMutation({
    mutationFn: (data: Record<string, string>[]) =>
      apiClient.post("/inventory/medicines/bulk-import", { rows: data }) as Promise<ImportResult>,
    onSuccess: (res: any) => {
      const r: ImportResult = res?.data ?? res;
      setResult(r);
      queryClient.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      if (r.created > 0) {
        toastSuccess(
          `${r.created} medicines imported`,
          `${r.skipped} skipped (duplicates)${r.errors.length ? `, ${r.errors.length} errors` : ""}`,
        );
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
      if (!("name" in parsed[0]!) || !("sku" in parsed[0]!)) {
        setParseError("Missing required columns. Download the sample template to see the correct format.");
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
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  const hasMissingRequired = rows.some((r) => !r.name?.trim() || !r.sku?.trim() || !r.price_mrp?.trim());

  return (
    <Modal title="Bulk Import Medicines" open={open} onClose={handleClose} size="xl">
      <div className="space-y-5">

        {/* Sample download banner */}
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">Start with the sample template</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              Fill in the CSV and upload it below. Required columns: <span className="font-mono font-bold">name, sku, price_mrp</span>
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

            {hasMissingRequired && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                Some rows are missing required fields (name, sku, price_mrp) and will be rejected. Review below.
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
                        <th key={c.key} className="px-3 py-2 whitespace-nowrap">
                          {c.label}{c.required && <span className="text-red-500 ml-0.5">*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row, idx) => {
                      const missing = !row.name?.trim() || !row.sku?.trim() || !row.price_mrp?.trim();
                      return (
                        <tr key={idx} className={missing ? "bg-red-50" : "hover:bg-muted/20"}>
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          {PREVIEW_COLS.map((c) => (
                            <td key={c.key} className={`px-3 py-2 max-w-[140px] truncate ${
                              c.required && !row[c.key]?.trim() ? "text-red-500 font-semibold" : "text-slate-700"
                            }`}>
                              {row[c.key] || <span className="text-slate-300 italic">—</span>}
                            </td>
                          ))}
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
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center justify-center bg-emerald-50 border border-emerald-100 rounded-xl py-4 gap-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <span className="text-2xl font-bold text-emerald-700">{result.created}</span>
                <span className="text-xs text-emerald-600 font-semibold">Imported</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-amber-50 border border-amber-100 rounded-xl py-4 gap-1">
                <AlertCircle className="w-6 h-6 text-amber-500" />
                <span className="text-2xl font-bold text-amber-600">{result.skipped}</span>
                <span className="text-xs text-amber-600 font-semibold">Skipped (duplicate)</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-red-50 border border-red-100 rounded-xl py-4 gap-1">
                <XCircle className="w-6 h-6 text-red-500" />
                <span className="text-2xl font-bold text-red-600">{result.errors.length}</span>
                <span className="text-xs text-red-600 font-semibold">Errors</span>
              </div>
            </div>

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
