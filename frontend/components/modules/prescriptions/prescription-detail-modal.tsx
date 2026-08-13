"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { format } from "date-fns";
import {
  FileText,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Image as ImageIcon,
  Printer,
} from "lucide-react";
import {
  PrescriptionPrintModal,
  toPrescriptionTemplateData,
} from "@/components/modules/prescriptions/prescription-template";

/**
 * Read-only view of a past prescription — what was prescribed, by whom, and
 * how much of it has been dispensed.
 *
 * The prescriptions list returns header rows only (no items), so the history
 * panel could name a prescriber and a date but never show the actual drugs.
 * This fetches the single record, which carries items, the dispensed counts and
 * a signed URL for any handwritten scan.
 */

function statusChip(status?: string) {
  const map: Record<string, string> = {
    verified: "bg-green-100 text-green-700",
    pending_verification: "bg-yellow-100 text-yellow-700",
    rejected: "bg-red-100 text-red-700",
    expired: "bg-red-100 text-red-600",
    partially_dispensed: "bg-emerald-100 text-emerald-700",
    fully_dispensed: "bg-emerald-100 text-emerald-700",
  };
  const label = (status ?? "").replace(/_/g, " ");
  if (!label) return null;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${
        map[status ?? ""] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

function fmtDate(value?: string | null) {
  if (!value) return "--";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "--" : format(d, "MMM d, yyyy");
}

export function PrescriptionDetailModal({
  prescriptionId,
  onClose,
}: {
  prescriptionId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.prescriptions.detail(prescriptionId),
    queryFn: () => apiClient.get(`/prescriptions/${prescriptionId}`) as Promise<any>,
    enabled: !!prescriptionId,
  });

  const [printOpen, setPrintOpen] = useState(false);

  const raw = data as any;
  const rx = raw?.data?.data ?? raw?.data ?? raw;
  const items: any[] = Array.isArray(rx?.items) ? rx.items : [];
  const scanUrl: string | undefined = rx?.displayUrl;
  const scanIsPdf = !!scanUrl && scanUrl.toLowerCase().endsWith(".pdf");

  return (
    <Modal
      title="Prescription"
      subtitle={rx?.doctorName ? `Written by ${rx.doctorName}` : undefined}
      icon={<FileText size={16} />}
      open
      onClose={onClose}
      size="xl"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="animate-spin" size={22} />
          <p className="text-sm">Loading prescription...</p>
        </div>
      ) : isError || !rx ? (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p>Could not load this prescription.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Generate / print official prescription */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
            >
              <Printer size={14} />
              Print / Generate Prescription
            </button>
          </div>

          {/* Header facts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-muted-foreground">Issued</p>
              <p className="font-medium">{fmtDate(rx.issuedDate)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Expires</p>
              <p className="font-medium">{fmtDate(rx.expiryDate)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Hospital</p>
              <p className="font-medium truncate">{rx.hospitalName ?? "--"}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Status</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                {statusChip(rx.status)}
                {rx.isControlled && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                    <AlertTriangle size={9} /> Controlled
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Prescribed medicines */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Prescribed Medicines</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No typed medicine lines
                {scanUrl ? " — this prescription was captured as a scan." : "."}
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Medicine</th>
                      <th className="text-left px-3 py-2 font-medium">Dosage</th>
                      <th className="text-left px-3 py-2 font-medium">Frequency</th>
                      <th className="text-left px-3 py-2 font-medium">Duration</th>
                      <th className="text-right px-3 py-2 font-medium">Dispensed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it, i) => (
                      <tr key={it.id ?? i}>
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {it.medicine?.name ?? it.medicineName}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{it.dosage ?? "--"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{it.frequency ?? "--"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{it.duration ?? "--"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {it.quantityDispensed ?? 0}
                          {it.quantityPrescribed ? ` / ${it.quantityPrescribed}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {rx.notes && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{rx.notes}</p>
            </div>
          )}

          {/* Handwritten scan, when one was attached */}
          {scanUrl && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <ImageIcon size={13} /> Handwritten Scan
                </h3>
                <a
                  href={scanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink size={11} /> Open full size
                </a>
              </div>
              <div className="rounded-lg border bg-slate-50 overflow-hidden">
                {scanIsPdf ? (
                  <iframe
                    src={scanUrl}
                    title="Prescription scan PDF"
                    className="w-full h-[50vh] bg-white"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={scanUrl}
                    alt="Handwritten prescription scan"
                    className="w-full max-h-[50vh] object-contain bg-white"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {rx && (
        <PrescriptionPrintModal
          rx={toPrescriptionTemplateData(raw)}
          open={printOpen}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </Modal>
  );
}
