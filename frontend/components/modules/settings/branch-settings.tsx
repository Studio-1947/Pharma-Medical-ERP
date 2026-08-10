"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  FileText,
  Plus,
  Edit2,
  Trash2,
  X,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";

interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  gstin?: string | null;
  drugLicense20B?: string | null;
  drugLicense21B?: string | null;
  licenseeName?: string | null;
  isHeadOffice: boolean;
  isActive: boolean;
}

interface BranchFormData {
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  state: string;
  gstin: string;
  drugLicense20B: string;
  drugLicense21B: string;
  licenseeName: string;
  isHeadOffice: boolean;
}

const inputCls =
  "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white";

function BranchForm({
  branch,
  onSuccess,
  onCancel,
}: {
  branch?: Branch;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BranchFormData>({
    defaultValues: {
      name: branch?.name ?? "",
      code: branch?.code ?? "",
      address: branch?.address ?? "",
      phone: branch?.phone ?? "",
      email: branch?.email ?? "",
      state: branch?.state ?? "",
      gstin: branch?.gstin ?? "",
      drugLicense20B: branch?.drugLicense20B ?? "",
      drugLicense21B: branch?.drugLicense21B ?? "",
      licenseeName: branch?.licenseeName ?? "",
      isHeadOffice: branch?.isHeadOffice ?? false,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: BranchFormData) => {
      const payload = {
        ...data,
        phone: data.phone || undefined,
        email: data.email || undefined,
        state: data.state || undefined,
        gstin: data.gstin || undefined,
        drugLicense20B: data.drugLicense20B || undefined,
        drugLicense21B: data.drugLicense21B || undefined,
        licenseeName: data.licenseeName || undefined,
      };
      return branch
        ? apiClient.patch(`/branches/${branch.id}`, payload)
        : apiClient.post("/branches", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      onSuccess();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to save branch."),
  });

  return (
    <form
      onSubmit={handleSubmit((d) => {
        setError(null);
        mutation.mutate(d);
      })}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Branch Name <span className="text-red-500">*</span>
          </label>
          <input
            {...register("name", { required: "Required" })}
            placeholder="Main Branch"
            className={inputCls}
          />
          {errors.name && (
            <p className="text-xs text-red-500">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Code <span className="text-red-500">*</span>
          </label>
          <input
            {...register("code", { required: "Required" })}
            placeholder="BRN01"
            className={inputCls}
          />
          {errors.code && (
            <p className="text-xs text-red-500">{errors.code.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">State</label>
          <input
            {...register("state")}
            placeholder="Maharashtra"
            className={inputCls}
          />
        </div>

        <div className="col-span-2 space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Address <span className="text-red-500">*</span>
          </label>
          <textarea
            {...register("address", { required: "Required" })}
            rows={2}
            placeholder="Full address"
            className={`${inputCls} resize-none`}
          />
          {errors.address && (
            <p className="text-xs text-red-500">{errors.address.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Phone</label>
          <input
            {...register("phone")}
            placeholder="+91 98765 43210"
            className={inputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Email</label>
          <input
            {...register("email")}
            type="email"
            placeholder="branch@pharma.com"
            className={inputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">GSTIN</label>
          <input
            {...register("gstin")}
            placeholder="19ABCDE1234F1Z5"
            className={inputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Licensee Name
          </label>
          <input
            {...register("licenseeName")}
            placeholder="Radha Madhav Medical Hall"
            className={inputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Drug License 20B (Retail)
          </label>
          <input
            {...register("drugLicense20B")}
            placeholder="WB/CAL/20B/104928"
            className={inputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">
            Drug License 21B (Wholesale)
          </label>
          <input
            {...register("drugLicense21B")}
            placeholder="WB/CAL/21B/104929"
            className={inputCls}
          />
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <input
            {...register("isHeadOffice")}
            type="checkbox"
            id="isHeadOffice"
            className="w-4 h-4"
          />
          <label htmlFor="isHeadOffice" className="text-sm text-slate-700">
            This is the head office
          </label>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-all"
        >
          {isSubmitting
            ? "Saving..."
            : branch
            ? "Update Branch"
            : "Create Branch"}
        </button>
      </div>
    </form>
  );
}

export function BranchSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);

  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const queryClient = useQueryClient();

  const isSuperAdmin = user?.role === "super_admin";

  const { data, isLoading } = useQuery<any>({
    queryKey: ["branches"],
    queryFn: () => apiClient.get("/branches"),
    retry: 1,
  });

  const branches: Branch[] = Array.isArray(data) ? data : data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/branches/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      toastSuccess("Branch deleted", "The branch has been removed successfully.");
      setDeletingBranch(null);
    },
    onError: (err: any) => {
      toastError(
        "Cannot delete branch",
        err?.response?.data?.message ?? "Failed to delete branch.",
      );
    },
  });

  if (showForm || editing) {
    return (
      <div className="max-w-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">
            {editing ? `Edit: ${editing.name}` : "New Branch"}
          </h3>
          <button
            onClick={() => {
              setShowForm(false);
              setEditing(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <BranchForm
          branch={editing ?? undefined}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isSuperAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus size={15} /> Add Branch
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          Loading branches...
        </div>
      )}

      {!isLoading && branches.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No branches configured. Add your first branch.
        </div>
      )}

      {branches.map((branch) => (
        <div
          key={branch.id}
          className="rounded-xl border bg-white p-5 space-y-3 shadow-2xs hover:shadow-xs transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0 border border-emerald-100">
                <Building2 size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-800">
                    {branch.name}
                  </h3>
                  {branch.isHeadOffice && (
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
                      HQ
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {branch.code}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  branch.isActive
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {branch.isActive ? "Active" : "Inactive"}
              </span>
              <button
                onClick={() => setEditing(branch)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
                title="Edit branch"
              >
                <Edit2 size={14} />
              </button>

              {/* Super Admin Delete Option */}
              {isSuperAdmin && (
                <button
                  onClick={() => setDeletingBranch(branch)}
                  className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                  title="Delete branch (Super Admin only)"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm pt-1">
            {branch.address && (
              <div className="flex items-start gap-2 text-slate-600">
                <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
                <span className="text-xs">
                  {branch.address}
                  {branch.state ? `, ${branch.state}` : ""}
                </span>
              </div>
            )}
            {branch.phone && (
              <div className="flex items-center gap-2 text-slate-600">
                <Phone size={13} className="shrink-0 text-slate-400" />
                <span className="text-xs">{branch.phone}</span>
              </div>
            )}
            {branch.email && (
              <div className="flex items-center gap-2 text-slate-600">
                <Mail size={13} className="shrink-0 text-slate-400" />
                <span className="text-xs">{branch.email}</span>
              </div>
            )}
            {branch.gstin && (
              <div className="flex items-center gap-2 text-slate-600">
                <FileText size={13} className="shrink-0 text-slate-400" />
                <span className="text-xs font-mono font-semibold">
                  GSTIN: {branch.gstin}
                </span>
              </div>
            )}
            {branch.drugLicense20B && (
              <div className="flex items-center gap-2 text-slate-600">
                <FileText size={13} className="shrink-0 text-slate-400" />
                <span className="text-xs font-mono">
                  DL 20B: {branch.drugLicense20B}
                </span>
              </div>
            )}
            {branch.drugLicense21B && (
              <div className="flex items-center gap-2 text-slate-600">
                <FileText size={13} className="shrink-0 text-slate-400" />
                <span className="text-xs font-mono">
                  DL 21B: {branch.drugLicense21B}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Delete Confirmation Modal for Super Admin */}
      {deletingBranch && (
        <Modal
          title="Delete Branch"
          subtitle={`Permanently remove "${deletingBranch.name}" (${deletingBranch.code})`}
          icon={<AlertTriangle size={18} className="text-rose-600" />}
          open={!!deletingBranch}
          onClose={() => setDeletingBranch(null)}
        >
          <div className="p-6 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900">{deletingBranch.name}</strong>? This action is permanent and restricted to <strong className="text-slate-900">Super Admins</strong>.
            </p>
            <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 text-amber-600 mt-0.5" />
              <span>
                Branches with active stock batches, sales invoices, or assigned staff cannot be hard-deleted to preserve accounting integrity. Deactivate them instead if they have transactions.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingBranch(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletingBranch.id)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={13} /> Delete Branch
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
