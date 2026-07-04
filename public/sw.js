/*
 * Update-safe caching:
 * - HTML/navigations are NEVER cached — every page load hits the network,
 *   so new deploys are picked up immediately.
 * - Only immutable build assets (/_next/static/, content-hashed filenames)
 *   and static images are cached, cache-first.
 * - Old caches are purged on activate; the SW takes over right away.
 */
const CACHE = "tracker-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

const STATIC_ASSET = /^\/(_next\/static\/|icon-\d+\.png$|favicon\.ico$)/;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Navigations, API/data requests: always network (no SW caching at all).
  if (!STATIC_ASSET.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
