"use client";

import { useAuthStore } from "@/stores/auth.store";
import { useClinicDoctors } from "@/queries/clinic.queries";

/**
 * Display name of the signed-in user when they are a doctor.
 *
 * The JWT carries only sub/email/role/branchId and there is no /auth/me route,
 * so the name comes from GET /clinic/doctors matched on the user id. That route
 * admits the doctor role, which is the only role this hook resolves a name for.
 *
 * This mirrors the server: PrescriptionsService.create overwrites `doctorName`
 * with the caller's own name whenever the caller is a doctor, so one prescriber
 * cannot issue a pre-verified controlled-drug prescription under another's
 * name. A doctor typing into that field was writing a value the API discards —
 * prefilling it makes the form agree with what actually gets stored.
 */
export function useCurrentDoctor(): {
  isDoctor: boolean;
  name: string | null;
  isLoading: boolean;
} {
  const { user } = useAuthStore();
  const isDoctor = user?.role === "doctor";

  const { data, isLoading } = useClinicDoctors({ enabled: isDoctor && !!user?.id });

  if (!isDoctor) return { isDoctor: false, name: null, isLoading: false };

  const raw = data as any;
  const doctors: any[] = Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.data?.data)
      ? raw.data.data
      : Array.isArray(raw)
        ? raw
        : [];

  const me = doctors.find((d) => d.id === user?.id);

  const rawName = me
    ? [me.firstName, me.lastName].filter(Boolean).join(" ").trim()
    : "";
  let formattedName = rawName;
  if (formattedName) {
    if (!formattedName.startsWith("Dr.")) formattedName = `Dr. ${formattedName}`;
  } else if (me?.email || user?.email) {
    const targetEmail = me?.email || user?.email || "";
    const prefix = (targetEmail.split("@")[0] ?? "doctor").replace(/[^a-zA-Z0-9]/g, " ").trim();
    const cap = prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : "Doctor";
    formattedName = `Dr. ${cap}`;
  } else {
    formattedName = "Dr. Doctor";
  }

  return { isDoctor: true, name: formattedName, isLoading };
}
