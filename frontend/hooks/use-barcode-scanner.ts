"use client";

import { useEffect, useRef } from "react";

const SCANNER_MAX_GAP_MS = 50;  // barcode scanners type chars faster than this
const SCANNER_MIN_LENGTH = 4;   // ignore accidental short sequences

/**
 * Plays a short synthesised beep sound to simulate a physical scanner feedback.
 * Uses Web Audio API so it requires no external audio assets.
 */
export function playScanBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    // 1400Hz frequency - a crisp high-pitched register typical of scanner pings
    oscillator.frequency.setValueAtTime(1400, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    // Smooth exponential ramp-down to avoid cracking sounds at the end
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.12);
  } catch (error) {
    console.warn("Failed to play scan beep:", error);
  }
}

interface UseBarcodeScannerOptions {
  enabled?: boolean;
}

export function useBarcodeScanner(
  onScan: (code: string) => void,
  options?: UseBarcodeScannerOptions
) {
  const enabled = options?.enabled ?? true;
  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!e.key) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
        
        // If focus is inside a typeable element, only capture scanning if it's explicitly barcode-enabled.
        // This allows typing normally in patient search, notes, quantities, etc.
        if (isInput && target.dataset.barcodeCapture !== "true") {
          return;
        }
      }

      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        if (code.length >= SCANNER_MIN_LENGTH) {
          e.preventDefault();
          playScanBeep();
          onScan(code);
        }
        bufferRef.current = "";
        return;
      }

      // If gap is too large, this is manual typing — reset the buffer
      if (gap > SCANNER_MAX_GAP_MS && bufferRef.current.length > 0) {
        bufferRef.current = "";
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onScan, enabled]);
}

