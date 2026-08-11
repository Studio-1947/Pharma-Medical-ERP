"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Printer, Barcode, Loader2 } from "lucide-react";

interface BarcodeLabelModalProps {
  batchId: string;
  open: boolean;
  onClose: () => void;
}

export function BarcodeLabelModal({ batchId, open, onClose }: BarcodeLabelModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["batch-barcode-label", batchId],
    queryFn: () => apiClient.get(`/inventory/batches/${batchId}/barcode-label`),
    enabled: open && !!batchId,
  });

  const labelData = (data as any)?.data ?? data ?? null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      title="Print Shelf Barcode Sticker"
      subtitle="Standard 50mm x 25mm packaging & shelf barcode label"
      icon={<Barcode size={18} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 size={18} className="animate-spin text-emerald-600" />
            Generating barcode label...
          </div>
        ) : error || !labelData ? (
          <div className="text-center py-8 text-red-600 text-sm">
            Failed to load barcode label data.
          </div>
        ) : (
          <>
            {/* Printable Label Area */}
            <div className="flex justify-center">
              <div
                id="printable-barcode-label"
                className="w-[240px] h-[130px] border-2 border-slate-900 rounded-md p-2 bg-white flex flex-col justify-between items-center text-center shadow-md print:border-black print:shadow-none"
              >
                <div className="w-full border-b border-slate-200 pb-1">
                  <div className="font-extrabold text-xs text-slate-900 truncate">
                    {labelData.brandName || labelData.medicineName}
                  </div>
                  {labelData.brandName && labelData.brandName !== labelData.medicineName && (
                    <div className="text-[10px] text-slate-600 truncate">{labelData.medicineName}</div>
                  )}
                </div>

                {/* Barcode Image */}
                {labelData.barcodeBase64 && (
                  <div className="my-1 flex items-center justify-center">
                    <img
                      src={labelData.barcodeBase64}
                      alt={`Barcode ${labelData.batchNo}`}
                      className="max-h-[45px] object-contain"
                    />
                  </div>
                )}

                <div className="w-full flex justify-between items-center text-[10px] font-mono font-bold text-slate-800 border-t border-slate-200 pt-1">
                  <span>B.No: {labelData.batchNo}</span>
                  <span>Exp: {labelData.expiryDate}</span>
                  <span className="text-emerald-700">₹{parseFloat(labelData.mrpAtEntry || "0").toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* CSS for print */}
            <style jsx global>{`
              @media print {
                body * {
                  visibility: hidden;
                }
                #printable-barcode-label,
                #printable-barcode-label * {
                  visibility: visible;
                }
                #printable-barcode-label {
                  position: absolute;
                  left: 50%;
                  top: 40%;
                  transform: translate(-50%, -50%) scale(1.5);
                }
              }
            `}</style>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 shadow-sm transition-all"
              >
                <Printer size={16} />
                Print Sticker
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
