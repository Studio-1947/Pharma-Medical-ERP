"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, AlertCircle, CheckCircle2, Search, ChevronDown } from "lucide-react";
import { apiClient } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Medicine {
  id: string;
  name: string;
  sku: string;
  scheduleClass: string | null;
}

interface Batch {
  id: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  reservedQty: number;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface TransferItemInput {
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNo: string;
  requestedQty: number;
}

interface TransferFormData {
  fromWarehouseId: string;
  toWarehouseId: string;
  notes: string;
  items: TransferItemInput[];
}

interface Props {
  onSuccess?: () => void;
  onCancel?: () => void;
}

// ─── Warehouse selector ───────────────────────────────────────────────────────

function WarehouseSelect({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  error?: boolean;
}) {
  const { data } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiClient.get("/inventory/warehouses").then((r: any) => r.data ?? r ?? []),
    staleTime: 60_000,
  });

  const warehouses: Warehouse[] = data ?? [];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "w-full rounded-lg border px-3 py-2 text-sm bg-white",
        "focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400",
        error ? "border-red-300 bg-red-50/30" : "border-slate-200",
      ].join(" ")}
    >
      <option value="">{placeholder}</option>
      {warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name} ({w.code})
        </option>
      ))}
    </select>
  );
}

// ─── Medicine search combobox ─────────────────────────────────────────────────

function MedicineCombobox({
  value,
  valueName,
  onSelect,
  error,
}: {
  value: string;
  valueName: string;
  onSelect: (id: string, name: string) => void;
  error?: boolean;
}) {
  const [query, setQuery] = useState(valueName);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ data: Medicine[] }>({
    queryKey: ["medicine-search", query],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        params: { search: query, limit: 10, page: 1 },
      }) as Promise<{ data: Medicine[] }>,
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  const results = data?.data ?? [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onSelect("", "");
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search medicine name or SKU..."
          className={[
            "w-full rounded-lg border pl-8 pr-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400",
            error ? "border-red-300 bg-red-50/30" : "border-slate-200 bg-white",
          ].join(" ")}
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between gap-2"
              onClick={() => {
                onSelect(m.id, m.name);
                setQuery(m.name);
                setOpen(false);
              }}
            >
              <span className="font-medium text-slate-800 truncate">{m.name}</span>
              <span className="text-xs text-slate-400 font-mono shrink-0">{m.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Batch selector ───────────────────────────────────────────────────────────

function BatchSelect({
  medicineId,
  value,
  onSelect,
  error,
}: {
  medicineId: string;
  value: string;
  onSelect: (id: string, batchNo: string, availableQty: number) => void;
  error?: boolean;
}) {
  const { data, isLoading } = useQuery<Batch[]>({
    queryKey: ["medicine-batches", medicineId],
    queryFn: () =>
      apiClient
        .get(`/inventory/medicines/${medicineId}/batches`)
        .then((r: any) => r.data ?? r ?? []),
    enabled: !!medicineId,
    staleTime: 30_000,
  });

  // A batch already reserved for another in-transit transfer has nothing
  // left to move — hide it. Transfers always move a batch's full remaining
  // quantity, so that's what we show and what gets submitted.
  const batches: Batch[] = (data ?? []).filter((b) => b.quantity - (b.reservedQty ?? 0) > 0);

  return (
    <select
      value={value}
      onChange={(e) => {
        const batch = batches.find((b) => b.id === e.target.value);
        const available = batch ? batch.quantity - (batch.reservedQty ?? 0) : 0;
        onSelect(e.target.value, batch?.batchNo ?? "", available);
      }}
      disabled={!medicineId || isLoading}
      className={[
        "w-full rounded-lg border px-3 py-2 text-sm bg-white",
        "focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400",
        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
        error ? "border-red-300 bg-red-50/30" : "border-slate-200",
      ].join(" ")}
    >
      <option value="">
        {!medicineId
          ? "Select medicine first"
          : isLoading
          ? "Loading batches..."
          : batches.length === 0
          ? "No transferable batches"
          : "Select batch"}
      </option>
      {batches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.batchNo} — Exp:{" "}
          {new Date(b.expiryDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}{" "}
          (Qty: {b.quantity - (b.reservedQty ?? 0)})
        </option>
      ))}
    </select>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function TransferForm({ onSuccess, onCancel }: Props) {
  const [rootError, setRootError] = useState<string | null>(null);

  const { control, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<TransferFormData>({
      defaultValues: {
        fromWarehouseId: "",
        toWarehouseId: "",
        notes: "",
        items: [{ medicineId: "", medicineName: "", batchId: "", batchNo: "", requestedQty: 1 }],
      },
    });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = watch("items");

  const mutation = useMutation({
    mutationFn: (data: TransferFormData) =>
      apiClient.post("/distribution/transfers", {
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        notes: data.notes || undefined,
        items: data.items.map((item) => ({
          medicineId: item.medicineId,
          batchId: item.batchId,
          requestedQty: item.requestedQty,
        })),
      }),
    onSuccess: () => onSuccess?.(),
    onError: (err: any) =>
      setRootError(err?.response?.data?.message ?? "Failed to create transfer."),
  });

  const onSubmit = (data: TransferFormData) => {
    setRootError(null);
    const invalid = data.items.find((i) => !i.medicineId || !i.batchId);
    if (invalid) {
      setRootError("Select a medicine and batch for each transfer item.");
      return;
    }
    mutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Warehouses */}
      <div className="px-6 py-5 space-y-4 border-b border-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              From Warehouse <span className="text-red-500">*</span>
            </label>
            <WarehouseSelect
              value={watch("fromWarehouseId")}
              onChange={(id) => setValue("fromWarehouseId", id)}
              placeholder="Select source warehouse"
              error={!!errors.fromWarehouseId}
            />
            {errors.fromWarehouseId && (
              <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={10} /> {errors.fromWarehouseId.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              To Warehouse <span className="text-red-500">*</span>
            </label>
            <WarehouseSelect
              value={watch("toWarehouseId")}
              onChange={(id) => setValue("toWarehouseId", id)}
              placeholder="Select destination warehouse"
              error={!!errors.toWarehouseId}
            />
            {errors.toWarehouseId && (
              <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={10} /> {errors.toWarehouseId.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Notes</label>
          <textarea
            {...control.register("notes")}
            rows={2}
            placeholder="Optional transfer notes..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400 resize-none"
          />
        </div>
      </div>

      {/* Items */}
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Transfer Items
          </h3>
          <button
            type="button"
            onClick={() =>
              append({ medicineId: "", medicineName: "", batchId: "", batchNo: "", requestedQty: 1 })
            }
            className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
          >
            <Plus size={12} /> Add Item
          </button>
        </div>

        <div className="space-y-4">
          {fields.map((field, idx) => (
            <div key={field.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Item {idx + 1}</span>
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Medicine <span className="text-red-400">*</span>
                </label>
                <MedicineCombobox
                  value={watchedItems[idx]?.medicineId ?? ""}
                  valueName={watchedItems[idx]?.medicineName ?? ""}
                  onSelect={(id, name) => {
                    setValue(`items.${idx}.medicineId`, id);
                    setValue(`items.${idx}.medicineName`, name);
                    setValue(`items.${idx}.batchId`, "");
                    setValue(`items.${idx}.batchNo`, "");
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">
                    Batch <span className="text-red-400">*</span>
                  </label>
                  <BatchSelect
                    medicineId={watchedItems[idx]?.medicineId ?? ""}
                    value={watchedItems[idx]?.batchId ?? ""}
                    onSelect={(id, batchNo, availableQty) => {
                      setValue(`items.${idx}.batchId`, id);
                      setValue(`items.${idx}.batchNo`, batchNo);
                      setValue(`items.${idx}.requestedQty`, availableQty);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Qty <span className="text-red-400">*</span>
                  </label>
                  <input
                    {...control.register(`items.${idx}.requestedQty`, {
                      valueAsNumber: true,
                      min: { value: 1, message: "Min 1" },
                    })}
                    type="number"
                    readOnly
                    title="Transfers always move a batch's full remaining quantity"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-100 text-slate-600 cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
        {rootError ? (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            <span>{rootError}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Select medicine then choose from available batches</span>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Create Transfer
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
