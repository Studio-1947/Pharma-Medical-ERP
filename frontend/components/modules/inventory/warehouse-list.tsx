"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Warehouse as WarehouseIcon,
  MapPin,
  Plus,
  Snowflake,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";

interface Warehouse {
  id: string;
  branchId: string;
  name: string;
  code: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
}

interface StorageLocation {
  id: string;
  warehouseId: string;
  aisle?: string;
  shelf?: string;
  bin?: string;
  label: string;
  isRefrigerated: boolean;
}

function unwrap<T>(raw: unknown): T[] {
  const d = raw as any;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d?.data?.data)) return d.data.data;
  return [];
}

/** Locations for one warehouse, loaded only when the row is expanded. */
function LocationPanel({ warehouseId }: { warehouseId: string }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    label: "",
    aisle: "",
    shelf: "",
    bin: "",
    isRefrigerated: false,
  });

  const { data: raw, isLoading } = useQuery({
    queryKey: ["warehouse-locations", warehouseId],
    queryFn: () => apiClient.get(`/inventory/warehouses/${warehouseId}/locations`),
  });

  const locations = unwrap<StorageLocation>(raw);

  const createMutation = useMutation({
    mutationFn: (data: object) => apiClient.post("/inventory/warehouses/locations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-locations", warehouseId] });
      success("Storage location added");
      setIsOpen(false);
      setForm({ label: "", aisle: "", shelf: "", bin: "", isRefrigerated: false });
    },
    onError: (err: any) => {
      toastError(
        "Failed to add location",
        err?.response?.data?.message ?? "An unexpected error occurred.",
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return;
    createMutation.mutate({
      warehouseId,
      label: form.label.trim(),
      aisle: form.aisle.trim() || undefined,
      shelf: form.shelf.trim() || undefined,
      bin: form.bin.trim() || undefined,
      isRefrigerated: form.isRefrigerated,
    });
  }

  return (
    <div className="bg-slate-50 px-6 py-4 border-t">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Storage Locations
        </span>
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Add location
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading locations...</p>
      ) : locations.length === 0 ? (
        // Goods receipt (GRN) picks a storage location to put stock into, and
        // fails outright if the warehouse has none — so say that plainly here
        // rather than showing an empty list.
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            No storage locations yet. Goods cannot be received into this warehouse
            until at least one location exists.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {locations.map((loc) => (
            <span
              key={loc.id}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm"
            >
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium">{loc.label}</span>
              {(loc.aisle || loc.shelf || loc.bin) && (
                <span className="text-xs text-muted-foreground font-mono">
                  {[loc.aisle, loc.shelf, loc.bin].filter(Boolean).join("-")}
                </span>
              )}
              {loc.isRefrigerated && (
                <Snowflake className="w-3.5 h-3.5 text-sky-500" aria-label="Refrigerated" />
              )}
            </span>
          ))}
        </div>
      )}

      {isOpen && (
        <Modal
          title="Add Storage Location"
          subtitle="Aisle, shelf and bin are optional - a label is enough to start receiving stock."
          open
          onClose={() => setIsOpen(false)}
          size="md"
          icon={<MapPin className="w-5 h-5 text-emerald-600" />}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Cold Room A"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {(["aisle", "shelf", "bin"] as const).map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1 capitalize">{field}</label>
                  <input
                    value={form[field]}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isRefrigerated}
                onChange={(e) => setForm({ ...form, isRefrigerated: e.target.checked })}
                className="rounded"
              />
              Refrigerated (cold chain)
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!form.label.trim() || createMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {createMutation.isPending ? "Adding..." : "Add Location"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function WarehouseList() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", address: "", isDefault: false });

  const { data: raw, isLoading } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiClient.get("/inventory/warehouses"),
  });

  const warehouses = unwrap<Warehouse>(raw);

  const createMutation = useMutation({
    mutationFn: (data: object) => apiClient.post("/inventory/warehouses", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      success("Warehouse created", "Add a storage location so it can receive stock.");
      setIsOpen(false);
      setForm({ name: "", code: "", address: "", isDefault: false });
    },
    onError: (err: any) => {
      toastError(
        "Failed to create warehouse",
        err?.response?.data?.message ?? "An unexpected error occurred.",
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) return;
    // branchId is intentionally omitted: the server pins the warehouse to the
    // caller's own branch.
    createMutation.mutate({
      name: form.name.trim(),
      code: form.code.trim(),
      address: form.address.trim() || undefined,
      isDefault: form.isDefault,
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Warehouses hold stock. Each needs at least one storage location before goods
          can be received into it.
        </p>
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="w-4 h-4" />
          New Warehouse
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading warehouses...</p>
      ) : warehouses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <WarehouseIcon className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="font-medium">No warehouses yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one to start receiving stock into this branch.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {warehouses.map((wh) => {
            const expanded = expandedId === wh.id;
            return (
              <div key={wh.id} className="border-b last:border-b-0">
                <button
                  onClick={() => setExpandedId(expanded ? null : wh.id)}
                  className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-slate-50"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  <WarehouseIcon className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold">{wh.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{wh.code}</span>
                  {wh.isDefault && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      Default
                    </span>
                  )}
                  {!wh.isActive && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      Inactive
                    </span>
                  )}
                  {wh.address && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {wh.address}
                    </span>
                  )}
                </button>

                {expanded && <LocationPanel warehouseId={wh.id} />}
              </div>
            );
          })}
        </div>
      )}

      {isOpen && (
        <Modal
          title="New Warehouse"
          subtitle="Created inside your branch."
          open
          onClose={() => setIsOpen(false)}
          size="md"
          icon={<WarehouseIcon className="w-5 h-5 text-emerald-600" />}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Main Store"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Code <span className="text-red-500">*</span>
              </label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. WH01"
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Address</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="rounded"
              />
              Make this the default warehouse
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!form.name.trim() || !form.code.trim() || createMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {createMutation.isPending ? "Creating..." : "Create Warehouse"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
