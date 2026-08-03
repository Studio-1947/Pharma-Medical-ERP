"use client";

import { useEffect, useState } from "react";
import { UserPlus, UserCog, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  useBranches,
  useCreateUser,
  useUpdateUser,
  rowsOf,
  extractError,
} from "@/queries/admin.queries";
import { ROLE_OPTIONS, roleLabel } from "./role-meta";

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

const labelCls = "block text-xs font-medium text-slate-600 mb-1.5";

export interface EditableUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  branchId?: string | null;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Omit to create. */
  user?: EditableUser | null;
}

interface FormState {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId: string;
}

const EMPTY: FormState = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  role: "cashier",
  branchId: "",
};

export function UserFormModal({ open, onClose, user }: Props) {
  const isEdit = !!user;
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data: branchesRaw } = useBranches();
  const branches = rowsOf<any>(branchesRaw);

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      user
        ? {
            email: user.email,
            password: "",
            firstName: user.firstName ?? "",
            lastName: user.lastName ?? "",
            role: user.role,
            branchId: user.branchId ?? "",
          }
        : EMPTY,
    );
  }, [open, user]);

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // A super_admin is the one role that legitimately has no branch; sending
    // "" would fail uuid validation.
    const branchId = form.branchId === "" ? null : form.branchId;

    if (isEdit) {
      updateMutation.mutate(
        {
          id: user!.id,
          data: {
            firstName: form.firstName,
            lastName: form.lastName,
            role: form.role,
            branchId,
          },
        },
        {
          onSuccess: () => {
            toastSuccess("User updated", form.email);
            onClose();
          },
          onError: (err) =>
            setError(extractError(err, "Failed to update the user.")),
        },
      );
      return;
    }

    createMutation.mutate(
      {
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        branchId,
      },
      {
        onSuccess: () => {
          toastSuccess("User created", `${form.email} can now sign in.`);
          onClose();
        },
        onError: (err) => {
          const msg = extractError(err, "Failed to create the user.");
          setError(msg);
          toastError("Could not create user", msg);
        },
      },
    );
  };

  const grantingSuperAdmin = form.role === "super_admin";

  return (
    <Modal
      title={isEdit ? "Edit user" : "Create user"}
      subtitle={
        isEdit
          ? "Change profile, role, or branch assignment"
          : "Create an account and assign any role, including super admin"
      }
      icon={isEdit ? <UserCog size={16} /> : <UserPlus size={16} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              First name <span className="text-red-500">*</span>
            </label>
            <input required minLength={2} placeholder="Jane" className={inputCls()} {...field("firstName")} />
          </div>
          <div>
            <label className={labelCls}>
              Last name <span className="text-red-500">*</span>
            </label>
            <input required minLength={2} placeholder="Doe" className={inputCls()} {...field("lastName")} />
          </div>
        </div>

        <div>
          <label className={labelCls}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="email"
            placeholder="jane@pharmacy.com"
            className={inputCls()}
            disabled={isEdit}
            {...field("email")}
          />
          {isEdit && (
            <p className="text-xs text-slate-400 mt-1">
              Email is the sign-in identifier and cannot be changed here.
            </p>
          )}
        </div>

        {!isEdit && (
          <div>
            <label className={labelCls}>
              Initial password <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="password"
              minLength={8}
              placeholder="Min 8 chars, one uppercase, one number"
              className={inputCls()}
              {...field("password")}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              Role <span className="text-red-500">*</span>
            </label>
            <select required className={inputCls()} {...field("role")}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select className={inputCls()} {...field("branchId")}>
              <option value="">
                {grantingSuperAdmin ? "All branches" : "No branch"}
              </option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {grantingSuperAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <strong>Super admin grants unrestricted access</strong> to every
              branch and every module, including this console and the ability to
              create further super admins. It bypasses all role checks.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                {isEdit ? "Save changes" : "Create user"}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
