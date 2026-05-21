"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface ExportButtonProps {
  /** API path, e.g. "/reports/gst" */
  url: string;
  params?: Record<string, string | number | boolean | undefined>;
  filename?: string;
  label?: string;
  className?: string;
}

export function ExportButton({
  url,
  params = {},
  filename = "export.csv",
  label = "Export CSV",
  className,
}: ExportButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const handleExport = async () => {
    setState("loading");
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("pharmerp_access_token")
          : null;

      const qs = new URLSearchParams();
      Object.entries({ ...params, format: "csv" }).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });

      const response = await fetch(`${base}${url}?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setState("idle");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={state === "loading"}
      className={
        className ??
        "flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
      }
    >
      {state === "loading" ? (
        <>
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Exporting…
        </>
      ) : state === "error" ? (
        <>
          <Download size={15} />
          Failed — retry
        </>
      ) : (
        <>
          <Download size={15} />
          {label}
        </>
      )}
    </button>
  );
}
