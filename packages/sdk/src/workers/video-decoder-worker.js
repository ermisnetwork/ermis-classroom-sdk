/**
 * Video Decoder Worker
 *
 * Standalone Worker for H.264 WASM decoding (tinyh264).
 * Created on the **main thread** by WorkerManager to avoid the nested-worker
 * restriction on iOS 15 Safari.
 *
 * Communication with media-worker-dev.js happens through a MessagePort
 * transferred during the "init" message.
 *
 * Port protocol
 * ─────────────
 * Inbound (media worker → this worker):
 *   { type: "configure", channelName, config }
 *   { type: "decode",    channelName, chunk: { type, timestamp, data } }
 *   { type: "reset",     channelName }
 *   { type: "resetAll" }
 *
 * Outbound (this worker → media worker):
 *   { type: "ready" }
 *   { type: "configured", channelName }
 *   { type: "videoData",  channelName, frame }
 *   { type: "error",      channelName?, message }
 */

import { WasmH264Decoder } from "../codec-polyfill/video-codec-polyfill.js";

/** @type {MessagePort|null} */
let port = null;

/**
 * Per-channel decoder instances.
 * @type {Map<string, WasmH264Decoder>}
 */
const decoders = new Map();

/**
 * Messages that arrive before the port handler is installed are queued here
 * and replayed once we are ready.
 * @type {Array<object>}
 */
const pendingMessages = [];

let ready = false;

// ─────────────────────────────────────────────
// Entry point — receive port from main thread
// ─────────────────────────────────────────────
self.onmessage = function (e) {
  if (e.data.type === "init" && e.data.port instanceof MessagePort) {
    port = e.data.port;
    port.onmessage = onPortMessage;
    ready = true;

    // Replay anything that arrived before we were ready
    for (const msg of pendingMessages) {
      processMessage(msg);
    }
    pendingMessages.length = 0;

    port.postMessage({ type: "ready" });
    console.log("[VideoDecoderWorker] Initialized, port connected");
  }
};

// ─────────────────────────────────────────────
// Port message handling
// ─────────────────────────────────────────────
function onPortMessage(e) {
  if (!ready) {
    pendingMessages.push(e.data);
    return;
  }
  processMessage(e.data);
}

function processMessage(data) {
  switch (data.type) {
    case "configure":
      handleConfigure(data.channelName, data.config);
      break;
    case "decode":
      handleDecode(data.channelName, data.chunk);
      break;
    case "reset":
      handleReset(data.channelName);
      break;
    case "resetAll":
      handleResetAll();
      break;
    default:
      console.warn("[VideoDecoderWorker] Unknown message type:", data.type);
  }
}

// ─────────────────────────────────────────────
// Configure
// ─────────────────────────────────────────────
async function handleConfigure(channelName, config) {
  try {
    let decoder = decoders.get(channelName);
    if (!decoder) {
      decoder = createDecoder(channelName);
      decoders.set(channelName, decoder);
    }
    await decoder.configure(config || { codec: "avc1.42001f" });
    port.postMessage({ type: "configured", channelName });
    console.log(`[VideoDecoderWorker] Decoder configured for ${channelName}`);
  } catch (err) {
    console.error(`[VideoDecoderWorker] Configure error (${channelName}):`, err);
    port.postMessage({
      type: "error",
      channelName,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Decode
// ─────────────────────────────────────────────
function handleDecode(channelName, chunk) {
  let decoder = decoders.get(channelName);
  if (!decoder) {
    // Lazily create & auto-configure if we haven't seen a configure yet
    decoder = createDecoder(channelName);
    decoders.set(channelName, decoder);
    decoder.configure({ codec: "avc1.42001f" }).catch((err) => {
      console.error(`[VideoDecoderWorker] Auto-configure error (${channelName}):`, err);
    });
  }

  if (decoder.state !== "configured") {
    // Decoder still loading WASM — drop the frame silently
    return;
  }

  try {
    decoder.decode(chunk);
  } catch (err) {
    console.error(`[VideoDecoderWorker] Decode error (${channelName}):`, err);
    port.postMessage({
      type: "error",
      channelName,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────
function handleReset(channelName) {
  const decoder = decoders.get(channelName);
  if (decoder) {
    try {
      decoder.close();
    } catch { /* ignore */ }
    decoders.delete(channelName);
  }
}

function handleResetAll() {
  for (const [name, decoder] of decoders) {
    try {
      decoder.close();
    } catch { /* ignore */ }
  }
  decoders.clear();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Create a new WasmH264Decoder with output/error wired to the port.
 */
function createDecoder(channelName) {
  const decoder = new WasmH264Decoder();

  decoder.onOutput = (frame) => {
    if (!port) return;

    // frame.yPlane/uPlane/vPlane point directly into WasmH264Decoder's
    // preallocated reuse buffers (_yBuf/_uBuf/_vBuf).  Transferring those
    // buffers detaches them on the sender side so the decoder can no longer
    // write into them on the next frame — causing "detached ArrayBuffer" on
    // iOS Safari.  Slice each plane first to get independent copies that are
    // safe to transfer without affecting the decoder's internal buffers.
    try {
      const yPlane = frame.yPlane.slice();
      const uPlane = frame.uPlane.slice();
      const vPlane = frame.vPlane.slice();
      port.postMessage(
        { type: "videoData", channelName, frame: { ...frame, yPlane, uPlane, vPlane } },
        [yPlane.buffer, uPlane.buffer, vPlane.buffer]
      );
    } catch {
      // Fallback: structured clone (if transfer fails on some browsers)
      port.postMessage({ type: "videoData", channelName, frame });
    }
  };

  decoder.onError = (err) => {
    if (!port) return;
    port.postMessage({
      type: "error",
      channelName,
      message: err.message || String(err),
    });
  };

  return decoder;
}
