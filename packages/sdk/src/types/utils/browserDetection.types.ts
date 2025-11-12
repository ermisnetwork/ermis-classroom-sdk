/**
 * Browser Detection Types
 * Type definitions for browser detection utilities
 */

/**
 * Browser information object
 */
export interface BrowserInfo {
  /** Full user agent string */
  userAgent: string;
  /** Whether browser is Safari */
  isSafari: boolean;
  /** Whether browser is iOS Safari */
  isIOSSafari: boolean;
  /** Whether WebTransport is supported */
  webTransportSupported: boolean;
  /** Whether WebRTC is supported */
  webRTCSupported: boolean;
  /** Recommended transport configuration */
  recommendedTransport: TransportRecommendation;
}

/**
 * Transport recommendation result
 */
export interface TransportRecommendation {
  /** Whether to use WebRTC (true) or WebTransport (false) */
  useWebRTC: boolean;
  /** Reason for the recommendation */
  reason: string;
  /** Detailed browser information */
  browserInfo: BrowserCapabilities;
}

/**
 * Browser capabilities
 */
export interface BrowserCapabilities {
  /** Is Safari browser */
  isSafari: boolean;
  /** Is iOS Safari */
  isIOS: boolean;
  /** WebTransport support */
  webTransportSupported: boolean;
  /** WebRTC support */
  webRTCSupported: boolean;
}
