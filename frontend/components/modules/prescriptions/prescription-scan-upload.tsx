"use client";

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Upload, CheckCircle2, X, Loader2, AlertTriangle, Camera, FileText } from "lucide-react";

/**
 * Uploads a photo of a handwritten prescription and hands the caller back the
 * S3 object key to store on `prescription.fileUrl`.
 *
 * Doctors here still write plenty of prescriptions on paper, so the scan is
 * often the only authoritative record of what was prescribed — the typed item
 * rows may be empty. That makes the image part of the dispensing record, not a
 * decoration, which is why the key is submitted with the prescription rather
 * than attached afterwards.
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

function PrescriptionCameraScannerModal({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [scanningTwain, setScanningTwain] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    loadDevices();
    startCamera(selectedDeviceId);
    return () => {
      stopCamera();
    };
  }, [open, selectedDeviceId]);

  async function loadDevices() {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "videoinput");
        setVideoDevices(inputs);
      }
    } catch (e) {
      console.warn("Could not enumerate video devices:", e);
    }
  }

  async function startCamera(deviceId?: string) {
    stopCamera();
    setCameraError(null);
    setStarting(true);
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
      };
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      // Re-enumerate to capture labels after permission granted
      loadDevices();
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError(
        "Could not access video scanner device. Please check hardware connection or permissions."
      );
    } finally {
      setStarting(false);
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }

  async function triggerHardwareTwainScan() {
    setScanningTwain(true);
    try {
      // Attempt connection to local TWAIN / WIA scanner service daemon
      const res = await fetch("http://127.0.0.1:18622/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "color", format: "png", dpi: 300 }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const capturedFile = new File([blob], `hardware_scan_${Date.now()}.png`, { type: "image/png" });
        stopCamera();
        onCapture(capturedFile);
        onClose();
        return;
      }
    } catch (e) {
      console.warn("Local TWAIN bridge not responding:", e);
    } finally {
      setScanningTwain(false);
    }

    // Fallback info if local TWAIN daemon is not active
    alert(
      "Physical USB Flatbed Scanner Bridge:\n\nPlease select your USB Document Scanner from the device dropdown above, or use your scanner software to save the JPG/PNG file and drag it into the upload box."
    );
  }

  function handleSnap() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const capturedFile = new File(
          [blob],
          `prescription_scan_${Date.now()}.png`,
          { type: "image/png" }
        );
        stopCamera();
        onCapture(capturedFile);
        onClose();
      },
      "image/png",
      0.92
    );
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 text-white rounded-3xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <Camera size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100 leading-tight">Prescription Scanner</h3>
              <p className="text-[11px] text-slate-400 truncate">Webcam, USB Document Camera &amp; Physical Hardware Scanner</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Physical Scanner / Device Selection Bar */}
        {videoDevices.length > 0 && (
          <div className="px-5 py-2.5 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Active Scanner Source:</span>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="bg-slate-900 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 truncate max-w-xs"
            >
              <option value="">Default Camera / Overhead Scanner</option>
              {videoDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Physical Scanner / Camera Device #${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Viewfinder Container */}
        <div className="relative p-4 flex flex-col items-center justify-center bg-black min-h-[320px]">
          {starting && (
            <div className="flex flex-col items-center justify-center space-y-2 text-slate-400 py-12">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
              <p className="text-xs font-medium">Connecting to scanner feed...</p>
            </div>
          )}

          {cameraError ? (
            <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
              <AlertTriangle size={36} className="text-amber-500" />
              <p className="text-xs text-slate-300 max-w-sm">{cameraError}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startCamera(selectedDeviceId)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                >
                  Retry Device
                </button>
                <button
                  type="button"
                  onClick={triggerHardwareTwainScan}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold rounded-lg text-white transition-colors"
                >
                  Trigger USB Flatbed Scanner
                </button>
              </div>
            </div>
          ) : (
            <div className="relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-[320px] sm:h-[380px] object-cover"
              />
              {/* Document Frame Guide */}
              <div className="absolute inset-6 border-2 border-dashed border-emerald-400/70 rounded-xl pointer-events-none flex flex-col justify-between p-3">
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
                  <div className="w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
                </div>
                <div className="text-center">
                  <span className="text-[10px] font-bold tracking-wider text-emerald-300 bg-slate-900/80 px-2.5 py-1 rounded border border-emerald-500/30 shadow-sm">
                    ALIGN PRESCRIPTION PAPER SLIP HERE
                  </span>
                </div>
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-emerald-400" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-800 bg-slate-900/90 gap-2">
          <button
            type="button"
            onClick={triggerHardwareTwainScan}
            disabled={scanningTwain}
            className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
            title="Scan from USB TWAIN / WIA flatbed or ADF hardware scanner"
          >
            {scanningTwain ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            <span>USB Flatbed Scan</span>
          </button>
          {!cameraError && (
            <button
              type="button"
              onClick={handleSnap}
              disabled={starting}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/40 transition-all disabled:opacity-50"
            >
              <Camera size={16} /> Snap &amp; Attach Photo
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
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
  const [cameraOpen, setCameraOpen] = useState(false);
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
      const key = res?.key ?? res?.data?.key;
      const url = res?.url ?? res?.data?.url;
      if (!key) throw new Error("Upload succeeded but no file key was returned.");

      onChange(key);
      setPreviewUrl(url ?? null);
      toastSuccess("Prescription scan attached");
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? err?.message ?? "Could not upload the scan.";
      setLocalError(message);
      toastError("Upload failed", message);
    } finally {
      setUploading(false);
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
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-3 shadow-2xs">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Prescription scan preview"
              className="w-14 h-14 rounded-lg object-cover border border-emerald-300 shrink-0 shadow-xs"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 border border-emerald-200">
              <CheckCircle2 size={22} className="text-emerald-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-900">Prescription Scan Attached</p>
            <p className="text-[11px] text-emerald-700/80 truncate mt-0.5">
              Saved with consultation for pharmacy dispensing verification.
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="p-1 rounded-lg text-emerald-700/60 hover:text-rose-600 hover:bg-white transition-colors shrink-0"
              title="Remove attached scan"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden File Input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {/* Dual Action Option Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Option 1: Live Camera Scanner */}
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={disabled || uploading}
          className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald-300/80 bg-emerald-50/70 hover:bg-emerald-100/70 text-left transition-all group disabled:opacity-50 shadow-2xs cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
            <Camera size={20} />
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-950">Open Camera Scanner</p>
            <p className="text-[11px] text-emerald-750/90 leading-snug">
              Snap paper slip using webcam or tablet camera
            </p>
          </div>
        </button>

        {/* Option 2: Upload File */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all group disabled:opacity-50 shadow-2xs cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200 group-hover:scale-105 transition-transform">
            <Upload size={18} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-800">Upload Image / File</p>
            <p className="text-[11px] text-slate-500 leading-snug">
              Select JPG or PNG image file from computer
            </p>
          </div>
        </button>
      </div>

      {/* Drag & Drop Dropzone */}
      <label
        className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-slate-200/90 rounded-2xl text-center transition-colors bg-slate-50/50 ${
          variant === "full" ? "px-6 py-8" : "px-4 py-5"
        } ${
          disabled || uploading
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:bg-emerald-50/30 hover:border-emerald-300"
        }`}
      >
        {uploading ? (
          <Loader2 className="text-emerald-600 animate-spin" size={22} />
        ) : (
          <FileText className="text-slate-400" size={22} />
        )}
        <span className="text-xs font-bold text-slate-700">
          {uploading ? "Uploading prescription scan..." : "Or drag and drop prescription file here"}
        </span>
        <span className="text-[11px] text-slate-400">
          Supports JPG, PNG up to 10MB
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled || uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {localError && (
        <div className="flex items-center gap-2 text-rose-600 text-xs bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-medium">
          <AlertTriangle size={14} className="shrink-0" /> {localError}
        </div>
      )}

      {/* Live Camera Scanner Modal */}
      <PrescriptionCameraScannerModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(capturedFile) => handleFile(capturedFile)}
      />
    </div>
  );
}

