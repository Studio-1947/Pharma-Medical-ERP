"use client";

import { useEffect, useState } from "react";
import { UserCog, LogOut } from "lucide-react";
import {
  getImpersonationState,
  stopImpersonation,
} from "@/lib/impersonation";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Always-visible bar shown while impersonating.
 *
 * Mounted in AppShell OUTSIDE the route-permission gate: usePermissions
 * derives from user.role, so during impersonation the operator has the
 * target's role and /admin renders AccessDenied. If the Stop button lived
 * inside the gate the operator would be stranded on a denial screen.
 */
export function ImpersonationBanner() {
  const [state, setState] = useState(() => getImpersonationState());
  const [remaining, setRemaining] = useState<number>(0);

  // sessionStorage fires no events in the tab that wrote it, so poll for the
  // start/stop transition rather than trying to observe it.
  useEffect(() => {
    const id = setInterval(() => setState(getImpersonationState()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state) return;
    const tick = () => {
      const ms = new Date(state.expiresAt).getTime() - Date.now();
      setRemaining(ms);
      // End it ourselves at zero rather than waiting for the next request to
      // 401, so the operator is never mid-action when the session swaps back.
      if (ms <= 0) {
        stopImpersonation({ callApi: false });
        window.location.href = "/admin/users";
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;

  const targetName =
    [state.target.firstName, state.target.lastName].filter(Boolean).join(" ") ||
    state.target.email;

  const handleStop = () => {
    stopImpersonation();
    window.location.href = "/admin/users";
  };

  return (
    <div
      role="status"
      // Amber, deliberately outside the emerald/slate palette, so it cannot be
      // mistaken for ordinary chrome.
      className="shrink-0 bg-amber-500 text-white text-sm font-medium px-4 py-2 flex flex-wrap items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserCog size={16} className="shrink-0" />
        <span className="truncate">
          Viewing as <strong>{targetName}</strong>
          <span className="opacity-90"> ({state.target.role.replace(/_/g, " ")})</span>
          <span className="opacity-90"> · read-only</span>
          <span className="opacity-75"> — signed in as {state.actor.email}</span>
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="tabular-nums opacity-90">
          {formatRemaining(remaining)} left
        </span>
        <button
          onClick={handleStop}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-semibold"
        >
          <LogOut size={14} />
          Stop
        </button>
      </div>
    </div>
  );
}
