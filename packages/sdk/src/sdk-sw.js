/**
 * SDK Asset Service Worker
 *
 * Intercepts fetch requests for SDK assets (workers, polyfills, WASM, opus_decoder, raptorQ)
 * and serves them from Cache Storage if available.
 *
 * Flow:
 * 1. App calls initSdkAssets() which fetches manifest + all files into cache
 * 2. This SW intercepts matching requests and serves from cache
 * 3. SDK uses plain local paths (/workers/..., /polyfills/...) — SW handles the rest
 */

const SDK_CACHE_PREFIX = 'sdk-assets-v';
const SDK_PATHS = ['/workers/', '/polyfills/', '/opus_decoder/', '/raptorQ/'];

// Activate immediately without waiting for existing clients to close
self.addEventListener('install', (event) => {
  console.log('[sdk-sw] Installing...');
  self.skipWaiting();
});

// Claim all clients immediately so the SW takes effect on first load
self.addEventListener('activate', (event) => {
  console.log('[sdk-sw] Activating...');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept SDK asset paths on same origin
  if (url.origin !== self.location.origin) return;

  const isSdkAsset = SDK_PATHS.some((p) => url.pathname.startsWith(p));
  if (!isSdkAsset) return;

  event.respondWith(
    (async () => {
      try {
        console.log('[sdk-sw] Intercepting:', url.pathname, 'mode:', event.request.mode);

        // Strip query params (e.g. ?t=timestamp) when looking up cache
        // Assets are cached without query strings
        const cacheUrl = new URL(event.request.url);
        cacheUrl.search = '';
        const cacheRequest = new Request(cacheUrl.href);

        // Search all sdk-assets caches
        const cacheNames = await caches.keys();
        console.log('[sdk-sw] Available caches:', cacheNames);
        for (const name of cacheNames) {
          if (!name.startsWith(SDK_CACHE_PREFIX)) continue;
          const cache = await caches.open(name);
          const cached = await cache.match(cacheRequest);
          if (cached) {
            // Ensure WASM files have correct Content-Type
            if (url.pathname.endsWith('.wasm')) {
              const body = await cached.arrayBuffer();
              return new Response(body, {
                status: cached.status,
                statusText: cached.statusText,
                headers: { 'Content-Type': 'application/wasm' },
              });
            }
            return cached;
          }
        }

        // Not in cache — try basic (same-origin) fetch as fallback
        // Works when files exist locally in public/ (dev mode)
        try {
          console.log('[sdk-sw] Cache MISS for', url.pathname, '- trying basic fetch');
          const basicResponse = await fetch(event.request);
          return basicResponse;
        } catch (basicErr) {
          console.warn('[sdk-sw] Basic fetch also failed for', url.pathname, basicErr);
        }

        // No CORS fallback — assets should be pre-cached by initSdkAssets()
        console.warn('[sdk-sw] Asset not available:', url.pathname);
        return new Response('SDK asset not cached', { status: 404 });
      } catch (e) {
        console.error('[sdk-sw] Error serving', url.pathname, e);
        return new Response('Service Worker error', { status: 500 });
      }
    })()
  );
});

// Listen for messages from the main page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
