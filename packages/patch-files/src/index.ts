export const PATCH_FILES_PATHS = {
  workers: {
    mediaWorker: '/workers/media-worker.js',
    mediaWorkerAB: '/workers/media-worker-ab.js',
    mediaWorkerDev: '/workers/media-worker-dev.js',
    mediaWorkerWs: '/workers/media-worker-ws.js',
    mediaWorkerDirect: '/workers/media-worker-direct.js',
    mediaWorkerWtp: '/workers/media-worker-wtp.js',
    audioWorklet: '/workers/audio-worklet.js',
    clientCommand: '/workers/ClientCommand.js',
    clientCommandDev: '/workers/ClientCommandDev.js',
  },
  constants: {
    publisherConstants: '/constants/publisherConstants.js',
    streamTypes: '/constants/streamTypes.js',
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
    decoderTypes: '/opus_decoder/opusDecoder.d.ts',
    decoderWorker: '/opus_decoder/decoderWorker.min.js',
    decoderWasm: '/opus_decoder/decoderWorker.min.wasm',
    encoderWorker: '/opus_decoder/encoderWorker.min.js',
    recorder: '/opus_decoder/recorder.min.js',
  },
  raptorQ: {
    // Main WASM files
    wasm: '/raptorQ/raptorq_wasm.js',
    wasmTypes: '/raptorQ/raptorq_wasm.d.ts',
    wasmBg: '/raptorQ/raptorq_wasm_bg.wasm',
    wasmBgTypes: '/raptorQ/raptorq_wasm_bg.wasm.d.ts',

    // AAC binding
    aac: '/raptorQ/wasm_binding_aac.js',
    aacTypes: '/raptorQ/wasm_binding_aac.d.ts',
    aacBg: '/raptorQ/wasm_binding_aac_bg.wasm',
    aacBgTypes: '/raptorQ/wasm_binding_aac_bg.wasm.d.ts',

    // Wirehair binding
    wirehair: '/raptorQ/wasm_binding_wirehair.js',
    wirehairTypes: '/raptorQ/wasm_binding_wirehair.d.ts',
    wirehairBg: '/raptorQ/wasm_binding_wirehair_bg.wasm',
    wirehairBgTypes: '/raptorQ/wasm_binding_wirehair_bg.wasm.d.ts',

    // Metadata
    readme: '/raptorQ/README.md',
    package: '/raptorQ/package.json',
  },
} as const;

export type PatchFilePaths = typeof PATCH_FILES_PATHS;

