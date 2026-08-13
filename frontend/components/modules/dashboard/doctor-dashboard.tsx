"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth.store";
import { useClinicTokens, useClinicDoctors } from "@/queries/clinic.queries";
import { useNavigation } from "@/lib/navigation-context";
import { localDateString } from "@/lib/date";
import { EditDoctorProfileModal, doctorName } from "@/components/modules/clinic/clinic-queue";
import {
  Stethoscope, Clock, PhoneCall, CheckCircle2, Users, FileText, ArrowRight, Edit, MapPin, DollarSign,
} from "lucide-react";

/**
 * Dashboard shown to doctors.
 *
 * The general dashboard is built from sales, stock valuation and purchasing
 * data, none of which a doctor has a grant for — it renders as empty cards over
 * four failed requests, with quick actions pointing at POS and Procurement that
 * deny on arrival. A doctor's day is the consultation queue, so this shows that
 * instead and only calls endpoints the doctor role is allowed to reach.
 */

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
  accent: "amber" | "teal" | "emerald";
}) {
  const styles = {
    amber: "bg-gradient-to-br from-amber-400 to-orange-500",
    teal: "bg-gradient-to-br from-teal-500 to-teal-600",
    emerald: "bg-gradient-to-br from-emerald-500 to-emerald-600",
  }[accent];

  return (
    <div className={`${styles} rounded-2xl p-5 text-white relative overflow-hidden`}>
      <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/5" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/75 mb-1">{label}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          <p className="text-xs mt-1 text-white/70">{sub}</p>
        </div>
        <div className="bg-white/20 p-2.5 rounded-xl">{icon}</div>
      </div>
    </div>
  );
}

export function DoctorDashboard() {
  const { user } = useAuthStore();
  const { navigate } = useNavigation();
  const today = localDateString();
  const [editingSelf, setEditingSelf] = useState(false);

  const { data: doctorsRes } = useClinicDoctors();
  const doctors: any[] = (doctorsRes as any)?.data ?? [];
  const uAny = user as any;
  const me = doctors.find((d) => d.id === user?.id || d.email === user?.email) ?? {
    id: user?.id ?? "",
    firstName: uAny?.firstName,
    lastName: uAny?.lastName,
    email: user?.email ?? "",
    doctorProfile: uAny?.doctorProfile,
  };

  const dp = me.doctorProfile;
  const specialty = dp?.specialty || "General Medicine & Primary Care";
  const fee = dp?.consultationFee ? `₹${dp.consultationFee}` : "₹400";
  const opdRoom = dp?.opdRoom || "OPD Cabin 101 (Ground Floor)";
  const status = dp?.availabilityStatus || "available";
  const weeklySchedule = dp?.weeklySchedule ?? [
    { days: "Mon - Fri", slots: "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" },
    { days: "Saturday", slots: "09:00 AM - 02:00 PM" },
  ];

  const displayName = doctorName({ ...me, firstName: me.firstName || uAny?.firstName, lastName: me.lastName || uAny?.lastName });

  const { data: tokensRes, isLoading } = useClinicTokens(
    { date: today, doctorId: user?.id, limit: 100 },
    { enabled: !!user?.id },
  );

  const raw = (tokensRes as any)?.data;
  const tokens: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

  const waiting = tokens.filter((t) => t.status === "pending");
  const inConsult = tokens.filter((t) => t.status === "called");
  const completed = tokens.filter((t) => t.status === "completed");

  const upNext = [...inConsult, ...waiting].slice(0, 6);

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Top Banner: Doctor Greeting & Availability Controls */}
      <div className="bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 p-6 rounded-2xl text-white shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center font-black text-lg shrink-0">
            {displayName.replace("Dr. ", "").slice(0, 2).toUpperCase()}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
                Good morning, {displayName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {specialty}
              </span>
              <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold border flex items-center gap-1.5 ${
                status === "on_leave"
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                  : status === "on_call"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                  : status === "busy"
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  status === "on_leave" ? "bg-rose-400" : status === "on_call" ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"
                }`} />
                {status === "on_leave" ? "On Leave" : status === "on_call" ? "On Call / Emergency" : status === "busy" ? "Busy / In Surgery" : "Available Today"}
              </span>
            </div>

            <p className="text-xs text-slate-300 font-medium flex items-center gap-3 flex-wrap pt-0.5">
              <span>{dateLabel}</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-200 font-semibold">
                <MapPin size={13} className="text-emerald-400" /> {opdRoom}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 text-slate-200 font-semibold">
                <DollarSign size={13} className="text-emerald-400" /> {fee} Fee
              </span>
            </p>

            <div className="flex items-center gap-2 text-[11px] text-slate-300 pt-1 flex-wrap font-mono">
              <span className="text-slate-400 font-bold uppercase tracking-wider font-sans flex items-center gap-1">
                <Clock size={12} className="text-emerald-400" /> Weekly Timings:
              </span>
              {weeklySchedule.map((s: any, idx: number) => (
                <span key={idx} className="bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700 text-slate-200">
                  {s.days}: {s.slots}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <button
            onClick={() => setEditingSelf(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-bold rounded-xl transition-all shadow-2xs"
          >
            <Edit size={14} className="text-emerald-400" /> Edit Profile & Timings
          </button>
          <button
            onClick={() => navigate("/clinic/doctor")}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold rounded-xl shadow-md transition-all hover:scale-105 active:scale-95"
          >
            <Stethoscope size={15} />
            Open Doctor Panel
          </button>
        </div>
      </div>

      {/* Queue stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Waiting"
          value={isLoading ? "--" : waiting.length}
          sub="Patients yet to be called"
          icon={<Clock size={20} />}
          accent="amber"
        />
        <StatCard
          label="In Consultation"
          value={isLoading ? "--" : inConsult.length}
          sub="Currently called in"
          icon={<PhoneCall size={20} />}
          accent="teal"
        />
        <StatCard
          label="Completed Today"
          value={isLoading ? "--" : completed.length}
          sub="Consultations finished"
          icon={<CheckCircle2 size={20} />}
          accent="emerald"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Up next */}
        <div className="xl:col-span-2 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Up Next</h2>
              <p className="text-xs text-slate-400 mt-0.5">Today&apos;s consultation queue</p>
            </div>
            <button
              onClick={() => navigate("/clinic/doctor")}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              Full queue <ArrowRight size={12} />
            </button>
          </div>

          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-lg" />)}
            </div>
          ) : upNext.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-slate-300 gap-2">
              <CheckCircle2 size={32} strokeWidth={1.5} />
              <p className="text-sm">No patients waiting.</p>
              <p className="text-xs">
                {completed.length > 0
                  ? `All ${completed.length} consultations for today are done.`
                  : "Tokens issued at the front desk will appear here."}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upNext.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate("/clinic/doctor")}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-100 hover:bg-emerald-50 hover:border-emerald-200 transition-colors group text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-white flex items-center justify-center text-sm font-bold text-slate-600 shrink-0">
                      {t.tokenNo}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {t.patient?.name ?? "--"}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{t.patient?.phone ?? ""}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0 ${
                      t.status === "called"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {t.status === "called" ? "In consultation" : "Waiting"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-slate-800 mb-1">Quick Actions</h2>
          <p className="text-xs text-slate-400 mb-4">Where you work day to day</p>

          <div className="space-y-2">
            <button
              onClick={() => navigate("/clinic/doctor")}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-all shadow-sm"
            >
              <Stethoscope size={14} />
              Consultation Queue
            </button>
            <button
              onClick={() => navigate("/prescriptions")}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 hover:border-emerald-200 hover:text-emerald-700 transition-all"
            >
              <FileText size={14} />
              Prescriptions
            </button>
            <button
              onClick={() => navigate("/patients")}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 hover:border-emerald-200 hover:text-emerald-700 transition-all"
            >
              <Users size={14} />
              Patients
            </button>
          </div>
        </div>
      </div>

      {/* Edit Doctor Profile Modal */}
      <EditDoctorProfileModal
        open={editingSelf}
        onClose={() => setEditingSelf(false)}
        doctor={me}
      />
    </div>
  );
}
