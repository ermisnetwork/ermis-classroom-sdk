/**
 * Browser Detection Utilities
 * Utilities for detecting browser capabilities and selecting optimal transport
 */

import type {BrowserCapabilities, BrowserInfo, TransportRecommendation,} from "../types";
import {log} from "./logger";

/**
 * Detect if current browser is Safari
 * @returns true if Safari, false otherwise
 */
export function isSafari(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1;
}

/**
 * Detect if current browser is iOS Safari
 * @returns true if iOS Safari, false otherwise
 */
export function isIOSSafari(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isSafari = ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1;
  return isIOS && isSafari;
}

/**
 * Check if WebTransport is supported
 * @returns true if supported, false otherwise
 */
export function isWebTransportSupported(): boolean {
  return "WebTransport" in window;
}

/**
 * Check if WebRTC is supported
 * @returns true if supported, false otherwise
 */
export function isWebRTCSupported(): boolean {
  return "RTCPeerConnection" in window;
}

/**
 * Determine which transport to use based on browser capabilities
 * Pure capability detection: WebTransport if available > WebRTC fallback
 * @returns Transport recommendation with details
 */
export function determineTransport(): TransportRecommendation {
  const safariDetected = isSafari();
  const iosSafariDetected = isIOSSafari();
  const webTransportSupported = isWebTransportSupported();
  const webRTCSupported = isWebRTCSupported();

  const browserInfo: BrowserCapabilities = {
    isSafari: safariDetected,
    isIOS: iosSafariDetected,
    webTransportSupported,
    webRTCSupported,
  };

  // Prefer WebTransport if natively supported (any browser)
  if (webTransportSupported) {
    log(`[BrowserDetection] Native WebTransport available — using WebTransport`);
    return {
      useWebRTC: false,
      reason: "Native WebTransport supported, using for optimal performance",
      browserInfo,
    };
  }

  // Fallback to WebRTC
  if (webRTCSupported) {
    return {
      useWebRTC: true,
      reason: "WebTransport not available, falling back to WebRTC",
      browserInfo,
    };
  }

  // Neither supported
  console.error(
    "Neither WebTransport nor WebRTC is supported in this browser",
  );
  return {
    useWebRTC: true,
    reason: "No transport supported, attempting WebRTC as last resort",
    browserInfo,
  };
}

/**
 * Get detailed browser information
 * @returns Complete browser information object
 */
export function getBrowserInfo(): BrowserInfo {
  const ua = navigator.userAgent;
  return {
    userAgent: ua,
    isSafari: isSafari(),
    isIOSSafari: isIOSSafari(),
    webTransportSupported: isWebTransportSupported(),
    webRTCSupported: isWebRTCSupported(),
    recommendedTransport: determineTransport(),
  };
}

/**
 * Log browser and transport information to console
 * @returns Browser information object
 */
export function logTransportInfo(): BrowserInfo {
  const info = getBrowserInfo();
  log("User Agent:", info.userAgent);
  log("Is Safari:", info.isSafari);
  log("Is iOS Safari:", info.isIOSSafari);
  log("WebTransport Supported:", info.webTransportSupported);
  log("WebRTC Supported:", info.webRTCSupported);
  log(
    "Recommended Transport:",
    info.recommendedTransport.useWebRTC ? "WebRTC" : "WebTransport",
  );
  log("Reason:", info.recommendedTransport.reason);

  return info;
}

/**
 * Check if VideoTrackGenerator (standard W3C API) is supported
 * Safari 18+, Chrome 94+ — produces MediaStreamTrack from VideoFrame stream
 * @returns true if supported, false otherwise
 */
export function hasVideoTrackGenerator(): boolean {
  return typeof (globalThis as any).VideoTrackGenerator === 'function';
}

/**
 * Browser detection utilities namespace
 */
export const BrowserDetection = {
  isSafari,
  isIOSSafari,
  isWebTransportSupported,
  isWebRTCSupported,
  hasVideoTrackGenerator,
  determineTransport,
  getBrowserInfo,
  logTransportInfo,
};
