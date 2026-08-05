"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export interface BranchOption {
  id: string;
  name: string;
  code?: string;
  isActive?: boolean;
}

/**
 * Branch picker for forms that must name a branch — stock transfers, purchase
 * orders, batch receipts.
 *
 * Replaces the warehouse pickers these forms used to carry. Warehouses were
 * removed: stock, orders and goods inward now belong to a branch directly.
 *
 * Inactive branches are excluded — you cannot raise new business against a
 * branch that has been shut down — except when one is already selected, so an
 * existing record still renders its own branch instead of showing blank.
 */
export function BranchSelect({
  value,
  onChange,
  placeholder = "Select branch",
  error,
  disabled,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.branches.all(),
    queryFn: () => apiClient.get("/branches") as Promise<any>,
    staleTime: 5 * 60_000,
  });

  const raw = data as any;
  const all: BranchOption[] = Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw)
      ? raw
      : [];

  const branches = all.filter((b) => b.isActive !== false || b.id === value);

  return (
    <select
      value={value}
      disabled={disabled || isLoading}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        `w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 ${
          error ? "border-red-400" : "border-slate-200"
        }`
      }
    >
      <option value="">{isLoading ? "Loading branches..." : placeholder}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
          {b.code ? ` (${b.code})` : ""}
        </option>
      ))}
    </select>
  );
}
