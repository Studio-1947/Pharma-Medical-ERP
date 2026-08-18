"use client";

import { useState } from "react";
import { Check, Copy, Link2, Loader2, ShieldOff } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

type ShareableType = "prescription" | "invoice";

interface ShareLink {
  token: string;
  path: string;
  expiresAt: string;
  revokedAt?: string | null;
  viewCount?: number;
  active?: boolean;
}

/**
 * Creates and revokes a patient-facing link for one prescription or invoice.
 *
 * The link is a revocable secret with an expiry, not the record id, so a
 * forwarded link can be killed. Revoke is offered next to the link precisely
 * because that is when staff realise it went to the wrong number.
 */
export function ShareRecordButton({
  type,
  recordId,
  label = "Share with patient",
}: {
  type: ShareableType;
  recordId: string;
  label?: string;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const { success, error: toastError } = useToast();

  const fullUrl = link
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.path}`
    : "";

  async function create() {
    setBusy(true);
    try {
      // Written out rather than built from a variable segment so both routes
      // stay greppable and match the controller one-to-one.
      const path =
        type === "prescription"
          ? `/sharing/prescriptions/${recordId}`
          : `/sharing/invoices/${recordId}`;
      const res: any = await apiClient.post(path, {});
      setLink(res?.data?.data ?? res?.data ?? res);
      success("Link created", "Valid for 7 days. Revoke any time.");
    } catch (e: any) {
      toastError(
        "Could not create link",
        e?.response?.data?.message ?? "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!link) return;
    setBusy(true);
    try {
      await apiClient.post(`/sharing/${link.token}/revoke`, {});
      setLink(null);
      setCopied(false);
      success("Link revoked", "It no longer opens for anyone.");
    } catch (e: any) {
      toastError(
        "Could not revoke link",
        e?.response?.data?.message ?? "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError("Could not copy", "Select the link and copy it manually.");
    }
  }

  if (!link) {
    return (
      <button
        onClick={create}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 text-xs font-bold transition-colors"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Link2 size={14} />
        )}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={fullUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700"
        />
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-emerald-800">
          Expires{" "}
          {new Date(link.expiresAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          . Shows medicines and totals only, with the patient name shortened.
        </p>
        <button
          onClick={revoke}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-60 text-[11px] font-bold transition-colors shrink-0"
        >
          <ShieldOff size={13} />
          <span>Revoke</span>
        </button>
      </div>
    </div>
  );
}
