"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ImageIcon, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

/**
 * Displays the uploaded scan of a handwritten prescription.
 *
 * The list endpoint returns the raw S3 key, which is not fetchable from the
 * browser. Only GET /prescriptions/:id signs it, so the viewer fetches the
 * single prescription and reads `displayUrl` off it — a presigned link that
 * expires, hence no caching beyond the session.
 */
export function PrescriptionScanViewer({
  prescriptionId,
  patientName,
  onClose,
}: {
  prescriptionId: string;
  patientName?: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.prescriptions.detail(prescriptionId),
    queryFn: () => apiClient.get(`/prescriptions/${prescriptionId}`) as Promise<any>,
    enabled: !!prescriptionId,
    staleTime: 0,
  });

  const rx = (data as any)?.data ?? (data as any);
  const imageUrl: string | undefined = rx?.displayUrl ?? rx?.data?.displayUrl;
  const isPdf = !!imageUrl && imageUrl.toLowerCase().endsWith(".pdf");

  return (
    <Modal
      title="Prescription Scan"
      subtitle={patientName ? `Handwritten prescription for ${patientName}` : undefined}
      icon={<ImageIcon size={16} />}
      open
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="animate-spin" size={24} />
            <p className="text-sm">Loading scan...</p>
          </div>
        ) : isError || !imageUrl ? (
          <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No scan available</p>
              <p className="text-xs text-red-600/80 mt-0.5">
                This prescription has no uploaded image, or the link could not be
                generated. Ask the prescriber to re-upload it.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border bg-slate-50 overflow-hidden">
              {isPdf ? (
                <iframe
                  src={imageUrl}
                  title="Prescription scan PDF"
                  className="w-full h-[65vh] bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="Handwritten prescription scan"
                  className="w-full max-h-[65vh] object-contain bg-white"
                />
              )}
            </div>
            <div className="flex justify-end">
              <a
                href={imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                <ExternalLink size={13} /> Open full size
              </a>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
