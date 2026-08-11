"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  Plus,
  Pencil,
  PowerOff,
  Power,
  Trash2,
  Star,
  MapPin,
  Phone,
  Mail,
  FileText,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  useBranches,
  useCreateBranch,
  useUpdateBranch,
  useToggleBranchActive,
  useDeleteBranch,
  rowsOf,
  extractError,
} from "@/queries/admin.queries";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  createdAt: string;
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

const EMPTY_FORM: BranchFormData = {
  name: "",
  code: "",
  address: "",
  phone: "",
  email: "",
  state: "",
  gstin: "",
  drugLicense20B: "",
  drugLicense21B: "",
  licenseeName: "",
  isHeadOffice: false,
};

// ─── Branch Form Modal ────────────────────────────────────────────────────────

function BranchFormModal({
  open,
  onClose,
  branch,
}: {
  open: boolean;
  onClose: () => void;
  branch: Branch | null;
}) {
  const isEdit = !!branch;
  const { success: toastOk, error: toastErr } = useToast();
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const isPending = create.isPending || update.isPending;

  const [form, setForm] = useState<BranchFormData>(() =>
    branch
      ? {
          name: branch.name,
          code: branch.code,
          address: branch.address,
          phone: branch.phone ?? "",
          email: branch.email ?? "",
          state: branch.state ?? "",
          gstin: branch.gstin ?? "",
          drugLicense20B: branch.drugLicense20B ?? "",
          drugLicense21B: branch.drugLicense21B ?? "",
          licenseeName: branch.licenseeName ?? "",
          isHeadOffice: branch.isHeadOffice,
        }
      : EMPTY_FORM,
  );

  // Reset form when modal opens for a different branch
  const [lastBranchId, setLastBranchId] = useState<string | null>(null);
  if (open && branch?.id !== lastBranchId) {
    setLastBranchId(branch?.id ?? null);
    setForm(
      branch
        ? {
            name: branch.name,
            code: branch.code,
            address: branch.address,
            phone: branch.phone ?? "",
            email: branch.email ?? "",
            state: branch.state ?? "",
            gstin: branch.gstin ?? "",
            drugLicense20B: branch.drugLicense20B ?? "",
            drugLicense21B: branch.drugLicense21B ?? "",
            licenseeName: branch.licenseeName ?? "",
            isHeadOffice: branch.isHeadOffice,
          }
        : EMPTY_FORM,
    );
  }
  if (!open && lastBranchId !== null) {
    setLastBranchId(null);
  }

  const set = (field: keyof BranchFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      address: form.address.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      state: form.state.trim() || undefined,
      gstin: form.gstin.trim() || undefined,
      drugLicense20B: form.drugLicense20B.trim() || undefined,
      drugLicense21B: form.drugLicense21B.trim() || undefined,
      licenseeName: form.licenseeName.trim() || undefined,
      isHeadOffice: form.isHeadOffice,
    };

    if (isEdit && branch) {
      update.mutate(
        { id: branch.id, data: payload },
        {
          onSuccess: () => {
            toastOk("Branch updated", `${payload.name} has been updated.`);
            onClose();
          },
          onError: (err) =>
            toastErr("Update failed", extractError(err, "Could not update branch")),
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toastOk("Branch created", `${payload.name} is ready.`);
          onClose();
        },
        onError: (err) =>
          toastErr("Create failed", extractError(err, "Could not create branch")),
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400";

  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Building2 size={16} className="text-emerald-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-800">
              {isEdit ? "Edit Branch" : "New Branch"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Row 1: Name + Code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Branch Name *</label>
              <input
                required
                className={inputCls}
                placeholder="e.g. Main Branch"
                value={form.name}
                onChange={set("name")}
              />
            </div>
            <div>
              <label className={labelCls}>Branch Code *</label>
              <input
                required
                maxLength={20}
                className={inputCls}
                placeholder="e.g. BR-001"
                value={form.code}
                onChange={set("code")}
              />
              <p className="text-[11px] text-slate-400 mt-1">Unique short identifier, auto-uppercased</p>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className={labelCls}>Address *</label>
            <textarea
              required
              rows={2}
              className={inputCls}
              placeholder="Full postal address"
              value={form.address}
              onChange={set("address")}
            />
          </div>

          {/* Row 2: Phone + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Phone</label>
              <input
                className={inputCls}
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={set("phone")}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                className={inputCls}
                placeholder="branch@pharmacy.com"
                value={form.email}
                onChange={set("email")}
              />
            </div>
          </div>

          {/* Row 3: State + GSTIN */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>State</label>
              <input
                className={inputCls}
                placeholder="e.g. Maharashtra"
                value={form.state}
                onChange={set("state")}
              />
              <p className="text-[11px] text-slate-400 mt-1">Drives intra vs inter-state GST</p>
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input
                maxLength={15}
                className={`${inputCls} uppercase`}
                placeholder="27AABCU9603R1ZX"
                value={form.gstin}
                onChange={set("gstin")}
              />
            </div>
          </div>

          {/* Drug Licenses */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Drug Licenses</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>License 20B</label>
                <input
                  className={inputCls}
                  placeholder="Drug License No. 20B"
                  value={form.drugLicense20B}
                  onChange={set("drugLicense20B")}
                />
              </div>
              <div>
                <label className={labelCls}>License 21B</label>
                <input
                  className={inputCls}
                  placeholder="Drug License No. 21B"
                  value={form.drugLicense21B}
                  onChange={set("drugLicense21B")}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Licensee Name</label>
              <input
                className={inputCls}
                placeholder="Name as on drug license"
                value={form.licenseeName}
                onChange={set("licenseeName")}
              />
            </div>
          </div>

          {/* Head Office toggle */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setForm((f) => ({ ...f, isHeadOffice: !f.isHeadOffice }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                form.isHeadOffice ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  form.isHeadOffice ? "left-5" : "left-1"
                }`}
              />
            </div>
            <div>
              <span className="text-sm font-medium text-slate-700">Head Office</span>
              <p className="text-xs text-slate-400">Only one branch should be marked Head Office</p>
            </div>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Create branch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete confirm inline ────────────────────────────────────────────────────

function DeleteConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <AlertTriangle size={13} className="text-red-500 shrink-0" />
      <span className="text-slate-600">Delete branch?</span>
      <button onClick={onConfirm} className="font-semibold text-red-600 hover:underline">
        Confirm
      </button>
      <button onClick={onCancel} className="text-slate-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function AdminBranchesView() {
  const { success: toastOk, error: toastErr } = useToast();
  const { data: raw, isLoading } = useBranches();
  const branches = rowsOf<Branch>(raw);
  const toggle = useToggleBranchActive();
  const del = useDeleteBranch();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const handleToggle = (b: Branch) => {
    toggle.mutate(
      { id: b.id, active: !b.isActive },
      {
        onSuccess: () =>
          toastOk(
            b.isActive ? "Branch deactivated" : "Branch activated",
            b.name,
          ),
        onError: (err) =>
          toastErr("Failed", extractError(err, "Could not toggle branch")),
      },
    );
  };

  const handleDelete = (b: Branch) => {
    del.mutate(b.id, {
      onSuccess: () => toastOk("Branch deleted", b.name),
      onError: (err) =>
        toastErr(
          "Cannot delete",
          extractError(err, "Branch has data — deactivate it instead"),
        ),
    });
    setConfirming(null);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {branches.length} branch{branches.length !== 1 ? "es" : ""} total
        </p>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
        >
          <Plus size={16} />
          Add Branch
        </button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Branch cards */}
      {!isLoading && branches.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No branches yet. Create your first one.</p>
        </div>
      )}

      {!isLoading && branches.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <div
              key={b.id}
              className={`rounded-xl border bg-white shadow-sm flex flex-col transition-all ${
                b.isActive
                  ? "border-slate-200"
                  : "border-slate-200 opacity-60"
              }`}
            >
              {/* Card header */}
              <div className="px-4 pt-4 pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-semibold text-slate-800 text-sm truncate">
                        {b.name}
                      </h3>
                      {b.isHeadOffice && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                          <Star size={9} fill="currentColor" />
                          HO
                        </span>
                      )}
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          b.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {b.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono mt-0.5 block">
                      {b.code}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card body */}
              <div className="px-4 py-3 space-y-2 flex-1 text-xs text-slate-600">
                <InfoRow icon={MapPin} value={b.address} />
                {b.phone && <InfoRow icon={Phone} value={b.phone} />}
                {b.email && <InfoRow icon={Mail} value={b.email} />}
                {b.gstin && (
                  <InfoRow icon={FileText} value={`GSTIN: ${b.gstin}`} />
                )}
                {b.state && (
                  <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                    {b.state}
                  </span>
                )}
                {(b.drugLicense20B || b.drugLicense21B) && (
                  <div className="text-[11px] text-slate-400 space-y-0.5 pt-1">
                    {b.drugLicense20B && <div>Lic 20B: {b.drugLicense20B}</div>}
                    {b.drugLicense21B && <div>Lic 21B: {b.drugLicense21B}</div>}
                    {b.licenseeName && <div>Licensee: {b.licenseeName}</div>}
                  </div>
                )}
              </div>

              {/* Card footer — actions */}
              <div className="px-4 py-3 border-t border-slate-100">
                {confirming === `delete:${b.id}` ? (
                  <DeleteConfirm
                    onConfirm={() => handleDelete(b)}
                    onCancel={() => setConfirming(null)}
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <ActionBtn
                      title="Edit branch"
                      icon={Pencil}
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                    />
                    <ActionBtn
                      title={b.isActive ? "Deactivate" : "Activate"}
                      icon={b.isActive ? PowerOff : Power}
                      tone={b.isActive ? "warn" : "success"}
                      onClick={() => handleToggle(b)}
                    />
                    {!b.isHeadOffice && (
                      <ActionBtn
                        title="Delete branch"
                        icon={Trash2}
                        tone="danger"
                        onClick={() => setConfirming(`delete:${b.id}`)}
                      />
                    )}
                    <span className="ml-auto text-[11px] text-slate-400">
                      {new Date(b.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <BranchFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        branch={editing}
      />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  value,
}: {
  icon: React.ElementType;
  value: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon size={12} className="text-slate-400 shrink-0 mt-0.5" />
      <span className="leading-relaxed break-all">{value}</span>
    </div>
  );
}

function ActionBtn({
  title,
  icon: Icon,
  onClick,
  tone = "default",
}: {
  title: string;
  icon: React.ElementType;
  onClick: () => void;
  tone?: "default" | "warn" | "danger" | "success";
}) {
  const cls =
    tone === "danger"
      ? "text-red-500 hover:bg-red-50"
      : tone === "warn"
        ? "text-amber-500 hover:bg-amber-50"
        : tone === "success"
          ? "text-emerald-600 hover:bg-emerald-50"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";

  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`p-1.5 rounded-lg transition-colors ${cls}`}
    >
      <Icon size={14} />
    </button>
  );
}
