/**
 * Video Encoder Worker
 *
 * Standalone Worker for H.264 WASM encoding (x264).
 * Created on the **main thread** to offload synchronous WASM encoding
 * and prevent UI/event-loop blocking on iOS 15 Safari.
 *
 * Communication with the main thread happens through direct postMessage.
 *
 * Protocol
 * ─────────────
 * Inbound (main thread → this worker):
 *   { type: "configure", encoderName, config }
 *   { type: "encode",    encoderName, rgbaData: ArrayBuffer, width, height, forceKeyFrame }
 *   { type: "flush",     encoderName }
 *   { type: "close",     encoderName }
 *   { type: "closeAll" }
 *
 * Outbound (this worker → main thread):
 *   { type: "ready" }
 *   { type: "configured", encoderName }
 *   { type: "output",     encoderName, chunk, metadata }
 *   { type: "flushed",    encoderName }
 *   { type: "closed",     encoderName }
 *   { type: "error",      encoderName?, message }
 */

import { X264WasmEncoder } from "../codec-polyfill/x264-encoder/x264-encoder-wrapper.js";

/** @type {Map<string, X264WasmEncoder>} */
const encoders = new Map();

/** @type {Map<string, object>} */
const encoderConfigs = new Map();

// ─────────────────────────────────────────────
// Message handling
// ─────────────────────────────────────────────
self.onmessage = function (e) {
  processMessage(e.data);
};

function processMessage(data) {
  switch (data.type) {
    case "configure":
      handleConfigure(data.encoderName, data.config);
      break;
    case "encode":
      handleEncode(
        data.encoderName,
        data.rgbaData,
        data.width,
        data.height,
        data.forceKeyFrame
      );
      break;
    case "flush":
      handleFlush(data.encoderName);
      break;
    case "close":
      handleClose(data.encoderName);
      break;
    case "closeAll":
      handleCloseAll();
      break;
    default:
      console.warn("[VideoEncoderWorker] Unknown message type:", data.type);
  }
}

// ─────────────────────────────────────────────
// Configure
// ─────────────────────────────────────────────
async function handleConfigure(encoderName, config) {
  try {
    // Close existing encoder if any
    let encoder = encoders.get(encoderName);
    if (encoder) {
      try {
        encoder.close();
      } catch {
        /* ignore */
      }
    }

    // Store config for metadata enrichment
    encoderConfigs.set(encoderName, config);

    encoder = createEncoder(encoderName);
    encoders.set(encoderName, encoder);

    await encoder.configure(config);
    self.postMessage({ type: "configured", encoderName });
    console.log(
      `[VideoEncoderWorker] Encoder configured for ${encoderName}:`,
      config
    );
  } catch (err) {
    console.error(
      `[VideoEncoderWorker] Configure error (${encoderName}):`,
      err
    );
    self.postMessage({
      type: "error",
      encoderName,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Encode
// ─────────────────────────────────────────────
function handleEncode(encoderName, rgbaBuffer, width, height, forceKeyFrame) {
  const encoder = encoders.get(encoderName);
  if (!encoder || encoder.state !== "configured") {
    return;
  }

  try {
    // Reconstruct ImageData from transferred RGBA buffer
    const rgbaData = new Uint8ClampedArray(rgbaBuffer);
    const imageData = new ImageData(rgbaData, width, height);
    encoder.encode(imageData, forceKeyFrame);
  } catch (err) {
    console.error(
      `[VideoEncoderWorker] Encode error (${encoderName}):`,
      err
    );
    self.postMessage({
      type: "error",
      encoderName,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Flush
// ─────────────────────────────────────────────
async function handleFlush(encoderName) {
  const encoder = encoders.get(encoderName);
  if (!encoder) {
    self.postMessage({ type: "flushed", encoderName });
    return;
  }

  try {
    await encoder.flush();
    self.postMessage({ type: "flushed", encoderName });
  } catch (err) {
    console.error(
      `[VideoEncoderWorker] Flush error (${encoderName}):`,
      err
    );
    self.postMessage({
      type: "error",
      encoderName,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Close
// ─────────────────────────────────────────────
function handleClose(encoderName) {
  const encoder = encoders.get(encoderName);
  if (encoder) {
    try {
      encoder.close();
    } catch {
      /* ignore */
    }
    encoders.delete(encoderName);
  }
  encoderConfigs.delete(encoderName);
  self.postMessage({ type: "closed", encoderName });
}

function handleCloseAll() {
  for (const [, encoder] of encoders) {
    try {
      encoder.close();
    } catch {
      /* ignore */
    }
  }
  encoders.clear();
  encoderConfigs.clear();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Create a new X264WasmEncoder with output/error wired to postMessage.
 */
function createEncoder(encoderName) {
  const encoder = new X264WasmEncoder();

  encoder.onOutput = (chunk, metadata) => {
    if (!chunk) return;

    // Enrich metadata with codedWidth/codedHeight from config
    const config = encoderConfigs.get(encoderName);
    if (metadata?.decoderConfig && config) {
      if (!metadata.decoderConfig.codedWidth) {
        metadata.decoderConfig.codedWidth = config.width;
      }
      if (!metadata.decoderConfig.codedHeight) {
        metadata.decoderConfig.codedHeight = config.height;
      }
    }

    // Serialize chunk (copyTo function cannot be transferred via postMessage)
    const serializedChunk = {
      type: chunk.type,
      timestamp: chunk.timestamp,
      data: chunk.data,
      byteLength: chunk.byteLength,
    };

    // Transfer the NAL data buffer for zero-copy to main thread.
    const transfer = [];
    if (chunk.data?.buffer) {
      transfer.push(chunk.data.buffer);
    }
    if (
      metadata?.decoderConfig?.description?.buffer &&
      !transfer.includes(metadata.decoderConfig.description.buffer)
    ) {
      transfer.push(metadata.decoderConfig.description.buffer);
    }

    try {
      self.postMessage(
        { type: "output", encoderName, chunk: serializedChunk, metadata },
        transfer
      );
    } catch {
      // Fallback: structured clone (if transfer fails on some browsers)
      self.postMessage({
        type: "output",
        encoderName,
        chunk: serializedChunk,
        metadata,
      });
    }
  };

  encoder.onError = (err) => {
    self.postMessage({
      type: "error",
      encoderName,
      message: err.message || String(err),
    });
  };

  return encoder;
}

// Signal that the worker script is loaded
self.postMessage({ type: "ready" });
