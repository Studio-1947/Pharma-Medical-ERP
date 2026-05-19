"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Building2, MapPin, Phone, Mail, FileText, Plus, Edit2, X, AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
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
    <form onSubmit={handleSubmit((d) => { setError(null); mutation.mutate(d); })} className="space-y-4">
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
          {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
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
          {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">State</label>
          <input {...register("state")} placeholder="Maharashtra" className={inputCls} />
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
          {errors.address && <p className="text-xs text-red-500">{errors.address.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Phone</label>
          <input {...register("phone")} placeholder="+91 98765 43210" className={inputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Email</label>
          <input {...register("email")} type="email" placeholder="branch@pharma.com" className={inputCls} />
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <input {...register("isHeadOffice")} type="checkbox" id="isHeadOffice" className="w-4 h-4" />
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
          {isSubmitting ? "Saving..." : branch ? "Update Branch" : "Create Branch"}
        </button>
      </div>
    </form>
  );
}

export function BranchSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["branches"],
    queryFn: () => apiClient.get("/branches"),
    retry: 1,
  });

  const branches: Branch[] = Array.isArray(data) ? data : data?.data ?? [];

  if (showForm || editing) {
    return (
      <div className="max-w-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">
            {editing ? `Edit: ${editing.name}` : "New Branch"}
          </h3>
          <button
            onClick={() => { setShowForm(false); setEditing(null); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <BranchForm
          branch={editing ?? undefined}
          onSuccess={() => { setShowForm(false); setEditing(null); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus size={15} /> Add Branch
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">Loading branches...</div>
      )}

      {!isLoading && branches.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No branches configured. Add your first branch.
        </div>
      )}

      {branches.map((branch) => (
        <div key={branch.id} className="rounded-xl border bg-white p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <Building2 size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-800">{branch.name}</h3>
                  {branch.isHeadOffice && (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-semibold rounded">
                      HQ
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{branch.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  branch.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}
              >
                {branch.isActive ? "Active" : "Inactive"}
              </span>
              <button
                onClick={() => setEditing(branch)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Edit branch"
              >
                <Edit2 size={14} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
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
          </div>
        </div>
      ))}
    </div>
  );
}
