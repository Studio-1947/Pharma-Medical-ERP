"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Pill, User, FileText, ArrowRight, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useNavigation } from "@/lib/navigation-context";
import { useDebounce } from "@/hooks/use-debounce";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
  const { navigate } = useNavigation();

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

  const { data: medicinesRes, isLoading: loadingMeds } = useQuery({
    queryKey: ["global-search-meds", debouncedQuery],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2,
  });

  const { data: patientsRes, isLoading: loadingPatients } = useQuery({
    queryKey: ["global-search-patients", debouncedQuery],
    queryFn: () => apiClient.get("/patients", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2,
  });

  const { data: invoicesRes, isLoading: loadingInvoices } = useQuery({
    queryKey: ["global-search-invoices", debouncedQuery],
    queryFn: () => apiClient.get("/billing/invoices", { params: { search: debouncedQuery, limit: 5 } }),
    enabled: open && debouncedQuery.trim().length >= 2,
  });

  if (!open) return null;

  const medicines: any[] = (medicinesRes as any)?.data ?? [];
  const patients: any[] = (patientsRes as any)?.data ?? (patientsRes as any)?.data?.data ?? [];
  const invoices: any[] = (invoicesRes as any)?.data ?? [];

  const isLoading = loadingMeds || loadingPatients || loadingInvoices;
  const hasResults = medicines.length > 0 || patients.length > 0 || invoices.length > 0;

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
            placeholder="Search medicines, patients, invoice numbers..."
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
              Type at least 2 characters to search across medicines, patients, and invoices.
            </div>
          ) : !hasResults && !isLoading ? (
            <div className="py-8 text-center text-xs text-slate-500 font-medium">
              No matching records found for &quot;{debouncedQuery}&quot;.
            </div>
          ) : (
            <>
              {/* Medicines group */}
              {medicines.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    Medicines & Products
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
                            <p className="text-[10px] text-slate-500">
                              SKU: {m.sku} &bull; MRP: ₹{m.priceMrp}
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
                    Invoices & Sales
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
