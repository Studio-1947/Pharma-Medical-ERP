"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Pill, User, FileText, ArrowRight, Loader2, Compass } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useNavigation } from "@/lib/navigation-context";
import { useDebounce } from "@/hooks/use-debounce";
import { formatStockUnit } from "@/lib/stock-unit-formatter";
import { NAV_ITEMS } from "@/lib/nav-items";
import { usePermissions } from "@/hooks/use-permissions";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ROUTE_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["dashboard", "home", "analytics", "overview", "kpi"],
  "/billing": ["billing", "pos", "point of sale", "cashier", "checkout", "receipt", "sale", "invoice"],
  "/inventory": ["inventory", "stock", "medicines", "batch", "products", "items", "catalog"],
  "/prescriptions": ["prescriptions", "rx", "drugs", "doctor notes", "verification"],
  "/patients": ["patients", "uhid", "medical record", "directory", "people"],
  "/clinic/queue": ["queue", "clinic queue", "token", "tokens", "reception", "waiting list"],
  "/clinic/doctor": ["doctor", "doctor panel", "opd", "consultation", "vitals"],
  "/procurement": ["procurement", "suppliers", "po", "purchase order", "grn", "vendors"],
  "/hr": ["hr", "staff", "employees", "human resources", "users"],
  "/distribution": ["distribution", "transfers", "dispatch", "inter-branch"],
  "/analytics": ["analytics", "charts", "trends", "performance"],
  "/reports": ["reports", "compliance", "gst", "hsn", "tax", "sales summary"],
  "/settings": ["settings", "configuration", "users", "branches", "roles"],
  "/admin": ["admin", "console", "audit logs", "impersonation", "system"],
};

export function GlobalSearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
  const { navigate } = useNavigation();
  const { can } = usePermissions();

  const canSearchInvoices = can("billing.create") || can("reports.view");
  const canSearchMedicines = can("inventory.adjust") || can("billing.create") || can("prescriptions.view") || can("procurement.write");
  const canSearchPatients = can("patients.write") || can("clinic.doctor") || can("clinic.tokens") || can("billing.create");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  // Sidebar Menu & Page Matches (filtered by Role Permission)
  const navMatches = (() => {
    const q = debouncedQuery.toLowerCase().trim();
    if (q.length < 2) return [];
    return NAV_ITEMS.filter((item) => {
      // Role permission check
      if (item.permission && !can(item.permission)) return false;

      const labelMatch = item.label.toLowerCase().includes(q);
      const hrefMatch = item.href.toLowerCase().includes(q);
      const keywords = ROUTE_KEYWORDS[item.href] ?? [];
      const keywordMatch = keywords.some((k) => k.toLowerCase().includes(q));

      return labelMatch || hrefMatch || keywordMatch;
    });
  })();

  const { data: medicinesRes, isLoading: loadingMeds } = useQuery({
    queryKey: ["global-search-meds", debouncedQuery],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2 && canSearchMedicines,
  });

  const { data: patientsRes, isLoading: loadingPatients } = useQuery({
    queryKey: ["global-search-patients", debouncedQuery],
    queryFn: () => apiClient.get("/patients", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2 && canSearchPatients,
  });

  const { data: invoicesRes, isLoading: loadingInvoices } = useQuery({
    queryKey: ["global-search-invoices", debouncedQuery],
    queryFn: () => apiClient.get("/billing/invoices", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2 && canSearchInvoices,
  });

  if (!open) return null;

  const medicines: any[] = (medicinesRes as any)?.data ?? [];
  const patients: any[] = (patientsRes as any)?.data ?? (patientsRes as any)?.data?.data ?? [];
  const invoices: any[] = (invoicesRes as any)?.data ?? [];

  const isLoading = loadingMeds || loadingPatients || loadingInvoices;
  const hasResults = navMatches.length > 0 || medicines.length > 0 || patients.length > 0 || invoices.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div
        className="fixed inset-0"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-10 animate-scale-in">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 bg-slate-50/50">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages (Billing, Inventory...), medicines, patients..."
            className="w-full text-sm bg-transparent font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {isLoading && <Loader2 size={16} className="animate-spin text-emerald-600 shrink-0" />}
          <kbd
            onClick={onClose}
            className="px-2 py-0.5 text-[10px] font-bold text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer rounded border border-slate-200 shrink-0 transition-colors"
            title="Close search (Esc)"
          >
            ESC
          </kbd>
        </div>

        {/* Results area */}
        <div className="max-h-96 overflow-y-auto p-4 space-y-4">
          {debouncedQuery.trim().length < 2 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Type at least 2 characters to search across modules, pages, medicines, and patients.
            </div>
          ) : !hasResults && !isLoading ? (
            <div className="py-8 text-center text-xs text-slate-500 font-medium">
              No matching records or accessible pages found for &quot;{debouncedQuery}&quot;.
            </div>
          ) : (
            <>
              {/* Sidebar Menu & Pages Matches */}
              {navMatches.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    Navigation &amp; Pages
                  </p>
                  <div className="space-y-1">
                    {navMatches.map((navItem) => {
                      const IconComponent = navItem.icon;
                      return (
                        <div
                          key={navItem.href}
                          onClick={() => {
                            navigate(navItem.href as any);
                            onClose();
                          }}
                          className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors group border border-slate-100 hover:border-slate-300"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-xs">
                              <IconComponent size={16} />
                            </div>
                            <div>
                              <p className="text-xs font-extrabold text-slate-900 group-hover:text-emerald-700">
                                {navItem.label}
                              </p>
                              <p className="text-[10px] text-slate-500 font-mono">
                                Jump to module: {navItem.href}
                              </p>
                            </div>
                          </div>
                          <ArrowRight size={14} className="text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Medicines group */}
              {medicines.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    Medicines &amp; Products
                  </p>
                  <div className="space-y-1">
                    {medicines.map((m: any) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          navigate(`/inventory?search=${encodeURIComponent(m.name)}`);
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-emerald-50/60 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <Pill size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800 group-hover:text-emerald-900">
                              {m.name}
                            </p>
                            <p className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span>SKU: {m.sku} &bull; MRP: ₹{m.priceMrp}</span>
                              {m.totalStock !== undefined && (
                                <span
                                  className={`inline-flex items-center gap-1 font-bold text-[9px] px-1.5 py-0.2 rounded border ${
                                    Number(m.totalStock) <= 0
                                      ? "bg-red-50 text-red-700 border-red-200"
                                      : Number(m.totalStock) <= Number(m.reorderLevel || 10)
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  {Number(m.totalStock) <= 0
                                    ? "Out of stock"
                                    : formatStockUnit(Number(m.totalStock), m)}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Patients group */}
              {patients.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    Patients
                  </p>
                  <div className="space-y-1">
                    {patients.map((p: any) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          navigate(`/patients?search=${encodeURIComponent(p.name)}`);
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-blue-50/60 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800 group-hover:text-blue-900">
                              {p.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Phone: {p.phone ?? "N/A"} &bull; UHID: {p.patientCode ?? p.id.slice(0, 8)}
                            </p>
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-slate-400 group-hover:text-blue-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoices group */}
              {invoices.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    Invoices &amp; Sales
                  </p>
                  <div className="space-y-1">
                    {invoices.map((inv: any) => (
                      <div
                        key={inv.id}
                        onClick={() => {
                          navigate(`/billing?search=${encodeURIComponent(inv.invoiceNo)}`);
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-purple-50/60 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                            <FileText size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-mono font-bold text-slate-800 group-hover:text-purple-900">
                              {inv.invoiceNo}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Total: ₹{parseFloat(inv.totalAmount).toFixed(2)} &bull; Status: {inv.status}
                            </p>
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-slate-400 group-hover:text-purple-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

