/*
 * PharmERP Service Worker  (GENERATED -- do not edit public/sw.js by hand)
 *
 * Source of truth: frontend/scripts/sw.template.js
 * Regenerate with:  node scripts/generate-sw.mjs   (runs automatically on `pnpm build`)
 *
 * Caching contract
 * ----------------
 * HTML navigations : network-first -> versioned cache -> /offline
 * /_next/static/*  : cache-first (content-hashed, immutable)
 * RSC / _next/data : network-only  (build-id + auth coupled, never cached)
 * /api/*           : network-only, 503 JSON when offline
 * other assets     : stale-while-revalidate
 *
 * Every cache name is stamped with SW_VERSION, which changes on every build.
 * `activate` deletes every cache that is not part of the current version, so a
 * deploy can never leave stale HTML pointing at deleted JS chunks behind.
 */

const SW_VERSION = "bmsyebydh";

const NAV_CACHE = `pharmerp-nav-${SW_VERSION}`;
const ASSET_CACHE = `pharmerp-assets-${SW_VERSION}`;
const SHELL_CACHE = `pharmerp-shell-${SW_VERSION}`;

const CURRENT_CACHES = [NAV_CACHE, ASSET_CACHE, SHELL_CACHE];

const OFFLINE_URL = "/offline";

// Only build-independent, auth-independent files are precached. Never precache
// an application route -- its HTML is coupled to a build id that dies on deploy.
const PRECACHE_URLS = [OFFLINE_URL, "/logo.svg", "/manifest.json"];

// -- install -----------------------------------------------------------------
// No skipWaiting() here. The new worker parks in `waiting` until the page tells
// it to take over, so a running tab is never swapped onto a different build
// mid-session (that is what produces ChunkLoadError).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            /* a missing precache entry must not fail the install */
          }),
        ),
      ),
    ),
  );
});

// -- activate ----------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }

      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith("pharmerp-") && !CURRENT_CACHES.includes(key),
          )
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();

      // Tell every open tab which build is now in control, so the UI can settle
      // its "update available" state without another round trip.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "SW_ACTIVATED", version: SW_VERSION });
      }
    })(),
  );
});

// -- messages from the page --------------------------------------------------
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "GET_VERSION") {
    if (event.source) {
      event.source.postMessage({ type: "SW_VERSION", version: SW_VERSION });
    }
    return;
  }

  // Escape hatch used by the client-side chunk-error self-heal.
  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
});

// -- helpers -----------------------------------------------------------------

/** Only same-origin, non-redirected, non-opaque 200s are safe to store. */
function isCacheable(response) {
  return (
    !!response &&
    response.status === 200 &&
    response.type === "basic" &&
    !response.redirected
  );
}

function offlineJson() {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "OFFLINE", message: "No network connection." },
    }),
    {
      // 503, not 200. A 200 here makes React Query treat the stub as real data.
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Network-first for HTML navigations.
 *
 * The network response is what boots the app, so a deploy is picked up the
 * moment the user navigates. The versioned cache is a pure offline fallback --
 * and because its name carries SW_VERSION, `activate` wipes it on every deploy,
 * so it can never serve HTML that points at chunks the server has deleted.
 */
async function handleNavigation(event) {
  const cache = await caches.open(NAV_CACHE);

  try {
    const preload = await event.preloadResponse;
    const response = preload || (await fetch(event.request));

    // isCacheable's !redirected check is what stops a /login redirect from
    // being stored under an app route.
    if (isCacheable(response)) {
      cache.put(event.request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached =
      (await cache.match(event.request)) ||
      (await cache.match(event.request, { ignoreSearch: true }));
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/** Cache-first. Only for immutable, content-hashed build output. */
async function handleImmutableAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/** Stale-while-revalidate for everything else static. */
async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  return (
    response || new Response("Offline", { status: 503, statusText: "Offline" })
  );
}

// -- fetch -------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  // Cross-origin (the API lives on its own origin) and non-http schemes are
  // left entirely to the browser.
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Never intercept the worker script itself.
  if (url.pathname === "/sw.js") return;

  // API traffic is never cached. Offline gets an explicit 503.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => offlineJson()));
    return;
  }

  // App Router client navigations are RSC payloads, not documents. They are
  // coupled to both the build id and the session, so they are network-only.
  const isRsc =
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1" ||
    url.searchParams.has("_rsc");
  if (isRsc || url.pathname.startsWith("/_next/data/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Content-hashed build output. Safe to serve from cache forever, because a
  // new build produces new filenames and `activate` drops the old cache.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutableAsset(request));
    return;
  }

  if (url.pathname.startsWith("/_next/image")) {
    event.respondWith(fetch(request).catch(() => handleAsset(request)));
    return;
  }

  event.respondWith(handleAsset(request));
});
