/**
 * Browser detection and transport selection utility
 */

/**
 * Detect if current browser is Safari
 * @returns {boolean} true if Safari, false otherwise
 */
export function isSafari() {
  const ua = navigator.userAgent.toLowerCase();
  const isSafari = ua.indexOf('safari') !== -1 && ua.indexOf('chrome') === -1;
  return isSafari;
}

/**
 * Detect if current browser is iOS Safari
 * @returns {boolean} true if iOS Safari, false otherwise
 */
export function isIOSSafari() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isSafari = ua.indexOf('safari') !== -1 && ua.indexOf('chrome') === -1;
  return isIOS && isSafari;
}

/**
 * Check if WebTransport is supported
 * @returns {boolean} true if supported, false otherwise
 */
export function isWebTransportSupported() {
  return 'WebTransport' in window;
}

/**
 * Check if WebRTC is supported
 * @returns {boolean} true if supported, false otherwise
 */
export function isWebRTCSupported() {
  return 'RTCPeerConnection' in window;
}

/**
 * Determine which transport to use based on browser capabilities
 * Priority: WebTransport (if supported and not Safari) > WebRTC
 * @returns {Object} { useWebRTC: boolean, reason: string }
 */
export function determineTransport() {
  const safariDetected = isSafari();
  const iosSafariDetected = isIOSSafari();
  const webTransportSupported = isWebTransportSupported();
  const webRTCSupported = isWebRTCSupported();

  // Safari always uses WebRTC (WebTransport not well supported)
  if (safariDetected || iosSafariDetected) {
    if (!webRTCSupported) {
      console.warn('Safari detected but WebRTC not supported');
      return {
        useWebRTC: false,
        reason: 'Safari detected but WebRTC not supported, falling back to WebTransport',
        browserInfo: {
          isSafari: true,
          isIOS: iosSafariDetected,
          webTransportSupported,
          webRTCSupported,
        }
      };
    }
    return {
      useWebRTC: true,
      reason: 'Safari browser detected, using WebRTC for better compatibility',
      browserInfo: {
        isSafari: true,
        isIOS: iosSafariDetected,
        webTransportSupported,
        webRTCSupported,
      }
    };
  }

  // Other browsers: prefer WebTransport if available
  if (webTransportSupported) {
    return {
      useWebRTC: false,
      reason: 'WebTransport supported, using for optimal performance',
      browserInfo: {
        isSafari: false,
        isIOS: false,
        webTransportSupported,
        webRTCSupported,
      }
    };
  }

  // Fallback to WebRTC if WebTransport not supported
  if (webRTCSupported) {
    return {
      useWebRTC: true,
      reason: 'WebTransport not supported, falling back to WebRTC',
      browserInfo: {
        isSafari: false,
        isIOS: false,
        webTransportSupported,
        webRTCSupported,
      }
    };
  }

  // Neither supported - this should rarely happen
  console.error('Neither WebTransport nor WebRTC is supported in this browser');
  return {
    useWebRTC: false,
    reason: 'No transport supported, attempting WebTransport as last resort',
    browserInfo: {
      isSafari: false,
      isIOS: false,
      webTransportSupported,
      webRTCSupported,
    }
  };
}

/**
 * Get detailed browser information
 * @returns {Object} Browser info object
 */
export function getBrowserInfo() {
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
 * Log browser and transport information
 */
export function logTransportInfo() {
  const info = getBrowserInfo();
  console.group('🌐 Browser & Transport Detection');
  console.log('User Agent:', info.userAgent);
  console.log('Is Safari:', info.isSafari);
  console.log('Is iOS Safari:', info.isIOSSafari);
  console.log('WebTransport Supported:', info.webTransportSupported);
  console.log('WebRTC Supported:', info.webRTCSupported);
  console.log('Recommended Transport:', info.recommendedTransport.useWebRTC ? 'WebRTC' : 'WebTransport');
  console.log('Reason:', info.recommendedTransport.reason);
  console.groupEnd();
  
  return info;
}
