/**
 * PolyfillManager - Manages polyfill loading for subscriber
 *
 * Responsibilities:
 * - Loads MediaStreamTrackGenerator polyfill if needed
 * - Prevents duplicate script loading
 * - Handles polyfill errors
 */

import EventEmitter from "../../../events/EventEmitter";

/**
 * Polyfill manager events
 */
interface PolyfillManagerEvents extends Record<string, unknown> {
  loaded: undefined;
  alreadySupported: undefined;
  error: { error: Error };
}

/**
 * PolyfillManager class
 */
export class PolyfillManager extends EventEmitter<PolyfillManagerEvents> {
  private polyfillUrl: string;
  private isLoaded = false;

  constructor(polyfillUrl: string) {
    super();
    this.polyfillUrl = polyfillUrl;
  }

  /**
   * Load MediaStreamTrackGenerator polyfill if needed
   */
  async load(): Promise<void> {
    // Skip if browser already supports it
    if (typeof MediaStreamTrackGenerator === "function") {
      console.log("✅ Browser already supports MediaStreamTrackGenerator");
      this.emit("alreadySupported", undefined);
      return;
    }

    // Determine the polyfill URL (absolute)
    const url = this.polyfillUrl || `${location.origin}/polyfills/MSTG_polyfill.js`;
    console.log("⚙️ Loading MSTG polyfill from:", url);

    // Prevent loading twice
    if (document.querySelector(`script[src="${url}"]`)) {
      console.log("ℹ️ MSTG polyfill already loaded");
      this.isLoaded = true;
      return;
    }

    try {
      await this.loadScript(url);
      this.isLoaded = true;
      this.emit("loaded", undefined);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Polyfill load failed");
      console.error("❌ Failed to load MSTG polyfill:", err);
      this.emit("error", { error: err });
      throw err;
    }
  }

  /**
   * Dynamically load script
   */
  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;

      script.onload = () => {
        console.log("✅ MSTG polyfill loaded successfully");
        resolve();
      };

      script.onerror = (err) => {
        console.error("❌ Failed to load MSTG polyfill:", err);
        reject(err);
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Check if polyfill is loaded
   */
  isPolyfillLoaded(): boolean {
    return this.isLoaded;
  }
}
