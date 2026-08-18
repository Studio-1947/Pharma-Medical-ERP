"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Pagination, readPageMeta } from "@/components/shared/pagination";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { Plus, Search, Edit2, Phone, Mail, FileText, Trash2, BookOpen } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { SupplierLedgerModal } from "./supplier-ledger-modal";
import { isValidPhoneNumber } from "@/lib/phone-validation";

interface Supplier {
  id: string;
  name: string;
  code: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  gstNo?: string;
  panNo?: string;
  drugLicenseNo?: string;
  drugLicenseExpiry?: string;
  creditDays?: number;
  creditLimit?: string;
  outstandingBalance?: string;
  rating: number;
}

const emptyForm = {
  name: "",
  code: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  gstNo: "",
  panNo: "",
  drugLicenseNo: "",
  drugLicenseExpiry: "",
  creditDays: 0,
  creditLimit: "0",
  rating: 3,
};

export function SuppliersView() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  const [page, setPage] = useState(1);

  // Narrowing the search shortens the list, so a page number carried over from
  // the previous result can land past the end and show nothing.
  useEffect(() => {
    setPage(1);
  }, [search]);

  const { data: rawSuppliers, isLoading } = useQuery({
    // Was fetched with no page: the list stopped at the server default of 100
    // with nothing on screen saying there were more.
    queryKey: ["suppliers", { search, page }],
    queryFn: () => apiClient.get("/procurement/suppliers", { params: { search, page, limit: 24 } }),
  });
  const meta = readPageMeta(rawSuppliers);

  const suppliers: Supplier[] = (() => {
    const d = rawSuppliers as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const extractError = (err: any): string => {
    const data = err?.response?.data;
    // Zod field errors come back as { errors: { field: [msg] } }
    if (data?.errors && typeof data.errors === "object") {
      const first = Object.entries(data.errors)[0] as [string, string[]] | undefined;
      if (first) return `${first[0]}: ${first[1]?.[0] ?? "invalid"}`;
    }
    return data?.message ?? "Could not save the supplier. Check the fields and try again.";
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/procurement/suppliers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toastSuccess("Supplier created", "The supplier has been registered.");
      handleClose();
    },
    onError: (err: any) => setFormError(extractError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiClient.patch(`/procurement/suppliers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toastSuccess("Supplier updated", "Changes have been saved.");
      handleClose();
    },
    onError: (err: any) => setFormError(extractError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/procurement/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toastSuccess("Supplier deleted", "Supplier has been removed.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete this supplier.");
      setConfirmDeleteId(null);
    },
  });

  function openCreate() {
    setEditingSupplier(null);
    setForm(emptyForm);
    setFormError("");
    setIsOpen(true);
  }

  function openEdit(sup: Supplier) {
    setEditingSupplier(sup);
    setForm({
      name: sup.name ?? "",
      code: sup.code ?? "",
      contactPerson: sup.contactPerson ?? "",
      phone: sup.phone ?? "",
      email: sup.email ?? "",
      address: sup.address ?? "",
      gstNo: sup.gstNo ?? "",
      panNo: sup.panNo ?? "",
      drugLicenseNo: sup.drugLicenseNo ?? "",
      drugLicenseExpiry: sup.drugLicenseExpiry ? sup.drugLicenseExpiry.slice(0, 10) : "",
      creditDays: sup.creditDays ?? 0,
      creditLimit: sup.creditLimit ?? "0",
      rating: sup.rating ?? 3,
    });
    setFormError("");
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingSupplier(null);
    setFormError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim() || !form.code.trim() || !form.phone.trim()) {
      setFormError("Name, Code and Phone are required.");
      return;
    }
    if (!isValidPhoneNumber(form.phone)) {
      setFormError("Please enter a valid 10-digit phone number (e.g. 9876543210 or +91 9876543210).");
      return;
    }

    // Send blanks as undefined so optional fields store as NULL and skip
    // format validation (empty email/GSTIN must not be rejected).
    const clean = (v: string) => (v.trim() === "" ? undefined : v.trim());
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      phone: form.phone.trim(),
      contactPerson: clean(form.contactPerson),
      email: clean(form.email),
      address: clean(form.address),
      gstNo: clean(form.gstNo),
      panNo: clean(form.panNo),
      drugLicenseNo: clean(form.drugLicenseNo),
      drugLicenseExpiry: clean(form.drugLicenseExpiry),
      creditDays: Number(form.creditDays) || 0,
      creditLimit: form.creditLimit?.toString().trim() || "0",
      rating: Number(form.rating),
    };

    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <input
            type="text"
            placeholder="Search suppliers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded-lg pl-10 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          />
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No suppliers found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {suppliers.map((sup) => (
            <div
              key={sup.id}
              className="bg-card border hover:shadow-md hover:border-emerald-200 transition-all duration-200 p-5 rounded-xl flex flex-col justify-between h-full bg-white backdrop-blur-md bg-opacity-70"
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-100">
                      {sup.code}
                    </span>
                    <h3 className="text-base font-bold text-slate-800 mt-2">{sup.name}</h3>
                  </div>
                  <div className="flex gap-1 text-amber-500 font-bold text-sm">
                    {"★".repeat(sup.rating || 3)}
                  </div>
                </div>

                <div className="space-y-1.5 text-sm text-slate-600 border-t pt-3 mt-2">
                  {sup.contactPerson && (
                    <p className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-400">Contact:</span>
                      <span className="font-medium text-slate-700">{sup.contactPerson}</span>
                    </p>
                  )}
                  <p className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{sup.phone}</span>
                  </p>
                  {sup.email && (
                    <p className="flex items-center gap-2 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{sup.email}</span>
                    </p>
                  )}
                  {sup.gstNo && (
                    <p className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-400">GSTIN:</span>
                      <span className="font-mono text-xs">{sup.gstNo}</span>
                    </p>
                  )}
                  {sup.drugLicenseNo && (
                    <p className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-mono text-xs">{sup.drugLicenseNo}</span>
                      {sup.drugLicenseExpiry && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            new Date(sup.drugLicenseExpiry) < new Date()
                              ? "bg-red-50 text-red-600"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          exp {sup.drugLicenseExpiry.slice(0, 10)}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="flex items-center justify-between pt-1">
                    <span className="font-semibold text-xs text-slate-400">Outstanding:</span>
                    <span
                      className={`text-sm font-bold ${
                        parseFloat(sup.outstandingBalance ?? "0") > 0
                          ? "text-red-600"
                          : "text-slate-500"
                      }`}
                    >
                      ₹{parseFloat(sup.outstandingBalance ?? "0").toFixed(2)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1 pt-4 border-t mt-4">
                <button
                  onClick={() => setLedgerSupplier(sup)}
                  className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors rounded-lg"
                  title="View ledger"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openEdit(sup)}
                  className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                {isAdmin && (
                  confirmDeleteId === sup.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(sup.id)}
                        disabled={deleteMutation.isPending}
                        className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                      >
                        {deleteMutation.isPending ? "..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(sup.id)}
                      className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination meta={meta} onPageChange={setPage} noun="suppliers" />

      {/* Supplier Modal */}
      <Modal
        title={editingSupplier ? "Edit Supplier" : "Register Supplier"}
        subtitle={editingSupplier ? `Editing supplier: ${editingSupplier.code}` : "Register a new supplier to the procurement catalog"}
        open={isOpen}
        onClose={handleClose}
        size="lg"
      >
        {formError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 animate-in fade-in">
            {formError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Code (Supplier ID) *</label>
              <input
                type="text"
                required
                placeholder="SUP-001"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Phone *</label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Contact Person</label>
              <input
                type="text"
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Rating (1-5)</label>
              <select
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {"★".repeat(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">GSTIN</label>
              <input
                type="text"
                value={form.gstNo}
                onChange={(e) => setForm({ ...form, gstNo: e.target.value.toUpperCase() })}
                placeholder="22ABCDE1234F1Z5"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">PAN</label>
              <input
                type="text"
                value={form.panNo}
                onChange={(e) => setForm({ ...form, panNo: e.target.value.toUpperCase() })}
                placeholder="ABCDE1234F"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Drug License No.</label>
              <input
                type="text"
                value={form.drugLicenseNo}
                onChange={(e) => setForm({ ...form, drugLicenseNo: e.target.value })}
                placeholder="20B / 21B licence"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">License Expiry</label>
              <input
                type="date"
                value={form.drugLicenseExpiry}
                onChange={(e) => setForm({ ...form, drugLicenseExpiry: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Credit Days</label>
              <input
                type="number"
                min={0}
                max={365}
                value={form.creditDays}
                onChange={(e) => setForm({ ...form, creditDays: Number(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Credit Limit (₹)</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                placeholder="0.00"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      {ledgerSupplier && (
        <SupplierLedgerModal
          supplier={ledgerSupplier}
          open={!!ledgerSupplier}
          onClose={() => setLedgerSupplier(null)}
        />
      )}
    </div>
  );
}
