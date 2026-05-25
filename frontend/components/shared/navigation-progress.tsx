"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigation } from "@/lib/navigation-context";

export function NavigationProgress() {
  const { isPending } = useNavigation();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  useEffect(() => {
    if (isPending) {
      // Navigation started — show bar immediately and animate forward
      clearTimers();
      setVisible(true);
      setWidth(0);
      timers.current.push(setTimeout(() => setWidth(25), 10));
      timers.current.push(setTimeout(() => setWidth(55), 200));
      timers.current.push(setTimeout(() => setWidth(78), 600));
    } else {
      // Navigation committed — complete and hide
      if (!visible) return;
      clearTimers();
      setWidth(100);
      timers.current.push(
        setTimeout(() => {
          setVisible(false);
          setWidth(0);
        }, 300),
      );
    }

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  return (
    <>
      {/* Top progress bar */}
      {visible && (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none">
          <div
            className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)]"
            style={{
              width: `${width}%`,
              transition:
                width === 100
                  ? "width 200ms ease-out"
                  : width === 0
                    ? "none"
                    : "width 500ms ease-out",
            }}
          />
        </div>
      )}

      {/* Full-viewport dimming overlay — pointer-events-none keeps everything clickable */}
      <div
        className="fixed inset-0 z-[9990] pointer-events-none bg-white/25 backdrop-blur-[1px]"
        style={{
          opacity: isPending ? 1 : 0,
          transition: isPending
            ? "opacity 120ms ease-in"
            : "opacity 250ms ease-out",
        }}
      />
    </>
  );
}
