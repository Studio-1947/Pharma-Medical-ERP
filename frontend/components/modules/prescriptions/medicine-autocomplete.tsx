"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useDebounce } from "@/hooks/use-debounce";
import { Loader2, Pill } from "lucide-react";

/**
 * Catalogue-backed medicine picker for prescription rows.
 *
 * A prescriber typing a drug name by hand is both slow and lossy — the row ends
 * up with no `medicineId`, so the pharmacist has to re-match it against stock at
 * dispensing time and a typo becomes their problem. Searching the catalogue
 * while they type pins the row to a real medicine and carries the strength over
 * into the dosage field.
 *
 * Free text is still accepted: doctors legitimately prescribe things this
 * pharmacy does not stock, and blocking that would be worse than an unmatched
 * row.
 */

export interface MedicineOption {
  id: string;
  name: string;
  brandName?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  packSize?: number | null;
  unit?: string | null;
  priceMrp?: string | null;
  scheduleClass?: string | null;
  requiresPrescription?: boolean;
  isControlled?: boolean;
}

/** Schedule H/H1/X need a prescription on record; OTC and blanks do not. */
function scheduleBadge(m: MedicineOption) {
  const sc = (m.scheduleClass ?? "").toUpperCase();
  if (!sc || sc === "OTC" || sc === "NA") return null;
  return (
    <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold shrink-0">
      {sc}
    </span>
  );
}

function subtitle(m: MedicineOption) {
  return [m.genericName, m.strength, m.dosageForm].filter(Boolean).join(" · ");
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSelect: (medicine: MedicineOption) => void;
  /** True once a catalogue item is pinned — suppresses further searching. */
  linked?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function MedicineAutocomplete({
  value,
  onChange,
  onSelect,
  linked = false,
  placeholder = "Search medicine...",
  autoFocus = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounce(value, 250);
  const shouldSearch = debounced.trim().length >= 2 && !linked;

  const { data, isFetching } = useQuery({
    queryKey: ["medicine-autocomplete", debounced],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        params: { search: debounced.trim(), limit: 8 },
      }) as Promise<any>,
    enabled: shouldSearch,
    staleTime: 60_000,
  });

  const raw = data as any;
  const results: MedicineOption[] = Array.isArray(raw?.data?.data)
    ? raw.data.data
    : Array.isArray(raw?.data)
      ? raw.data
      : [];

  // Reset the cursor whenever the result set changes, so Enter never lands on
  // whatever happened to be highlighted for the previous query.
  useEffect(() => setHighlight(0), [debounced]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const showDropdown = open && shouldSearch && (results.length > 0 || isFetching);

  function choose(m: MedicineOption) {
    onSelect(m);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      // Enter picks the highlighted medicine rather than submitting the form —
      // the prescriber is mid-row, not done with it.
      e.preventDefault();
      const picked = results[highlight];
      if (picked) choose(picked);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        className={
          className ??
          "w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        }
      />

      {showDropdown && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto"
        >
          {results.length === 0 && isFetching ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Searching catalogue...
            </div>
          ) : (
            results.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === highlight}
                onMouseEnter={() => setHighlight(idx)}
                // mousedown fires before the input's blur, so the click is not
                // lost to the dropdown closing first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                className={`w-full text-left px-2.5 py-2 transition-colors border-b last:border-b-0 ${
                  idx === highlight ? "bg-emerald-50" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{m.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {scheduleBadge(m)}
                    {m.priceMrp && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        ₹{Number(m.priceMrp).toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
                {subtitle(m) && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Pill size={9} className="text-muted-foreground shrink-0" />
                    <span className="text-[10px] text-muted-foreground truncate">
                      {subtitle(m)}
                    </span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
