"use client";

import { useState, useEffect } from "react";
import { Calendar, Clock, Plus, Trash2, Check } from "lucide-react";

const ALL_DAYS = [
  { key: "Mon", label: "Mon" },
  { key: "Tue", label: "Tue" },
  { key: "Wed", label: "Wed" },
  { key: "Thu", label: "Thu" },
  { key: "Fri", label: "Fri" },
  { key: "Sat", label: "Sat" },
  { key: "Sun", label: "Sun" },
];

const DAY_PRESETS = [
  { label: "Mon – Fri", days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
  { label: "Mon – Sat", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
  { label: "Mon, Wed, Fri", days: ["Mon", "Wed", "Fri"] },
  { label: "Tue, Thu, Sat", days: ["Tue", "Thu", "Sat"] },
  { label: "Saturday", days: ["Sat"] },
  { label: "Sunday", days: ["Sun"] },
  { label: "Weekends", days: ["Sat", "Sun"] },
  { label: "Everyday", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
];

const TIME_OPTIONS = [
  "07:00 AM", "07:30 AM", "08:00 AM", "08:30 AM", "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "01:00 PM", "01:30 PM", "02:00 PM", "02:30 PM",
  "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM", "06:30 PM",
  "07:00 PM", "07:30 PM", "08:00 PM", "08:30 PM", "09:00 PM", "09:30 PM", "10:00 PM",
];

const SHIFT_PRESETS = [
  { label: "09:00 AM – 01:00 PM & 04:00 PM – 07:00 PM (Dual Shift)", value: "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" },
  { label: "09:00 AM – 01:00 PM (Morning)", value: "09:00 AM - 01:00 PM" },
  { label: "10:00 AM – 02:00 PM & 05:00 PM – 08:00 PM (Late Shift)", value: "10:00 AM - 02:00 PM & 05:00 PM - 08:00 PM" },
  { label: "09:00 AM – 02:00 PM (Half Day)", value: "09:00 AM - 02:00 PM" },
  { label: "04:00 PM – 08:00 PM (Evening)", value: "04:00 PM - 08:00 PM" },
  { label: "10:00 AM – 04:00 PM (Full Day Continuous)", value: "10:00 AM - 04:00 PM" },
  { label: "On Call Emergency Only", value: "On Call Emergency Only" },
];

export function formatSelectedDays(selected: string[]): string {
  if (selected.length === 0) return "";
  if (selected.length === 5 && ["Mon", "Tue", "Wed", "Thu", "Fri"].every((d) => selected.includes(d))) return "Mon - Fri";
  if (selected.length === 6 && ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].every((d) => selected.includes(d))) return "Mon - Sat";
  if (selected.length === 7) return "Mon - Sun (Everyday)";
  if (selected.length === 2 && selected.includes("Sat") && selected.includes("Sun")) return "Weekend (Sat, Sun)";
  return selected.join(", ");
}

export function parseDaysString(str: string): string[] {
  if (!str) return ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const lower = str.toLowerCase();
  if (lower.includes("mon - fri") || lower.includes("mon – fri")) return ["Mon", "Tue", "Wed", "Thu", "Fri"];
  if (lower.includes("mon - sat") || lower.includes("mon – sat")) return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (lower.includes("everyday") || lower.includes("mon - sun")) return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (lower.includes("weekend")) return ["Sat", "Sun"];
  
  const found: string[] = [];
  ALL_DAYS.forEach((d) => {
    if (lower.includes(d.key.toLowerCase())) found.push(d.key);
  });
  return found.length > 0 ? found : ["Mon", "Tue", "Wed", "Thu", "Fri"];
}

interface SlotState {
  days: string;
  hours: string;
}

interface Props {
  slot1: SlotState;
  slot2: SlotState;
  onChangeSlot1: (slot: SlotState) => void;
  onChangeSlot2: (slot: SlotState) => void;
}

export function OpdScheduleBuilder({ slot1, slot2, onChangeSlot1, onChangeSlot2 }: Props) {
  // Slot 1 Days local selection state
  const [slot1SelectedDays, setSlot1SelectedDays] = useState<string[]>(() => parseDaysString(slot1.days));
  // Slot 2 Days local selection state
  const [slot2SelectedDays, setSlot2SelectedDays] = useState<string[]>(() => parseDaysString(slot2.days));

  // Time pickers for Slot 1
  const [slot1Shift1Start, setSlot1Shift1Start] = useState("09:00 AM");
  const [slot1Shift1End, setSlot1Shift1End] = useState("01:00 PM");
  const [slot1EnableShift2, setSlot1EnableShift2] = useState(true);
  const [slot1Shift2Start, setSlot1Shift2Start] = useState("04:00 PM");
  const [slot1Shift2End, setSlot1Shift2End] = useState("07:00 PM");

  // Time pickers for Slot 2
  const [slot2Shift1Start, setSlot2Shift1Start] = useState("09:00 AM");
  const [slot2Shift1End, setSlot2Shift1End] = useState("02:00 PM");

  const [hasSlot2, setHasSlot2] = useState(() => !!slot2.days.trim());

  // Sync Slot 1 days changes to parent
  const toggleSlot1Day = (dayKey: string) => {
    const next = slot1SelectedDays.includes(dayKey)
      ? slot1SelectedDays.filter((d) => d !== dayKey)
      : [...slot1SelectedDays, dayKey];
    setSlot1SelectedDays(next);
    onChangeSlot1({ ...slot1, days: formatSelectedDays(next) });
  };

  const applySlot1DayPreset = (days: string[]) => {
    setSlot1SelectedDays(days);
    onChangeSlot1({ ...slot1, days: formatSelectedDays(days) });
  };

  // Sync Slot 2 days changes to parent
  const toggleSlot2Day = (dayKey: string) => {
    const next = slot2SelectedDays.includes(dayKey)
      ? slot2SelectedDays.filter((d) => d !== dayKey)
      : [...slot2SelectedDays, dayKey];
    setSlot2SelectedDays(next);
    onChangeSlot2({ ...slot2, days: formatSelectedDays(next) });
  };

  const applySlot2DayPreset = (days: string[]) => {
    setSlot2SelectedDays(days);
    onChangeSlot2({ ...slot2, days: formatSelectedDays(days) });
  };

  // Update Slot 1 Hours from pickers
  const updateSlot1Hours = (start1: string, end1: string, enable2: boolean, start2: string, end2: string) => {
    let formatted = `${start1} - ${end1}`;
    if (enable2) {
      formatted += ` & ${start2} - ${end2}`;
    }
    onChangeSlot1({ ...slot1, hours: formatted });
  };

  // Update Slot 2 Hours from pickers
  const updateSlot2Hours = (start1: string, end1: string) => {
    const formatted = `${start1} - ${end1}`;
    onChangeSlot2({ ...slot2, hours: formatted });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-emerald-200/60 pb-1.5">
        <label className="text-[11px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Calendar size={14} className="text-emerald-600" />
          Weekly OPD Days &amp; Time Slots Roster
        </label>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200">
          Structured Slot Builder
        </span>
      </div>

      {/* SLOT 1 (PRIMARY OPD ROSTER) */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
            <span className="text-xs font-black text-slate-900 uppercase tracking-wider">Primary OPD Schedule (Slot 1)</span>
          </div>
          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            {slot1.days || "Mon - Fri"}
          </span>
        </div>

        {/* Slot 1 Day Selector Pills */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Select Duty Days
          </span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_DAYS.map((d) => {
              const active = slot1SelectedDays.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleSlot1Day(d.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                    active
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          {/* Quick Day Presets */}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[10px] text-slate-400 font-medium mr-1">Quick Presets:</span>
            {DAY_PRESETS.slice(0, 5).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applySlot1DayPreset(p.days)}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-800 border border-slate-200 transition"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Slot 1 Time Picker & Shift Controls */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Shift Timings &amp; Hours</span>
            <span className="text-[10px] text-slate-400 normal-case font-mono">{slot1.hours}</span>
          </span>

          {/* Structured Shift Pickers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {/* Shift 1 */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
              <span className="text-[10px] font-bold text-slate-600 block">Morning Shift</span>
              <div className="flex items-center gap-1.5">
                <select
                  value={slot1Shift1Start}
                  onChange={(e) => {
                    setSlot1Shift1Start(e.target.value);
                    updateSlot1Hours(e.target.value, slot1Shift1End, slot1EnableShift2, slot1Shift2Start, slot1Shift2End);
                  }}
                  className="w-full border border-slate-300 rounded-md px-1.5 py-1 text-xs bg-white font-semibold text-slate-800"
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span className="text-slate-400 font-bold">to</span>
                <select
                  value={slot1Shift1End}
                  onChange={(e) => {
                    setSlot1Shift1End(e.target.value);
                    updateSlot1Hours(slot1Shift1Start, e.target.value, slot1EnableShift2, slot1Shift2Start, slot1Shift2End);
                  }}
                  className="w-full border border-slate-300 rounded-md px-1.5 py-1 text-xs bg-white font-semibold text-slate-800"
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Shift 2 (Optional Evening Shift) */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600">Evening Shift (Optional)</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slot1EnableShift2}
                    onChange={(e) => {
                      setSlot1EnableShift2(e.target.checked);
                      updateSlot1Hours(slot1Shift1Start, slot1Shift1End, e.target.checked, slot1Shift2Start, slot1Shift2End);
                    }}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3 h-3"
                  />
                  <span className="text-[10px] font-semibold text-slate-600">Enable</span>
                </label>
              </div>
              {slot1EnableShift2 ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={slot1Shift2Start}
                    onChange={(e) => {
                      setSlot1Shift2Start(e.target.value);
                      updateSlot1Hours(slot1Shift1Start, slot1Shift1End, true, e.target.value, slot1Shift2End);
                    }}
                    className="w-full border border-slate-300 rounded-md px-1.5 py-1 text-xs bg-white font-semibold text-slate-800"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <span className="text-slate-400 font-bold">to</span>
                  <select
                    value={slot1Shift2End}
                    onChange={(e) => {
                      setSlot1Shift2End(e.target.value);
                      updateSlot1Hours(slot1Shift1Start, slot1Shift1End, true, slot1Shift2Start, e.target.value);
                    }}
                    className="w-full border border-slate-300 rounded-md px-1.5 py-1 text-xs bg-white font-semibold text-slate-800"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 py-1 font-medium italic">Single shift schedule</div>
              )}
            </div>
          </div>

          {/* Quick Shift Presets Dropdown */}
          <div className="pt-1">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onChangeSlot1({ ...slot1, hours: e.target.value });
                }
              }}
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] bg-slate-50 text-slate-700 font-medium"
            >
              <option value="">Or select a quick shift preset…</option>
              {SHIFT_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* SLOT 2 (OPTIONAL SECONDARY ROSTER e.g. Saturday) */}
      {hasSlot2 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-black flex items-center justify-center">2</span>
              <span className="text-xs font-black text-slate-900 uppercase tracking-wider">Secondary OPD Schedule (Slot 2)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setHasSlot2(false);
                onChangeSlot2({ days: "", hours: "" });
              }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1"
            >
              <Trash2 size={12} /> Remove Slot 2
            </button>
          </div>

          {/* Slot 2 Day Selector Pills */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Select Duty Days
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map((d) => {
                const active = slot2SelectedDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleSlot2Day(d.key)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                      active
                        ? "bg-slate-800 text-white border-slate-800 shadow-2xs"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slot 2 Time Picker */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Shift Timings</span>
              <span className="text-[10px] text-slate-400 font-mono">{slot2.hours || "09:00 AM - 02:00 PM"}</span>
            </span>

            <div className="flex items-center gap-2">
              <select
                value={slot2Shift1Start}
                onChange={(e) => {
                  setSlot2Shift1Start(e.target.value);
                  updateSlot2Hours(e.target.value, slot2Shift1End);
                }}
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs bg-white font-semibold text-slate-800"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="text-slate-400 font-bold text-xs">to</span>
              <select
                value={slot2Shift1End}
                onChange={(e) => {
                  setSlot2Shift1End(e.target.value);
                  updateSlot2Hours(slot2Shift1Start, e.target.value);
                }}
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs bg-white font-semibold text-slate-800"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setHasSlot2(true);
            const defaultDays = "Saturday";
            const defaultHours = "09:00 AM - 02:00 PM";
            setSlot2SelectedDays(["Sat"]);
            onChangeSlot2({ days: defaultDays, hours: defaultHours });
          }}
          className="w-full py-2 border-2 border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:border-emerald-500 hover:text-emerald-700 transition flex items-center justify-center gap-1.5 bg-slate-50/50"
        >
          <Plus size={14} /> Add Secondary OPD Schedule (e.g. Saturday / Weekend Roster)
        </button>
      )}
    </div>
  );
}
