"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Modal } from "@/components/ui/modal";
import { Camera, AlertCircle, RefreshCw, ImageUp } from "lucide-react";
import { playScanBeep } from "@/hooks/use-barcode-scanner";

// 1D barcode formats used by medicine strips and general retail goods, plus QR.
const SCAN_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e",
  "code_128", "code_39", "itf", "codabar", "qr_code",
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  subtitle?: string;
}

export function BarcodeScannerDialog({
  open,
  onClose,
  onScan,
  title = "Scan Barcode",
  subtitle = "Align the barcode within the highlighted box to scan"
}: Props) {
  const qrReaderId = "barcode-scanner-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  // Bumped by the Retry button to re-run the camera startup effect
  const [attempt, setAttempt] = useState(0);
  // Photo-capture fallback: iOS Safari has no BarcodeDetector API and its live
  // video 1D decode is unreliable, so snap a still and decode it with a WASM
  // ZXing reader instead.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoStatus, setPhotoStatus] = useState<null | "reading" | "notfound">(null);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so selecting the same photo again re-fires onChange
    if (!file) return;
    setPhotoStatus("reading");
    try {
      // Loaded on demand so the WASM decoder isn't pulled into the main bundle.
      const { BarcodeDetector } = await import("barcode-detector/ponyfill");
      const detector = new BarcodeDetector({ formats: [...SCAN_FORMATS] });
      const results = await detector.detect(file);
      const code = results.find((r) => r.rawValue)?.rawValue;
      if (code) {
        playScanBeep();
        onScan(code);
        setPhotoStatus(null);
        await handleStop();
        onClose();
      } else {
        setPhotoStatus("notfound");
      }
    } catch (err) {
      console.error("Photo decode error:", err);
      setPhotoStatus("notfound");
    }
  };

  useEffect(() => {
    if (!open) {
      // Reset state when closed
      setError(null);
      setIsInitializing(true);
      return;
    }

    let isMounted = true;

    // Small delay to ensure the DOM element has fully rendered
    const timer = setTimeout(async () => {
      try {
        if (!isMounted) return;
        
        // formatsToSupport + experimentalFeatures must go in the CONSTRUCTOR
        // config (not start()) — html5-qrcode reads them only here.
        const html5Qrcode = new Html5Qrcode(qrReaderId, {
          // Books and medicine strips carry 1D barcodes (EAN-13, UPC, Code-128).
          // Without an explicit list the live-video decoder skews toward QR and
          // silently fails to read these striped codes.
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          // Prefer the phone's native BarcodeDetector when present — far more
          // reliable at 1D barcodes than the JS fallback (Android Chrome/Edge).
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        });
        scannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 15,
            // A wide rectangular box suitable for barcode labels
            qrbox: (width, height) => {
              const boxWidth = Math.min(width * 0.8, 320);
              const boxHeight = Math.min(height * 0.4, 150);
              return { width: boxWidth, height: boxHeight };
            },
            aspectRatio: 1.777778 // 16:9
          },
          (decodedText) => {
            if (isMounted) {
              playScanBeep();
              onScan(decodedText);
              // Stop the camera AND dismiss the dialog — otherwise it lingers
              // on a frozen frame and hides the resulting toast / cart update.
              handleStop();
              onClose();
            }
          },
          () => {
            // Keep verbose scanner output silent
          }
        );

        if (isMounted) {
          setIsInitializing(false);
          setError(null);
        }
      } catch (err: any) {
        console.error("Scanner startup error:", err);
        if (isMounted) {
          setIsInitializing(false);
          setError(err?.message || "Failed to start camera. Please verify permissions.");
        }
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      handleStop();
    };
  }, [open, attempt]);

  const handleStop = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (err) {
        console.warn("Failed to stop scanner on unmount:", err);
      } finally {
        scannerRef.current = null;
      }
    }
  };

  const handleModalClose = async () => {
    await handleStop();
    onClose();
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      open={open}
      onClose={handleModalClose}
      size="md"
      icon={<Camera size={18} />}
    >
      <div className="flex flex-col items-center justify-center space-y-4">
        {/* Camera Scanner Viewport Container */}
        <div className="relative w-full max-w-sm aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-950 flex items-center justify-center shadow-inner group">
          {/* html5-qrcode video element target */}
          <div id={qrReaderId} className="w-full h-full overflow-hidden" />

          {/* Initializing indicator */}
          {isInitializing && !error && (
            <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-white space-y-3 z-10 animate-in fade-in duration-200">
              <RefreshCw size={28} className="animate-spin text-emerald-500" />
              <span className="text-sm font-medium">Initializing camera...</span>
            </div>
          )}

          {/* Error Message display overlay */}
          {error && (
            <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-white px-6 text-center space-y-3 z-10 animate-in fade-in duration-200">
              <AlertCircle size={32} className="text-red-500" />
              <p className="text-sm font-medium">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setIsInitializing(true);
                  setAttempt((a) => a + 1);
                }}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-xs font-semibold rounded-lg transition"
              >
                Retry
              </button>
            </div>
          )}

          {/* Scanner Overlay Guide Layer (Only visible when scanning has initialized successfully) */}
          {!isInitializing && !error && (
            <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between">
              {/* Top dimmed area */}
              <div className="bg-black/50 flex-1 w-full" />
              
              {/* Scanning center cutout row */}
              <div className="flex w-full h-[150px] shrink-0 justify-between items-center">
                {/* Left side shade */}
                <div className="bg-black/50 h-full flex-1" />
                
                {/* Visual Scanner Box Focus Frame — fluid so it never overflows narrow phone screens */}
                <div className="w-[min(320px,85%)] h-[150px] shrink-0 border-2 border-emerald-500 rounded-lg relative overflow-hidden bg-transparent">
                  {/* Corner brackets */}
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br" />

                  {/* Laser indicator animation */}
                  <div className="absolute w-[92%] left-[4%] h-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" 
                       style={{
                         animation: 'barcodeLaser 2s infinite ease-in-out',
                       }}
                  />
                </div>

                {/* Right side shade */}
                <div className="bg-black/50 h-full flex-1" />
              </div>
              
              {/* Bottom dimmed area */}
              <div className="bg-black/50 flex-1 w-full" />
            </div>
          )}
        </div>

        {/* Global style injection for the barcode laser animation */}
        <style jsx global>{`
          @keyframes barcodeLaser {
            0%, 100% {
              top: 10%;
            }
            50% {
              top: 90%;
            }
          }
          /* Hide html5-qrcode verbose banner */
          #barcode-scanner-reader {
            border: none !important;
          }
          #barcode-scanner-reader video {
            object-fit: cover !important;
            width: 100% !important;
            height: 100% !important;
          }
        `}</style>

        <p className="text-xs text-slate-500 text-center font-medium bg-slate-50 px-4 py-2 rounded-lg border border-slate-100 max-w-sm">
          Tip: Hold the barcode steady. If the image is dark, ensure your workspace is well-lit.
        </p>

        {/* Photo-capture fallback — the reliable path on iPhone/iOS Safari,
            where the live video scanner can't decode striped barcodes. */}
        <div className="w-full max-w-sm flex flex-col items-center gap-2 pt-1">
          <div className="flex items-center gap-3 w-full text-[11px] font-semibold text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            OR
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoStatus === "reading"}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition"
          >
            {photoStatus === "reading" ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Reading barcode...
              </>
            ) : (
              <>
                <ImageUp size={16} />
                Take a Photo to Scan
              </>
            )}
          </button>

          {photoStatus === "notfound" && (
            <p className="text-xs text-red-600 font-medium text-center">
              Couldn&apos;t read a barcode in that photo. Fill the frame with the barcode, hold steady, and try again.
            </p>
          )}
          <p className="text-[11px] text-slate-400 text-center">
            On iPhone, use this if the live scanner above doesn&apos;t pick up the barcode.
          </p>
        </div>
      </div>
    </Modal>
  );
}
