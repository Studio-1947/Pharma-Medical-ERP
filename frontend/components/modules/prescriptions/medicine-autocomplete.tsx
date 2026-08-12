"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useDebounce } from "@/hooks/use-debounce";
import { formatStockUnit } from "@/lib/stock-unit-formatter";
import { Loader2, Pill, CheckCircle2, X } from "lucide-react";

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
  totalStock?: number | null;
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
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number; openUpward: boolean }>({
    top: 0,
    left: 0,
    width: 360,
    openUpward: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const debounced = useDebounce(value, 300);
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

  const updateCoords = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;

    const maxW = Math.min(window.innerWidth - 16, Math.max(rect.width, 320));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - maxW - 8));

    if (openUpward) {
      setCoords({
        bottom: window.innerHeight - rect.top + 6,
        top: undefined,
        left,
        width: maxW,
        openUpward: true,
      });
    } else {
      setCoords({
        top: rect.bottom + 6,
        bottom: undefined,
        left,
        width: maxW,
        openUpward: false,
      });
    }
  };

  // Reset the cursor whenever the result set changes, so Enter never lands on
  // whatever happened to be highlighted for the previous query.
  useEffect(() => setHighlight(0), [debounced]);

  // Close dropdown if item becomes linked
  useEffect(() => {
    if (linked) setOpen(false);
  }, [linked]);

  // Update floating coordinates when open
  useEffect(() => {
    if (!open || !shouldSearch) return;
    updateCoords();

    const handleScrollOrResize = (e: Event) => {
      if (listRef.current && listRef.current.contains(e.target as Node)) {
        return;
      }
      updateCoords();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, shouldSearch]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
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
      e.preventDefault();
      const picked = results[highlight];
      if (picked) choose(picked);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const dropdownMenu = (
    <div
      ref={listRef}
      role="listbox"
      style={{
        position: "fixed",
        top: coords.top !== undefined ? `${coords.top}px` : "auto",
        bottom: coords.bottom !== undefined ? `${coords.bottom}px` : "auto",
        left: `${coords.left}px`,
        width: `${coords.width}px`,
        maxHeight: coords.openUpward
          ? `${Math.min(240, coords.bottom ? window.innerHeight - coords.bottom - 16 : 240)}px`
          : "240px",
        zIndex: 99999,
      }}
      className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-y-auto p-1.5 ring-1 ring-black/10 animate-in fade-in-50 zoom-in-95 duration-100"
    >
      {results.length === 0 && isFetching ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-slate-500">
          <Loader2 size={13} className="animate-spin text-emerald-600 shrink-0" /> Searching catalogue...
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
            onMouseDown={(e) => {
              e.preventDefault();
              choose(m);
            }}
            className={`w-full text-left px-3 py-2.5 transition-all rounded-lg border-b last:border-b-0 border-slate-100 ${
              idx === highlight ? "bg-emerald-50 border-emerald-200 text-emerald-950" : "hover:bg-slate-50 text-slate-800"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold truncate">{m.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {scheduleBadge(m)}
                {m.totalStock !== undefined && m.totalStock !== null && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      Number(m.totalStock) <= 0
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    {Number(m.totalStock) <= 0 ? "Out" : formatStockUnit(Number(m.totalStock), m)}
                  </span>
                )}
                {m.priceMrp && (
                  <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded">
                    ₹{Number(m.priceMrp).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            {subtitle(m) && (
              <div className="flex items-center gap-1 mt-1">
                <Pill size={10} className="text-slate-400 shrink-0" />
                <span className="text-[11px] text-slate-600 font-medium truncate">
                  {subtitle(m)}
                </span>
              </div>
            )}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center w-full">
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (!linked) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          className={
            className ??
            `w-full border rounded-xl pl-3 ${
              value ? "pr-7" : "pr-3"
            } py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors ${
              linked
                ? "bg-emerald-50/80 border-emerald-400 text-emerald-950 font-bold shadow-2xs"
                : "bg-white text-slate-900 border-slate-200"
            }`
          }
        />

        {linked && (
          <CheckCircle2 size={13} className="absolute right-7 text-emerald-600 shrink-0 pointer-events-none" />
        )}

        {value ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(true);
            }}
            className="absolute right-2 text-slate-400 hover:text-slate-700 p-0.5 rounded-full hover:bg-slate-200/60 transition-colors"
            title="Clear / re-search medicine"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      {showDropdown && mounted && createPortal(dropdownMenu, document.body)}
    </div>
  );
}

