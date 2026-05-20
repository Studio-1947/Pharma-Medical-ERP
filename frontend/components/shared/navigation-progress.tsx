"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;

    // Start the bar
    setWidth(0);
    setVisible(true);

    // Animate to 85% quickly then stall
    const t1 = setTimeout(() => setWidth(30), 20);
    const t2 = setTimeout(() => setWidth(65), 150);
    const t3 = setTimeout(() => setWidth(85), 400);

    // Complete and hide after page settles
    const t4 = setTimeout(() => setWidth(100), 600);
    const t5 = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 900);

    timerRef.current = t5;
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] bg-transparent pointer-events-none">
      <div
        className="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] transition-all"
        style={{
          width: `${width}%`,
          transitionDuration: width === 100 ? "200ms" : width === 0 ? "0ms" : "400ms",
          transitionTimingFunction: "ease-out",
        }}
      />
    </div>
  );
}
