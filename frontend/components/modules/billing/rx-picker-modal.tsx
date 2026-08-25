"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/components/ui/toast";
import { PrescriptionScanUpload } from "@/components/modules/prescriptions/prescription-scan-upload";
import {
  Search,
  FileText,
  CheckCircle2,
  User,
  Stethoscope,
  Calendar,
  Inbox,
  Upload,
  Plus,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectRx: (rxId: string, rxDetails?: any) => void;
  patientId?: string | null;
  patientName?: string | null;
  /**
   * Why the picker is open.
   *
   * "schedule-h" is the compulsory case: the sale is illegal without a
   * prescription and the register has to identify the prescriber, so the
   * doctor's council number is required.
   *
   * "optional" is a customer who simply brought a prescription for an
   * ordinary counter sale. Demanding an MCI number there asks for something
   * the operator does not have and did not need, and the only way out would
   * be to abandon the record entirely.
   */
  context?: "schedule-h" | "optional";
}

export function RxPickerModal({
  open,
  onClose,
  onSelectRx,
  patientId,
  patientName,
  context = "schedule-h",
}: Props) {
  const optionalContext = context === "optional";
  const [tab, setTab] = useState<"search" | "upload">("search");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { success: toastSuccess, error: toastError } = useToast();
  const queryClient = useQueryClient();

  // Physical prescription log form
  const [doctorName, setDoctorName] = useState("");
  const [doctorRegNo, setDoctorRegNo] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [physicalRegisterNo, setPhysicalRegisterNo] = useState("");
  const [fileKey, setFileKey] = useState<string | null>(null);
  // Who the prescription belongs to, when the screen that opened this had
  // nobody selected. A counter sale is a walk-in by definition, so requiring a
  // patient here blocked the paper-Rx form outright — including for Schedule
  // H, where the fallback below had been written for exactly this case and
  // could never run.
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

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
    enabled: open && tab === "search",
  });

  /** The reserved anonymous record every unnamed counter prescription shares. */
  const WALK_IN_PHONE = "0000000000";

  const findPatientByPhone = async (phone: string): Promise<string | null> => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return null;
    const res: any = await apiClient.get("/patients", {
      params: { search: digits.slice(-10), limit: 10 },
    });
    const rows = res?.data?.data ?? res?.data ?? res ?? [];
    const match = (Array.isArray(rows) ? rows : []).find(
      (p: any) => String(p?.phone ?? "").replace(/\D/g, "").slice(-10) === digits.slice(-10),
    );
    return match?.id ?? null;
  };

  /**
   * The patient this prescription is filed against when the calling screen had
   * none. A named customer gets their own record; otherwise it goes on the
   * shared walk-in one, which is what keeps an unnamed paper Rx recordable at
   * all rather than lost.
   */
  const resolveWalkInPatient = async (): Promise<string> => {
    const named = walkInName.trim();
    const phone = walkInPhone.trim();

    if (named && phone) {
      const existing = await findPatientByPhone(phone);
      if (existing) return existing;
      const created: any = await apiClient.post("/patients", { name: named, phone });
      const id = created?.data?.id ?? created?.id;
      if (id) return id;
      const retry = await findPatientByPhone(phone);
      if (retry) return retry;
    }

    // Matched on the reserved number, not on the name: searching for "Walk-in"
    // would happily return a real person whose name merely contains it.
    const existingWalkIn = await findPatientByPhone(WALK_IN_PHONE);
    if (existingWalkIn) return existingWalkIn;

    const createRes: any = await apiClient.post("/patients", {
      name: "Walk-in Customer",
      phone: WALK_IN_PHONE,
    });
    const id = createRes?.data?.id ?? createRes?.id;
    if (id) return id;

    const retry = await findPatientByPhone(WALK_IN_PHONE);
    if (retry) return retry;
    throw new Error("Could not assign a patient record for the prescription.");
  };

  // Physical Rx Creation + Auto-Verify Mutation
  const createPhysicalRxMutation = useMutation({
    mutationFn: async () => {
      let activePatientId = patientId;
      if (!activePatientId) {
        try {
          activePatientId = await resolveWalkInPatient();
        } catch (err) {
          throw new Error(
            (err as Error)?.message ??
              "Could not assign a patient record for the prescription. Please select a patient.",
          );
        }
      }

      if (!doctorName.trim()) {
        throw new Error("Doctor Name is required.");
      }
      // The council number identifies the prescriber in the Schedule H
      // register. An ordinary counter sale keeps no such register, and the
      // customer's slip often does not carry it.
      if (!optionalContext && !doctorRegNo.trim()) {
        throw new Error("Doctor Medical Registration Number is required for Schedule H sales.");
      }

      const today = new Date().toISOString().split("T")[0]!;
      const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

      // Step 1: Create prescription record
      const createRes: any = await apiClient.post("/prescriptions", {
        patientId: activePatientId,
        doctorName: doctorName.trim(),
        doctorRegNo: doctorRegNo.trim(),
        hospitalName: hospitalName.trim() || undefined,
        physicalRegisterNo: physicalRegisterNo.trim() || undefined,
        issuedDate: today,
        expiryDate: expiry,
        isControlled: true,
        fileUrl: fileKey || undefined,
      });

      const rx = createRes?.data?.prescription ?? createRes?.data ?? createRes;
      const rxId = rx?.id;

      if (!rxId) throw new Error("Failed to create prescription record.");

      // Step 2: Auto-verify for POS dispensing
      try {
        await apiClient.post(`/prescriptions/${rxId}/verify`, { action: "verify" });
      } catch {
        // If already verified or current user auto-verified, proceed
      }

      return rxId;
    },
    onSuccess: (rxId: string) => {
      queryClient.invalidateQueries({ queryKey: ["rx-picker-search"] });
      toastSuccess("Physical Rx Logged", "Prescription created, verified, and linked to cart.");
      onSelectRx(rxId);
      onClose();
      // Reset form
      setDoctorName("");
      setHospitalName("");
      setFileKey(null);
    },
    onError: (err: any) => {
      toastError("Rx Logging Failed", err?.message ?? err?.response?.data?.message ?? "Could not save physical prescription.");
    },
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
      title="Schedule H Prescription Management"
      subtitle={patientName ? `Patient: ${patientName}` : "Link a verified digital Rx or log a physical paper prescription"}
      size="lg"
      icon={<FileText className="w-5 h-5 text-emerald-600" />}
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 gap-2 pb-2">
          <div className="flex border-b border-transparent gap-1">
            <button
              type="button"
              onClick={() => setTab("search")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all rounded-t-xl ${
                tab === "search"
                  ? "border-b-2 border-emerald-600 text-emerald-900 bg-emerald-50/80"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Search size={14} className="text-emerald-600" />
              <span>Search Digital Rx</span>
            </button>

            <button
              type="button"
              onClick={() => setTab("upload")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all rounded-t-xl ${
                tab === "upload"
                  ? "border-b-2 border-emerald-600 text-emerald-900 bg-emerald-50/80"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Upload size={14} className="text-emerald-600" />
              <span>Log Details / Photo (Optional)</span>
            </button>
          </div>
        </div>

        {tab === "search" ? (
          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Prescription ID, Doctor Name, or Patient..."
                className="w-full border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 font-semibold shadow-2xs"
              />
            </div>

            {/* Prescription List */}
            <div className="max-h-[45vh] overflow-y-auto space-y-2.5 pr-1">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
                ))
              ) : rxList.length === 0 ? (
                <div className="py-10 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                  <Inbox size={32} className="opacity-40 text-slate-400" />
                  <p className="text-sm font-bold text-slate-800">No verified digital prescriptions found</p>
                  <p className="text-xs text-slate-500 max-w-sm font-medium">
                    Does the patient have a paper prescription? Switch to &quot;Log Details / Photo&quot; or click &quot;⚡ Quick Verify Physical Rx&quot;.
                  </p>
                </div>
              ) : (
                rxList.map((rx: any) => (
                  <div
                    key={rx.id}
                    className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-emerald-500/60 hover:bg-emerald-50/40 transition-all flex items-center justify-between gap-4 group cursor-pointer shadow-sm"
                    onClick={() => {
                      onSelectRx(rx.id, rx);
                      onClose();
                    }}
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-950 text-sm font-mono truncate">
                          #{rx.prescriptionNumber || rx.id.slice(0, 8)}
                        </span>
                        <Badge variant="emerald" size="sm" dot>
                          Verified
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-700">
                        {rx.doctorName && (
                          <span className="flex items-center gap-1 text-slate-900 font-bold">
                            <Stethoscope size={14} className="text-emerald-600" />
                            Dr. {rx.doctorName}
                          </span>
                        )}
                        {rx.patientName && (
                          <span className="flex items-center gap-1 text-slate-700">
                            <User size={14} className="text-slate-500" />
                            {rx.patientName}
                          </span>
                        )}
                        {rx.createdAt && (
                          <span className="flex items-center gap-1 text-slate-600 font-semibold">
                            <Calendar size={14} className="text-slate-400" />
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
                      className="shrink-0 font-bold"
                    >
                      Link Rx
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Log Physical Paper Rx */
          <div className="space-y-4 pt-1">
            <div className="space-y-3.5">
              {/* No patient on the calling screen. A counter sale is a
                  walk-in by definition, so this used to block the form
                  outright — the paper prescription simply could not be
                  recorded. Naming the customer is offered, not demanded. */}
              {!patientId && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                  <p className="text-[11px] font-semibold text-slate-600">
                    Whose prescription is this?{" "}
                    <span className="font-normal text-slate-400">
                      Optional — left blank it is filed against the shared
                      walk-in record.
                    </span>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      placeholder="Customer name"
                      aria-label="Customer name for this prescription"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                    <input
                      value={walkInPhone}
                      onChange={(e) => setWalkInPhone(e.target.value)}
                      placeholder="Phone number"
                      inputMode="tel"
                      aria-label="Customer phone for this prescription"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                  {walkInName.trim() && !walkInPhone.trim() && (
                    <p className="text-[11px] font-semibold text-amber-700">
                      A phone number is needed to file it under this name —
                      otherwise it goes on the shared walk-in record.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Prescribing Doctor Name *
                  </label>
                  <input
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    placeholder="e.g. Dr. A. K. Sharma"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Doctor Reg. No. (MCI / State Council)
                    {optionalContext ? "" : " *"}
                  </label>
                  <input
                    value={doctorRegNo}
                    onChange={(e) => setDoctorRegNo(e.target.value)}
                    placeholder="e.g. WBMC-84920 / MCI-4819"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Hospital / Clinic Name
                  </label>
                  <input
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                    placeholder="e.g. City Hospital / Apex Clinic"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Physical Register Serial / Ref No
                  </label>
                  <input
                    value={physicalRegisterNo}
                    onChange={(e) => setPhysicalRegisterNo(e.target.value)}
                    placeholder="e.g. SCH-H-2026/0491"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Scan / Photo of Physical Paper Prescription
                </label>
                <PrescriptionScanUpload
                  value={fileKey}
                  onChange={setFileKey}
                  variant="compact"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  isLoading={createPhysicalRxMutation.isPending}
                  leftIcon={<Plus size={16} />}
                  onClick={() => createPhysicalRxMutation.mutate()}
                >
                  Verify & Link Physical Rx to Checkout
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

