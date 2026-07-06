"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Modal } from "@/components/ui/modal";
import { Camera, AlertCircle, RefreshCw } from "lucide-react";
import { playScanBeep } from "@/hooks/use-barcode-scanner";

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
        
        const html5Qrcode = new Html5Qrcode(qrReaderId);
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
              // Stop scanning and close
              handleStop();
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
  }, [open]);

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
                  // Trigger restart of scanner
                  const dummy = {};
                  onClose();
                  setTimeout(() => {
                    // Quick toggle open state callback by parent
                  }, 100);
                }}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-xs font-semibold rounded-lg transition"
              >
                Close & Retry
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
                
                {/* Visual Scanner Box Focus Frame */}
                <div className="w-[320px] h-[150px] shrink-0 border-2 border-emerald-500 rounded-lg relative overflow-hidden bg-transparent">
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
      </div>
    </Modal>
  );
}
