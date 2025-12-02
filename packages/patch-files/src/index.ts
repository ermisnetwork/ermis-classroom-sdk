export const PATCH_FILES_PATHS = {
  workers: {
    mediaWorker: '/workers/media-worker.js',
    mediaWorkerAB: '/workers/media-worker-ab.js',
    audioWorklet: '/workers/audio-worklet1.js',
  },
  polyfills: {
    audioData: '/polyfills/audioData.js',
    encodedAudioChunk: '/polyfills/encodedAudioChunk.js',
    intervalWorker: '/polyfills/intervalWorker.js',
    triggerWorker: '/polyfills/triggerWorker.js',
    mstgPolyfill: '/polyfills/MSTG_polyfill.js',
    mstpPolyfill: '/polyfills/MSTP_polyfill.js',
  },
  opus: {
    decoder: '/opus_decoder/opusDecoder.js',
    decoderWorker: '/opus_decoder/decoderWorker.min.js',
    decoderWasm: '/opus_decoder/decoderWorker.min.wasm',
    encoderWorker: '/opus_decoder/encoderWorker.min.js',
    recorder: '/opus_decoder/recorder.min.js',
  },
  raptorQ: {
    wasm: '/raptorQ/raptorq_wasm.js',
    wasmBg: '/raptorQ/raptorq_wasm_bg.wasm',
    aac: '/raptorQ/wasm_binding_aac.js',
    aacBg: '/raptorQ/wasm_binding_aac_bg.wasm',
    wirehair: '/raptorQ/wasm_binding_wirehair.js',
    wirehairBg: '/raptorQ/wasm_binding_wirehair_bg.wasm',
  },
} as const;

export type PatchFilePaths = typeof PATCH_FILES_PATHS;

export { copyPatchFiles, type CopyPatchFilesOptions } from './plugin';

