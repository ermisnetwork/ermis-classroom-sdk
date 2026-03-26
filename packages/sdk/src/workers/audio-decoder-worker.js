/**
 * Audio Decoder Worker
 *
 * Dedicated worker for audio decoding — isolates audio from the video decode
 * pipeline so that heavy H.264 frame decoding on Android Chrome cannot block
 * audio data delivery to the AudioWorklet.
 *
 * Data flow:
 *   media-worker ──(MessagePort: audioDecoderPort)──► this worker
 *   this worker  ──(MessagePort: workletPort)──► AudioWorkletNode
 *
 * Messages received (from media-worker via audioDecoderPort):
 *   { type: "init", workletPort: MessagePort }
 *   { type: "configureDecoder", config: {...}, decoderType: "aac"|"opus" }
 *   { type: "decode", timestamp, data: Uint8Array }
 *   { type: "congestionLevel", data: number }
 *
 * Messages sent (to AudioWorkletNode via workletPort):
 *   { type: "audioData", channelData, timestamp, sampleRate, numberOfFrames, numberOfChannels }
 *   { type: "congestionLevel", data: number }
 */

import { AACDecoder } from "../codec-polyfill/audio-codec-polyfill.js";
import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";

let workletPort = null;
let decoder = null;
let decoderReady = false;
let externalDecoderPort = null; // for iOS 15 Opus compat

/**
 * Handle decoded audio output — copy AudioData to Float32Array channels
 * and forward to the AudioWorklet via workletPort.
 */
function handleAudioOutput(audioData) {
  try {
    const channelData = [];

    if (audioData.numberOfChannels === 1) {
      const monoChannel = new Float32Array(audioData.numberOfFrames);
      audioData.copyTo(monoChannel, { planeIndex: 0, format: "f32-planar" });
      channelData.push(monoChannel);
      channelData.push(new Float32Array(monoChannel)); // duplicate for stereo
      // const MONO_GAIN = Math.SQRT1_2; // ≈ 0.7071
      // const left = new Float32Array(audioData.numberOfFrames);
      // const right = new Float32Array(audioData.numberOfFrames);
      // for (let i = 0; i < monoChannel.length; i++) {
      //   left[i] = monoChannel[i] * MONO_GAIN;
      //   right[i] = monoChannel[i] * MONO_GAIN;
      // }
      // channelData.push(left);
      // channelData.push(right);
    } else {
      for (let i = 0; i < audioData.numberOfChannels; i++) {
        const channel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(channel, { planeIndex: i, format: "f32-planar" });
        channelData.push(channel);
      }
    }

    if (workletPort) {
      workletPort.postMessage(
        {
          type: "audioData",
          channelData,
          timestamp: audioData.timestamp,
          sampleRate: audioData.sampleRate,
          numberOfFrames: audioData.numberOfFrames,
          numberOfChannels: audioData.numberOfChannels,
          // numberOfChannels: channelData.length, // actual output channels (always 2 after mono→stereo)
        },
        channelData.map((c) => c.buffer)
      );
    }
  } finally {
    try {
      audioData.close();
    } catch {
      /* ignore */
    }
  }
}

function handleAudioError(e) {
  console.error("[AudioDecoderWorker] Decode error:", e);
}

/**
 * Configure the audio decoder based on the config received from media-worker.
 */
async function configureDecoder(config) {
  const isAAC = config.codec === "mp4a.40.2";

  if (isAAC) {
    decoder = new AACDecoder();
    decoder.onOutput = handleAudioOutput;
    decoder.onError = handleAudioError;

    await decoder.configure({
      codec: "mp4a.40.2",
      sampleRate: config.sampleRate,
      numberOfChannels: config.numberOfChannels,
      description: config.description,
    });

    decoder.isReadyForAudio = true;
    decoderReady = true;
    console.log(
      `[AudioDecoderWorker] AACDecoder configured — ${decoder.usingNative ? "native" : "FAAD2 WASM"}`
    );
  } else {
    // Opus path
    const audioInit = {
      output: handleAudioOutput,
      error: handleAudioError,
    };
    decoder = new OpusAudioDecoder(audioInit);
    await decoder.configure({
      sampleRate: config.sampleRate || 48000,
      numberOfChannels: config.numberOfChannels || 1,
      decoderPort: externalDecoderPort,
    });

    // Wait for WASM ready
    try {
      await decoder.waitForReady(5000);
    } catch {
      console.warn("[AudioDecoderWorker] Opus WASM ready timeout, proceeding");
    }

    // If description chunk is provided, decode it first
    if (config.description) {
      try {
        const desc = config.description instanceof Uint8Array
          ? config.description
          : new Uint8Array(config.description);
        const dataView = new DataView(
          desc.buffer,
          desc.byteOffset,
          desc.byteLength
        );
        const timestamp = dataView.getUint32(4, false);
        const data = desc.slice(9);
        const chunk = new EncodedAudioChunk({
          timestamp: timestamp * 1000,
          type: "key",
          data,
        });
        decoder.decode(chunk);
      } catch (err) {
        console.warn(
          "[AudioDecoderWorker] Error decoding Opus description chunk:",
          err
        );
      }
    }

    decoder.isReadyForAudio = true;
    decoderReady = true;
    console.log(
      `[AudioDecoderWorker] OpusDecoder configured, state: ${decoder.state}`
    );
  }
}

/**
 * Decode a single audio packet.
 */
function decodeAudioPacket(timestamp, data) {
  if (!decoder || !decoderReady) return;

  if (decoder.usingNative !== undefined) {
    // AACDecoder path
    try {
      decoder.decode({ type: "key", timestamp, data });
    } catch (err) {
      console.error("[AudioDecoderWorker] AAC decode error:", err);
    }
  } else {
    // Opus path
    try {
      decoder.decode(
        new EncodedAudioChunk({ timestamp, type: "key", data })
      );
    } catch (err) {
      console.error("[AudioDecoderWorker] Opus decode error:", err);
    }
  }
}

/**
 * Main message handler — receives commands from media-worker.
 */
self.onmessage = async function (e) {
  const msg = e.data;

  switch (msg.type) {
    case "init": {
      // Receive the workletPort from WorkerManager
      if (msg.workletPort instanceof MessagePort) {
        workletPort = msg.workletPort;
      }
      if (msg.decoderPort instanceof MessagePort) {
        externalDecoderPort = msg.decoderPort;
      }

      // Set up the audioDecoderPort — this is how media-worker sends us data
      if (msg.audioDecoderPort instanceof MessagePort) {
        const port = msg.audioDecoderPort;
        port.onmessage = async (ev) => {
          const data = ev.data;
          switch (data.type) {
            case "configureDecoder":
              await configureDecoder(data.config);
              break;

            case "decode":
              if (!decoderReady) {
                return; // Drop packets before decoder is configured (matches original behavior)
              }
              decodeAudioPacket(data.timestamp, data.data);
              break;

            case "congestionLevel":
              // Forward to worklet
              if (workletPort) {
                workletPort.postMessage({
                  type: "congestionLevel",
                  data: data.data,
                });
              }
              break;

            default:
              break;
          }
        };
        port.start();
      }

      console.log("[AudioDecoderWorker] Initialized");
      break;
    }

    default:
      break;
  }
};
