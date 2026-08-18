"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface Medicine {
  id: string;
  name: string;
  sku: string;
}

/**
 * Server-backed medicine picker.
 *
 * The catalogue runs to thousands of rows, and `GET /inventory/medicines`
 * defaults to 20 per page. Any plain `<select>` filled from that call silently
 * offers the first 20 and hides the rest — which is exactly what the purchase
 * order form did: 20 of 5,056 medicines were orderable and nothing on screen
 * said so. Paginating a dropdown does not help either; nobody pages through 253
 * pages to find a product. Searching does.
 *
 * Lives here rather than inside one form because two features need the same
 * picker and a second copy would be a second thing to forget.
 */
export function MedicineCombobox({
  value,
  valueName,
  onSelect,
  error,
  placeholder = "Search medicine name or SKU...",
  disabled,
}: {
  value: string;
  valueName: string;
  onSelect: (id: string, name: string) => void;
  error?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(valueName);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Keeps the box in step when the parent sets a selection itself — editing an
  // existing order, or clearing the form after a save.
  useEffect(() => {
    setQuery(valueName);
  }, [valueName]);

  const { data, isFetching } = useQuery<{ data: Medicine[] }>({
    queryKey: ["medicine-search", query],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        params: { search: query, limit: 10, page: 1 },
      }) as Promise<{ data: Medicine[] }>,
    // Two characters is enough to narrow the catalogue without firing a query
    // on every first keystroke.
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  const results = data?.data ?? [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showEmpty = open && query.length >= 2 && !isFetching && results.length === 0;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Clearing the text clears the selection: leaving the id behind
            // would submit a medicine the operator can no longer see.
            if (!e.target.value) onSelect("", "");
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={[
            "w-full rounded-lg border pl-8 pr-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400",
            "disabled:bg-slate-50 disabled:text-slate-400",
            error && !value ? "border-red-300 bg-red-50/30" : "border-slate-200 bg-white",
          ].join(" ")}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between gap-2"
              onClick={() => {
                onSelect(m.id, m.name);
                setQuery(m.name);
                setOpen(false);
              }}
            >
              <span className="font-medium text-slate-800 truncate">{m.name}</span>
              <span className="text-xs text-slate-400 font-mono shrink-0">{m.sku}</span>
            </button>
          ))}
        </div>
      )}

      {showEmpty && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs text-slate-500">
          No medicine matches &ldquo;{query}&rdquo;. Check the spelling, or add it in Inventory first.
        </div>
      )}
    </div>
  );
}
