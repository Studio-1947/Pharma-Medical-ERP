"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMedicineSchema, type CreateMedicineDto } from "@pharmerp/types";
import { apiClient, queryKeys } from "@/lib/api-client";
import { isControlledScheduleClass } from "@/lib/schedule-class";
import { BarcodeScannerDialog } from "@/components/shared/barcode-scanner-dialog";
import {
  Pill,
  Barcode,
  DollarSign,
  Package,
  ShieldAlert,
  FileText,
  AlertCircle,
  CheckCircle2,
  Camera,
  Loader2,
} from "lucide-react";

interface Props {
  initial?: Partial<CreateMedicineDto> & { id?: string };
  onSuccess?: () => void;
  onCancel?: () => void;
}

const SCHEDULE_OPTIONS = [
  { value: "", label: "OTC — Over the Counter", color: "text-emerald-700 bg-emerald-50" },
  { value: "G",  label: "Schedule G",           color: "text-amber-700 bg-amber-50" },
  { value: "H",  label: "Schedule H",           color: "text-orange-700 bg-orange-50" },
  { value: "H1", label: "Schedule H1",          color: "text-red-700 bg-red-50" },
  { value: "X",  label: "Schedule X (Narcotic)","color": "text-teal-700 bg-teal-50" },
] as const;

const UNIT_OPTIONS = [
  { value: "strip",   label: "Strip" },
  { value: "bottle",  label: "Bottle" },
  { value: "vial",    label: "Vial" },
  { value: "tube",    label: "Tube" },
  { value: "sachet",  label: "Sachet" },
  { value: "unit",    label: "Unit" },
  { value: "box",     label: "Box" },
  { value: "ampoule", label: "Ampoule" },
];

const GST_OPTIONS = [
  { value: "0",   label: "0% — Exempt" },
  { value: "5",   label: "5% GST" },
  { value: "12",  label: "12% GST" },
  { value: "18",  label: "18% GST" },
];

export function MedicineForm({ initial, onSuccess, onCancel }: Props) {
  const qc = useQueryClient();
  const isEdit = !!initial?.id;
  const [cameraOpen, setCameraOpen] = useState(false);

  // Categories are created on the fly by catalogue imports, so the picker is
  // loaded rather than hardcoded.
  const { data: categoryRes } = useQuery({
    queryKey: ["medicine-categories"],
    queryFn: () => apiClient.get("/inventory/categories") as Promise<any>,
    staleTime: 5 * 60_000,
  });
  const categories: { id: string; name: string }[] = (() => {
    const d = (categoryRes as any)?.data ?? categoryRes;
    return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
  })();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting, isDirty },
    setError,
  } = useForm<CreateMedicineDto>({
    resolver: zodResolver(createMedicineSchema),
    defaultValues: initial
      ? (initial as CreateMedicineDto)
      : ({
          isActive: true,
          requiresPrescription: false,
          isControlled: false,
          stripSize: 1,
          reorderLevel: 10,
          unit: "box",
        } as any),
  });

  const { data: fullRes, isLoading: loadingFull } = useQuery({
    queryKey: queryKeys.medicines.detail(initial?.id ?? ""),
    queryFn: () => apiClient.get(`/inventory/medicines/${initial!.id}`) as Promise<any>,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!isEdit || !fullRes) return;
    const d = (fullRes as any)?.data?.data ?? (fullRes as any)?.data ?? fullRes;
    if (!d?.id) return;
    reset({
      ...(d as CreateMedicineDto),
      brandName: d.brandName ?? "",
      genericName: d.genericName ?? "",
      composition: d.composition ?? "",
      strength: d.strength ?? "",
      dosageForm: d.dosageForm ?? "",
      packSize: d.packSize ?? "",
      barcode: d.barcode ?? "",
      categoryId: d.categoryId ?? "",
      therapeuticClass: d.therapeuticClass ?? "",
      manufacturer: d.manufacturer ?? "",
      hsnCode: d.hsnCode ?? "",
      purchaseRate: d.purchaseRate ?? "",
      scheduleClass: d.scheduleClass ?? "",
      storageConditions: d.storageConditions ?? "",
      drawerMapping: d.drawerMapping ?? "",
      description: d.description ?? "",
    });
  }, [fullRes, isEdit, reset]);

  const scheduleVal = watch("scheduleClass");
  const scheduleOption = SCHEDULE_OPTIONS.find((o) => o.value === scheduleVal) ?? SCHEDULE_OPTIONS[0];

  useEffect(() => {
    // The dropdown above emits bare letters ("H"), so a "SCHEDULE_H" match
    // never fired and a hand-added Schedule H medicine saved as
    // requires_prescription = false.
    if (isControlledScheduleClass(scheduleVal)) {
      setValue("requiresPrescription", true, { shouldDirty: true });
      setValue("isControlled", true, { shouldDirty: true });
    }
  }, [scheduleVal, setValue]);

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
        message: err?.response?.data?.message ?? "Save failed. Please try again.",
      });
    },
  });

  const onSubmit = (data: CreateMedicineDto) => mutation.mutate(data);

  // Blocks submitting a partially-populated form: until the full record lands,
  // the untouched fields would post back as blanks.
  if (isEdit && loadingFull) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="animate-spin" size={22} />
        <p className="text-sm">Loading full record...</p>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col flex-1 min-h-0"
        // Typed-but-unsaved fields would be thrown away by the background
        // auto-reload that applies a new app version, so hold it off while the
        // form is dirty. PwaRegister reads this; the explicit prompt still shows.
        data-pharmerp-unsaved={isDirty || isSubmitting ? "medicine-form" : undefined}
      >
        {/* ── Scrollable body ──────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {/* Content goes here... but wait, let's keep it wrapped */}
          {/* We will just output the form block, and append the dialog below it */}

      {/* ── Section 1: Basic Information ─────────────────────────────── */}
      <Section icon={<Pill size={14} />} title="Basic Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Medicine Name" required error={errors.name?.message}>
            <input
              {...register("name")}
              placeholder="e.g. Paracetamol 500mg"
              className={inputCls(!!errors.name)}
            />
          </Field>

          <Field
            label="Brand Name"
            hint="Marketed brand as staff know it at the counter (e.g. Dolo)"
            error={errors.brandName?.message}
          >
            <input
              {...register("brandName")}
              placeholder="e.g. Dolo"
              className={inputCls(!!errors.brandName)}
            />
          </Field>

          <Field label="Generic Name" error={errors.genericName?.message}>
            <input
              {...register("genericName")}
              placeholder="e.g. Acetaminophen"
              className={inputCls(!!errors.genericName)}
            />
          </Field>

          <Field
            label="Composition"
            hint="Full ingredient list with amounts"
            error={errors.composition?.message}
          >
            <input
              {...register("composition")}
              placeholder="e.g. Amoxicillin 500 mg + Clavulanic Acid 125 mg"
              className={inputCls(!!errors.composition)}
            />
          </Field>

          <Field label="Strength" error={errors.strength?.message}>
            <input
              {...register("strength")}
              placeholder="e.g. 650 mg"
              className={inputCls(!!errors.strength)}
            />
          </Field>

          <Field label="Dosage Form" error={errors.dosageForm?.message}>
            <input
              {...register("dosageForm")}
              placeholder="e.g. Tablet, Syrup, Injection"
              className={inputCls(!!errors.dosageForm)}
            />
          </Field>

          <Field
            label="Pack Size"
            hint="Pack label as sold (e.g. 10x10 Tablets)"
            error={errors.packSize?.message}
          >
            <input
              {...register("packSize")}
              placeholder="e.g. 10x10 Tablets"
              className={inputCls(!!errors.packSize)}
            />
          </Field>

          <Field
            label="SKU / Code"
            error={errors.sku?.message}
            hint="Leave blank to auto-generate (MED00001, MED00002…)"
          >
            <input
              {...register("sku")}
              placeholder="Auto-generated if left blank"
              className={`${inputCls(!!errors.sku)} font-mono`}
            />
          </Field>

          <Field label="Barcode" error={errors.barcode?.message}>
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <Barcode size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  {...register("barcode")}
                  placeholder="EAN / UPC barcode"
                  className={`${inputCls(!!errors.barcode)} pl-8`}
                />
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="px-3 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 transition flex items-center justify-center shadow-sm"
                title="Scan Barcode with Camera"
              >
                <Camera size={15} />
              </button>
            </div>
          </Field>

          <Field label="Manufacturer" error={errors.manufacturer?.message}>
            <input
              {...register("manufacturer")}
              placeholder="e.g. Cipla Ltd"
              className={inputCls(!!errors.manufacturer)}
            />
          </Field>

          <Field label="HSN Code" error={errors.hsnCode?.message}>
            <input
              {...register("hsnCode")}
              placeholder="e.g. 30049099"
              className={`${inputCls(!!errors.hsnCode)} font-mono`}
            />
          </Field>

          <Field
            label="Therapeutic Class"
            hint="Pharmacological class, narrower than the shelf category"
            error={errors.therapeuticClass?.message}
          >
            <input
              {...register("therapeuticClass")}
              placeholder="e.g. Cephalosporin Antibiotic"
              className={inputCls(!!errors.therapeuticClass)}
            />
          </Field>

          <Field label="Category" error={errors.categoryId?.message}>
            <select {...register("categoryId")} className={selectCls(!!errors.categoryId)}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* ── Section 2: Pricing & Tax ──────────────────────────────────── */}
      <Section icon={<DollarSign size={14} />} title="Pricing &amp; Tax">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <Field label="MRP (INR)" required error={errors.priceMrp?.message}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">₹</span>
              <input
                {...register("priceMrp")}
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className={`${inputCls(!!errors.priceMrp)} pl-7`}
              />
            </div>
          </Field>

          <Field
            label="Purchase Rate (INR)"
            hint="Catalogue cost from the supplier — advisory; each batch records its own cost"
            error={errors.purchaseRate?.message}
          >
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">₹</span>
              <input
                {...register("purchaseRate")}
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className={`${inputCls(!!errors.purchaseRate)} pl-7`}
              />
            </div>
          </Field>

          <Field label="GST Rate" error={errors.taxPercent?.message}>
            <select {...register("taxPercent")} className={selectCls(!!errors.taxPercent)}>
              {GST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Pack / Unit" required error={errors.unit?.message}>
            <select {...register("unit")} className={selectCls(!!errors.unit)}>
              {UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Tablets / Units per Pack"
            hint="How many individual units are in one pack (e.g. 10 tablets per strip)"
            error={errors.stripSize?.message}
          >
            <input
              {...register("stripSize", { valueAsNumber: true })}
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 10"
              className={inputCls(!!errors.stripSize)}
            />
          </Field>
        </div>
      </Section>

      {/* ── Section 3: Stock & Reorder ────────────────────────────────── */}
      <Section icon={<Package size={14} />} title="Stock &amp; Reorder">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <Field
            label="Reorder Level"
            hint="Alert triggers when stock falls below this"
            error={errors.reorderLevel?.message}
          >
            <input
              {...register("reorderLevel", { valueAsNumber: true })}
              type="number"
              min="0"
              placeholder="10"
              className={inputCls(!!errors.reorderLevel)}
            />
          </Field>

          <Field
            label="Reorder Quantity"
            hint="Suggested quantity to order when restocking"
            error={errors.reorderQty?.message}
          >
            <input
              {...register("reorderQty", { valueAsNumber: true })}
              type="number"
              min="0"
              placeholder="50"
              className={inputCls(!!errors.reorderQty)}
            />
          </Field>
        </div>
      </Section>

      {/* ── Section 4: Classification ─────────────────────────────────── */}
      <Section icon={<ShieldAlert size={14} />} title="Classification &amp; Compliance">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Schedule Class" error={errors.scheduleClass?.message}>
            <div className="relative">
              <select {...register("scheduleClass")} className={selectCls(!!errors.scheduleClass)}>
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {scheduleVal && (
                <span className={`absolute right-9 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded pointer-events-none ${scheduleOption.color}`}>
                  {scheduleVal || "OTC"}
                </span>
              )}
            </div>
          </Field>

          <div className="flex flex-col gap-3 pt-1">
            <CheckboxField
              {...register("requiresPrescription")}
              label="Requires Prescription"
              description="Cannot be dispensed without a valid Rx"
            />
            <CheckboxField
              {...register("isControlled")}
              label="Controlled Substance"
              description="Subject to additional regulatory tracking"
            />
          </div>
        </div>
      </Section>

      {/* ── Section 5: Additional ────────────────────────────────────── */}
      <Section icon={<FileText size={14} />} title="Additional Information" last>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Storage Conditions" error={errors.storageConditions?.message}>
              <input
                {...register("storageConditions")}
                placeholder="e.g. Store below 25°C, protect from direct sunlight"
                className={inputCls(!!errors.storageConditions)}
              />
            </Field>

            <Field
              label="Drawer Mapping"
              hint="Counter drawer or pigeonhole label used to pick this product"
              error={errors.drawerMapping?.message}
            >
              <input
                {...register("drawerMapping")}
                placeholder="e.g. D-14"
                className={inputCls(!!errors.drawerMapping)}
              />
            </Field>
          </div>

          <Field label="Description / Notes" error={errors.description?.message}>
            <textarea
              {...register("description")}
              rows={3}
              placeholder="Optional: usage instructions, or internal notes"
              className={`${inputCls(!!errors.description)} resize-none`}
            />
          </Field>

          {/* Sellability. A catalogue import parks rows here inactive when the
              sheet carried no MRP, and there was previously no way to switch
              one back on — the product stayed unsellable however it was edited. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <CheckboxField
              {...register("isActive")}
              label="Active — available for sale"
              description="Inactive products stay in the catalogue but are hidden from POS search and barcode scanning."
            />
            {isEdit && initial?.isActive === false && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                This product was imported without a price and is not sellable. Set an
                MRP above, then tick Active.
              </p>
            )}
          </div>
        </div>
      </Section>

      </div>{/* end scrollable body */}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
        {errors.root ? (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errors.root.message}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">
            {isEdit ? "Editing existing record" : "All fields marked * are required"}
          </span>
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
            disabled={isSubmitting || (!isDirty && isEdit)}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                {isEdit ? "Save Changes" : "Add Medicine"}
              </>
            )}
          </button>
        </div>
      </div>
      </form>
      <BarcodeScannerDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={(code) => {
          setValue("barcode", code, { shouldDirty: true, shouldValidate: true });
          setCameraOpen(false);
        }}
      />
    </>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function Section({
  icon,
  title,
  children,
  last = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`px-6 py-5 ${!last ? "border-b border-slate-100" : ""}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-slate-400">{icon}</span>
        <h3
          className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
          dangerouslySetInnerHTML={{ __html: title }}
        />
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[11px] text-slate-400 mt-1">{hint}</p>
      )}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-500 mt-1">
          <AlertCircle size={10} className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

import { forwardRef } from "react";

const CheckboxField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    description?: string;
    name: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    onBlur: React.FocusEventHandler<HTMLInputElement>;
  }
>(function CheckboxField({ label, description, ...rest }, ref) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          ref={ref}
          {...rest}
          className="sr-only peer"
        />
        <div className="w-4 h-4 border-2 border-slate-300 rounded peer-checked:border-emerald-600 peer-checked:bg-emerald-600 transition-colors group-hover:border-slate-400 flex items-center justify-center">
          <svg
            className="w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity"
            viewBox="0 0 10 8"
            fill="none"
          >
            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {description && (
          <p className="text-[11px] text-slate-400 mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
});

/* ── Style helpers ──────────────────────────────────────────────────────── */

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

const selectCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow appearance-none",
    "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M4%206l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')]",
    "bg-no-repeat bg-[right_0.5rem_center] bg-[length:1.25em_1.25em] pr-9",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");
