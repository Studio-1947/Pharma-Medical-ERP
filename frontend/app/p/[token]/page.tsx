"use client";

import { use } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { 
  Stethoscope, FileText, Pill, Calendar, User, CheckCircle2, 
  Building2, Phone, Download, Share2, Receipt, ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function PublicPatientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const isRx = token.startsWith("rx-");
  const isInv = token.startsWith("inv-");
  const entityId = token.replace(/^(rx-|inv-)/, "");

  const endpoint = isRx 
    ? `/prescriptions/public/${entityId}`
    : `/billing/public/invoices/${entityId}`;

  const { data: response, isLoading, error } = useQuery({
    queryKey: ["public-patient-view", token],
    queryFn: () => apiClient.get(endpoint) as Promise<any>,
    enabled: !!token && (isRx || isInv),
  });

  const record = (response as any)?.data?.data ?? (response as any)?.data;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto animate-pulse">
            <Stethoscope className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-800">Loading Patient Records...</p>
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Record Not Found</h2>
          <p className="text-xs text-slate-500">This prescription or invoice link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-6 flex flex-col items-center print:min-h-0 print:py-0 print:px-0 print:bg-white print:block">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80 shadow-xl overflow-hidden space-y-0 printable-invoice print:max-w-none print:w-full print:rounded-none print:border-0 print:shadow-none">
        
        {/* Top Header */}
        <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 p-6 text-white text-center relative">
          {/* The pharmacy mark, matching the printed letterhead. The asset
              carries its own white ground so it stays legible on this header. */}
          <Image
            src="/logo.svg"
            alt="Radha Madhav Medical Hall"
            width={56}
            height={56}
            className="inline-block w-14 h-14 rounded-2xl mb-3 shadow-lg"
            priority
          />
          <h1 className="text-lg font-black tracking-tight">Radha Madhav Medical Hall</h1>
          <p className="text-xs text-emerald-200 font-medium mt-0.5">Digital Patient Healthcare Record</p>

          <div className="absolute top-4 right-4">
            <Badge variant="emerald" size="sm" dot>
              Verified
            </Badge>
          </div>
        </div>

        {/* Prescription View */}
        {isRx && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prescription ID</span>
                <p className="text-sm font-black font-mono text-slate-900">#{record.prescriptionNumber || record.id.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Issued Date</span>
                <p className="text-xs font-semibold text-slate-700">
                  {record.issuedDate ? new Date(record.issuedDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                </p>
              </div>
            </div>

            {/* Doctor Info */}
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/60 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                Dr
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Prescribed By</p>
                <h3 className="text-sm font-black text-slate-900">Dr. {record.doctorName || "Attending Physician"}</h3>
              </div>
            </div>

            {/* Patient Name */}
            {record.patientName && (
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60">
                <User size={14} className="text-slate-400" />
                <span>Patient: {record.patientName}</span>
              </div>
            )}

            {/* Prescribed Items */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Pill size={14} className="text-emerald-600" /> Prescribed Medications
              </h4>

              {Array.isArray(record.items) && record.items.length > 0 ? (
                <div className="space-y-2">
                  {record.items.map((it: any, idx: number) => (
                    <div key={idx} className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-extrabold text-slate-900">{it.medicine?.name || it.medicineName || "Medicine Item"}</span>
                        {it.quantityPrescribed && (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                            Qty: {it.quantityPrescribed}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs font-medium text-slate-600 pt-0.5">
                        {it.dosage && <span>Dosage: <strong className="text-slate-800">{it.dosage}</strong></span>}
                        {it.frequency && <span>Freq: <strong className="text-slate-800">{it.frequency}</strong></span>}
                        {it.duration && <span>Duration: <strong className="text-slate-800">{it.duration}</strong></span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic py-2">Paper prescription scan attached below.</p>
              )}
            </div>

            {/* Prescribed Photo Image */}
            {record.displayUrl && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Prescription Photo Scan</h4>
                <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                  <img src={record.displayUrl} alt="Prescription Scan" className="w-full h-auto object-contain bg-slate-50 max-h-80" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Invoice View */}
        {isInv && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Invoice Number</span>
                <p className="text-sm font-black font-mono text-slate-900">#{record.invoiceNo || record.id.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Date</span>
                <p className="text-xs font-semibold text-slate-700">
                  {record.createdAt ? new Date(record.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "--"}
                </p>
              </div>
            </div>

            {/* Items Purchased */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Receipt size={14} className="text-emerald-600" /> Purchased Items
              </h4>

              {Array.isArray(record.items) && record.items.length > 0 && (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl bg-white overflow-hidden">
                  {record.items.map((it: any, idx: number) => {
                    const medicineName = it.medicine?.name || it.medicineName || "Medicine Item";
                    const itemTotal = Number(
                      it.lineTotal ?? it.totalAmount ?? (Number(it.quantity || 1) * Number(it.unitPrice || 0))
                    ).toFixed(2);

                    return (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs font-medium">
                        <div>
                          <p className="font-bold text-slate-900">{medicineName}</p>
                          <p className="text-[11px] text-slate-500">Qty: {it.quantity} × ₹{Number(it.unitPrice || 0).toFixed(2)}</p>
                        </div>
                        <span className="font-extrabold text-slate-900">₹{itemTotal}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Total Payment Breakdown */}
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>Subtotal</span>
                <span>₹{Number(record.subtotal || record.totalAmount || 0).toFixed(2)}</span>
              </div>
              {Number(record.taxAmount || 0) > 0 && (
                <div className="flex justify-between text-xs font-medium text-slate-300">
                  <span>GST Tax</span>
                  <span>₹{Number(record.taxAmount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black border-t border-slate-800 pt-2 text-emerald-400">
                <span>Total Amount Paid</span>
                <span>₹{Number(record.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200/80 text-center space-y-3 print:bg-white print:p-0 print:border-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-extrabold transition-all shadow-md inline-flex items-center justify-center gap-2 print:hidden"
          >
            <Download size={14} className="text-emerald-400" /> Save / Print PDF Record
          </button>

          <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-slate-600">
            <ShieldCheck size={14} className="text-emerald-600 print:hidden" />
            <span>Official Verified Record — Radha Madhav Medical Hall</span>
          </div>
          <p className="text-[10px] text-slate-400 print:text-slate-600">
            Thank you for choosing Radha Madhav Medical Hall. For support, contact your pharmacy counter.
          </p>
        </div>

      </div>
    </div>
  );
}
