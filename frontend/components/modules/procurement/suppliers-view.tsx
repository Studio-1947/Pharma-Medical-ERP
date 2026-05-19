"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Plus, Search, Edit2, Phone, Mail, FileText } from "lucide-react";
import { Modal } from "@/components/ui/modal";

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
  rating: number;
}

export function SuppliersView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [form, setForm] = useState({
    name: "",
    code: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    gstNo: "",
    panNo: "",
    rating: 3,
  });

  const { data: rawSuppliers, isLoading } = useQuery({
    queryKey: ["suppliers", { search }],
    queryFn: () => apiClient.get("/procurement/suppliers", { params: { search } }),
  });

  const suppliers: Supplier[] = (() => {
    const d = rawSuppliers as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/procurement/suppliers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      handleClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiClient.patch(`/procurement/suppliers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      handleClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/procurement/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  function openCreate() {
    setEditingSupplier(null);
    setForm({
      name: "",
      code: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      gstNo: "",
      panNo: "",
      rating: 3,
    });
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
      rating: sup.rating ?? 3,
    });
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingSupplier(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.code || !form.phone) return;

    const payload = {
      ...form,
      rating: Number(form.rating),
      creditDays: 0,
      creditLimit: "0",
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
              className="bg-card border hover:shadow-md hover:border-blue-200 transition-all duration-200 p-5 rounded-xl flex flex-col justify-between h-full bg-white backdrop-blur-md bg-opacity-70"
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
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
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                <button
                  onClick={() => openEdit(sup)}
                  className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete ${sup.name}?`)) {
                      deleteMutation.mutate(sup.id);
                    }
                  }}
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors rounded-lg"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Supplier Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold mb-4">
              {editingSupplier ? "Edit Supplier" : "Register Supplier"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono"
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
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Rating (1-5)</label>
                  <select
                    value={form.rating}
                    onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                    onChange={(e) => setForm({ ...form, gstNo: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">PAN</label>
                  <input
                    type="text"
                    value={form.panNo}
                    onChange={(e) => setForm({ ...form, panNo: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold">Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
