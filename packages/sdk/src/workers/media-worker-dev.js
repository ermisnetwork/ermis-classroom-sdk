import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, STREAM_TYPE, CHUNK_TYPE, FRAME_TYPE } from "./publisherConstants.js";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";
import { AACDecoder } from "../codec-polyfill/audio-codec-polyfill.js";
import raptorqInit, { WasmFecManager } from '../raptorQ/raptorq_wasm.js';

import CommandSender from "./ClientCommand.js";

// ── Constants ──────────────────────────────────────────────────────────────
// All magic strings/numbers extracted here for maintainability.

// Message types (self.onmessage & postMessage)
const MSG = {
  INIT: "init",
  ATTACH_WEB_SOCKET: "attachWebSocket",
  ATTACH_WEB_TRANSPORT_URL: "attachWebTransportUrl",
  ATTACH_STREAM: "attachStream",
  ATTACH_DATA_CHANNEL: "attachDataChannel",
  TOGGLE_AUDIO: "toggleAudio",
  SWITCH_BITRATE: "switchBitrate",
  START_STREAM: "startStream",
  STOP_STREAM: "stopStream",
  PAUSE_STREAM: "pauseStream",
  RESUME_STREAM: "resumeStream",
  RESET: "reset",
  STOP: "stop",
  // Outgoing
  VIDEO_DATA: "videoData",
  AUDIO_DATA: "audioData",
  AUDIO_TOGGLED: "audio-toggled",
  BITRATE_CHANGED: "bitrateChanged",
  ERROR: "error",
  LOG: "log",
  CONGESTION_LEVEL: "congestionLevel",
  RAPTORQ_INITIALIZED: "raptorq-initialized",
  CODEC_RECEIVED: "codecReceived",
  STOP_EVENT: "stop",
  RESET_EVENT: "reset",
  STREAM_CLOSED: "stream_closed",  // Outgoing: notify main thread that transport closed
  // External decoder worker messages
  READY: "ready",
  CONFIGURED: "configured",
  CONFIGURE: "configure",
  DECODE: "decode",
  RESET_ALL: "resetAll",
  CONFIGURE_DECODER: "configureDecoder",
};

// JSON message types from server
const SERVER_MSG = {
  DECODER_CONFIGS: "DecoderConfigs",
  STREAM_CONFIG: "StreamConfig",
  SUBSCRIBER_CONNECTION_STATS: "subscriber_connection_stats",
};

// Protocol identifiers
const PROTOCOL = {
  WEBRTC: "webrtc",
  WEBSOCKET: "websocket",
  WEBTRANSPORT: "webtransport",
};

// Command types
const COMMAND_TYPE = {
  SUBSCRIBER: "subscriber_command",
};

// Codec identifiers
const CODEC = {
  AAC: "mp4a.40.2",
  H264_BASELINE: "avc1.42001f",
};

// Audio format constants
const AUDIO_FORMAT = {
  F32_PLANAR: "f32-planar",
  SAMPLE_RATE_48K: 48000,
  MONO_CHANNELS: 1,
};

// Video frame format
const VIDEO_FORMAT = {
  YUV420: "yuv420",
};

// Media types in stream config
const MEDIA_TYPE = {
  VIDEO: "video",
  AUDIO: "audio",
};

// Decoder states (WebCodecs API)
const DECODER_STATE = {
  CLOSED: "closed",
  UNCONFIGURED: "unconfigured",
};

// Binary protocol sizes (bytes)
const BINARY = {
  JSON_OPEN_BRACE: 0x7B,            // '{' — used to detect JSON vs binary
  FEC_FLAG: 0xff,                    // FEC packet marker
  MEDIA_HEADER_SIZE: 9,              // seq(4) + ts(4) + frameType(1)
  GOP_FRAME_HEADER_SIZE: 13,         // seq(4) + ts(4) + frameType(1) + payloadSize(4)
  WEBRTC_HEADER_SIZE: 6,             // seq(4) + fec(1) + type(1)
  LENGTH_PREFIX_SIZE: 4,             // big-endian u32 length prefix
  STREAM_ID_LEN_SIZE: 2,             // big-endian u16 stream-id length
  GOP_META_EXTRA: 7,                 // channel(1) + gopId(4) + expected(2)
};

// Guard limits
const LIMITS = {
  MAX_PAYLOAD_BYTES: 10_000_000,     // 10 MB — implausible frame guard
  MAX_BUFFER_BYTES: 5 * 1024 * 1024, // 5 MB — LengthDelimitedReader overflow
  DECODER_READY_TIMEOUT_MS: 5000,    // waitForReady() timeout
};

// Timestamp conversion
const TIMESTAMP_US_PER_MS = 1000;

// Congestion level indices
const CONGESTION_LEVEL = {
  NORMAL: 0,
  MILD: 1,
  MODERATE: 2,
  SEVERE: 3,
};

const CONGESTION_LEVEL_NAMES = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE'];

// GOP channel byte → CHANNEL_NAME mapping (MeetingChannel::to_u8() on server)
const GOP_CHANNEL_BYTE = {
  CAM_360P: 1,
  CAM_720P: 2,
  SCREEN_SHARE_720P: 3,
  CAM_1080P: 9,
  CAM_1440P: 10,
};

// WebRTC DataChannel name prefixes for command routing
const DC_PREFIX = {
  VIDEO: "video_",
  SCREEN_SHARE: "screen_share_",
  AUDIO: "audio",
};

// Bitrate switch inline command strings
const BITRATE_CMD = {
  PAUSE: "pause",
  RESUME: "resume",
};

// ── End Constants ──────────────────────────────────────────────────────────

let subscribeType = STREAM_TYPE.CAMERA;

let currentVideoChannel = CHANNEL_NAME.CAM_360P;

let workletPort = null; // DEPRECATED — kept for legacy compat; audio now goes via audioDecoderPort
let audioDecoderPort = null; // MessagePort to dedicated audio decoder worker
let audioEnabled = true;

// Audio subscription control - received from init message
// For screen share, this is determined by whether the publisher has screen share audio
let subscriptionAudioEnabled = true;

// External decoder port — set by the main thread for platforms without nested
// worker support (e.g. iOS 15 Safari).  When present, OpusAudioDecoder uses
// this MessagePort instead of creating a nested Worker.
let externalDecoderPort = null;

// External video decoder port — set by the main thread for iOS 15.
// When present, H.264 WASM decoding is offloaded to a dedicated worker thread
// so that synchronous tinyh264 decode() calls do not block the media worker's
// event loop (which must remain responsive for audio port messages).
let videoDecoderPort = null;

let mediaConfigs = new Map();

let mediaDecoders = new Map();

let videoIntervalID;
let audioIntervalID;

// Per-channel keyframe tracking - each channel tracks its own keyframe state
const keyFrameReceivedMap = new Map();

function isKeyFrameReceived(channelName) {
  return keyFrameReceivedMap.get(channelName) || false;
}

function setKeyFrameReceived(channelName, value) {
  keyFrameReceivedMap.set(channelName, value);
}

function resetAllKeyFrameFlags() {
  keyFrameReceivedMap.clear();
}

const channelStreams = new Map();

// WebRTC specific
let isWebRTC = false;
let webRtcConnection = null;
let webRtcDataChannels = new Map();

// command sender
let commandSender = null;

let webSocketConnection = null;
let webTPStreamReader = null;
let webTPStreamWriter = null;
let initialQuality = null;
let protocol = null;

// WebSocket specific
let isWebSocket = false;

// ── Downlink Congestion Controller (subscriber side) ──
// Uses server-sent Quinn stats (server→client path) for quality adaptation.
//
// Detection: loss-based only (per GCC / RFC 9002 standards).
// RTT ratio was removed — it is not a standard signal and produces false
// positives on low-latency links (e.g. baseRtt=6ms, jitter→20ms = ratio 3x
// but 0% loss = no congestion). The server-side already does proper BWE-based
// CC via cwnd/rtt; the client only needs loss for quality ladder decisions.
//
// GCC reference thresholds:
//   >10% loss → reduce (SEVERE)
//   >5%  loss → moderate degradation
//   >2%  loss → mild degradation (hold/don't increase)
//   ≤2%  loss → normal (can increase quality)
const QUALITY_LADDER = [CHANNEL_NAME.CAM_360P, CHANNEL_NAME.CAM_720P, CHANNEL_NAME.CAM_1080P, CHANNEL_NAME.CAM_1440P];
let _dlPrevLostPackets = 0;
let _dlPrevSentPackets = 0;
let _dlLevel = CONGESTION_LEVEL.NORMAL;
let _dlRecoveryStartTime = 0;
const DL_RECOVERY_HOLD_MS = 8000; // 8s hold before upgrading quality

// Loss rate thresholds (per GCC standard)
const DL_LOSS_MILD = 0.02;     // 2% — hold / don't increase
const DL_LOSS_MODERATE = 0.05; // 5% — reduce quality
const DL_LOSS_SEVERE = 0.10;   // 10% — heavy reduction

function evaluateDownlinkCongestion(stats) {
  // Compute loss rate since last interval
  const sentDelta = stats.sent_packets - _dlPrevSentPackets;
  const lostDelta = stats.lost_packets - _dlPrevLostPackets;
  _dlPrevSentPackets = stats.sent_packets;
  _dlPrevLostPackets = stats.lost_packets;
  const lossRate = sentDelta > 0 ? lostDelta / sentDelta : 0;

  // Determine target level (loss-based, per GCC)
  let target = CONGESTION_LEVEL.NORMAL;
  if (lossRate >= DL_LOSS_SEVERE) {
    target = CONGESTION_LEVEL.SEVERE;
  } else if (lossRate >= DL_LOSS_MODERATE) {
    target = CONGESTION_LEVEL.MODERATE;
  } else if (lossRate >= DL_LOSS_MILD) {
    target = CONGESTION_LEVEL.MILD;
  }

  const prevLevel = _dlLevel;

  // Degrade immediately
  if (target > _dlLevel) {
    _dlLevel = target;
    _dlRecoveryStartTime = 0;
    applyDownlinkQuality();
  }
  // Recover with hold timer (one step at a time)
  else if (target < _dlLevel) {
    if (_dlRecoveryStartTime === 0) {
      _dlRecoveryStartTime = performance.now();
    } else if (performance.now() - _dlRecoveryStartTime >= DL_RECOVERY_HOLD_MS) {
      _dlLevel = Math.max(CONGESTION_LEVEL.NORMAL, _dlLevel - 1);
      _dlRecoveryStartTime = 0;
      applyDownlinkQuality();
    }
  } else {
    _dlRecoveryStartTime = 0;
  }

  // Debug log + forward to audio worklet
  if (_dlLevel !== prevLevel) {
    console.warn(
      `[DownlinkCongestion] ${CONGESTION_LEVEL_NAMES[prevLevel]} → ${CONGESTION_LEVEL_NAMES[_dlLevel]}` +
      `  (rtt=${stats.rtt_ms.toFixed(1)}ms, loss=${(lossRate*100).toFixed(1)}%)`
    );

    if (workletPort) {
      workletPort.postMessage({ type: MSG.CONGESTION_LEVEL, data: _dlLevel });
    }
    if (audioDecoderPort) {
      audioDecoderPort.postMessage({ type: MSG.CONGESTION_LEVEL, data: _dlLevel });
    }
  }
}

function applyDownlinkQuality() {
  // Only applies to camera subscriptions (screen share has fixed quality)
  if (subscribeType !== STREAM_TYPE.CAMERA) return;

  const currentIdx = QUALITY_LADDER.indexOf(currentVideoChannel);
  if (currentIdx === -1) return;

  // Map congestion level to max quality index
  // NORMAL=3(1440p), MILD=2(1080p), MODERATE=1(720p), SEVERE=0(360p)
  const maxIdx = Math.max(0, QUALITY_LADDER.length - 1 - _dlLevel);
  const targetIdx = Math.min(currentIdx, maxIdx);

  if (targetIdx !== currentIdx) {
    const targetQuality = QUALITY_LADDER[targetIdx];
    console.warn(`[DownlinkCongestion] Switching quality: ${currentVideoChannel} → ${targetQuality}`);
    handleBitrateSwitch(targetQuality);
  }
}

/** @type {WasmFecManager|null} Single shared FEC manager for all channels */
let fecManager = null;

function getOrCreateFecManager() {
  if (!fecManager) {
    fecManager = new WasmFecManager();
  }
  return fecManager;
}

async function initRaptorQWasm() {
  // Load RaptorQ WASM from local path (served via Service Worker cache)
  const wasmUrl = "../raptorQ/raptorq_wasm_bg.wasm";
  await raptorqInit(wasmUrl);
}

const proxyConsole = {
  log: () => { },
  error: () => { },
  warn: () => { },
  debug: () => { },
  info: () => { },
  trace: () => { },
  group: () => { },
  groupEnd: () => { },
};

/**
 * Throttled recreation tracker — prevents spamming new WASM decoder instances
 * when a stream repeatedly returns decode errors. Safari 15 can't handle many
 * simultaneous WASM instances so we add a per-channel cooldown (3 s).
 */
const _decoderRecreationCooldown = new Map(); // channelName → lastRecreationTimestamp
const DECODER_RECREATE_COOLDOWN_MS = 3000; // 3 seconds between recreations

function canRecreateDecoder(channelName) {
  const last = _decoderRecreationCooldown.get(channelName) || 0;
  const now = Date.now();
  if (now - last < DECODER_RECREATE_COOLDOWN_MS) return false;
  _decoderRecreationCooldown.set(channelName, now);
  return true;
}

// Helper: Create polyfill decoder
async function createPolyfillDecoder(channelName) {
  const decoder = new H264Decoder();
  const init = createVideoInit(channelName);
  decoder.onOutput = init.output;
  decoder.onError = init.error;
  // IMPORTANT: Must call configure() to initialize the underlying WASM decoder
  await decoder.configure({ codec: CODEC.H264_BASELINE });
  return decoder;
}

let _nativeH264Supported = undefined;
async function cachedIsNativeH264Supported() {
  if (_nativeH264Supported === undefined) {
    try {
      _nativeH264Supported = await isNativeH264DecoderSupported();
    } catch {
      _nativeH264Supported = false;
    }
  }
  return _nativeH264Supported;
}

// Helper: Create decoder with fallback
async function createVideoDecoderWithFallback(channelName) {
  try {
    const nativeSupported = await cachedIsNativeH264Supported();
    proxyConsole.log(`[VideoDecoder] Native H264 decoder supported: ${nativeSupported}`);
    if (nativeSupported) {
      return new VideoDecoder(createVideoInit(channelName));
    }
  } catch (e) {
    proxyConsole.warn("Native VideoDecoder not available, using polyfill");
  }
  // console.log(`[VideoDecoder] 🔧 Using WASM decoder (tinyh264) for ${channelName}`);
  return createPolyfillDecoder(channelName);
}

// Shared TextDecoder singleton — avoid allocating new instance per packet
const _sharedTextDecoder = new TextDecoder();

const createVideoInit = (channelName) => ({
  output: (frame) => {
    // Native VideoDecoder outputs VideoFrame - send directly (transferable)
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
      if (!self._frameCount) self._frameCount = 0;
      self._frameCount++;
      try {
        self.postMessage({ type: MSG.VIDEO_DATA, frame, quality: channelName }, [frame]);
      } catch (postMessageError) {
        // Transfer failed (can happen on Safari 15) — must close frame to free GPU memory
        console.error('[Worker] VideoFrame transfer FAILED, closing frame:', postMessageError);
        try { frame.close(); } catch { /* ignore */ }
      }
    } 
    // WASM decoder outputs YUV frame object - send YUV directly for WebGL rendering
    else if (frame && frame.yPlane && frame.uPlane && frame.vPlane) {
      // Copy YUV planes for transfer (original data may be reused by decoder)
      const yPlane = new Uint8Array(frame.yPlane);
      const uPlane = new Uint8Array(frame.uPlane);
      const vPlane = new Uint8Array(frame.vPlane);
      
      try {
        // NOTE: Don't use transferables on iOS 15 - it can silently fail
        // Just copy the data instead (slightly slower but more compatible)
        self.postMessage({ 
          type: MSG.VIDEO_DATA, 
          frame: { 
            format: VIDEO_FORMAT.YUV420,
            yPlane: yPlane,
            uPlane: uPlane,
            vPlane: vPlane,
            width: frame.width, 
            height: frame.height 
          },
          quality: channelName 
        });
      } catch (postMessageError) {
        console.error('[Worker] postMessage FAILED:', postMessageError);
      }
    }
    // Unknown frame format
    else {
      console.warn('[Worker] Unknown frame format:', frame);
    }
  },
  error: (e) => {
    proxyConsole.error(`Video decoder error (${channelName}):`, e);
    self.postMessage({
      type: MSG.ERROR,
      message: `${channelName} decoder: ${e.message}`,
    });
    // Attempt to recover by resetting keyframe flag - next keyframe will reinitialize decoder
    setKeyFrameReceived(channelName, false);
    proxyConsole.warn(`[Recovery] Reset keyframe flag for ${channelName} decoder, waiting for next keyframe`);
  },
});

const audioInit = {
  output: (audioData) => {
    // This callback is used when audio decoder runs in this worker (legacy/fallback).
    // With audioDecoderPort, audio decoding happens in the audio-decoder-worker
    // and this callback is NOT used.
    try {
      const channelData = [];
   
      // if mono, duplicate to create stereo  
      if (audioData.numberOfChannels === AUDIO_FORMAT.MONO_CHANNELS) {
        const monoChannel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(monoChannel, { planeIndex: 0, format: AUDIO_FORMAT.F32_PLANAR });
        channelData.push(monoChannel);
        channelData.push(new Float32Array(monoChannel));
      } else {
        for (let i = 0; i < audioData.numberOfChannels; i++) {
          const channel = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(channel, { planeIndex: i, format: AUDIO_FORMAT.F32_PLANAR });
          channelData.push(channel);
        }
      }

      const port = workletPort;
      if (port) {
        port.postMessage(
          {
            type: MSG.AUDIO_DATA,
            channelData,
            timestamp: audioData.timestamp,
            sampleRate: audioData.sampleRate,
            numberOfFrames: audioData.numberOfFrames,
            numberOfChannels: audioData.numberOfChannels,
          },
          channelData.map((c) => c.buffer),
        );
      } else {
        console.error('[Audio] No audio output port available');
      }
    } finally {
      // Must always close AudioData to release underlying memory (Safari 15 critical)
      try { audioData.close(); } catch { /* ignore */ }
    }
  },
  error: (e) => {
    self.postMessage({ type: MSG.ERROR, message: e.message });
  },
};

// ------------------------------
// Main entry
// ------------------------------

self.onmessage = async function (e) {
  const { type, port, quality, readable, writable, channelName, dataChannel, wsUrl, localStreamId } = e.data;

  switch (type) {
    case MSG.INIT:
      protocol = e.data.protocol;
      if (protocol === PROTOCOL.WEBRTC) {
        await initRaptorQWasm();
        this.postMessage({ type: MSG.RAPTORQ_INITIALIZED });
      }
      if (e.data.enableLogging) {
        const methods = ['log', 'error', 'warn', 'debug', 'info', 'trace', 'group', 'groupEnd'];
        for (const m of methods) {
          if (console[m]) proxyConsole[m] = console[m].bind(console);
        }
      }
      // Legacy: if workletPort is sent directly (for backward compat)
      if (e.data.port instanceof MessagePort) workletPort = e.data.port;
      // New: audioDecoderPort — raw audio packets are forwarded here for
      // decoding on a dedicated thread (prevents video blocking audio)
      if (e.data.audioDecoderPort instanceof MessagePort) {
        audioDecoderPort = e.data.audioDecoderPort;
        audioDecoderPort.start();
      }
      subscribeType = e.data.subscribeType || STREAM_TYPE.CAMERA;
      // Get audioEnabled from init message - for screen share, this determines if we should subscribe to audio
      subscriptionAudioEnabled = e.data.audioEnabled !== undefined ? e.data.audioEnabled : true;
      initialQuality = e.data.initialQuality;
      externalDecoderPort = e.data.decoderPort || null;
      videoDecoderPort = e.data.videoDecoderPort || null;
      if (videoDecoderPort) {
        setupVideoDecoderPort(videoDecoderPort);
      }
      proxyConsole.log(`[Worker] Init with subscribeType=${subscribeType}, audioEnabled=${subscriptionAudioEnabled}, initialQuality=${initialQuality}, audioDecoderPort=${!!audioDecoderPort}`);
      try {
        await initializeDecoders();
        proxyConsole.log(`[Worker] Decoders initialized successfully`);
      } catch (err) {
        console.error(`[Worker] Decoder initialization failed:`, err);
      }
      break;

    case MSG.ATTACH_WEB_SOCKET:
      if (wsUrl) {
        commandSender = new CommandSender({
          localStreamId,
          sendDataFn: sendOverWebSocket,
          protocol: PROTOCOL.WEBSOCKET,
          commandType: COMMAND_TYPE.SUBSCRIBER,
        });

        isWebSocket = true;
        attachWebSocket(e.data.wsUrl);
      }
      break;

    case MSG.ATTACH_WEB_TRANSPORT_URL:
      // Worker creates the WebTransport session itself so we can directly
      // call incomingUnidirectionalStreams.getReader() following the MDN pattern,
      // without any postMessage transfer issues.
      if (e.data.url) {
        commandSender = new CommandSender({
          localStreamId: e.data.localStreamId,
          sendDataFn: sendOverStream,
          protocol: PROTOCOL.WEBTRANSPORT,
          commandType: COMMAND_TYPE.SUBSCRIBER,
        });
        proxyConsole.warn(`[Worker] Connecting WebTransport inside worker: ${e.data.url}`);
        attachWebTransportFromUrl(e.data.url, e.data.channelName).catch((err) => {
          console.error('[Worker] attachWebTransportFromUrl error:', err);
        });
      }
      break;

    case MSG.ATTACH_STREAM:
      if (readable && writable) {
        commandSender = new CommandSender({
          localStreamId,
          sendDataFn: sendOverStream,
          protocol: PROTOCOL.WEBTRANSPORT,
          commandType: COMMAND_TYPE.SUBSCRIBER,
        });
        proxyConsole.warn(`[Publisher worker]: Attaching WebTransport stream!`);
        attachWebTransportStream(readable, writable, channelName);
      }
      break;

    case MSG.ATTACH_DATA_CHANNEL:
      if (channelName && dataChannel) {
        proxyConsole.warn(`[Publisher worker]: Attaching WebRTC data channel for ${channelName}`);
        attachWebRTCDataChannel(channelName, dataChannel);

        // Initialize commandSender for WebRTC if not already done
        if (!commandSender) {
          commandSender = new CommandSender({
            localStreamId,
            sendDataFn: sendOverDataChannel,
            protocol: PROTOCOL.WEBSOCKET, // uses string JSON format (non-webtransport path)
            commandType: COMMAND_TYPE.SUBSCRIBER,
          });
        }
      }
      break;

    case MSG.TOGGLE_AUDIO:
      audioEnabled = !audioEnabled;
      self.postMessage({ type: MSG.AUDIO_TOGGLED, audioEnabled });
      break;

    case MSG.SWITCH_BITRATE:
      handleBitrateSwitch(quality);
      break;
    
    case MSG.START_STREAM:
      if (commandSender) commandSender.startStream();
      break;

    case MSG.STOP_STREAM:
      if (commandSender) commandSender.stopStream();
      break;

    case MSG.PAUSE_STREAM:
      resetAllKeyFrameFlags(); // Reset so decoder waits for keyframe on resume
      if (commandSender) commandSender.pauseStream();
      break;

    case MSG.RESUME_STREAM:
      if (commandSender) commandSender.resumeStream();
      break;

    case MSG.RESET:
      resetDecoders();
      break;

    case MSG.STOP:
      stopAll();
      break;
  }
};
// ------------------------------
// WebSocket Setup
// ------------------------------
function attachWebSocket(wsUrl) {
  const ws = new WebSocket(wsUrl);

  ws.binaryType = "arraybuffer";

  webSocketConnection = ws;

  ws.onopen = () => {
    // Use subscriptionAudioEnabled for audio option - dynamically determined based on publisher's screen share audio
    const options = {
      audio: subscribeType === STREAM_TYPE.CAMERA ? true : subscriptionAudioEnabled,
      video: true,
      initialQuality: initialQuality,
    };
    console.warn(`[Worker] 🔊 WebSocket subscribe options:`, JSON.stringify(options), `subscribeType=${subscribeType}, subscriptionAudioEnabled=${subscriptionAudioEnabled}`);
    commandSender.initSubscribeChannelStream(subscribeType, options);

    commandSender.startStream();
  };

  ws.onclose = () => {
    proxyConsole.log(`[WebSocket] Closed!`);
    self.postMessage({ type: MSG.STREAM_CLOSED });
  };

  ws.onerror = (error) => {
    proxyConsole.error(`[WebSocket] Error:`, error);
  };

  ws.onmessage = (event) => {
    processIncomingMessage(event.data);
  };
}

/// Send data over websocket, dont need to add length prefix
async function sendOverWebSocket(data) {
  if (!webSocketConnection || webSocketConnection.readyState !== WebSocket.OPEN) {
    proxyConsole.error(`WebSocket not found`);
    return;
  }

  proxyConsole.warn(`[WebSocket] Sending data ${data}`);
  await webSocketConnection.send(data);
}

// ------------------------------
// WebRTC Setup
// ------------------------------
function attachWebRTCDataChannel(channelName, channel) {
  webRtcDataChannels.set(channelName, channel);

  try {
    channel.binaryType = "arraybuffer";
  } catch (e) {
    // Safari 15: binaryType may already be set before transfer or
    // setting it on a transferred channel may throw TypeMismatchError.
    proxyConsole.warn(`[WebRTC] Could not set binaryType for ${channelName}:`, e.message);
  }

  channel.onopen = () => {
    proxyConsole.log(`[WebRTC] Data channel opened: ${channelName}`);
    const initText = `subscribe:${channelName}`;
    const initData = new TextEncoder().encode(initText);
    const len = initData.length;
    const out = new Uint8Array(BINARY.LENGTH_PREFIX_SIZE + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(initData, BINARY.LENGTH_PREFIX_SIZE);

    channel.send(out);
    proxyConsole.log(`[WebRTC] Sent subscribe message for ${channelName}`);
  };

  channel.onclose = () => {
    proxyConsole.log(`[WebRTC] Data channel closed: ${channelName}`);
    self.postMessage({ type: MSG.STREAM_CLOSED });
  };

  channel.onerror = (error) => {
    proxyConsole.error(`[WebRTC] Data channel error for ${channelName}:`, error);
  };

  channel.onmessage = async (event) => {
    // console.warn(`[WebRTC] Received message for ${channelName}:`, event.data, " data type: ", typeof event.data);
    let data = event.data;
    // iOS 15: binaryType="arraybuffer" may not persist after transfer to worker,
    // so data can arrive as Blob instead of ArrayBuffer.  Convert if needed.
    if (data instanceof Blob) {
      data = await data.arrayBuffer();
    }
    handleWebRtcMessage(channelName, data);
  };
}

// Send subscriber commands over WebRTC DataChannel
async function sendOverDataChannel(json) {
  // Send to all video/screen-share DataChannels (pause/resume affects video)
  for (const [name, channel] of webRtcDataChannels) {
    if ((name.startsWith(DC_PREFIX.VIDEO) || (name.startsWith(DC_PREFIX.SCREEN_SHARE) && !name.includes(DC_PREFIX.AUDIO))) && channel.readyState === 'open') {
      try {
        channel.send(json);
        proxyConsole.warn(`[WebRTC] Sent command to ${name}: ${json}`);
      } catch (error) {
        proxyConsole.error(`[WebRTC] Failed to send command to ${name}:`, error);
      }
    }
  }
}

function handleWebRtcMessage(channelName, message) {
    const { sequenceNumber, isFec, packetType, payload } = parseWebRTCPacket(new Uint8Array(message));

    if (isFec) {
      const channelFecManager = getOrCreateFecManager(channelName);
      const result = channelFecManager.process_fec_packet(payload, sequenceNumber);
      if (result) {
        const decodedData = result[0][1];
        processIncomingMessage(decodedData);
        return;
      }
    } else {
      processIncomingMessage(payload);
    }
}

function parseWebRTCPacket(packet) {
  if (packet.length < BINARY.WEBRTC_HEADER_SIZE) {
    throw new Error("Invalid packet: too short");
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  // 4 bytes sequence number (big endian)
  const sequenceNumber = view.getUint32(0, false);
  // 1 byte FEC flag
  const fecFlag = view.getUint8(4);
  // 1 byte packet type
  const packetType = view.getUint8(5);
  // Remaining bytes are the payload
  const payload = packet.subarray(6);

  return {
    sequenceNumber,
    isFec: fecFlag === BINARY.FEC_FLAG,
    packetType,
    payload,
  };
}

function handleStreamConfigs(json) {
  if (json.type !== SERVER_MSG.DECODER_CONFIGS) return;

  for (const [key, value] of Object.entries(json)) {
    if (key === "type") continue;

    try {
      const stream = (typeof value === "string") ? JSON.parse(value) : value;
      if (!stream || stream.type !== SERVER_MSG.STREAM_CONFIG) continue;

      const channelName = stream.channelName;
      const cfg = stream.config;
      const desc = base64ToUint8Array(cfg.description);

      proxyConsole.log(`Configuring decoder for ${key} (${channelName})`, { cfg });
      if (stream.mediaType === MEDIA_TYPE.VIDEO) {
        // Check if this is a native VideoDecoder or WASM polyfill
        const decoder = mediaDecoders.get(channelName);
        // Guard against VideoDecoder not existing on iOS 15
        const hasNativeVideoDecoder = typeof VideoDecoder !== 'undefined';
        const isNativeDecoder = decoder && hasNativeVideoDecoder && decoder instanceof VideoDecoder;

        // For native VideoDecoder with Annex B format, don't use description
        // For WASM polyfill decoder, pass description for SPS/PPS extraction
        const videoConfig = {
          codec: cfg.codec,
          codedWidth: cfg.codedWidth,
          codedHeight: cfg.codedHeight,
          frameRate: cfg.frameRate,
        };

        // Native VideoDecoder in Annex B mode doesn't need description
        // WASM decoder needs description for SPS/PPS parsing
        // NOTE: Check hasNativeVideoDecoder (API availability) rather than
        // isNativeDecoder (instance check), because 1080p/1440p decoders
        // haven't been created yet when config arrives. Using isNativeDecoder
        // would incorrectly include the 3-byte annexb description, which
        // causes native VideoDecoder to fail with "Failed to parse avcC".
        if (!hasNativeVideoDecoder && desc && desc.length > 0) {
          videoConfig.description = desc;
        }

        mediaConfigs.set(channelName, videoConfig);

        // Route to external video decoder worker if available (iOS 15)
        if (videoDecoderPort) {
          // External worker: always pass description for SPS/PPS
          const externalConfig = {
            codec: cfg.codec,
            codedWidth: cfg.codedWidth,
            codedHeight: cfg.codedHeight,
            frameRate: cfg.frameRate,
          };
          if (desc && desc.length > 0) {
            externalConfig.description = desc;
          }
          configureVideoExternal(channelName, externalConfig);
        } else if (decoder) {
          try {
            decoder.configure(videoConfig);
          } catch (err) {
            proxyConsole.warn(`Configure decoder fail ${channelName}:`, err);
          }
        } else {
          proxyConsole.warn(`No decoder for video channel ${channelName}`);
        }
      } else if (stream.mediaType === MEDIA_TYPE.AUDIO) {
        const audioConfig = {
          codec: cfg.codec,
          sampleRate: cfg.sampleRate,
          numberOfChannels: cfg.numberOfChannels,
          description: desc,
        };

        mediaConfigs.set(channelName, audioConfig);

        // ── Forward to dedicated audio decoder worker ──
        // When audioDecoderPort is active, audio decoding happens on a
        // separate thread. Just forward the config and let the audio
        // decoder worker handle decoder creation.
        if (audioDecoderPort) {
          proxyConsole.log(`[Audio] Forwarding decoder config to audio decoder worker for ${channelName}`);
          // Transfer description as a copy (the port can't transfer views into shared buffers)
          const descCopy = desc ? new Uint8Array(desc) : null;
          audioDecoderPort.postMessage({
            type: MSG.CONFIGURE_DECODER,
            config: {
              codec: cfg.codec,
              sampleRate: cfg.sampleRate,
              numberOfChannels: cfg.numberOfChannels,
              description: descCopy,
            },
          });
        } else {
          // ── Legacy inline decode path ──
          const isAAC = cfg.codec === CODEC.AAC;

          if (isAAC) {
            // ── AAC path: swap out any existing decoder for AACDecoder ──────────────
            const existingDecoder = mediaDecoders.get(channelName);
            // close old Opus decoder if it was already created
            if (existingDecoder && typeof existingDecoder.stop === 'function') {
              try { existingDecoder.stop(); } catch { /* ignore */ }
            }

            const aacDecoder = new AACDecoder();
            aacDecoder.onOutput = audioInit.output;
            aacDecoder.onError = audioInit.error;

            mediaDecoders.set(channelName, aacDecoder);

            // DEBUG: Log ASC bytes for diagnostics (critical for cross-browser debugging)
            if (desc && desc.length > 0) {
              proxyConsole.log(`[Audio] AAC ASC bytes for ${channelName}: [${Array.from(desc).map(b => b.toString(16).padStart(2, '0')).join(' ')}], len=${desc.length}`);
            } else {
              console.warn(`[Audio] ⚠️ No ASC description for AAC channel ${channelName}`);
            }

            aacDecoder.configure({
              codec: CODEC.AAC,
              sampleRate: cfg.sampleRate,
              numberOfChannels: cfg.numberOfChannels,
              description: desc, // AudioSpecificConfig
            }).then(() => {
              aacDecoder.isReadyForAudio = true;
              proxyConsole.log(`[Audio] AACDecoder configured for ${channelName} — using ${aacDecoder.usingNative ? 'native WebCodecs' : 'FAAD2 WASM'}, state: ${aacDecoder.state}`);
            }).catch((err) => {
              console.error(`[Audio] AACDecoder configure failed for ${channelName}:`, err);
            });
          } else {
            // ── Opus path (unchanged) ─────────────────────────────────────────────────
            const decoder = mediaDecoders.get(channelName);
            if (decoder) {
              try {
                decoder.configure({ ...audioConfig, decoderPort: externalDecoderPort })
                  .then((configResult) => {
                    proxyConsole.log(`[Audio] configured successfully for ${channelName}, result:`, configResult, "state:", decoder.state);
                    return decoder.waitForReady(LIMITS.DECODER_READY_TIMEOUT_MS);
                  })
                  .then(() => {
                    try {
                      proxyConsole.log(`[Audio] Decoder WASM ready for ${channelName}, sending description chunk`);

                      const dataView = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
                      const timestamp = dataView.getUint32(4, false);
                      const data = desc.slice(9);

                      const chunk = new EncodedAudioChunk({
                        timestamp: timestamp * TIMESTAMP_US_PER_MS,
                        type: CHUNK_TYPE.KEY,
                        data,
                      });
                      decoder.decode(chunk);
                      decoder.isReadyForAudio = true;
                      proxyConsole.log(`[Audio] Sent description chunk for ${channelName}, now ready for audio packets`);

                      if (decoder._preConfigBuffer && decoder._preConfigBuffer.length > 0) {
                        proxyConsole.log(`[Audio] Replaying ${decoder._preConfigBuffer.length} pre-config buffered packets for ${channelName}`);
                        for (const buffered of decoder._preConfigBuffer) {
                          try {
                            const bufferedChunk = new EncodedAudioChunk({
                              timestamp: buffered.timestamp * TIMESTAMP_US_PER_MS,
                              type: CHUNK_TYPE.KEY,
                              data: buffered.data,
                            });
                            decoder.decode(bufferedChunk);
                          } catch (err) {
                            console.warn(`[Audio] Error replaying buffered chunk for ${channelName}:`, err);
                          }
                        }
                        decoder._preConfigBuffer = null;
                      }
                    } catch (err) {
                      console.warn(`[Audio] Error decoding first audio frame (${channelName}):`, err);
                    }
                  })
                  .catch((err) => {
                    console.error(`[Audio] configure/ready REJECTED for ${channelName}:`, err);
                  });
              } catch (err) {
                console.error(`[Audio] Configure decoder FAIL ${channelName}:`, err);
              }
            } else {
              console.warn(`[Audio] No decoder for audio channel ${channelName}`);
            }
          }
        }
      }
    } catch (err) {
      proxyConsole.error(`Error processing config for ${key}:`, err);
    }
  }
}

// ------------------------------
// Stream handling (WebTransport)
// ------------------------------

async function attachWebTransportStream(readable, writable, channelName) {
  webTPStreamReader = readable.getReader();
  webTPStreamWriter = writable.getWriter();
  // Use subscriptionAudioEnabled for audio option - dynamically determined based on publisher's screen share audio
  const options = {
    audio: subscribeType === STREAM_TYPE.CAMERA ? true : subscriptionAudioEnabled,
    video: true,
    initialQuality: subscribeType === STREAM_TYPE.CAMERA ? (initialQuality || channelName) : channelName,
  };
  proxyConsole.warn(`[WebTransport] Attached stream, options:`, options);

  commandSender.initSubscribeChannelStream(subscribeType, options);

  proxyConsole.log(`Attached WebTransport stream`);

  commandSender.startStream();
  readStream(webTPStreamReader);
}

/**
 * Create a WebTransport session inside the worker from a URL.
 * This avoids all postMessage DataCloneErrors because the session object
 * and its incomingUnidirectionalStreams are never transferred across threads.
 */
async function attachWebTransportFromUrl(url, channelName) {
  const transport = new WebTransport(url);
  await transport.ready;
  proxyConsole.log('[WebTransport] Session ready inside worker');

  // ── Bidi stream: used for command send/receive (DecoderConfigs, etc.) ──
  const bidi = await transport.createBidirectionalStream();
  webTPStreamReader = bidi.readable.getReader();
  webTPStreamWriter = bidi.writable.getWriter();

  const options = {
    audio: subscribeType === STREAM_TYPE.CAMERA ? true : subscriptionAudioEnabled,
    video: true,
    initialQuality: subscribeType === STREAM_TYPE.CAMERA ? (initialQuality || channelName) : channelName,
  };
  commandSender.initSubscribeChannelStream(subscribeType, options);
  commandSender.startStream();

  // ── Bidi stream reader: DecoderConfigs + legacy media packets ──
  readStream(webTPStreamReader);

  // ── Unidirectional streams: one stream per GOP from the node server ──
  receiveUnidirectional(transport);
}

async function sendOverStream(frameBytes) {
  if (!webTPStreamWriter) {
    console.error(`[sendOverStream] WebTransport stream writer not found!`);
    return;
  }

  try {
    const len = frameBytes.length;
    const out = new Uint8Array(BINARY.LENGTH_PREFIX_SIZE + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(frameBytes, BINARY.LENGTH_PREFIX_SIZE);
    await webTPStreamWriter.write(out);
  } catch (error) {
    console.error(`[sendOverStream] ❌ Failed to send over stream:`, error);
    throw error;
  }
}

async function readStream(reader) {
  const delimitedReader = new LengthDelimitedReader(reader);
  let messageCount = 0;
  try {
    while (true) {
      const message = await delimitedReader.readMessage();
      if (message === null) {
        console.warn(`[readStream] Stream ended after ${messageCount} messages`);
        break;
      }
      messageCount++;
      await processIncomingMessage(message);
    }
  } catch (err) {
    proxyConsole.error(`[readStream] error after ${messageCount} messages:`, err);
  }
}

// ======================================
// GOP Stream Receiver (WebTransport unidirectional streams)
// ======================================

/**
 * GopByteReader wraps a ReadableStreamDefaultReader and maintains an internal
 * byte buffer, allowing exact-size reads across WebTransport chunk boundaries.
 */
class GopByteReader {
  constructor(reader) {
    this.reader = reader;
    this._chunks = [];
    this._totalBytes = 0;
    this.done = false;
  }

  async readExact(size) {
    while (this._totalBytes < size) {
      if (this.done) return null;
      const { value, done } = await this.reader.read();
      if (done) { this.done = true; if (this._totalBytes < size) return null; break; }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      this._chunks.push(chunk);
      this._totalBytes += chunk.length;
    }
    return this._consume(size);
  }

  _consume(size) {
    if (this._chunks[0].length >= size) {
      const first = this._chunks[0];
      if (first.length === size) {
        this._chunks.shift();
        this._totalBytes -= size;
        return first;
      }
      const out = new Uint8Array(first.subarray(0, size));
      this._chunks[0] = first.subarray(size);
      this._totalBytes -= size;
      return out;
    }

    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = this._chunks[0];
      const needed = size - offset;
      if (chunk.length <= needed) {
        out.set(chunk, offset);
        offset += chunk.length;
        this._chunks.shift();
      } else {
        out.set(chunk.subarray(0, needed), offset);
        this._chunks[0] = chunk.subarray(needed);
        offset += needed;
      }
    }
    this._totalBytes -= size;
    return out;
  }
}

/**
 * Map the channel byte from GOP header (MeetingChannel::to_u8() on server)
 * to the CHANNEL_NAME string used by keyFrameReceivedMap.
 *
 * Server channel bytes:
 *   1=Cam360p, 2=Cam720p, 3=ScreenShare720p, 4=ScreenShare1080p,
 *   5=Mic48k, 6=ScreenShareAudio, 7=Livestream720p, 9=Cam1080p, 10=Cam1440p
 */
function gopChannelToName(channelByte) {
  switch (channelByte) {
    case GOP_CHANNEL_BYTE.CAM_360P: return CHANNEL_NAME.CAM_360P;
    case GOP_CHANNEL_BYTE.CAM_720P: return CHANNEL_NAME.CAM_720P;
    case GOP_CHANNEL_BYTE.SCREEN_SHARE_720P: return CHANNEL_NAME.SCREEN_SHARE_720P;
    // case 4: return CHANNEL_NAME.SCREEN_SHARE_1080P; // not used yet
    case GOP_CHANNEL_BYTE.CAM_1080P: return CHANNEL_NAME.CAM_1080P;
    case GOP_CHANNEL_BYTE.CAM_1440P: return CHANNEL_NAME.CAM_1440P;
    default: return null;
  }
}

/**
 * Track the latest GOP ID per channel so that when a new GOP arrives,
 * older (superseded) GOPs for the same channel stop processing.
 * Key: channel byte (u8), Value: latest gopId (u32)
 */
const activeGopPerChannel = new Map();

/**
 * Loop over all incoming unidirectional streams from the WebTransport session.
 * Follows the MDN pattern exactly:
 *   const reader = transport.incomingUnidirectionalStreams.getReader();
 *   while (true) { const { done, value } = await reader.read(); ... }
 */
async function receiveUnidirectional(transport) {
  proxyConsole.log('[GOP] 🎬 receiveUnidirectional: starting GOP stream listener');
  let gopCount = 0;
  const reader = transport.incomingUnidirectionalStreams.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.warn('[GOP] incomingUnidirectionalStreams closed');
      self.postMessage({ type: MSG.STREAM_CLOSED });
      break;
    }
    // value is a WebTransportReceiveStream (one GOP from the node)
    gopCount++;
    // Do NOT await — process each GOP stream in parallel
    readGopStream(value, gopCount).catch((err) => {
      proxyConsole.error('[GOP] readGopStream error:', err);
    });
  }
}

/**
 * Read all frames from a single WebTransportReceiveStream (one GOP).
 * MDN pattern: const reader = receiveStream.getReader(); reader.read() loop.
 * Data is fed through GopByteReader for exact-size reads across chunks.
 *
 * When a newer GOP arrives for the same channel, this GOP is superseded:
 * remaining frames are dropped and the underlying QUIC stream is cancelled.
 *
 * Wire format (GopStreamSender / GopStreamHeaderEncoder):
 *  GOP Header: [streamIdLen:2B][streamId:N][channel:1B][gopId:4B][expected:2B]
 *  Per frame:  [sequence:4B][timestamp:4B][frameType:1B][payloadSize:4B][payload]
 */
async function readGopStream(receiveStream, gopIndex) {
  const rawReader = receiveStream.getReader();
  const byteReader = new GopByteReader(rawReader);
  let channel = -1;
  let gopId = -1;
  let channelName = null; // CHANNEL_NAME string for keyframe tracking
  try {
    // ── 1. GOP Header ────────────────────────────────────────────────────
    const streamIdLenBytes = await byteReader.readExact(2);
    if (!streamIdLenBytes) return;
    const streamIdLen = new DataView(streamIdLenBytes.buffer).getUint16(0, false);

    const gopMeta = await byteReader.readExact(streamIdLen + 1 + 4 + 2);
    if (!gopMeta) return;

    const streamId = _sharedTextDecoder.decode(gopMeta.subarray(0, streamIdLen));
    const dv = new DataView(gopMeta.buffer, gopMeta.byteOffset, gopMeta.byteLength);
    let off = streamIdLen;
    channel = dv.getUint8(off); off += 1;
    gopId = dv.getUint32(off, false); off += 4;
    const expectedFrames = dv.getUint16(off, false);

    // Map channel byte → CHANNEL_NAME for keyframe flag reset
    channelName = gopChannelToName(channel);

    // Register this GOP as the active one for its channel.
    // Any older GOP for this channel will detect it's been superseded.
    activeGopPerChannel.set(channel, gopId);

    // ── 2. Frame loop ────────────────────────────────────────────────────
    const FRAME_HEADER_SIZE = BINARY.GOP_FRAME_HEADER_SIZE;
    let frameCount = 0;
    let wasSuperseded = false;
    while (true) {
      const headerBytes = await byteReader.readExact(FRAME_HEADER_SIZE);
      if (!headerBytes) break; // stream ended — normal GOP completion

      const fv = new DataView(headerBytes.buffer, headerBytes.byteOffset, FRAME_HEADER_SIZE);
      const payloadSize = fv.getUint32(9, false);

      // Guard against binary misalignment: if the frame header was read at a wrong
      // offset, payloadSize will be nonsensical. A real frame is never 0 bytes and
      // never exceeds 10 MB (typical 1080p keyframe ~100-400 KB). If this fires,
      // all subsequent reads would also be misaligned → break out of the GOP entirely.
      if (payloadSize === 0 || payloadSize > LIMITS.MAX_PAYLOAD_BYTES) {
        console.warn(`[GOP] ch=${channel} gopId=${gopId} implausible payloadSize=${payloadSize}`);
        break;
      }

      const payload = await byteReader.readExact(payloadSize);
      if (!payload) break;

      frameCount++;

      // Check if this GOP has been superseded by a newer one.
      // Without this check, frames from the old GOP can interleave with
      // the new GOP's frames at the decoder, causing brief corruption.
      if (activeGopPerChannel.get(channel) !== gopId) {
        wasSuperseded = true;
        rawReader.cancel().catch(() => {});
        break;
      }

      // Reconstruct full packet: [seq:4][ts:4][frameType:1] + media_payload
      // handleBinaryPacket() expects this 9-byte prefix to route to the correct decoder.
      const fullPacket = new Uint8Array(BINARY.MEDIA_HEADER_SIZE + payload.length);
      fullPacket.set(headerBytes.subarray(0, BINARY.MEDIA_HEADER_SIZE), 0);  // seq + ts + frameType from FrameHeader
      fullPacket.set(payload, BINARY.MEDIA_HEADER_SIZE);
      await processIncomingMessage(fullPacket);
    }

    // ── 3. GOP integrity check ─────────────────────────────────────────
    // If the GOP ended prematurely (fewer frames than expected), the decoder
    // has received an incomplete GOP. H.264 delta frames depend on ALL previous
    // frames, so missing frames corrupt the decoder's reference state.
    // Reset keyframe flag → decoder drops all subsequent deltas until a clean
    // keyframe arrives from the next GOP, preventing visual artifacts.
    if (channelName && frameCount > 0 && frameCount < expectedFrames && !wasSuperseded) {
      // console.warn(
      //   `[GOP] ⚠️ Incomplete GOP: ch=${channel} gopId=${gopId} ` +
      //   `frames=${frameCount}/${expectedFrames} — resetting keyframe flag to prevent artifacts`
      // );
      setKeyFrameReceived(channelName, false);
    }

  } catch (err) {
    // Suppress errors from cancelled streams (expected when superseded)
    if (activeGopPerChannel.get(channel) !== gopId) {
      // This GOP was superseded — cancellation errors are expected
      return;
    }
    // GOP stream error: decoder may have partial data → reset keyframe flag
    if (channelName) {
      // console.warn(`[GOP] readGopStream error, resetting keyframe flag for ch=${channel}`);
      setKeyFrameReceived(channelName, false);
    }
    // proxyConsole.error(`[GOP] readGopStream #${gopIndex} error:`, err);
  }
}

async function processIncomingMessage(message) {
  // Get raw bytes for inspection
  let bytes;
  if (message instanceof Uint8Array) {
    bytes = message;
  } else if (message instanceof ArrayBuffer) {
    bytes = new Uint8Array(message);
  } else {
    bytes = new Uint8Array(message.buffer || message);
  }

  // Only attempt JSON parsing if data starts with '{' (0x7B)
  // DecoderConfigs arrive rarely (once per session) — skip JSON parse for binary packets
  if (bytes.length > 0 && bytes[0] === BINARY.JSON_OPEN_BRACE) {
    try {
      const text = _sharedTextDecoder.decode(bytes); // Reuse singleton to reduce GC pressure
      const json = JSON.parse(text);
      // Only log DecoderConfigs parsing — avoid per-packet log spam in hot path
      if (json.type === SERVER_MSG.DECODER_CONFIGS) {
        proxyConsole.log(`[processIncomingMessage] Received DecoderConfigs`);
        handleStreamConfigs(json);
        return;
      }
      // ── Subscriber downlink congestion stats ──
      // NOTE: Client-side subscriber CC is DISABLED.
      // Server-side congestion.rs already detects downlink congestion and does
      // GOP-level frame dropping. Having a second CC here using the same Quinn
      // stats creates a double-reaction feedback loop (oscillation between quality
      // levels). Quality switching should be user-driven, not auto-congestion.
      if (json.type === SERVER_MSG.SUBSCRIBER_CONNECTION_STATS) {
        // evaluateDownlinkCongestion(json);  // disabled — server handles CC
        return;
      }
    } catch (e) {
      // Not valid JSON — binary data that happens to start with 0x7B.
      // Fall through to binary handling.
    }
  }

  // Binary media packet
  const buf = (message instanceof ArrayBuffer)
    ? message
    : (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
      ? bytes.buffer
      : bytes.slice().buffer;
  handleBinaryPacket(buf);
}

async function handleBinaryPacket(dataBuffer) {
  const dataView = new DataView(dataBuffer);
  const sequenceNumber = dataView.getUint32(0, false);
  const timestamp = dataView.getUint32(4, false);
  const frameType = dataView.getUint8(BINARY.MEDIA_HEADER_SIZE - 1);
  // Use a Uint8Array VIEW instead of ArrayBuffer.slice(9) to avoid a deep copy
  // of every frame payload. ArrayBuffer.slice() memcpy's the entire payload
  // (100-400 KB per 720p frame) which wastes memory and CPU on Safari 15.
  // If transfer to an external worker is needed, decodeVideoExternal() will do
  // a targeted slice() of just that path.
  const data = new Uint8Array(dataBuffer, BINARY.MEDIA_HEADER_SIZE);

  // ── Video frame types ──
  // When videoDecoderPort is set (iOS 15), all video decoding is offloaded
  // to the external video-decoder-worker via MessagePort.  Keyframe tracking
  // still happens here so we don't send delta frames before a keyframe.

  if (frameType === FRAME_TYPE.CAM_360P_KEY || frameType === FRAME_TYPE.CAM_360P_DELTA) {
    // 360p video
    const type = frameType === FRAME_TYPE.CAM_360P_KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    if (type === CHUNK_TYPE.KEY) setKeyFrameReceived(CHANNEL_NAME.CAM_360P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.CAM_360P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.CAM_360P, type, timestamp, data);
      } else {
        let decoder360p = mediaDecoders.get(CHANNEL_NAME.CAM_360P);
        const decoderState = decoder360p ? decoder360p.state : null;

        if (!decoder360p || decoderState === DECODER_STATE.CLOSED || decoderState === DECODER_STATE.UNCONFIGURED) {
          // Throttle decoder recreation to avoid spawning multiple WASM instances
          // under rapid error conditions (Safari 15 memory limit critical)
          if (canRecreateDecoder(CHANNEL_NAME.CAM_360P)) {
            decoder360p = await createVideoDecoderWithFallback(CHANNEL_NAME.CAM_360P);
            mediaDecoders.set(CHANNEL_NAME.CAM_360P, decoder360p);
            const video360pConfig = mediaConfigs.get(CHANNEL_NAME.CAM_360P);
            if (video360pConfig) decoder360p.configure(video360pConfig);
          } else {
            return; // Still in cooldown — drop this frame
          }
        }

        try {
          if (data.byteLength === 0) return;
          if (!self._decodeCount) self._decodeCount = 0;
          self._decodeCount++;

          const hasNativeVideoDecoder = typeof VideoDecoder !== 'undefined';
          const isPolyfill = decoder360p.usingNative === false || !hasNativeVideoDecoder || !(decoder360p instanceof VideoDecoder);

          if (isPolyfill) {
            decoder360p.decode({ type, timestamp: timestamp * TIMESTAMP_US_PER_MS, data: new Uint8Array(data) });
          } else {
            decoder360p.decode(new EncodedVideoChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type, data }));
          }
        } catch (err) {
          proxyConsole.error("360p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.CAM_360P, false);
        }
      }
    }
    return;
  } else if (frameType === FRAME_TYPE.CAM_720P_KEY || frameType === FRAME_TYPE.CAM_720P_DELTA) {
    // 720p video
    const type = frameType === FRAME_TYPE.CAM_720P_KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    if (type === CHUNK_TYPE.KEY) setKeyFrameReceived(CHANNEL_NAME.CAM_720P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.CAM_720P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.CAM_720P, type, timestamp, data);
      } else {
        let decoder720p = mediaDecoders.get(CHANNEL_NAME.CAM_720P);
        const decoderState = decoder720p ? decoder720p.state : null;

        if (!decoder720p || decoderState === DECODER_STATE.CLOSED || decoderState === DECODER_STATE.UNCONFIGURED) {
          // Throttle decoder recreation to avoid spawning multiple WASM instances
          if (canRecreateDecoder(CHANNEL_NAME.CAM_720P)) {
            decoder720p = await createVideoDecoderWithFallback(CHANNEL_NAME.CAM_720P);
            mediaDecoders.set(CHANNEL_NAME.CAM_720P, decoder720p);
            const config720p = mediaConfigs.get(CHANNEL_NAME.CAM_720P);
            if (config720p) {
              proxyConsole.log("Decoder error, Configuring 720p decoder with config:", config720p);
              decoder720p.configure(config720p);
            }
          } else {
            return; // Still in cooldown — drop this frame
          }
        }

        try {
          if (data.byteLength === 0) return;
          const hasNativeVideoDecoder = typeof VideoDecoder !== 'undefined';
          const isPolyfill = decoder720p.usingNative === false || !hasNativeVideoDecoder || !(decoder720p instanceof VideoDecoder);

          if (isPolyfill) {
            decoder720p.decode({ type, timestamp: timestamp * TIMESTAMP_US_PER_MS, data: new Uint8Array(data) });
          } else {
            decoder720p.decode(new EncodedVideoChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type, data }));
          }
        } catch (err) {
          proxyConsole.error("720p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.CAM_720P, false);
        }
      }
    }
    return;
  } else if (frameType === FRAME_TYPE.CAM_1080P_KEY || frameType === FRAME_TYPE.CAM_1080P_DELTA) {
    // 1080p video
    const type = frameType === FRAME_TYPE.CAM_1080P_KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    if (type === CHUNK_TYPE.KEY) setKeyFrameReceived(CHANNEL_NAME.CAM_1080P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.CAM_1080P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.CAM_1080P, type, timestamp, data);
      } else {
        let decoder1080p = mediaDecoders.get(CHANNEL_NAME.CAM_1080P);
        const decoderState = decoder1080p ? decoder1080p.state : null;

        if (!decoder1080p || decoderState === DECODER_STATE.CLOSED || decoderState === DECODER_STATE.UNCONFIGURED) {
          decoder1080p = new VideoDecoder(createVideoInit(CHANNEL_NAME.CAM_1080P));
          mediaDecoders.set(CHANNEL_NAME.CAM_1080P, decoder1080p);
          const config1080p = mediaConfigs.get(CHANNEL_NAME.CAM_1080P);
          if (config1080p) {
            proxyConsole.log("Configuring 1080p decoder with config:", config1080p);
            decoder1080p.configure(config1080p);
          }
        }

        try {
          decoder1080p.decode(new EncodedVideoChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type, data }));
        } catch (err) {
          proxyConsole.error("1080p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.CAM_1080P, false);
        }
      }
    }
    return;
  } else if (frameType === FRAME_TYPE.CAM_1440P_KEY || frameType === FRAME_TYPE.CAM_1440P_DELTA) {
    // 1440p video
    const type = frameType === FRAME_TYPE.CAM_1440P_KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    if (type === CHUNK_TYPE.KEY) setKeyFrameReceived(CHANNEL_NAME.CAM_1440P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.CAM_1440P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.CAM_1440P, type, timestamp, data);
      } else {
        let decoder1440p = mediaDecoders.get(CHANNEL_NAME.CAM_1440P);

        try {
          decoder1440p.decode(new EncodedVideoChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type, data }));
        } catch (err) {
          proxyConsole.error("1440p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.CAM_1440P, false);
        }
      }
    }
    return;
  } else if (frameType === FRAME_TYPE.SCREEN_SHARE_KEY || frameType === FRAME_TYPE.SCREEN_SHARE_DELTA) {
    // Screen share 720p
    const type = frameType === FRAME_TYPE.SCREEN_SHARE_KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    if (type === CHUNK_TYPE.KEY) setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.SCREEN_SHARE_720P, type, timestamp, data);
      } else {
        let videoDecoderScreenShare720p = mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
        const decoderState = videoDecoderScreenShare720p ? videoDecoderScreenShare720p.state : null;

        if (!videoDecoderScreenShare720p || decoderState === DECODER_STATE.CLOSED || decoderState === DECODER_STATE.UNCONFIGURED) {
          // Recreate decoder when closed (e.g. after decode error from GOP interleaving)
          if (canRecreateDecoder(CHANNEL_NAME.SCREEN_SHARE_720P)) {
            videoDecoderScreenShare720p = await createVideoDecoderWithFallback(CHANNEL_NAME.SCREEN_SHARE_720P);
            mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, videoDecoderScreenShare720p);
            const configSS720p = mediaConfigs.get(CHANNEL_NAME.SCREEN_SHARE_720P);
            if (configSS720p) {
              proxyConsole.log("Recreating screen share 720p decoder with config:", configSS720p);
              videoDecoderScreenShare720p.configure(configSS720p);
            }
            // After recreation, wait for next keyframe
            setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, false);
          }
          return; // Drop this frame — wait for next keyframe after recreation
        }

        try {
          if (data.byteLength === 0) return;
          const encodedChunk = new EncodedVideoChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type, data });
          videoDecoderScreenShare720p.decode(encodedChunk);
        } catch (error) {
          proxyConsole.error("Screen share video decode error:", error);
          setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, false);
        }
      }
    }
    return;
  } else if (frameType === FRAME_TYPE.AUDIO) {
    if (!self._audioPacketCount) self._audioPacketCount = 0;
    self._audioPacketCount++;

    // ── Forward to dedicated audio decoder worker ──
    // Audio decoding is offloaded to a separate thread (audio-decoder-worker)
    // so that video decode (which can block 10-50ms on Android) never
    // delays audio data delivery to the AudioWorklet.
    if (audioDecoderPort) {
      const audioPayload = data.slice(); // isolated copy
      audioDecoderPort.postMessage(
        { type: MSG.DECODE, timestamp: timestamp * TIMESTAMP_US_PER_MS, data: audioPayload },
        [audioPayload.buffer]
      );
      return;
    }

    // ── Legacy fallback: decode inline (when audioDecoderPort is not available) ──
    let audioDecoder = mediaDecoders.get(
      subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_48K : CHANNEL_NAME.SCREEN_SHARE_AUDIO
    );

    if (!audioDecoder) {
      if (self._audioPacketCount <= 3) console.error('[Audio] audioDecoder is NULL'); // first 3 packets only
      return;
    }

    if (!audioDecoder.isReadyForAudio) {
      return;
    }

    if (audioDecoder.usingNative !== undefined) {
      try {
        audioDecoder.decode({ type: CHUNK_TYPE.KEY, timestamp: timestamp * TIMESTAMP_US_PER_MS, data: data.slice() });
      } catch (err) { console.error('[Audio] AAC decode error:', err); }
    } else {
      try {
        audioDecoder.decode(new EncodedAudioChunk({ timestamp: timestamp * TIMESTAMP_US_PER_MS, type: CHUNK_TYPE.KEY, data: data.slice() }));
      } catch (err) { console.error('[Audio] decode error:', err); }
    }
  }
}

// ------------------------------
// External video decoder port (iOS 15)
// ------------------------------

/**
 * Wire up the MessagePort that connects to the video-decoder-worker.
 * Decoded YUV frames arrive here and are forwarded to the main thread.
 */
function setupVideoDecoderPort(port) {
  port.onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
      case MSG.READY:
        proxyConsole.log("[Worker] Video decoder worker is ready");
        break;

      case MSG.CONFIGURED:
        proxyConsole.log(`[Worker] External video decoder configured for ${msg.channelName}`);
        break;

      case MSG.VIDEO_DATA: {
        // msg.frame = { format: 'yuv420', yPlane, uPlane, vPlane, width, height }
        const frame = msg.frame;
        if (frame && frame.yPlane && frame.uPlane && frame.vPlane) {
          // Forward directly to main thread without copying YUV buffers.
          // The video-decoder-worker already copies into preallocated buffers;
          // wrapping in another new Uint8Array() here is wasteful on Safari 15.
          self.postMessage({
            type: MSG.VIDEO_DATA,
            frame,
            quality: msg.channelName,
          });
        }
        break;
      }

      case MSG.ERROR:
        console.error(`[Worker] Video decoder worker error (${msg.channelName}):`, msg.message);
        // Reset keyframe flag so decoder waits for next keyframe
        if (msg.channelName) {
          setKeyFrameReceived(msg.channelName, false);
        }
        break;
    }
  };
}

/**
 * Send an encoded video chunk to the external video decoder worker.
 */
function decodeVideoExternal(channelName, type, timestamp, data) {
  if (!videoDecoderPort) return;
  if (data.byteLength === 0) return;
  // `data` is a Uint8Array VIEW into the original dataBuffer (from handleBinaryPacket).
  // We must create an isolated copy before transferring — transferring the shared
  // dataBuffer would detach it, making other accessors (audio path, etc.) throw.
  // data.slice() copies only the payload bytes (vs the old full dataBuffer.slice(9)
  // which also had to copy the 9-byte header region).
  const isolated = data.slice(); // Uint8Array.slice → new ArrayBuffer, payload only
  videoDecoderPort.postMessage({
    type: MSG.DECODE,
    channelName,
    chunk: {
      type,
      timestamp: timestamp * TIMESTAMP_US_PER_MS,
      data: isolated,
    },
  }, [isolated.buffer]);
}

/**
 * Send a configure command to the external video decoder worker.
 */
function configureVideoExternal(channelName, config) {
  if (!videoDecoderPort) return;
  videoDecoderPort.postMessage({
    type: MSG.CONFIGURE,
    channelName,
    config,
  });
}

// ------------------------------
// Decoder configuration
// ------------------------------

async function initializeDecoders() {
  proxyConsole.log("Initializing camera decoders for subscribe type:", subscribeType,
    "videoDecoderPort:", !!videoDecoderPort);

  switch (subscribeType) {
    case STREAM_TYPE.CAMERA: {
      // ── Audio decoder ──
      // When audioDecoderPort is active, audio decoding is handled by
      // the dedicated audio-decoder-worker — skip local decoder creation.
      if (!audioDecoderPort) {
        const micAudioDecoder = new OpusAudioDecoder(audioInit);
        const audioConfigPromise = micAudioDecoder.configure({ sampleRate: AUDIO_FORMAT.SAMPLE_RATE_48K, numberOfChannels: AUDIO_FORMAT.MONO_CHANNELS, decoderPort: externalDecoderPort });
        mediaDecoders.set(CHANNEL_NAME.MIC_48K, micAudioDecoder);
        await audioConfigPromise;
        proxyConsole.log('[Audio] OpusDecoder configured, state:', micAudioDecoder.state,
          'mode:', micAudioDecoder.useInlineDecoder ? 'inline' : 'worker');
      } else {
        proxyConsole.log('[Audio] Audio decoding offloaded to audio-decoder-worker');
      }

      // ── Video decoders ──
      if (videoDecoderPort) {
        proxyConsole.log('[Worker] Video decoding offloaded to external video decoder worker');
      } else {
        // Normal path: create local video decoders (native or WASM fallback)
        const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.CAM_360P);
        const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.CAM_720P);
        const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
        mediaDecoders.set(CHANNEL_NAME.CAM_360P, decoder360p);
        mediaDecoders.set(CHANNEL_NAME.CAM_720P, decoder720p);
      }
      break;
    }

    case STREAM_TYPE.SCREEN_SHARE: {
      if (videoDecoderPort) {
        proxyConsole.log('[Worker] Screen share video decoding offloaded to external worker');
      } else {
        // Use same native/WASM fallback logic as camera path
        const screenDecoder = await createVideoDecoderWithFallback(CHANNEL_NAME.SCREEN_SHARE_720P);
        mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, screenDecoder);
      }
      if (!audioDecoderPort) {
        mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_AUDIO, new OpusAudioDecoder(audioInit));
      } else {
        proxyConsole.log('[Audio] Screen share audio decoding offloaded to audio-decoder-worker');
      }
      proxyConsole.warn(
        "Initialized screen share decoders:",
        mediaDecoders,
        "video channel",
        CHANNEL_NAME.SCREEN_SHARE_720P,
        "audio channel",
        CHANNEL_NAME.SCREEN_SHARE_AUDIO
      );
      break;
    }

    default: {
      // ── Audio decoder ──
      if (!audioDecoderPort) {
        const defaultMicAudioDecoder = new OpusAudioDecoder(audioInit);
        const audioConfigPromise = defaultMicAudioDecoder.configure({ sampleRate: AUDIO_FORMAT.SAMPLE_RATE_48K, numberOfChannels: AUDIO_FORMAT.MONO_CHANNELS, decoderPort: externalDecoderPort });
        mediaDecoders.set(CHANNEL_NAME.MIC_48K, defaultMicAudioDecoder);
        await audioConfigPromise;
      } else {
        proxyConsole.log('[Audio] Audio decoding offloaded to audio-decoder-worker');
      }

      // ── Video decoders ──
      if (videoDecoderPort) {
        proxyConsole.log('[Worker] Video decoding offloaded to external video decoder worker');
      } else {
        const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.CAM_360P);
        const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.CAM_720P);
        const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
        mediaDecoders.set(CHANNEL_NAME.CAM_360P, decoder360p);
        mediaDecoders.set(CHANNEL_NAME.CAM_720P, decoder720p);
      }
      break;
    }
  }
}
// function configureVideoDecoders(channelName) {
//   const config = mediaConfigs.get(channelName);
//   if (!config) return;

//   try {
//     const decoder = mediaDecoders.get(channelName);
//     if (decoder.state === "unconfigured") {
//       decoder.configure(config);
//       // videoFrameRate = config.frameRate;
//     }

//     self.postMessage({
//       type: "codecReceived",
//       stream: "video",
//       channelName,
//       config,
//     });
//   } catch (error) {
//     proxyConsole.error("Failed to configure video decoder:", error);
//   }
// }

// ------------------------------
// Bitrate Switching
// ------------------------------

async function handleBitrateSwitch(channelName) {
  if (channelName === currentVideoChannel) {
    proxyConsole.log(`[Bitrate] Already at ${channelName}, no switch needed.`);
    return;
  }

  if (isWebRTC) {
    await handleWebRTCBitrateSwitch(channelName);
  } else {
    await handleWebTransportBitrateSwitch(channelName);
  }
}

async function handleWebRTCBitrateSwitch(targetChannelName) {
  try {
    const currentChannel = webRtcDataChannels.get(currentVideoChannel);
    const targetChannel = webRtcDataChannels.get(targetChannelName);

    if (!targetChannel || targetChannel.readyState !== "open") {
      proxyConsole.warn(`[Bitrate] Target channel cam_${targetChannelName} not ready.`);
      return;
    }

    const encoder = new TextEncoder();

    if (currentChannel && currentChannel.readyState === "open") {
      proxyConsole.log(`[Bitrate] Sending "pause" to currentQuality`);
      currentChannel.send(encoder.encode(BITRATE_CMD.PAUSE));
    }

    if (targetChannel.readyState === "open") {
      proxyConsole.log(`[Bitrate] Sending "resume" to ${targetChannelName}`);
      targetChannel.send(encoder.encode(BITRATE_CMD.RESUME));
    }

    currentVideoChannel = targetChannelName;
    setKeyFrameReceived(targetChannelName, false);

    self.postMessage({
      type: MSG.BITRATE_CHANGED,
      quality: targetChannelName,
    });

    proxyConsole.log(`[Bitrate] Switched to ${targetChannelName}`);
  } catch (err) {
    proxyConsole.error(`[Bitrate] Failed to switch to ${targetChannelName}:`, err);
    self.postMessage({
      type: MSG.ERROR,
      message: `Failed to switch bitrate: ${err.message}`,
    });
  }
}

async function handleWebTransportBitrateSwitch(targetChannelName) {
  const currentStream = channelStreams.get(currentVideoChannel);
  const targetStream = channelStreams.get(targetChannelName);

  if (!targetStream) {
    proxyConsole.warn(`[Bitrate] Target stream cam_${targetChannelName} not attached.`);
    return;
  }

  try {
    const encoder = new TextEncoder();

    if (currentStream && currentStream.writer) {
      proxyConsole.log(`[Bitrate] Sending "pause" to cam_${currentVideoChannel}`);
      await currentStream.writer.write(encoder.encode(BITRATE_CMD.PAUSE));
    }

    if (targetStream && targetStream.writer) {
      proxyConsole.log(`[Bitrate] Sending "resume" to cam_${quality}`);
      await targetStream.writer.write(encoder.encode(BITRATE_CMD.RESUME));
    }

    currentVideoChannel = quality;
    setKeyFrameReceived(quality, false);

    self.postMessage({
      type: MSG.BITRATE_CHANGED,
      quality,
    });

    proxyConsole.log(`[Bitrate] Switched to ${quality}`);
  } catch (err) {
    proxyConsole.error(`[Bitrate] Failed to switch to ${quality}:`, err);
    self.postMessage({
      type: MSG.ERROR,
      message: `Failed to switch bitrate: ${err.message}`,
    });
  }
}

// ------------------------------
// Maintenance
// ------------------------------

function resetDecoders() {
  if (videoDecoder360p) videoDecoder360p.reset();
  if (videoDecoder720p) videoDecoder720p.reset();
  // if (audioDecoder) audioDecoder.reset();

  // videoCodecReceived = false;
  // audioCodecReceived = false;
  resetAllKeyFrameFlags();

  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  self.postMessage({
    type: MSG.LOG,
    event: MSG.RESET_EVENT,
    message: "Reset all decoders",
  });
}

function stopAll() {
  // Destroy jitter buffer and its setInterval timer (critical — prevents lingering timers after stop)
  if (videoJitterBuffer) {
    videoJitterBuffer.destroy();
    videoJitterBuffer = null;
  }



  if (workletPort) {
    workletPort.postMessage({ type: MSG.STOP_EVENT });
    workletPort = null;
  }

  // Close WebRTC connections
  if (isWebRTC) {
    for (const [name, channel] of webRtcDataChannels.entries()) {
      try {
        channel.close();
      } catch (e) {
        proxyConsole.error(`Error closing channel ${name}:`, e);
      }
    }
    webRtcDataChannels.clear();

    if (webRtcConnection) {
      webRtcConnection.close();
      webRtcConnection = null;
    }
  }

  // Close WebTransport streams
  for (const { reader, writer } of channelStreams.values()) {
    try {
      reader.cancel();
      writer.close();
    } catch { }
  }
  channelStreams.clear();

  // Close external video decoder port
  if (videoDecoderPort) {
    try {
      videoDecoderPort.postMessage({ type: MSG.RESET_ALL });
      videoDecoderPort.close();
    } catch { }
    videoDecoderPort = null;
  }

  mediaDecoders.forEach((decoder) => {
    try {
      decoder.close();
    } catch { }
  });
  mediaDecoders.clear();
  mediaConfigs.clear();

  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  if (isWebSocket) {
    try {
      if (
        webSocketConnection.readyState === WebSocket.OPEN ||
        webSocketConnection.readyState === WebSocket.CONNECTING
      ) {
        webSocketConnection.close();
      }
    } catch (e) {
      proxyConsole.error(`Error closing WebSocket:`, e);
    }
  }

  self.postMessage({
    type: MSG.LOG,
    event: MSG.STOP_EVENT,
    message: "Stopped all media operations",
  });
}

// ------------------------------
// Utility
// ------------------------------

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

class LengthDelimitedReader {
  constructor(reader) {
    this.reader = reader;
    this.buffer = new Uint8Array(0);
  }

  appendBuffer(newData) {
    // Guard against unbounded memory growth on stalled/slow streams (Safari 15 critical)
    const MAX_BUFFER_BYTES = LIMITS.MAX_BUFFER_BYTES;
    if (this.buffer.length + newData.length > MAX_BUFFER_BYTES) {
      console.error('[LDReader] Buffer overflow (>' + MAX_BUFFER_BYTES + ' bytes), resetting. Possible stall?');
      this.buffer = new Uint8Array(0);
    }
    const combined = new Uint8Array(this.buffer.length + newData.length);
    combined.set(this.buffer);
    combined.set(newData, this.buffer.length);
    this.buffer = combined;
  }

  async readMessage() {
    while (true) {
      if (this.buffer.length >= BINARY.LENGTH_PREFIX_SIZE) {
        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, BINARY.LENGTH_PREFIX_SIZE);
        const messageLength = view.getUint32(0, false);

        const totalLength = BINARY.LENGTH_PREFIX_SIZE + messageLength;
        if (this.buffer.length >= totalLength) {
          const message = this.buffer.slice(BINARY.LENGTH_PREFIX_SIZE, totalLength);
          this.buffer = this.buffer.slice(totalLength);

          return message;
        }
      }

      const { value, done } = await this.reader.read();
      if (done) {
        if (this.buffer.length > 0) {
          throw new Error("Stream ended with incomplete message");
        }
        return null;
      }

      this.appendBuffer(value);
    }
  }
}
