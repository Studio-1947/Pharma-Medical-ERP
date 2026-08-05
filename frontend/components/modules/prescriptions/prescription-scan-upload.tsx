"use client";

import { useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Upload, CheckCircle2, X, Loader2, AlertTriangle } from "lucide-react";

/**
 * Uploads a photo of a handwritten prescription and hands the caller back the
 * S3 object key to store on `prescription.fileUrl`.
 *
 * Doctors here still write plenty of prescriptions on paper, so the scan is
 * often the only authoritative record of what was prescribed — the typed item
 * rows may be empty. That makes the image part of the dispensing record, not a
 * decoration, which is why the key is submitted with the prescription rather
 * than attached afterwards.
 *
 * The API returns { key, url }: `key` is what persists, `url` is a short-lived
 * presigned link used purely for the local preview.
 */

const MAX_BYTES = 10 * 1024 * 1024; // Backend caps the body at 16MB; stay clear of it.

interface Props {
  /** S3 object key of the uploaded scan, or null when nothing is attached. */
  value: string | null;
  onChange: (key: string | null) => void;
  disabled?: boolean;
  /** "full" is the tall dropzone used on its own tab; "compact" fits inside a form. */
  variant?: "full" | "compact";
}

export function PrescriptionScanUpload({
  value,
  onChange,
  disabled = false,
  variant = "compact",
}: Props) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLocalError(null);

    if (!file.type.startsWith("image/")) {
      setLocalError("Only image files (JPG, PNG) can be uploaded.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError("Image is larger than 10MB. Retake it at a lower resolution.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res: any = await apiClient.post("/prescriptions/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // The response interceptor unwraps one envelope, but the transform
      // interceptor can leave a second — accept either shape.
      const key = res?.key ?? res?.data?.key;
      const url = res?.url ?? res?.data?.url;
      if (!key) throw new Error("Upload succeeded but no file key was returned.");

      onChange(key);
      setPreviewUrl(url ?? null);
      toastSuccess("Scan attached");
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? err?.message ?? "Could not upload the scan.";
      setLocalError(message);
      toastError("Upload failed", message);
    } finally {
      setUploading(false);
      // Let the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    onChange(null);
    setPreviewUrl(null);
    setLocalError(null);
  }

  if (value) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Prescription scan preview"
              className="w-14 h-14 rounded-md object-cover border border-green-200 shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-md bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} className="text-green-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800">Scan attached</p>
            <p className="text-xs text-green-700/80 truncate">
              Saved with this prescription for the pharmacist to read.
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="p-1 rounded-md text-green-700/60 hover:text-red-600 hover:bg-white transition-colors shrink-0"
              title="Remove scan"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl text-center transition-colors ${
          variant === "full" ? "px-6 py-10" : "px-4 py-6"
        } ${
          disabled || uploading
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:bg-muted/40 hover:border-primary/40"
        }`}
      >
        {uploading ? (
          <Loader2 className="text-muted-foreground animate-spin" size={variant === "full" ? 28 : 22} />
        ) : (
          <Upload className="text-muted-foreground" size={variant === "full" ? 28 : 22} />
        )}
        <span className="text-sm font-medium">
          {uploading ? "Uploading..." : "Click to upload or photograph the prescription"}
        </span>
        <span className="text-xs text-muted-foreground">
          JPG or PNG, up to 10MB. Use this for handwritten prescriptions.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={disabled || uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {localError && (
        <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="shrink-0" /> {localError}
        </div>
      )}
    </div>
  );
}
