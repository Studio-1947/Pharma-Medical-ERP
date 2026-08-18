"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PwaUpdatePrompt } from "@/components/shared/pwa-update-prompt";

/** How often an open tab asks the server whether a new build exists. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

/**
 * How long the tab must stay hidden before a pending update is applied without
 * asking. Reloading a backgrounded tab is invisible to the user, which is what
 * makes a counter terminal that stays open for days pick up deploys on its own.
 */
const IDLE_AUTO_APPLY_MS = 60_000;

/**
 * Any screen holding work that a reload would destroy renders an element with
 * this attribute. Auto-apply is suppressed while one is on the page; the user
 * still gets the explicit prompt.
 */
const UNSAVED_WORK_SELECTOR = "[data-pharmerp-unsaved]";

/** Timestamp of this tab's last self-heal reload; guards against a reload loop. */
const RECOVERY_FLAG = "pharmerp:sw-recovered-at";

/** A tab may self-heal at most once per this window. */
const RECOVERY_COOLDOWN_MS = 60_000;

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Hand control to the waiting worker; `controllerchange` drives the reload. */
  const applyUpdate = useCallback(() => {
    const waiting = waitingRef.current;
    if (!waiting) {
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, []);

  const dismissUpdate = useCallback(() => setUpdateReady(false), []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const container = navigator.serviceWorker;

    // Whether this page was already under a worker. On a first-ever install the
    // worker claims the page and fires controllerchange, but there is no new
    // build to load, so that case must not trigger a reload.
    const hadController = Boolean(container.controller);

    let disposed = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const markUpdateReady = (worker: ServiceWorker) => {
      if (disposed) return;
      waitingRef.current = worker;
      setUpdateReady(true);
    };

    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        // `installed` + an existing controller means a previous build is still
        // serving this page and the new one is parked in `waiting`.
        if (worker.state === "installed" && container.controller) {
          markUpdateReady(worker);
        }
      });
    };

    const register = async () => {
      try {
        const registration = await container.register("/sw.js", {
          // Never let the HTTP cache satisfy the worker script or its imports.
          // Without this a stale sw.js can be served for up to 24h and the
          // update is simply never noticed.
          updateViaCache: "none",
        });

        if (disposed) return;
        registrationRef.current = registration;

        if (registration.waiting && container.controller) {
          markUpdateReady(registration.waiting);
        }
        watchInstalling(registration.installing);

        registration.addEventListener("updatefound", () => {
          watchInstalling(registration.installing);
        });

        intervalId = setInterval(() => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => {});
          }
        }, UPDATE_CHECK_INTERVAL_MS);
      } catch (err) {
        console.warn("[pwa] service worker registration failed:", err);
      }
    };

    const onControllerChange = () => {
      if (!hadController || reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      registrationRef.current?.update().catch(() => {});
    };

    /**
     * Auto-apply a pending update while the tab is in the background, so the
     * user is not asked to confirm something they cannot see.
     */
    const onVisibilityChange = () => {
      if (hiddenTimerRef.current) {
        clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = null;
      }

      if (document.visibilityState === "visible") {
        checkForUpdate();
        return;
      }

      hiddenTimerRef.current = setTimeout(() => {
        if (!waitingRef.current) return;
        if (document.visibilityState === "visible") return;
        if (document.querySelector(UNSAVED_WORK_SELECTOR)) return;
        applyUpdate();
      }, IDLE_AUTO_APPLY_MS);
    };

    /**
     * Self-heal. A client running an old build that requests a chunk the server
     * no longer has gets a hard failure with no route back. Drop every cache,
     * pull the newest worker and reload -- once per tab, so a genuinely broken
     * build cannot spin.
     */
    const recoverFromChunkError = (message: string) => {
      if (!CHUNK_ERROR_PATTERN.test(message)) return;

      // Rate-limited rather than once-only: a stale lazy route should still be
      // recoverable later in a long-lived tab, but a genuinely broken build
      // must not be able to spin the page.
      const last = Number(sessionStorage.getItem(RECOVERY_FLAG) ?? 0);
      if (Number.isFinite(last) && Date.now() - last < RECOVERY_COOLDOWN_MS) {
        return;
      }
      sessionStorage.setItem(RECOVERY_FLAG, String(Date.now()));

      console.warn("[pwa] stale build detected, clearing caches and reloading");

      container.controller?.postMessage({ type: "CLEAR_CACHES" });

      const clearAll =
        "caches" in window
          ? caches
              .keys()
              .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
              .catch(() => undefined)
          : Promise.resolve(undefined);

      clearAll.then(() => {
        reloadingRef.current = true;
        // Bypasses bfcache and any in-memory document cache.
        window.location.reload();
      });
    };

    const onError = (event: ErrorEvent) => {
      recoverFromChunkError(String(event?.message ?? ""));
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      recoverFromChunkError(String(reason?.message ?? reason ?? ""));
    };

    container.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", checkForUpdate);
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      disposed = true;
      if (intervalId) clearInterval(intervalId);
      if (hiddenTimerRef.current) clearTimeout(hiddenTimerRef.current);
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", checkForUpdate);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [applyUpdate]);

  return (
    <PwaUpdatePrompt
      open={updateReady}
      onApply={applyUpdate}
      onDismiss={dismissUpdate}
    />
  );
}
