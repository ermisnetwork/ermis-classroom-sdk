/**
 * Codec Polyfill Module
 * Provides backward-compatible codec support for browsers without WebCodecs API
 * 
 * Auto-selects between native WebCodecs and WASM fallback based on browser support.
 */

// Re-export from video codec polyfill
export {
  H264Encoder,
  H264Decoder,
  NativeH264Encoder,
  NativeH264Decoder,
  WasmH264Encoder,
  WasmH264Decoder,
  isNativeH264EncoderSupported,
  isNativeH264DecoderSupported,
  HAS_VIDEO_ENCODER,
  HAS_VIDEO_DECODER,
} from './video-codec-polyfill.js';

// Re-export from audio codec polyfill
export {
  AACEncoder,
  AACDecoder,
  NativeAACEncoder,
  NativeAACDecoder,
  WasmAACEncoder,
  WasmAACDecoder,
  isNativeAACEncoderSupported,
  isNativeAACDecoderSupported,
  HAS_AUDIO_ENCODER,
  HAS_AUDIO_DECODER,
} from './audio-codec-polyfill.js';

// Re-export from WebGL renderer
export {
  WebGLRenderer,
  hasMediaStreamTrackGenerator,
  hasWebGL2,
} from './webgl-renderer.js';

/**
 * Check if native WebCodecs is fully supported
 */
export async function isNativeCodecSupported() {
  const { isNativeH264DecoderSupported } = await import('./video-codec-polyfill.js');
  const { isNativeAACDecoderSupported } = await import('./audio-codec-polyfill.js');
  
  const [videoSupported, audioSupported] = await Promise.all([
    isNativeH264DecoderSupported(),
    isNativeAACDecoderSupported(),
  ]);
  console.log('[VideoCodec] Native H.264 decoder supported:', videoSupported);
  console.log('[AudioCodec] Native AAC decoder supported:', audioSupported);
  
  return {
    video: videoSupported,
    audio: audioSupported,
    full: videoSupported && audioSupported,
  };
}

/**
 * Get codec support information for logging/debugging
 */
export async function getCodecSupportInfo() {
  const { isNativeH264EncoderSupported, isNativeH264DecoderSupported } = await import('./video-codec-polyfill.js');
  const { isNativeAACEncoderSupported, isNativeAACDecoderSupported } = await import('./audio-codec-polyfill.js');
  
  const [h264Encode, h264Decode, aacEncode, aacDecode] = await Promise.all([
    isNativeH264EncoderSupported(),
    isNativeH264DecoderSupported(),
    isNativeAACEncoderSupported(),
    isNativeAACDecoderSupported(),
  ]);
  
  return {
    h264: {
      encode: h264Encode ? 'native' : 'wasm',
      decode: h264Decode ? 'native' : 'wasm',
    },
    aac: {
      encode: aacEncode ? 'native' : 'wasm',
      decode: aacDecode ? 'native' : 'wasm',
    },
  };
}
