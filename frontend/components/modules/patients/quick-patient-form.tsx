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
  const [ageYears, setAgeYears] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dobMode, setDobMode] = useState<"dob" | "age">("age");
  const [state, setState] = useState("West Bengal");
  const [pincode, setPincode] = useState("");
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

    let finalDob = dateOfBirth;
    if (dobMode === "age" && ageYears.trim()) {
      const ageNum = parseInt(ageYears.trim(), 10);
      if (!isNaN(ageNum) && ageNum > 0 && ageNum < 130) {
        const bYear = new Date().getFullYear() - ageNum;
        finalDob = `${bYear}-01-01`;
      }
    }

    let fullAddress = "";
    if (pincode.trim()) {
      fullAddress = `PIN: ${pincode.trim()}`;
    }

    mutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      gender: gender || undefined,
      dateOfBirth: finalDob ? new Date(finalDob).toISOString() : undefined,
      state: state.trim() || "West Bengal",
      address: fullAddress || undefined,
    });
  }

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-xl p-3.5 space-y-3.5 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <UserPlus size={14} className="text-primary" />
          <p className="text-xs font-bold text-primary">Register New Patient</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-700">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-700">
            Phone <span className="text-red-500">*</span>
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile"
            inputMode="tel"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {/* Gender Radio Buttons */}
        <div className="space-y-1 sm:col-span-2">
          <label className="text-[11px] font-semibold text-slate-700">Gender</label>
          <div className="flex items-center gap-2">
            {[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other" },
            ].map((g) => (
              <label
                key={g.value}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                  gender === g.value
                    ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="quickGender"
                  value={g.value}
                  checked={gender === g.value}
                  onChange={(e) => setGender(e.target.value)}
                  className="accent-emerald-600 w-3 h-3 cursor-pointer"
                />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Age / DOB Section */}
        <div className="space-y-1 sm:col-span-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-700">Age &amp; Birth Date</label>
            <div className="flex items-center gap-1 bg-slate-200/70 p-0.5 rounded text-[9px] font-bold">
              <button
                type="button"
                onClick={() => setDobMode("age")}
                className={`px-1.5 py-0.5 rounded ${dobMode === "age" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600"}`}
              >
                Age (Years)
              </button>
              <button
                type="button"
                onClick={() => setDobMode("dob")}
                className={`px-1.5 py-0.5 rounded ${dobMode === "dob" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600"}`}
              >
                Exact DOB
              </button>
            </div>
          </div>

          {dobMode === "age" ? (
            <input
              type="number"
              min="1"
              max="120"
              value={ageYears}
              onChange={(e) => {
                const val = e.target.value;
                const num = parseInt(val, 10);
                let approx = "";
                if (!isNaN(num) && num > 0 && num < 120) {
                  approx = `${new Date().getFullYear() - num}-01-01`;
                }
                setAgeYears(val);
                setDateOfBirth(approx);
              }}
              placeholder="Age in years (e.g. 35)"
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          ) : (
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => {
                const val = e.target.value;
                let calc = "";
                if (val) {
                  const bDate = new Date(val);
                  const ageDiff = Math.floor((Date.now() - bDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                  if (ageDiff >= 0) calc = String(ageDiff);
                }
                setDateOfBirth(val);
                setAgeYears(calc);
              }}
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-700">State</label>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="West Bengal"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-700">Pincode</label>
          <input
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="e.g. 700001"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
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
