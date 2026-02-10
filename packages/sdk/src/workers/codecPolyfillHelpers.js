/**
 * Codec Polyfill Helpers for Media Workers
 * Provides shared utilities for using codec polyfills in web workers
 */

import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";

/**
 * Convert YUV420 planar data to RGBA for transfer to main thread
 * @param {Uint8Array} yPlane - Y plane data
 * @param {Uint8Array} uPlane - U plane data
 * @param {Uint8Array} vPlane - V plane data
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @returns {Uint8ClampedArray} - RGBA data
 */
export function convertYUV420toRGBA(yPlane, uPlane, vPlane, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const uvWidth = width >> 1;
  
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const yIndex = j * width + i;
      const uvIndex = (j >> 1) * uvWidth + (i >> 1);
      
      const y = yPlane[yIndex];
      const u = uPlane[uvIndex] - 128;
      const v = vPlane[uvIndex] - 128;
      
      // BT.601 conversion
      let r = y + 1.402 * v;
      let g = y - 0.344136 * u - 0.714136 * v;
      let b = y + 1.772 * u;
      
      // Clamp to 0-255
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      
      const rgbaIndex = yIndex * 4;
      rgba[rgbaIndex] = r;
      rgba[rgbaIndex + 1] = g;
      rgba[rgbaIndex + 2] = b;
      rgba[rgbaIndex + 3] = 255;
    }
  }
  
  return rgba;
}

/**
 * Create a polyfill decoder (auto-selects native or WASM)
 * @param {Function} createVideoInit - Function that creates the init callbacks for the decoder
 * @param {string} channelName - Channel name for the decoder
 * @returns {Promise<H264Decoder>} - Configured polyfill decoder
 */
export async function createPolyfillDecoder(createVideoInit, channelName) {
  const decoder = new H264Decoder();
  const init = createVideoInit(channelName);
  decoder.onOutput = init.output;
  decoder.onError = init.error;
  return decoder;
}

/**
 * Create a video decoder with automatic fallback to WASM polyfill
 * @param {Function} createVideoInit - Function that creates the init callbacks for the decoder
 * @param {string} channelName - Channel name for the decoder
 * @returns {Promise<VideoDecoder|H264Decoder>} - Native VideoDecoder or polyfill H264Decoder
 */
export async function createVideoDecoderWithFallback(createVideoInit, channelName) {
  try {
    const nativeSupported = await isNativeH264DecoderSupported();
    if (nativeSupported && typeof VideoDecoder !== 'undefined') {
      return new VideoDecoder(createVideoInit(channelName));
    }
  } catch (e) {
    console.warn("[Codec] Native VideoDecoder not available, using polyfill");
  }
  // Fall back to polyfill
  return createPolyfillDecoder(createVideoInit, channelName);
}

/**
 * Handle video frame output - supports both VideoFrame (native) and YUV420 (WASM) formats
 * @param {VideoFrame|Object} frame - The decoded frame
 * @param {string} quality - Quality level identifier
 * @param {Function} postMessage - Function to post message (typically self.postMessage)
 */
export function handleVideoFrameOutput(frame, quality, postMessage) {
  if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
    // Native path - transfer VideoFrame directly
    postMessage({ type: "videoData", frame, quality }, [frame]);
  } else if (frame && frame.format === 'yuv420') {
    // WASM path - convert YUV420 to RGBA for transfer
    const rgba = convertYUV420toRGBA(
      frame.yPlane, 
      frame.uPlane, 
      frame.vPlane, 
      frame.width, 
      frame.height
    );
    postMessage({ 
      type: "videoData", 
      frame: { 
        format: 'rgba', 
        data: rgba, 
        width: frame.width, 
        height: frame.height 
      },
      quality 
    }, [rgba.buffer]);
  }
}

/**
 * Create a video init configuration that handles both native and polyfill outputs
 * @param {string} channelName - Channel name for error messages
 * @param {Function} postMessage - Function to post messages (typically self.postMessage)
 * @param {Object} console - Console object for logging (can be a proxy)
 * @returns {Object} - Init configuration with output and error callbacks
 */
export function createUnifiedVideoInit(channelName, postMessage, console = globalThis.console) {
  return {
    output: (frame) => {
      handleVideoFrameOutput(frame, channelName, postMessage);
    },
    error: (e) => {
      console.error(`Video decoder error (${channelName}):`, e);
      postMessage({
        type: "error",
        message: `${channelName} decoder: ${e.message}`,
      });
    },
  };
}

// Re-export for convenience
export { H264Decoder, isNativeH264DecoderSupported };
