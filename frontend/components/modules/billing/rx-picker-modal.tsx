"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { Search, FileText, CheckCircle2, User, Stethoscope, Calendar, Inbox } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectRx: (rxId: string, rxDetails?: any) => void;
  patientId?: string | null;
  patientName?: string | null;
}

export function RxPickerModal({ open, onClose, onSelectRx, patientId, patientName }: Props) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data: rxResponse, isLoading } = useQuery({
    queryKey: ["rx-picker-search", patientId, debouncedSearch],
    queryFn: () =>
      apiClient.get("/prescriptions", {
        params: {
          status: "verified",
          patientId: patientId || undefined,
          search: debouncedSearch || undefined,
          limit: 10,
        },
      }) as Promise<any>,
    enabled: open,
  });

  const rxList: any[] = Array.isArray(rxResponse?.data?.data)
    ? rxResponse.data.data
    : Array.isArray(rxResponse?.data)
    ? rxResponse.data
    : Array.isArray(rxResponse)
    ? rxResponse
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link Verified Prescription"
      subtitle={patientName ? `Searching verified prescriptions for ${patientName}` : "Select a verified prescription to comply with Schedule H regulations"}
      size="lg"
      icon={<FileText className="w-5 h-5 text-emerald-600" />}
    >
      <div className="space-y-4">
        {/* Search input */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Prescription ID, Doctor Name, or Patient..."
            className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 font-medium"
          />
        </div>

        {/* Prescription List */}
        <div className="max-h-[50vh] overflow-y-auto space-y-2.5 pr-1">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
            ))
          ) : rxList.length === 0 ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <Inbox size={32} className="opacity-30" />
              <p className="text-sm font-semibold text-slate-700">No verified prescriptions found</p>
              <p className="text-xs text-slate-400 max-w-sm">
                Ensure the prescription has been created and marked as VERIFIED by the pharmacist/doctor before billing Schedule H drugs.
              </p>
            </div>
          ) : (
            rxList.map((rx: any) => (
              <div
                key={rx.id}
                className="p-4 rounded-2xl border border-slate-200/80 bg-white hover:border-emerald-500/60 hover:bg-emerald-50/30 transition-all flex items-center justify-between gap-4 group cursor-pointer shadow-card"
                onClick={() => {
                  onSelectRx(rx.id, rx);
                  onClose();
                }}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm font-mono truncate">
                      #{rx.prescriptionNumber || rx.id.slice(0, 8)}
                    </span>
                    <Badge variant="emerald" size="sm" dot>
                      Verified
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                    {rx.doctorName && (
                      <span className="flex items-center gap-1 text-slate-700 font-semibold">
                        <Stethoscope size={13} className="text-emerald-600" />
                        Dr. {rx.doctorName}
                      </span>
                    )}
                    {rx.patientName && (
                      <span className="flex items-center gap-1">
                        <User size={13} className="text-slate-400" />
                        {rx.patientName}
                      </span>
                    )}
                    {rx.createdAt && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Calendar size={13} />
                        {new Date(rx.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<CheckCircle2 size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRx(rx.id, rx);
                    onClose();
                  }}
                  className="shrink-0"
                >
                  Link Rx
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
