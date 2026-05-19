"use client";

import { useEffect, useRef } from "react";

const SCANNER_MAX_GAP_MS = 50;  // barcode scanners type chars faster than this
const SCANNER_MIN_LENGTH = 4;   // ignore accidental short sequences

export function useBarcodeScanner(onScan: (code: string) => void) {
  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if focus is inside a normal input that isn't the POS search
      const tag = (e.target as HTMLElement).tagName;
      const isTypeable = tag === "TEXTAREA" || (tag === "INPUT" && (e.target as HTMLInputElement).dataset.barcodeIgnore === "true");
      if (isTypeable) return;

      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        if (code.length >= SCANNER_MIN_LENGTH) {
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
  }, [onScan]);
}
