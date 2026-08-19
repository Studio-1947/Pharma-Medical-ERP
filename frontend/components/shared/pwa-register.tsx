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

/**
 * How long to wait after handing control to the waiting worker before reloading
 * anyway. `controllerchange` is the happy path; this only exists so the Update
 * button can never sit spinning if that event never reaches us.
 */
const APPLY_FALLBACK_MS = 4_000;

/**
 * Where a tab lands once it has picked up a new build. Reloading in place drops
 * the user back onto a half-finished screen rebuilt by different code, so the
 * new build starts from the entry screen instead. Middleware sends a session
 * holder straight on to /dashboard, so this only shows the login form to
 * someone who was signed out anyway.
 */
const POST_UPDATE_PATH = "/login";

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether this page has ever been under a worker. Live, not a snapshot: the
   * first worker claims an uncontrolled page some time after mount, and a tab
   * that missed that transition would otherwise never recognise a later
   * `controllerchange` as an update and would never reload.
   */
  const hadControllerRef = useRef(false);

  /** Set once the user (or idle auto-apply) has asked for the new build. */
  const applyRequestedRef = useRef(false);

  /** Single exit path, so no two signals can race into a double navigation. */
  const leavePage = useCallback((to?: string) => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    if (applyTimerRef.current) {
      clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    if (to) window.location.assign(to);
    else window.location.reload();
  }, []);

  /** Hand the user to the new build on a clean screen. */
  const landOnNewBuild = useCallback(
    () => leavePage(POST_UPDATE_PATH),
    [leavePage],
  );

  /** Hand control to the waiting worker; `controllerchange` drives the reload. */
  const applyUpdate = useCallback(() => {
    applyRequestedRef.current = true;

    const waiting = waitingRef.current;

    // Nothing parked, or the worker moved on while the prompt sat on screen
    // (another tab applied it, or idle auto-apply won the race). There is
    // nobody left to hand control to, so just load the new build.
    if (!waiting || waiting.state === "redundant" || waiting.state === "activated") {
      landOnNewBuild();
      return;
    }

    // The worker reaching `activated` is a second, independent signal that the
    // handover went through -- `controllerchange` is not guaranteed to be the
    // first one to arrive.
    waiting.addEventListener("statechange", () => {
      if (waiting.state === "activated") landOnNewBuild();
    });

    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(landOnNewBuild, APPLY_FALLBACK_MS);

    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [landOnNewBuild]);

  const dismissUpdate = useCallback(() => setUpdateReady(false), []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const container = navigator.serviceWorker;

    // On a first-ever install the worker claims the page and fires
    // controllerchange, but there is no new build to load, so that one case
    // must not trigger a reload.
    hadControllerRef.current = Boolean(container.controller);

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
      // First worker claiming a page that was loaded uncontrolled: same build,
      // nothing to reload for. Remember it so the next handover does reload.
      if (!hadControllerRef.current && !applyRequestedRef.current) {
        hadControllerRef.current = true;
        return;
      }
      landOnNewBuild();
    };

    /** The activating worker announces itself; treat it as a handover signal. */
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "SW_ACTIVATED") return;
      if (!applyRequestedRef.current) return;
      landOnNewBuild();
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

      // Bypasses bfcache and any in-memory document cache.
      clearAll.then(() => leavePage());
    };

    const onError = (event: ErrorEvent) => {
      recoverFromChunkError(String(event?.message ?? ""));
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      recoverFromChunkError(String(reason?.message ?? reason ?? ""));
    };

    container.addEventListener("controllerchange", onControllerChange);
    container.addEventListener("message", onMessage);
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
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
      container.removeEventListener("controllerchange", onControllerChange);
      container.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", checkForUpdate);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [applyUpdate, landOnNewBuild, leavePage]);

  return (
    <PwaUpdatePrompt
      open={updateReady}
      onApply={applyUpdate}
      onDismiss={dismissUpdate}
    />
  );
}
