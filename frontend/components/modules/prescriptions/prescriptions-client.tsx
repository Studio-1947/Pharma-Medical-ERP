"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { FileText, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";

interface PrescriptionPatient {
  name: string;
  phone: string;
}

interface Prescription {
  id: string;
  patientId: string;
  patient?: PrescriptionPatient;
  doctorName: string;
  hospitalName?: string;
  issuedDate: string;
  expiryDate?: string;
  status: string;
  isControlled?: boolean;
  notes?: string;
  createdAt: string;
}

type TabKey = "all" | "pending_verification" | "verified" | "rejected";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending_verification", label: "Pending Verification" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

function statusBadge(status: string) {
  switch (status) {
    case "pending_verification":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" /> Verified
        </span>
      );
    case "partially_dispensed":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
          Partially Dispensed
        </span>
      );
    case "fully_dispensed":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
          Fully Dispensed
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    case "expired":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium">
          <AlertTriangle className="w-3 h-3" /> Expired
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
          {status}
        </span>
      );
  }
}

export function PrescriptionsClient() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [verifyingPrescription, setVerifyingPrescription] = useState<Prescription | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifyError, setVerifyError] = useState("");

  const queryParams = {
    status: activeTab === "all" ? undefined : activeTab,
    page,
    limit: 20,
  };

  const { data: rawData, isLoading } = useQuery({
    queryKey: queryKeys.prescriptions.list(queryParams),
    queryFn: () => apiClient.get("/prescriptions", { params: queryParams }),
  });

  const prescriptions: Prescription[] = (() => {
    const d = rawData as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const verifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiClient.post(`/prescriptions/${id}/verify`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all() });
      handleCloseVerify();
    },
    onError: (err: any) => {
      setVerifyError(err?.response?.data?.message ?? "Action failed.");
    },
  });

  function handleOpenVerify(prescription: Prescription) {
    setVerifyingPrescription(prescription);
    setRejectionReason("");
    setVerifyError("");
  }

  function handleCloseVerify() {
    setVerifyingPrescription(null);
    setRejectionReason("");
    setVerifyError("");
  }

  function handleVerify() {
    if (!verifyingPrescription) return;
    verifyMutation.mutate({ id: verifyingPrescription.id, body: { action: "verify" } });
  }

  function handleReject() {
    if (!verifyingPrescription) return;
    if (!rejectionReason.trim()) {
      setVerifyError("Please enter a rejection reason.");
      return;
    }
    verifyMutation.mutate({
      id: verifyingPrescription.id,
      body: { action: "reject", rejectionReason: rejectionReason.trim() },
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Prescriptions</h1>
        <p className="text-muted-foreground mt-1">Review and verify patient prescriptions.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="mx-auto mb-3 opacity-30" size={48} />
          <p className="font-medium">No prescriptions found.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Patient</th>
                  <th className="px-6 py-4">Doctor</th>
                  <th className="px-6 py-4">Hospital</th>
                  <th className="px-6 py-4">Issued Date</th>
                  <th className="px-6 py-4">Expiry Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {prescriptions.map((rx) => (
                  <tr key={rx.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium">{rx.patient?.name ?? "--"}</div>
                      <div className="text-xs text-muted-foreground">{rx.patient?.phone ?? ""}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{rx.doctorName}</div>
                      {rx.isControlled && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-medium">
                          <AlertTriangle className="w-3 h-3" /> Controlled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{rx.hospitalName ?? "--"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {rx.issuedDate ? format(new Date(rx.issuedDate), "MMM d, yyyy") : "--"}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {rx.expiryDate ? format(new Date(rx.expiryDate), "MMM d, yyyy") : "--"}
                    </td>
                    <td className="px-6 py-4">{statusBadge(rx.status)}</td>
                    <td className="px-6 py-4 text-right">
                      {rx.status === "pending_verification" && (
                        <button
                          onClick={() => handleOpenVerify(rx)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                        >
                          Verify
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t text-sm text-muted-foreground">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={prescriptions.length < 20}
                className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verify Modal */}
      <Modal
        title="Review Prescription"
        open={verifyingPrescription !== null}
        onClose={handleCloseVerify}
        size="md"
      >
        {verifyingPrescription && (
          <div className="space-y-4">
            {verifyError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                {verifyError}
              </div>
            )}

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Patient</span>
                <span className="font-medium">{verifyingPrescription.patient?.name ?? "--"}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Doctor</span>
                <span className="font-medium">{verifyingPrescription.doctorName}</span>
              </div>
              {verifyingPrescription.hospitalName && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Hospital</span>
                  <span className="font-medium">{verifyingPrescription.hospitalName}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Issued</span>
                <span className="font-medium">
                  {verifyingPrescription.issuedDate
                    ? format(new Date(verifyingPrescription.issuedDate), "MMM d, yyyy")
                    : "--"}
                </span>
              </div>
              {verifyingPrescription.expiryDate && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Expiry</span>
                  <span className="font-medium">
                    {format(new Date(verifyingPrescription.expiryDate), "MMM d, yyyy")}
                  </span>
                </div>
              )}
              {verifyingPrescription.notes && (
                <div className="py-2">
                  <p className="text-muted-foreground text-xs mb-1">Notes</p>
                  <p>{verifyingPrescription.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                Rejection Reason{" "}
                <span className="text-muted-foreground font-normal">(required only for rejection)</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Enter reason for rejection..."
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseVerify}
                className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={verifyMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {verifyMutation.isPending ? "Processing..." : "Reject"}
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifyMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                {verifyMutation.isPending ? "Processing..." : "Verify"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
