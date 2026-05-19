"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface TransferItemInput {
  medicineId: string;
  batchId: string;
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

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-blue-100 focus:border-blue-400 bg-white hover:border-slate-300",
  ].join(" ");

export function TransferForm({ onSuccess, onCancel }: Props) {
  const [rootError, setRootError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TransferFormData>({
    defaultValues: {
      fromWarehouseId: "",
      toWarehouseId: "",
      notes: "",
      items: [{ medicineId: "", batchId: "", requestedQty: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const mutation = useMutation({
    mutationFn: (data: TransferFormData) =>
      apiClient.post("/distribution/transfers", data),
    onSuccess: () => onSuccess?.(),
    onError: (err: any) =>
      setRootError(err?.response?.data?.message ?? "Failed to create transfer."),
  });

  const onSubmit = (data: TransferFormData) => {
    setRootError(null);
    mutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="px-6 py-5 space-y-4 border-b border-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              From Warehouse / Branch <span className="text-red-500">*</span>
            </label>
            <input
              {...register("fromWarehouseId", { required: "Required" })}
              placeholder="Warehouse ID"
              className={inputCls(!!errors.fromWarehouseId)}
            />
            {errors.fromWarehouseId && (
              <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={10} /> {errors.fromWarehouseId.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              To Warehouse / Branch <span className="text-red-500">*</span>
            </label>
            <input
              {...register("toWarehouseId", { required: "Required" })}
              placeholder="Warehouse ID"
              className={inputCls(!!errors.toWarehouseId)}
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
            {...register("notes")}
            rows={2}
            placeholder="Optional transfer notes or instructions"
            className={`${inputCls()} resize-none`}
          />
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Transfer Items
          </h3>
          <button
            type="button"
            onClick={() => append({ medicineId: "", batchId: "", requestedQty: 1 })}
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <Plus size={12} /> Add Item
          </button>
        </div>

        <div className="space-y-2">
          {fields.map((field, idx) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1">
                <input
                  {...register(`items.${idx}.medicineId`, { required: "Required" })}
                  placeholder="Medicine ID (UUID)"
                  className={inputCls(!!errors.items?.[idx]?.medicineId)}
                />
              </div>
              <div className="flex-1">
                <input
                  {...register(`items.${idx}.batchId`, { required: "Required" })}
                  placeholder="Batch ID (UUID)"
                  className={inputCls(!!errors.items?.[idx]?.batchId)}
                />
              </div>
              <div className="w-24">
                <input
                  {...register(`items.${idx}.requestedQty`, {
                    required: "Required",
                    valueAsNumber: true,
                    min: { value: 1, message: "Min 1" },
                  })}
                  type="number"
                  min="1"
                  placeholder="Qty"
                  className={inputCls(!!errors.items?.[idx]?.requestedQty)}
                />
              </div>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="mt-2 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
        {rootError ? (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            <span>{rootError}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">All fields marked * are required</span>
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
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
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
