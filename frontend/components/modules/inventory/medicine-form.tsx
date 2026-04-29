"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMedicineSchema, type CreateMedicineDto } from "@pharmerp/types";
import { apiClient, queryKeys } from "@/lib/api-client";

interface Props {
  /** Pass existing medicine to switch to edit mode */
  initial?: Partial<CreateMedicineDto> & { id?: string };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MedicineForm({ initial, onSuccess, onCancel }: Props) {
  const qc = useQueryClient();
  const isEdit = !!initial?.id;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<CreateMedicineDto>({
    resolver: zodResolver(createMedicineSchema),
    defaultValues: initial as CreateMedicineDto,
  });

  const mutation = useMutation({
    mutationFn: (data: CreateMedicineDto) =>
      isEdit
        ? apiClient.patch(`/inventory/medicines/${initial!.id}`, data)
        : apiClient.post("/inventory/medicines", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.medicines.all() });
      onSuccess?.();
    },
    onError: (err: any) => {
      setError("root", {
        message: err?.response?.data?.message ?? "Save failed",
      });
    },
  });

  const onSubmit = (data: CreateMedicineDto) => mutation.mutate(data);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name *" error={errors.name?.message}>
          <input {...register("name")} placeholder="Paracetamol 500mg" className={inputCls} />
        </Field>

        <Field label="Generic Name" error={errors.genericName?.message}>
          <input {...register("genericName")} placeholder="Acetaminophen" className={inputCls} />
        </Field>

        <Field label="SKU *" error={errors.sku?.message}>
          <input {...register("sku")} placeholder="PCM-500-STR" className={inputCls} />
        </Field>

        <Field label="Barcode" error={errors.barcode?.message}>
          <input {...register("barcode")} placeholder="8901234567890" className={inputCls} />
        </Field>

        <Field label="Manufacturer" error={errors.manufacturer?.message}>
          <input {...register("manufacturer")} placeholder="Cipla Ltd" className={inputCls} />
        </Field>

        <Field label="HSN Code" error={errors.hsnCode?.message}>
          <input {...register("hsnCode")} placeholder="30049099" className={inputCls} />
        </Field>

        <Field label="Unit *" error={errors.unit?.message}>
          <select {...register("unit")} className={inputCls}>
            <option value="strip">Strip</option>
            <option value="bottle">Bottle</option>
            <option value="vial">Vial</option>
            <option value="tube">Tube</option>
            <option value="sachet">Sachet</option>
            <option value="unit">Unit</option>
          </select>
        </Field>

        <Field label="MRP (INR) *" error={errors.priceMrp?.message}>
          <input
            {...register("priceMrp")}
            type="number"
            step="0.01"
            min="0"
            placeholder="25.00"
            className={inputCls}
          />
        </Field>

        <Field label="Tax %" error={errors.taxPercent?.message}>
          <input
            {...register("taxPercent")}
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="12"
            className={inputCls}
          />
        </Field>

        <Field label="Reorder Level" error={errors.reorderLevel?.message}>
          <input
            {...register("reorderLevel", { valueAsNumber: true })}
            type="number"
            min="0"
            placeholder="10"
            className={inputCls}
          />
        </Field>

        <Field label="Reorder Qty" error={errors.reorderQty?.message}>
          <input
            {...register("reorderQty", { valueAsNumber: true })}
            type="number"
            min="0"
            placeholder="50"
            className={inputCls}
          />
        </Field>

        <Field label="Schedule Class" error={errors.scheduleClass?.message}>
          <select {...register("scheduleClass")} className={inputCls}>
            <option value="">— OTC —</option>
            <option value="G">Schedule G</option>
            <option value="H">Schedule H</option>
            <option value="H1">Schedule H1</option>
            <option value="X">Schedule X</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            {...register("requiresPrescription")}
            type="checkbox"
            className="h-4 w-4"
          />
          Requires Prescription
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            {...register("isControlled")}
            type="checkbox"
            className="h-4 w-4"
          />
          Controlled Substance
        </label>
      </div>

      <Field label="Storage Conditions" error={errors.storageConditions?.message}>
        <input
          {...register("storageConditions")}
          placeholder="e.g. Store below 25°C, away from sunlight"
          className={inputCls}
        />
      </Field>

      <Field label="Description" error={errors.description?.message}>
        <textarea
          {...register("description")}
          rows={2}
          className={inputCls}
          placeholder="Optional notes"
        />
      </Field>

      {errors.root && (
        <p className="text-red-500 text-sm">{errors.root.message}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {isSubmitting ? "Saving..." : isEdit ? "Update Medicine" : "Create Medicine"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background";
