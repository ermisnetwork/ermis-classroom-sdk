# AAC Encoder/Decoder Implementation

**Date:** 2026-02-28  
**Author:** AI  
**Branch:** feature/aac-encoder-decoder  

---

## Overview

Implement AAC audio encoding (publisher) and decoding (subscriber) with automatic WebCodecs-native-first strategy, falling back to WASM (FDK-AAC encoder, FAAD2 decoder) when native is not available (e.g. iOS 15 Safari).

Opus remains the default codec. AAC is opt-in via `audioCodec: "aac"` in `PublisherConfig`.

---

## Architecture

```
PUBLISHER
  Mic → AudioWorklet [aac-capture-processor]
       ↓ PCM Float32, 128 frames/quantum
  AACEncoderManager
       ↓ postMessage (transferable ArrayBuffer)
  aac-encoder-worker.js  [ES module Worker, /public/workers/]
       → imports ../codec-polyfill/audio-codec-polyfill.js
           ├─ Chrome/Edge  → native WebCodecs AudioEncoder (mp4a.40.2)
           └─ iOS 15       → FDK-AAC WASM
       ↓ postMessage { data: Uint8Array, metadata: { decoderConfig } }
  emit configReady(AudioSpecificConfig) + audioChunk(raw AAC-LC frames)
       ↓
  AudioProcessor → StreamManager → transport

SUBSCRIBER (media-worker-dev.js)
  transport → frameType=6 → EncodedAudioChunk
       ↓ codec from DecoderConfigs packet
  AACDecoder [audio-codec-polyfill.js]
       ├─ Chrome/Edge  → native WebCodecs AudioDecoder
       └─ iOS 15       → FAAD2 WASM
  Float32 PCM → workletPort → AudioWorklet jitter buffer → speakers
```

---

## New Files

### `packages/sdk/src/workers/aac-capture-worklet.js`
AudioWorklet `AudioWorkletProcessor` that captures PCM quanta (128 frames/channel) from the microphone and transfers them to `AACEncoderManager` via the node's `MessagePort` using transferable `ArrayBuffer`s.

### `packages/sdk/src/workers/aac-encoder-worker.js`
ES module Worker served from `/public/workers/`. Imports `audio-codec-polyfill.js` via relative path `../codec-polyfill/` — bypasses Vite's restriction on `import()` from `/public`. Accepts `configure / encode / flush / close` messages, returns `output / error / flushed` messages.

This Worker pattern is required because Vite dev server blocks dynamic `import('/codec-polyfill/...')` from source code, while `new Worker(url)` strings are not intercepted.

---

## Modified Files

### `packages/sdk/src/media/publisher/managers/AACEncoderManager.ts`
**Full rewrite.** Previous version used native `WebCodecs AudioEncoder` only. New version:
- Creates `new Worker('/workers/aac-encoder-worker.js', { type: 'module' })`
- Registers AudioWorklet (`aac-capture-worklet.js`) and connects mic → worklet → manager
- Accumulates 128-frame quanta until 1024-sample AAC frame, then transfers to worker
- Receives `output` messages from worker, emits `configReady` (with `AudioSpecificConfig`) and `audioChunk`
- API compatible with `AudioEncoderManager` (same event signatures + `setConfigSent`, `getConfig`, `getStats`, etc.)

### `packages/sdk/src/media/publisher/processors/AudioProcessor.ts`
- Import added: `AACEncoderManager`
- New union type: `type AnyEncoderManager = AudioEncoderManager | AACEncoderManager`
- Constructor and field types updated to accept `AnyEncoderManager`
- `setupEncoderHandlers()` — skips OGG packet header wrapping when `codec === "mp4a.40.2"` (AAC `description` is raw `AudioSpecificConfig`, not an OGG page)
- `resendConfig()` — same OGG skip logic

### `packages/sdk/src/types/media/publisher.types.ts`
Added optional field to `PublisherConfig`:
```typescript
audioCodec?: "opus" | "aac";
// "opus" = default (Recorder.js WASM)
// "aac"  = WebCodecs native → FDK-AAC WASM fallback
```

### `packages/sdk/src/media/publisher/Publisher.ts`
`initializeProcessors()` branches on `options.audioCodec`:
- `"aac"` → creates `AACEncoderManager` (no `InitAudioRecorder` needed)
- default → creates `AudioEncoderManager` (Opus, unchanged)

### `packages/sdk/src/workers/media-worker-dev.js`
- Added import: `import { AACDecoder } from '../codec-polyfill/audio-codec-polyfill.js'`
- `handleStreamConfigs()` audio branch: detects `cfg.codec === "mp4a.40.2"`:
  - Closes existing `OpusAudioDecoder`
  - Creates `new AACDecoder()`, wires `onOutput` / `onError`
  - Calls `.configure({ codec, sampleRate, numberOfChannels, description })` — FAAD2 uses `description` (AudioSpecificConfig) to initialize
  - Sets `aacDecoder.isReadyForAudio = true`
  - Opus path unchanged

### `packages/sdk/vite-plugin.ts`
Added `'codec-polyfill'` to `DEFAULT_DIRECTORIES`:
```typescript
const DEFAULT_DIRECTORIES = [
  'workers', 'raptorQ', 'polyfills', 'opus_decoder',
  'codec-polyfill',  // ← new: auto-copies fdk-aac + faad2 WASM
];
```

---

## Public Directory Requirements

The following files must be served from the app's `/public/` directory:

```
public/
  workers/
    aac-capture-worklet.js      ← new
    aac-encoder-worker.js       ← new
    media-worker-dev.js         ← updated
  codec-polyfill/
    audio-codec-polyfill.js
    fdk-aac/
      fdk-aac-encoder.js
      fdk_aac_encoder.js        (Emscripten module)
      fdk_aac_encoder.wasm
    faad2/
      faad2-decoder.js
      faad2_decoder.js          (Emscripten module)
      faad2_decoder.wasm
```

The Vite plugin (`copySDKStaticFiles`) now auto-copies `codec-polyfill/` during `pnpm dev` and `pnpm build`.

---

## Usage

```typescript
const publisher = new Publisher({
  publishUrl: "wss://...",
  permissions: { ... },
  audioCodec: "aac",   // opt-in; omit for default Opus
});
await publisher.startPublishing();
```

Subscriber detects codec automatically from the server's `DecoderConfigs` packet — no subscriber-side changes required.

---

## Codec Support Matrix

| Browser | Encoder | Decoder |
|---------|---------|---------|
| Chrome / Edge | WebCodecs `AudioEncoder` (native) | WebCodecs `AudioDecoder` (native) |
| Firefox | FDK-AAC WASM | FAAD2 WASM |
| Safari 16+ | WebCodecs `AudioEncoder` (native) | WebCodecs `AudioDecoder` (native) |
| Safari 15 / iOS 15 | FDK-AAC WASM | FAAD2 WASM |

---

## Notes

- **OGG wrapping skipped for AAC**: Opus sends an OGG page as `description`; AAC sends raw `AudioSpecificConfig` (2–5 bytes). `AudioProcessor` now detects codec before wrapping.
- **FAAD2 requires AudioSpecificConfig**: Unlike native `AudioDecoder` which can decode without it, FAAD2 WASM MUST have ASC to initialize. This is always provided by the FDK-AAC encoder (or native `AudioEncoder` via `metadata.decoderConfig.description`).
- **FDK-AAC frame size**: 1024 samples/channel fixed. `AACEncoderManager` accumulates 128-frame worklet quanta until 1024 samples are ready before encoding.
- **Backward compatible**: `audioCodec` defaults to `"opus"`. All existing Opus functionality is unchanged.
