"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { UserPlus, AlertTriangle, Loader2 } from "lucide-react";
import { isValidPhoneNumber } from "@/lib/phone-validation";

/**
 * Minimal patient registration, for use inside another flow.
 *
 * A walk-in is usually not on file yet, and sending the person at the desk off
 * to the Patients screen loses whatever they had already filled in. Only name
 * and phone are required by the API, so this asks for those plus the two fields
 * a consultation actually uses, and hands the created patient straight back.
 *
 * Full registration (address, insurance, allergies, chronic conditions) stays
 * on the Patients screen — this is the counter version, not a replacement.
 */

export interface QuickPatient {
  id: string;
  name: string;
  phone: string;
}

const GENDERS = ["male", "female", "other"] as const;

/** Digits-only input is a phone; anything else is a name. */
export function looksLikePhone(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 4 && /^[\d\s+()-]+$/.test(trimmed);
}

export function QuickPatientForm({
  initialQuery = "",
  onCreated,
  onCancel,
}: {
  /** Whatever was typed into the search, used to prefill the obvious field. */
  initialQuery?: string;
  onCreated: (patient: QuickPatient) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const prefillIsPhone = looksLikePhone(initialQuery);

  const [name, setName] = useState(prefillIsPhone ? "" : initialQuery.trim());
  const [phone, setPhone] = useState(prefillIsPhone ? initialQuery.trim() : "");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: object) => apiClient.post("/patients", body) as Promise<any>,
    onSuccess: (res: any) => {
      const created = res?.data?.data ?? res?.data ?? res;
      if (!created?.id) {
        setError("Patient was created but could not be selected. Search for them by phone.");
        return;
      }
      // Refresh any open patient list so the new record is not missing from it.
      qc.invalidateQueries({ queryKey: queryKeys.patients.all() });
      onCreated({ id: created.id, name: created.name, phone: created.phone });
    },
    onError: (err: any) => {
      // 409 is the common one: the phone is already on file, which usually
      // means the patient exists and should be searched for instead.
      const status = err?.response?.status;
      const message = err?.response?.data?.message;
      setError(
        status === 409
          ? `${phone.trim()} is already registered. Close this and search for the patient by phone.`
          : (message ?? "Could not register the patient."),
      );
    },
  });

  function submit() {
    if (!name.trim()) { setError("Patient name is required."); return; }
    if (!isValidPhoneNumber(phone)) {
      setError("Please enter a valid 10-digit mobile number (e.g. 9876543210 or +91 9876543210).");
      return;
    }
    setError(null);

    mutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      gender: gender || undefined,
      dateOfBirth: dateOfBirth || undefined,
    });
  }

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <UserPlus size={13} className="text-primary" />
        <p className="text-xs font-semibold text-primary">Register new patient</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Phone <span className="text-red-500">*</span>
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile"
            inputMode="tel"
            className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Gender</label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Not stated</option>
            {GENDERS.map((g) => (
              <option key={g} value={g} className="capitalize">{g}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Date of birth</label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-red-600 text-[11px] bg-red-50 border border-red-200 rounded px-2 py-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 border rounded-lg text-xs font-medium hover:bg-muted transition-colors bg-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? (
            <><Loader2 size={11} className="animate-spin" /> Saving...</>
          ) : (
            <><UserPlus size={11} /> Register & Select</>
          )}
        </button>
      </div>
    </div>
  );
}
