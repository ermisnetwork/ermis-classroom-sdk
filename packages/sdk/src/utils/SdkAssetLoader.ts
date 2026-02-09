/**
 * SDK Asset Loader
 *
 * Pre-fetches all SDK assets from the meeting server and caches them locally
 * via Service Worker + Cache Storage.
 *
 * When sdkAssetsUrl is configured, this module:
 * 1. Registers the sdk-sw.js Service Worker
 * 2. Fetches the asset manifest from the server
 * 3. Downloads all assets into Cache Storage with local path keys
 * 4. The Service Worker intercepts matching requests and serves from cache
 *
 * When sdkAssetsUrl is NOT configured, this module does nothing —
 * assets are loaded from local paths (Vite plugin copies them to public/).
 */

const SDK_CACHE_PREFIX = 'sdk-assets-v';

interface SdkManifest {
  version: string;
  baseUrl: string;
  files: string[];
}

let _initialized = false;

/**
 * Initialize SDK assets: register Service Worker and pre-fetch all assets.
 *
 * @param sdkAssetsUrl - The base URL for SDK assets on the server
 *   e.g. "https://meeting-server:9938/meeting/sdk-assets"
 * @returns Promise that resolves when all assets are cached
 */
export async function initSdkAssets(sdkAssetsUrl?: string): Promise<void> {
  if (!sdkAssetsUrl) {
    // No server URL — assets loaded from local paths (Vite plugin)
    return;
  }

  if (_initialized) {
    return;
  }

  try {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.register('/sdk-sw.js');
      console.log('[SdkAssetLoader] Service Worker registered:', reg.scope);

      // Wait for SW to be ready
      await navigator.serviceWorker.ready;
      console.log('[SdkAssetLoader] Service Worker ready');
    } else {
      console.warn('[SdkAssetLoader] Service Workers not supported — assets will be fetched directly from server');
      return;
    }

    // 2. Fetch manifest
    const baseUrl = sdkAssetsUrl.replace(/\/+$/, '');
    const manifestUrl = `${baseUrl}/manifest`;
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);
    }
    const manifest: SdkManifest = await res.json();
    console.log(`[SdkAssetLoader] Manifest loaded: v${manifest.version}, ${manifest.files.length} files`);

    // 3. Check if we already have this version cached
    const cacheName = `${SDK_CACHE_PREFIX}${manifest.version}`;
    const existingCache = await caches.open(cacheName);
    const existingKeys = await existingCache.keys();
    if (existingKeys.length === manifest.files.length) {
      console.log(`[SdkAssetLoader] Assets v${manifest.version} already cached (${existingKeys.length} files)`);
      _initialized = true;
      return;
    }

    // 4. Clean up old version caches AND the current incomplete cache
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.startsWith(SDK_CACHE_PREFIX)) {
        console.log(`[SdkAssetLoader] Deleting cache: ${name}`);
        await caches.delete(name);
      }
    }

    // 5. Fetch all assets and cache them with LOCAL paths as keys
    const cache = await caches.open(cacheName);
    const serverBaseUrl = `${baseUrl}/v${manifest.version}`;

    const fetchPromises = manifest.files.map(async (file: string) => {
      try {
        const response = await fetch(`${serverBaseUrl}/${file}`);
        if (!response.ok) {
          console.warn(`[SdkAssetLoader] Failed to fetch ${file}: ${response.status}`);
          return;
        }
        // IMPORTANT: Create a new Response to strip CORS type.
        // Cross-origin fetch responses have type "cors", which Service Worker
        // cannot serve for same-origin requests (browser blocks with
        // "Response served by service worker is CORS while mode is same origin").
        // Re-creating the Response makes it type "default" (basic), which works.
        const body = await response.arrayBuffer();
        const headers: Record<string, string> = {};
        // Ensure correct Content-Type — WASM files must be application/wasm
        // for WebAssembly.instantiateStreaming to work
        if (file.endsWith('.wasm')) {
          headers['Content-Type'] = 'application/wasm';
        } else {
          const contentType = response.headers.get('Content-Type');
          if (contentType) headers['Content-Type'] = contentType;
        }
        const basicResponse = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        // Cache with LOCAL path as key (e.g. "/workers/media-worker-dev.js")
        await cache.put(new Request(`${self.location.origin}/${file}`), basicResponse);
      } catch (err) {
        console.warn(`[SdkAssetLoader] Error fetching ${file}:`, err);
      }
    });

    await Promise.all(fetchPromises);

    const finalKeys = await cache.keys();
    console.log(`[SdkAssetLoader] Cached ${finalKeys.length}/${manifest.files.length} SDK assets v${manifest.version}`);
    _initialized = true;
  } catch (err) {
    console.error('[SdkAssetLoader] Pre-fetch failed:', err);
    // Non-fatal — SDK will fall back to loading from local paths
  }
}
