/**
 * aac-encoder-worker.js
 *
 * Runs as an ES module Worker.
 * Served from /public/workers/, so relative imports to ../codec-polyfill/ resolve
 * correctly against /public/codec-polyfill/ — bypassing Vite's /public import
 * restriction that applies to Vite-processed source modules.
 *
 * Message protocol (AACEncoderManager ↔ this worker):
 *
 *   Manager → Worker:
 *     { type: 'configure', config: { sampleRate, numberOfChannels, bitrate } }
 *     { type: 'encode', pcm: Float32Array, sampleRate, numberOfFrames,
 *                       numberOfChannels, timestamp }   — ArrayBuffer transferred
 *     { type: 'flush' }
 *     { type: 'close' }
 *
 *   Worker → Manager:
 *     { type: 'configured' }
 *     { type: 'output', data: Uint8Array, metadata, usingNative: bool }   — buffer transferred
 *     { type: 'error', message: string }
 *     { type: 'flushed' }
 */

import { AACEncoder } from '../codec-polyfill/audio-codec-polyfill.js';

let encoder = null;

self.onmessage = async (e) => {
  const msg = e.data;

  switch (msg.type) {
    // ── Configure ────────────────────────────────────────────────────────────
    case 'configure': {
      try {
        encoder = new AACEncoder();

        encoder.onOutput = (chunk, metadata) => {
          // Extract raw bytes regardless of whether chunk is native EncodedAudioChunk
          // or the WASM-style plain object { data: Uint8Array, copyTo, ... }.
          let data;
          if (chunk && chunk.data instanceof Uint8Array) {
            data = chunk.data;
          } else if (typeof chunk.copyTo === 'function') {
            data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
          } else {
            console.warn('[aac-encoder-worker] Unknown chunk type');
            return;
          }

          if (data.length === 0) return;

          // Serialise metadata (decoderConfig.description may be Uint8Array)
          const serialMeta = {};
          if (metadata && metadata.decoderConfig) {
            const dc = metadata.decoderConfig;
            const desc = dc.description;
            let descBytes;
            if (desc instanceof Uint8Array) {
              descBytes = desc;
            } else if (desc instanceof ArrayBuffer) {
              descBytes = new Uint8Array(desc);
            } else if (desc) {
              descBytes = new Uint8Array(desc);
            }
            serialMeta.decoderConfig = {
              codec: dc.codec ?? 'mp4a.40.2',
              sampleRate: dc.sampleRate,
              numberOfChannels: dc.numberOfChannels,
              ...(descBytes && { description: descBytes }),
            };
          }

          const transfer = [data.buffer];
          if (serialMeta.decoderConfig?.description) {
            // Don't transfer description buffer — it may be reused by encoder
            // (FdkAacEncoder stores it internally). Clone instead.
            serialMeta.decoderConfig.description = serialMeta.decoderConfig.description.slice();
          }

          self.postMessage({
            type: 'output',
            data,
            metadata: serialMeta,
            usingNative: encoder.usingNative,
          }, [data.buffer]);
        };

        encoder.onError = (err) => {
          self.postMessage({ type: 'error', message: String(err) });
        };

        await encoder.configure(msg.config);
        self.postMessage({ type: 'configured', usingNative: encoder.usingNative });
      } catch (err) {
        self.postMessage({ type: 'error', message: `configure failed: ${err}` });
      }
      break;
    }

    // ── Encode ───────────────────────────────────────────────────────────────
    case 'encode': {
      if (!encoder) return;

      try {
        const pcm = msg.pcm; // Float32Array (buffer transferred — still usable on this side)

        if (typeof AudioData !== 'undefined') {
          // Native WebCodecs path — create AudioData in worker (WebCodecs available in workers)
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: msg.sampleRate,
            numberOfFrames: msg.numberOfFrames,
            numberOfChannels: msg.numberOfChannels,
            timestamp: msg.timestamp,
            data: pcm,
          });
          encoder.encode(audioData);
          audioData.close();
        } else {
          // WASM path — WasmAACEncoder.encode() expects object with copyTo()
          encoder.encode({
            numberOfFrames: msg.numberOfFrames,
            numberOfChannels: msg.numberOfChannels,
            sampleRate: msg.sampleRate,
            timestamp: msg.timestamp,
            copyTo: (dest, { planeIndex }) => {
              if (planeIndex === 0) dest.set(pcm);
            },
            close: () => {},
          });
        }
      } catch (err) {
        self.postMessage({ type: 'error', message: `encode error: ${err}` });
      }
      break;
    }

    // ── Flush ────────────────────────────────────────────────────────────────
    case 'flush': {
      try {
        if (encoder) await encoder.flush();
        self.postMessage({ type: 'flushed' });
      } catch (err) {
        self.postMessage({ type: 'error', message: `flush error: ${err}` });
      }
      break;
    }

    // ── Close ────────────────────────────────────────────────────────────────
    case 'close': {
      if (encoder) {
        encoder.close();
        encoder = null;
      }
      break;
    }
  }
};
