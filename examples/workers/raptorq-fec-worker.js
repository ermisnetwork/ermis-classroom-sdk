/**
 * RaptorQ FEC Encode Worker
 *
 * Handles synchronous WASM FEC encoding off the main thread so that
 * x-platform WASM calls do not block the UI / event loop.
 * Created on the **main thread** by StreamManager (WebRTC path).
 *
 * Protocol
 * ─────────
 * Inbound (main thread → worker):
 *   { type: "encode", requestId: number, packet: ArrayBuffer,
 *     chunkSize: number, redundancy: number }
 *
 * Outbound (worker → main thread):
 *   { type: "ready" }
 *   { type: "encoded", requestId: number,
 *     fecPacketBuffers: ArrayBuffer[], raptorQConfig: object }
 *   { type: "error", requestId?: number, message: string }
 */

import raptorqInit, { WasmEncoder } from '../raptorQ/raptorq_wasm.js';

/** @type {boolean} */
let wasmReady = false;

/** Messages that arrive before WASM is ready are queued here. @type {object[]} */
const pendingMessages = [];

// ─────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────
self.onmessage = function (e) {
  if (!wasmReady) {
    pendingMessages.push(e.data);
    return;
  }
  processMessage(e.data);
};

function processMessage(data) {
  switch (data.type) {
    case 'encode':
      handleEncode(data);
      break;
    default:
      console.warn('[RaptorQFecWorker] Unknown message type:', data.type);
  }
}

// ─────────────────────────────────────────────
// Encode
// ─────────────────────────────────────────────
function handleEncode({ requestId, packet, chunkSize, redundancy }) {
  try {
    const packetBytes = new Uint8Array(packet); // packet is a transferred ArrayBuffer

    const encoder = new WasmEncoder(packetBytes, chunkSize);

    // Parse RaptorQ config from the encoder
    const configBuf = encoder.getConfigBuffer();
    const configView = new DataView(configBuf.buffer, configBuf.byteOffset, configBuf.byteLength);
    const raptorQConfig = {
      transferLength: configView.getBigUint64(0, false),
      symbolSize:     configView.getUint16(8, false),
      sourceBlocks:   configView.getUint8(10),
      subBlocks:      configView.getUint16(11, false),
      alignment:      configView.getUint8(13),
    };

    // Encode — returns Uint8Array[]
    const rawPackets = encoder.encode(redundancy);
    encoder.free();

    // Copy each FEC packet into its own ArrayBuffer so we can transfer
    // them without risking aliasing into WASM memory.
    const fecPacketBuffers = rawPackets.map((pkt) => {
      const copy = new Uint8Array(pkt.length);
      copy.set(pkt);
      return copy.buffer;
    });

    self.postMessage(
      { type: 'encoded', requestId, fecPacketBuffers, raptorQConfig },
      fecPacketBuffers,
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err.message || String(err),
    });
  }
}

// ─────────────────────────────────────────────
// WASM initialization (auto-started)
// ─────────────────────────────────────────────
(async function initWasm() {
  try {
    // Relative URL resolves to /raptorQ/raptorq_wasm_bg.wasm from the worker's location
    await raptorqInit('../raptorQ/raptorq_wasm_bg.wasm');
    wasmReady = true;
    self.postMessage({ type: 'ready' });

    // Replay messages that arrived before WASM was ready
    for (const msg of pendingMessages) {
      processMessage(msg);
    }
    pendingMessages.length = 0;

    console.log('[RaptorQFecWorker] WASM initialized, worker ready');
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: 'Failed to initialize RaptorQ WASM: ' + (err.message || String(err)),
    });
  }
})();
