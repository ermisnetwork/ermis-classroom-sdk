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
 * Priority: WebTransport (if supported and not Safari) > WebRTC
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

  // Safari always uses WebRTC (WebTransport not well supported)
  if (safariDetected || iosSafariDetected) {
    if (!webRTCSupported) {
      console.warn("Safari detected but WebRTC not supported");
      return {
        useWebRTC: false,
        reason:
          "Safari detected but WebRTC not supported, falling back to WebTransport",
        browserInfo,
      };
    }
    return {
      useWebRTC: true,
      reason: "Safari browser detected, using WebRTC for better compatibility",
      browserInfo,
    };
  }

  // Other browsers: prefer WebTransport if available
  if (webTransportSupported) {
    return {
      useWebRTC: false,
      reason: "WebTransport supported, using for optimal performance",
      browserInfo,
    };
  }

  // Fallback to WebRTC if WebTransport not supported
  if (webRTCSupported) {
    return {
      useWebRTC: true,
      reason: "WebTransport not supported, falling back to WebRTC",
      browserInfo,
    };
  }

  // Neither supported - this should rarely happen
  console.error(
    "Neither WebTransport nor WebRTC is supported in this browser",
  );
  return {
    useWebRTC: false,
    reason: "No transport supported, attempting WebTransport as last resort",
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
 * Browser detection utilities namespace
 */
export const BrowserDetection = {
  isSafari,
  isIOSSafari,
  isWebTransportSupported,
  isWebRTCSupported,
  determineTransport,
  getBrowserInfo,
  logTransportInfo,
};
