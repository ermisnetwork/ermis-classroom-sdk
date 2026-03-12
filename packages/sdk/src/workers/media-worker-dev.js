import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, STREAM_TYPE } from "./publisherConstants.js";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";
import { AACDecoder } from "../codec-polyfill/audio-codec-polyfill.js";
import raptorqInit, { WasmFecManager } from '../raptorQ/raptorq_wasm.js';

import CommandSender from "./ClientCommand.js";

// ── Jitter Buffer feature flags ──
const USE_VIDEO_JITTER_BUFFER = false;
const USE_SCREEN_SHARE_JITTER_BUFFER = false;

let subscribeType = STREAM_TYPE.CAMERA;

let currentVideoChannel = CHANNEL_NAME.VIDEO_360P;

let workletPort = null;
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

/** @type {WasmFecManager|null} Single shared FEC manager for all channels */
let fecManager = null;
let isRaptorQInitialized = false;

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
  isRaptorQInitialized = true;
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
  await decoder.configure({ codec: 'avc1.42001f' });
  return decoder;
}

// Helper: Create decoder with fallback
async function createVideoDecoderWithFallback(channelName) {
  try {
    const nativeSupported = await isNativeH264DecoderSupported();
    console.log(`[VideoDecoder] Native H264 decoder supported: ${nativeSupported}`, "type of VideoDecoder", typeof VideoDecoder);
    if (nativeSupported) {
      console.log(`[VideoDecoder] ✅ Using NATIVE decoder for ${channelName}`);
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
        self.postMessage({ type: "videoData", frame, quality: channelName }, [frame]);
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
          type: "videoData", 
          frame: { 
            format: 'yuv420',
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
      type: 'error',
      message: `${channelName} decoder: ${e.message}`,
    });
    // Attempt to recover by resetting keyframe flag - next keyframe will reinitialize decoder
    setKeyFrameReceived(channelName, false);
    proxyConsole.warn(`[Recovery] Reset keyframe flag for ${channelName} decoder, waiting for next keyframe`);
  },
});

const audioInit = {
  output: (audioData) => {
    // Always close AudioData in finally to prevent memory leak even if an error occurs
    try {
      const channelData = [];
   
      // if mono, duplicate to create stereo  
      if (audioData.numberOfChannels === 1) {
        const monoChannel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(monoChannel, { planeIndex: 0, format: 'f32-planar' });
        channelData.push(monoChannel);
        channelData.push(new Float32Array(monoChannel));
      } else {
        for (let i = 0; i < audioData.numberOfChannels; i++) {
          const channel = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(channel, { planeIndex: i, format: 'f32-planar' });
          channelData.push(channel);
        }
      }
    

      if (workletPort) {
        // Log first few frames and sample values to verify data integrity
        workletPort.postMessage(
          {
            type: "audioData",
            channelData,
            timestamp: audioData.timestamp,
            sampleRate: audioData.sampleRate,
            numberOfFrames: audioData.numberOfFrames,
            numberOfChannels: audioData.numberOfChannels,
          },
          channelData.map((c) => c.buffer),
        );
      } else {
        console.error('[Audio] workletPort is NULL, cannot send audio data');
      }
    } finally {
      // Must always close AudioData to release underlying memory (Safari 15 critical)
      try { audioData.close(); } catch { /* ignore */ }
    }
  },
  error: (e) => {
    self.postMessage({ type: 'error', message: e.message });
  },
};

// ------------------------------
// Main entry
// ------------------------------

self.onmessage = async function (e) {
  const { type, port, quality, readable, writable, channelName, dataChannel, wsUrl, localStreamId } = e.data;

  switch (type) {
    case "init":
      protocol = e.data.protocol;
      if (protocol === 'webrtc') {
        await initRaptorQWasm();
        this.postMessage({ type: 'raptorq-initialized' });
      }
      if (e.data.enableLogging) {
        const methods = ['log', 'error', 'warn', 'debug', 'info', 'trace', 'group', 'groupEnd'];
        for (const m of methods) {
          if (console[m]) proxyConsole[m] = console[m].bind(console);
        }
      }
      if (port instanceof MessagePort) workletPort = port;
      subscribeType = e.data.subscribeType || STREAM_TYPE.CAMERA;
      // Get audioEnabled from init message - for screen share, this determines if we should subscribe to audio
      subscriptionAudioEnabled = e.data.audioEnabled !== undefined ? e.data.audioEnabled : true;
      initialQuality = e.data.initialQuality;
      externalDecoderPort = e.data.decoderPort || null;
      videoDecoderPort = e.data.videoDecoderPort || null;
      if (videoDecoderPort) {
        setupVideoDecoderPort(videoDecoderPort);
      }
      console.log(`[Worker] Init with subscribeType=${subscribeType}, audioEnabled=${subscriptionAudioEnabled}, initialQuality=${initialQuality}, workletPort=${workletPort}, hasDecoderPort=${!!externalDecoderPort}, hasVideoDecoderPort=${!!videoDecoderPort}`);
      try {
        await initializeDecoders();
        console.log(`[Worker] Decoders initialized successfully`);
      } catch (err) {
        console.error(`[Worker] Decoder initialization failed:`, err);
      }
      break;

    case "attachWebSocket":
      if (wsUrl) {
        commandSender = new CommandSender({
          localStreamId,
          sendDataFn: sendOverWebSocket,
          protocol: "websocket",
          commandType: "subscriber_command",
        });

        isWebSocket = true;
        attachWebSocket(e.data.wsUrl);
      }
      break;

    case "attachWebTransportUrl":
      // Worker creates the WebTransport session itself so we can directly
      // call incomingUnidirectionalStreams.getReader() following the MDN pattern,
      // without any postMessage transfer issues.
      if (e.data.url) {
        commandSender = new CommandSender({
          localStreamId: e.data.localStreamId,
          sendDataFn: sendOverStream,
          protocol: "webtransport",
          commandType: "subscriber_command",
        });
        proxyConsole.warn(`[Worker] Connecting WebTransport inside worker: ${e.data.url}`);
        attachWebTransportFromUrl(e.data.url, e.data.channelName).catch((err) => {
          console.error('[Worker] attachWebTransportFromUrl error:', err);
        });
      }
      break;

    case "attachStream":
      if (readable && writable) {
        commandSender = new CommandSender({
          localStreamId,
          sendDataFn: sendOverStream,
          protocol: "webtransport",
          commandType: "subscriber_command",
        });
        proxyConsole.warn(`[Publisher worker]: Attaching WebTransport stream!`);
        attachWebTransportStream(readable, writable, channelName);
      }
      break;

    case "attachDataChannel":
      if (channelName && dataChannel) {
        proxyConsole.warn(`[Publisher worker]: Attaching WebRTC data channel for ${channelName}`);
        attachWebRTCDataChannel(channelName, dataChannel);

        // Initialize commandSender for WebRTC if not already done
        if (!commandSender) {
          commandSender = new CommandSender({
            localStreamId,
            sendDataFn: sendOverDataChannel,
            protocol: "websocket", // uses string JSON format (non-webtransport path)
            commandType: "subscriber_command",
          });
        }
      }
      break;

    case "toggleAudio":
      audioEnabled = !audioEnabled;
      self.postMessage({ type: "audio-toggled", audioEnabled });
      break;

    case "switchBitrate":
      handleBitrateSwitch(quality);
      break;
    
    case "startStream":
      if (commandSender) commandSender.startStream();
      break;

    case "stopStream":
      if (commandSender) commandSender.stopStream();
      break;

    case "pauseStream":
      resetAllKeyFrameFlags(); // Reset so decoder waits for keyframe on resume
      if (commandSender) commandSender.pauseStream();
      break;

    case "resumeStream":
      if (self._audioReorderBuffer) self._audioReorderBuffer.reset();
      self._lastAudioSeq = undefined;
      if (commandSender) commandSender.resumeStream();
      break;

    case "reset":
      resetDecoders();
      break;

    case "stop":
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
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(initData, 4);

    channel.send(out);
    console.log(`[WebRTC] Sent subscribe message for ${channelName}`);
  };

  channel.onclose = () => {
    proxyConsole.log(`[WebRTC] Data channel closed: ${channelName}`);
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
    if ((name.startsWith('video_') || (name.startsWith('screen_share_') && !name.includes('audio'))) && channel.readyState === 'open') {
      try {
        channel.send(json);
        proxyConsole.warn(`[WebRTC] Sent command to ${name}: ${json}`);
      } catch (error) {
        proxyConsole.error(`[WebRTC] Failed to send command to ${name}:`, error);
      }
    }
  }
}

// ======================================
// Jitter Buffer for WebRTC packet reordering
// ======================================
class JitterBuffer {
  constructor(options = {}) {
    this.buffer = new Map(); // sequenceNumber -> { data, timestamp }
    this.lastProcessedSeq = -1;
    this.maxBufferSize = options.maxBufferSize || 50;
    this.maxWaitMs = options.maxWaitMs || 100; // Max time to wait for missing packet
    this.flushIntervalMs = options.flushIntervalMs || 50;
    this.onPacketReady = options.onPacketReady || (() => {});
    
    // Start periodic flush timer
    this.flushTimer = setInterval(() => this.flushStalePackets(), this.flushIntervalMs);
  }

  /**
   * Add a packet to the buffer
   * @param {number} sequenceNumber 
   * @param {Uint8Array} data 
   */
  addPacket(sequenceNumber, data) {
    const now = Date.now();
    
    // If this is the first packet or the expected next packet
    if (this.lastProcessedSeq === -1) {
      this.lastProcessedSeq = sequenceNumber - 1;
    }

    // If packet is too old (already processed or too far behind), drop it
    if (sequenceNumber <= this.lastProcessedSeq) {
      // console.log(`[JitterBuffer] Dropping old packet seq=${sequenceNumber}, lastProcessed=${this.lastProcessedSeq}`);
      return;
    }

    // If it's the next expected packet, process immediately
    if (sequenceNumber === this.lastProcessedSeq + 1) {
      this.lastProcessedSeq = sequenceNumber;
      this.onPacketReady(data);
      
      // Try to flush any buffered packets that are now in order
      this.flushBufferedPackets();
      return;
    }

    // Otherwise, buffer the packet for reordering
    this.buffer.set(sequenceNumber, { data, timestamp: now });

    // If buffer is too large, force flush oldest packets
    if (this.buffer.size > this.maxBufferSize) {
      this.forceFlushOldest();
    }
  }

  /**
   * Flush buffered packets that are now in order
   */
  flushBufferedPackets() {
    let nextSeq = this.lastProcessedSeq + 1;
    
    while (this.buffer.has(nextSeq)) {
      const packet = this.buffer.get(nextSeq);
      this.buffer.delete(nextSeq);
      this.lastProcessedSeq = nextSeq;
      this.onPacketReady(packet.data);
      nextSeq++;
    }
  }

  /**
   * Flush packets that have been waiting too long
   */
  flushStalePackets() {
    if (this.buffer.size === 0) return;
    
    const now = Date.now();
    const staleThreshold = now - this.maxWaitMs;
    
    // Find the minimum sequence number in buffer
    let minSeq = Infinity;
    for (const seq of this.buffer.keys()) {
      if (seq < minSeq) minSeq = seq;
    }
    
    // Check if the oldest packet is stale
    if (minSeq !== Infinity) {
      const packet = this.buffer.get(minSeq);
      if (packet && packet.timestamp < staleThreshold) {
        // Skip the missing packets and process from minSeq
        console.warn(`[JitterBuffer] Skipping missing packets ${this.lastProcessedSeq + 1} to ${minSeq - 1}, forcing flush`);
        this.lastProcessedSeq = minSeq - 1;
        this.flushBufferedPackets();
      }
    }
  }

  /**
   * Force flush the oldest packets when buffer is full
   */
  forceFlushOldest() {
    // Sort sequence numbers and get the oldest
    const seqNumbers = Array.from(this.buffer.keys()).sort((a, b) => a - b);
    
    // Flush half of the buffer
    const flushCount = Math.floor(seqNumbers.length / 2);
    for (let i = 0; i < flushCount; i++) {
      const seq = seqNumbers[i];
      const packet = this.buffer.get(seq);
      this.buffer.delete(seq);
      
      if (seq > this.lastProcessedSeq) {
        this.lastProcessedSeq = seq;
        this.onPacketReady(packet.data);
      }
    }
    console.warn(`[JitterBuffer] Buffer overflow, force flushed ${flushCount} packets`);
  }

  /**
   * Get buffer stats for debugging
   */
  getStats() {
    return {
      bufferSize: this.buffer.size,
      lastProcessedSeq: this.lastProcessedSeq,
      pendingSeqs: Array.from(this.buffer.keys()).sort((a, b) => a - b),
    };
  }

  /**
   * Clear the buffer and reset state
   */
  reset() {
    this.buffer.clear();
    this.lastProcessedSeq = -1;
  }

  /**
   * Stop the flush timer
   */
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer.clear();
  }
}

// Create jitter buffers for video and screen share packets
let videoJitterBuffer = null;
let screenShareJitterBuffer = null;

function initVideoJitterBuffer() {
  if (videoJitterBuffer) {
    videoJitterBuffer.destroy();
  }
  videoJitterBuffer = new JitterBuffer({
    maxBufferSize: 30,
    maxWaitMs: 100,
    flushIntervalMs: 50,
    onPacketReady: (data) => {
      processIncomingMessage(data);
    },
  });
}

function initScreenShareJitterBuffer() {
  if (screenShareJitterBuffer) {
    screenShareJitterBuffer.destroy();
  }
  screenShareJitterBuffer = new JitterBuffer({
    maxBufferSize: 30,
    maxWaitMs: 100,
    flushIntervalMs: 50,
    onPacketReady: (data) => {
      processIncomingMessage(data);
    },
  });
}

/**
 * Check if a channel name is a video or screen share channel (not audio/control)
 */
function isVideoChannel(channelName) {
  return channelName.startsWith('video_') || 
         (channelName.startsWith('screen_share_') && !channelName.includes('audio'));
}

/**
 * Get the appropriate jitter buffer for a channel, initializing if needed
 */
function getJitterBufferForChannel(channelName) {
  if (USE_VIDEO_JITTER_BUFFER && channelName.startsWith('video_')) {
    if (!videoJitterBuffer) initVideoJitterBuffer();
    return videoJitterBuffer;
  }
  if (USE_SCREEN_SHARE_JITTER_BUFFER && channelName.startsWith('screen_share_') && !channelName.includes('audio')) {
    if (!screenShareJitterBuffer) initScreenShareJitterBuffer();
    return screenShareJitterBuffer;
  }
  return null;
}

let fecDisabled = false; // Set to true after first WASM crash to avoid repeated errors

function handleWebRtcMessage(channelName, message) {
    const { sequenceNumber, isFec, packetType, payload } = parseWebRTCPacket(new Uint8Array(message));
    
    const jitterBuffer = getJitterBufferForChannel(channelName);

    if (isFec) {
      const channelFecManager = getOrCreateFecManager(channelName);
      const result = channelFecManager.process_fec_packet(payload, sequenceNumber);
      if (result) {
        const decodedData = result[0][1];
        if (jitterBuffer) {
          jitterBuffer.addPacket(sequenceNumber, decodedData);
        } else {
          processIncomingMessage(decodedData);
        }
        return;
      }
    } else {
      if (jitterBuffer) {
        jitterBuffer.addPacket(sequenceNumber, payload);
      } else {
        processIncomingMessage(payload);
      }
    }
}

function parseWebRTCPacket(packet) {
  if (packet.length < 6) {
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
  // const payload = packet.subarray(6);
  const payload = packet.slice(6);

  return {
    sequenceNumber,
    isFec: fecFlag === 0xff,
    packetType,
    payload,
  };
}

function handleStreamConfigs(json) {
  if (json.type !== "DecoderConfigs") return;

  for (const [key, value] of Object.entries(json)) {
    if (key === "type") continue;

    try {
      const stream = (typeof value === "string") ? JSON.parse(value) : value;
      if (!stream || stream.type !== "StreamConfig") continue;

      const channelName = stream.channelName;
      const cfg = stream.config;
      const desc = base64ToUint8Array(cfg.description);

      proxyConsole.log(`Configuring decoder for ${key} (${channelName})`, { cfg });
      if (stream.mediaType === "video") {
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
      } else if (stream.mediaType === "audio") {
        const audioConfig = {
          codec: cfg.codec,
          sampleRate: cfg.sampleRate,
          numberOfChannels: cfg.numberOfChannels,
          description: desc,
        };

        mediaConfigs.set(channelName, audioConfig);

        const isAAC = cfg.codec === "mp4a.40.2";

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
            console.log(`[Audio] AAC ASC bytes for ${channelName}: [${Array.from(desc).map(b => b.toString(16).padStart(2, '0')).join(' ')}], len=${desc.length}`);
          } else {
            console.warn(`[Audio] ⚠️ No ASC description for AAC channel ${channelName}`);
          }

          aacDecoder.configure({
            codec: 'mp4a.40.2',
            sampleRate: cfg.sampleRate,
            numberOfChannels: cfg.numberOfChannels,
            description: desc, // AudioSpecificConfig
          }).then(() => {
            aacDecoder.isReadyForAudio = true;
            console.log(`[Audio] AACDecoder configured for ${channelName} — using ${aacDecoder.usingNative ? 'native WebCodecs' : 'FAAD2 WASM'}, state: ${aacDecoder.state}`);
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
                  console.log(`[Audio] configured successfully for ${channelName}, result:`, configResult, "state:", decoder.state);
                  // Wait for the decoder worker's WASM to be truly ready instead
                  // of relying on a hardcoded delay (which was unreliable on slow
                  // iOS 15 devices).
                  return decoder.waitForReady(5000);
                })
                .then(() => {
                  try {
                    console.log(`[Audio] Decoder WASM ready for ${channelName}, sending description chunk`);

                    const dataView = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
                    const timestamp = dataView.getUint32(4, false);
                    const data = desc.slice(9);

                    const chunk = new EncodedAudioChunk({
                      timestamp: timestamp * 1000,
                      type: "key",
                      data,
                    });
                    decoder.decode(chunk);
                    decoder.isReadyForAudio = true; // Flag to allow normal packets
                    console.log(`[Audio] Sent description chunk for ${channelName}, now ready for audio packets`);

                    // Replay any audio packets that arrived before the description
                    if (decoder._preConfigBuffer && decoder._preConfigBuffer.length > 0) {
                      console.log(`[Audio] Replaying ${decoder._preConfigBuffer.length} pre-config buffered packets for ${channelName}`);
                      for (const buffered of decoder._preConfigBuffer) {
                        try {
                          const bufferedChunk = new EncodedAudioChunk({
                            timestamp: buffered.timestamp * 1000,
                            type: "key",
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
  console.log('[WebTransport] Session ready inside worker');

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
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(frameBytes, 4);
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
// Audio Reorder Buffer
// ======================================

/**
 * Lightweight reorder buffer for audio packets.
 *
 * The server broadcasts audio from overlapping GOP tasks, which can cause
 * small out-of-order delivery (typically 2-packet swaps at batch boundaries).
 * This buffer collects a small window of packets and emits them sorted by
 * sequence number, restoring correct order before decoding.
 *
 * Design:
 *  - BUFFER_SIZE = 3: sufficient for the observed 2-packet swap pattern
 *  - FLUSH_TIMEOUT = 60ms (~3 audio frames at 20ms): ensures packets are
 *    not held indefinitely if a true loss occurs
 *  - When the buffer is full OR the next expected seq arrives, packets are
 *    flushed in order immediately (zero added latency in the common path)
 */
class AudioReorderBuffer {
  constructor(onEmit) {
    this._onEmit = onEmit;      // callback(seq, timestamp, data) for each ordered packet
    this._buffer = [];           // [{seq, timestamp, data}, ...]
    this._nextExpectedSeq = -1;  // -1 = not initialized
    this._flushTimer = null;
    this.BUFFER_SIZE = 3;
    this.FLUSH_TIMEOUT_MS = 60;
  }

  /**
   * Push a packet into the reorder buffer.
   * @param {number} seq - sequence number
   * @param {number} timestamp - media timestamp
   * @param {Uint8Array} data - audio payload
   */
  push(seq, timestamp, data) {
    // First packet: initialize expected sequence
    if (this._nextExpectedSeq === -1) {
      this._nextExpectedSeq = seq;
    }

    // Insert into buffer (keep sorted by seq for efficient flush)
    this._buffer.push({ seq, timestamp, data });

    // Try to flush consecutive packets starting from _nextExpectedSeq
    this._tryFlush();

    // If buffer still has items, set a timeout to force-flush
    // (handles true packet loss — don't hold packets forever)
    this._resetTimer();
  }

  /** Emit all consecutive packets starting from _nextExpectedSeq. */
  _tryFlush() {
    if (!this._onEmit || this._buffer.length === 0) return;

    // Sort buffer by sequence number
    this._buffer.sort((a, b) => a.seq - b.seq);

    // Emit consecutive packets from the front
    while (this._buffer.length > 0) {
      const head = this._buffer[0];

      if (head.seq === this._nextExpectedSeq) {
        // Expected packet — emit immediately
        this._buffer.shift();
        this._nextExpectedSeq = head.seq + 1;
        this._onEmit(head.seq, head.timestamp, head.data);
      } else if (head.seq < this._nextExpectedSeq) {
        // Duplicate or late packet we already emitted — drop
        this._buffer.shift();
      } else if (this._buffer.length >= this.BUFFER_SIZE) {
        // Buffer full but expected seq hasn't arrived — it's truly lost.
        // Skip to the smallest seq in the buffer and emit from there.
        this._nextExpectedSeq = head.seq;
        // Continue the loop to emit this packet
      } else {
        // Gap exists but buffer isn't full yet — wait for more packets
        break;
      }
    }
  }

  /** Reset the flush timeout timer. */
  _resetTimer() {
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._buffer.length > 0) {
      this._flushTimer = setTimeout(() => {
        this._forceFlush();
      }, this.FLUSH_TIMEOUT_MS);
    }
  }

  /** Force-flush all buffered packets (timeout path). */
  _forceFlush() {
    this._flushTimer = null;
    if (!this._onEmit || this._buffer.length === 0) return;

    this._buffer.sort((a, b) => a.seq - b.seq);
    while (this._buffer.length > 0) {
      const pkt = this._buffer.shift();
      if (pkt.seq >= this._nextExpectedSeq) {
        this._nextExpectedSeq = pkt.seq + 1;
        this._onEmit(pkt.seq, pkt.timestamp, pkt.data);
      }
      // else: stale duplicate — drop
    }
  }

  /** Reset state (e.g. on stream restart). */
  reset() {
    this._buffer = [];
    this._nextExpectedSeq = -1;
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /** Destroy the buffer — clears timer and prevents any further callbacks. */
  destroy() {
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._buffer = [];
    this._onEmit = null;
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
    this.buf = new Uint8Array(0);
    this.done = false;
  }

  /**
   * Read exactly `size` bytes. Returns null if the stream ended.
   */
  async readExact(size) {
    while (this.buf.length < size) {
      if (this.done) return null;
      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        // Stream closed before we got enough bytes
        return this.buf.length >= size ? this._consume(size) : null;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    return this._consume(size);
  }

  _consume(size) {
    const out = this.buf.slice(0, size);
    this.buf = this.buf.slice(size);
    return out;
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
  console.log('[GOP] 🎬 receiveUnidirectional: starting GOP stream listener');
  let gopCount = 0;
  const reader = transport.incomingUnidirectionalStreams.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.warn('[GOP] incomingUnidirectionalStreams closed');
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
  try {
    // ── 1. GOP Header ────────────────────────────────────────────────────
    const streamIdLenBytes = await byteReader.readExact(2);
    if (!streamIdLenBytes) return;
    const streamIdLen = new DataView(streamIdLenBytes.buffer).getUint16(0, false);

    const gopMeta = await byteReader.readExact(streamIdLen + 1 + 4 + 2);
    if (!gopMeta) return;

    const streamId = new TextDecoder().decode(gopMeta.subarray(0, streamIdLen));
    const dv = new DataView(gopMeta.buffer, gopMeta.byteOffset, gopMeta.byteLength);
    let off = streamIdLen;
    channel = dv.getUint8(off); off += 1;
    gopId = dv.getUint32(off, false); off += 4;
    const expectedFrames = dv.getUint16(off, false);

    // Register this GOP as the active one for its channel.
    // Any older GOP for this channel will detect it's been superseded.
    // const prevGopId = activeGopPerChannel.get(channel);
    activeGopPerChannel.set(channel, gopId);

    // if (prevGopId !== undefined && prevGopId !== gopId) {
    //   console.log(`[GOP] ch=${channel} new gopId=${gopId} supersedes old gopId=${prevGopId}`);
    // }

    if (gopIndex <= 3) {
      console.log(`[GOP] #${gopIndex} streamId=${streamId} ch=${channel} gopId=${gopId} expected=${expectedFrames}`);
    }

    // ── 2. Frame loop ────────────────────────────────────────────────────
    const FRAME_HEADER_SIZE = 13; // sequence(4)+timestamp(4)+frameType(1)+payloadSize(4)
    let frameCount = 0;
    while (true) {
      const headerBytes = await byteReader.readExact(FRAME_HEADER_SIZE);
      if (!headerBytes) break; // stream ended — normal GOP completion

      const fv = new DataView(headerBytes.buffer, headerBytes.byteOffset, FRAME_HEADER_SIZE);
      const payloadSize = fv.getUint32(9, false);

      // Guard against binary misalignment: if the frame header was read at a wrong
      // offset, payloadSize will be nonsensical. A real frame is never 0 bytes and
      // never exceeds 10 MB (typical 1080p keyframe ~100-400 KB). If this fires,
      // all subsequent reads would also be misaligned → break out of the GOP entirely.
      if (payloadSize === 0 || payloadSize > 10_000_000) {
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
        rawReader.cancel().catch(() => {});
        break;
      }

      // Reconstruct full packet: [seq:4][ts:4][frameType:1] + media_payload
      // handleBinaryPacket() expects this 9-byte prefix to route to the correct decoder.
      const fullPacket = new Uint8Array(9 + payload.length);
      fullPacket.set(headerBytes.subarray(0, 9), 0);  // seq + ts + frameType from FrameHeader
      fullPacket.set(payload, 9);
      await processIncomingMessage(fullPacket);
    }


  } catch (err) {
    // Suppress errors from cancelled streams (expected when superseded)
    if (activeGopPerChannel.get(channel) !== gopId) {
      // This GOP was superseded — cancellation errors are expected
      return;
    }
    proxyConsole.error(`[GOP] readGopStream #${gopIndex} error:`, err);
  }
}

/**
 * Handle a single incoming GOP unidirectional stream.
 *
 * Wire format written by GopStreamSender / GopStreamHeaderEncoder:
 *
 *  GOP Header (variable):
 *    [streamIdLen: 2B big-endian]
 *    [streamId:   N bytes UTF-8]
 *    [channel:    1B]
 *    [gopId:      4B big-endian]
 *    [expected:   2B big-endian]
 *
 *  Then, for each frame (FrameHeaderEncoder.SIZE = 13):
 *    [sequence:   4B big-endian]
 *    [timestamp:  4B big-endian]
 *    [frameType:  1B]
 *    [payloadSz:  4B big-endian]
 *    [payload:    payloadSz bytes]  ← same binary packet format as bidi stream
 */
async function handleGopStream(stream, gopIndex) {
  const reader = stream.getReader();
  const byteReader = new GopByteReader(reader);

  try {
    // ── 1. Parse GOP Header ──────────────────────────────────────────────
    const streamIdLenBytes = await byteReader.readExact(2);
    if (!streamIdLenBytes) return;
    const streamIdLen = new DataView(streamIdLenBytes.buffer).getUint16(0, false);

    // streamId(N) + channel(1) + gopId(4) + expectedFrames(2)
    const gopMeta = await byteReader.readExact(streamIdLen + 1 + 4 + 2);
    if (!gopMeta) return;

    const streamId = new TextDecoder().decode(gopMeta.subarray(0, streamIdLen));
    let off = streamIdLen;
    const dv = new DataView(gopMeta.buffer, gopMeta.byteOffset, gopMeta.byteLength);
    const channel = dv.getUint8(off); off += 1;
    const gopId   = dv.getUint32(off, false); off += 4;
    const expectedFrames = dv.getUint16(off, false);

    // if (gopIndex <= 3) {
    //   console.log(`[GOP] #${gopIndex} streamId=${streamId} ch=${channel} gopId=${gopId} expected=${expectedFrames}`);
    // }

    // ── 2. Read frames until stream ends ─────────────────────────────────
    const FRAME_HEADER_SIZE = 13; // 4+4+1+4
    let frameCount = 0;

    while (true) {
      const headerBytes = await byteReader.readExact(FRAME_HEADER_SIZE);
      if (!headerBytes) break; // Stream closed — normal end of GOP

      const fv = new DataView(headerBytes.buffer, headerBytes.byteOffset, FRAME_HEADER_SIZE);
      // const sequence  = fv.getUint32(0, false); // unused on receiver side
      // const timestamp = fv.getUint32(4, false); // already in payload packet
      // const frameType = fv.getUint8(8);         // already in payload packet
      const payloadSize = fv.getUint32(9, false);

      // Guard against binary misalignment: if the frame header was read at a wrong
      // offset, payloadSize will be nonsensical. A real frame is never 0 bytes and
      // never exceeds 10 MB (typical 1080p keyframe ~100-400 KB). If this fires,
      // all subsequent reads would also be misaligned → break out of the GOP entirely.
      if (payloadSize === 0 || payloadSize > 10_000_000) {
        console.warn(`[GOP] ch=${channel} gopId=${gopId} implausible payloadSize=${payloadSize}, skipping frame`);
        break;
      }

      const payload = await byteReader.readExact(payloadSize);
      if (!payload) break;

      frameCount++;
      // Reconstruct full packet: [seq:4][ts:4][frameType:1] + media_payload
      // The FrameHeader contains seq/ts/frameType; payload is raw media data.
      // handleBinaryPacket() expects the 9-byte prefix to route to the correct decoder.
      const fullPacket = new Uint8Array(9 + payload.length);
      fullPacket.set(headerBytes.subarray(0, 9), 0);  // seq + ts + frameType from FrameHeader
      fullPacket.set(payload, 9);
      await processIncomingMessage(fullPacket);
    }

    if (gopIndex <= 3 || frameCount !== expectedFrames) {
      proxyConsole.log(`[GOP] #${gopIndex} done: ch=${channel} gopId=${gopId} frames=${frameCount}/${expectedFrames}`);
    }
  } catch (err) {
    proxyConsole.error(`[GOP] handleGopStream #${gopIndex} error:`, err);
  } finally {
    reader.cancel().catch(() => {});
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
  if (bytes.length > 0 && bytes[0] === 0x7B) {
    try {
      const text = _sharedTextDecoder.decode(bytes); // Reuse singleton to reduce GC pressure
      const json = JSON.parse(text);
      // Only log DecoderConfigs parsing — avoid per-packet log spam in hot path
      if (json.type === 'DecoderConfigs') {
        console.log(`[processIncomingMessage] Received DecoderConfigs`);
        handleStreamConfigs(json);
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
    : bytes.buffer.byteLength === bytes.length
      ? bytes.buffer
      : bytes.slice().buffer;
  handleBinaryPacket(buf);
}

async function handleBinaryPacket(dataBuffer) {
  const dataView = new DataView(dataBuffer);
  const sequenceNumber = dataView.getUint32(0, false);
  const timestamp = dataView.getUint32(4, false);
  const frameType = dataView.getUint8(8);
  // Use a Uint8Array VIEW instead of ArrayBuffer.slice(9) to avoid a deep copy
  // of every frame payload. ArrayBuffer.slice() memcpy's the entire payload
  // (100-400 KB per 720p frame) which wastes memory and CPU on Safari 15.
  // If transfer to an external worker is needed, decodeVideoExternal() will do
  // a targeted slice() of just that path.
  const data = new Uint8Array(dataBuffer, 9);

  // ── Video frame types ──
  // When videoDecoderPort is set (iOS 15), all video decoding is offloaded
  // to the external video-decoder-worker via MessagePort.  Keyframe tracking
  // still happens here so we don't send delta frames before a keyframe.

  if (frameType === 0 || frameType === 1) {
    // 360p video
    const type = frameType === 0 ? "key" : "delta";
    if (type === "key") setKeyFrameReceived(CHANNEL_NAME.VIDEO_360P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_360P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.VIDEO_360P, type, timestamp, data);
      } else {
        let decoder360p = mediaDecoders.get(CHANNEL_NAME.VIDEO_360P);
        const decoderState = decoder360p ? decoder360p.state : null;

        if (!decoder360p || decoderState === "closed" || decoderState === "unconfigured") {
          // Throttle decoder recreation to avoid spawning multiple WASM instances
          // under rapid error conditions (Safari 15 memory limit critical)
          if (canRecreateDecoder(CHANNEL_NAME.VIDEO_360P)) {
            decoder360p = await createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
            mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
            const video360pConfig = mediaConfigs.get(CHANNEL_NAME.VIDEO_360P);
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
            decoder360p.decode({ type, timestamp: timestamp * 1000, data: new Uint8Array(data) });
          } else {
            decoder360p.decode(new EncodedVideoChunk({ timestamp: timestamp * 1000, type, data }));
          }
        } catch (err) {
          proxyConsole.error("360p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.VIDEO_360P, false);
        }
      }
    }
    return;
  } else if (frameType === 2 || frameType === 3) {
    // 720p video
    const type = frameType === 2 ? "key" : "delta";
    if (type === "key") setKeyFrameReceived(CHANNEL_NAME.VIDEO_720P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_720P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.VIDEO_720P, type, timestamp, data);
      } else {
        let decoder720p = mediaDecoders.get(CHANNEL_NAME.VIDEO_720P);
        const decoderState = decoder720p ? decoder720p.state : null;

        if (!decoder720p || decoderState === "closed" || decoderState === "unconfigured") {
          // Throttle decoder recreation to avoid spawning multiple WASM instances
          if (canRecreateDecoder(CHANNEL_NAME.VIDEO_720P)) {
            decoder720p = await createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);
            mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
            const config720p = mediaConfigs.get(CHANNEL_NAME.VIDEO_720P);
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
            decoder720p.decode({ type, timestamp: timestamp * 1000, data: new Uint8Array(data) });
          } else {
            decoder720p.decode(new EncodedVideoChunk({ timestamp: timestamp * 1000, type, data }));
          }
        } catch (err) {
          proxyConsole.error("720p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.VIDEO_720P, false);
        }
      }
    }
    return;
  } else if (frameType === 13 || frameType === 14) {
    // 1080p video
    const type = frameType === 13 ? "key" : "delta";
    if (type === "key") setKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.VIDEO_1080P, type, timestamp, data);
      } else {
        let decoder1080p = mediaDecoders.get(CHANNEL_NAME.VIDEO_1080P);
        const decoderState = decoder1080p ? decoder1080p.state : null;

        if (!decoder1080p || decoderState === "closed" || decoderState === "unconfigured") {
          decoder1080p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1080P));
          mediaDecoders.set(CHANNEL_NAME.VIDEO_1080P, decoder1080p);
          const config1080p = mediaConfigs.get(CHANNEL_NAME.VIDEO_1080P);
          if (config1080p) {
            proxyConsole.log("Configuring 1080p decoder with config:", config1080p);
            decoder1080p.configure(config1080p);
          }
        }

        try {
          decoder1080p.decode(new EncodedVideoChunk({ timestamp: timestamp * 1000, type, data }));
        } catch (err) {
          proxyConsole.error("1080p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P, false);
        }
      }
    }
    return;
  } else if (frameType === 15 || frameType === 16) {
    // 1440p video
    const type = frameType === 15 ? "key" : "delta";
    if (type === "key") setKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.VIDEO_1440P, type, timestamp, data);
      } else {
        let decoder1440p = mediaDecoders.get(CHANNEL_NAME.VIDEO_1440P);

        try {
          decoder1440p.decode(new EncodedVideoChunk({ timestamp: timestamp * 1000, type, data }));
        } catch (err) {
          proxyConsole.error("1440p decode error:", err);
          setKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P, false);
        }
      }
    }
    return;
  } else if (frameType === 4 || frameType === 5) {
    // Screen share 720p
    const type = frameType === 4 ? "key" : "delta";
    if (type === "key") setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, true);

    if (isKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P)) {
      if (videoDecoderPort) {
        decodeVideoExternal(CHANNEL_NAME.SCREEN_SHARE_720P, type, timestamp, data);
      } else {
        let videoDecoderScreenShare720p = mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
        const decoderState = videoDecoderScreenShare720p ? videoDecoderScreenShare720p.state : null;

        if (!videoDecoderScreenShare720p || decoderState === "closed" || decoderState === "unconfigured") {
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
          const encodedChunk = new EncodedVideoChunk({ timestamp: timestamp * 1000, type, data });
          videoDecoderScreenShare720p.decode(encodedChunk);
        } catch (error) {
          proxyConsole.error("Screen share video decode error:", error);
          setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, false);
        }
      }
    }
    return;
  } else if (frameType === 6) {
    if (!self._audioPacketCount) self._audioPacketCount = 0;
    self._audioPacketCount++;

    let audioDecoder = mediaDecoders.get(
      subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_AUDIO : CHANNEL_NAME.SCREEN_SHARE_AUDIO
    );

    if (!audioDecoder) {
      if (self._audioPacketCount <= 3) console.error('[Audio] audioDecoder is NULL');
      return;
    }

    // Buffer packets arriving before the description chunk is sent, then
    // replay them in order once the description is processed.
    // (Previously these were hard-dropped, causing silent audio at stream start.)
    if (!audioDecoder.isReadyForAudio) {
      return;
    }

    if (self._audioPacketCount <= 3) {
      console.log('[Audio] packet#:', self._audioPacketCount,
        'state:', audioDecoder.state, 'ts:', timestamp, 'len:', data.byteLength);
    }

    // ── Audio delivery ──
    // With single persistent uni-stream (both publisher→server and server→subscriber),
    // QUIC guarantees in-order delivery, so reorder buffer is unnecessary.
    const AUDIO_REORDER_ENABLED = false;
    if (!AUDIO_REORDER_ENABLED) {
      // Direct path — no buffering, lower latency
      if (!self._audioRxTotal) { self._audioRxTotal = 0; self._audioRxLost = 0; }
      self._audioRxTotal++;

      // Seq gap detection
      if (self._lastAudioSeq === undefined) {
        self._lastAudioSeq = sequenceNumber;
      } else {
        const expected = self._lastAudioSeq + 1;
        if (sequenceNumber !== expected) {
          const lost = sequenceNumber - expected;
          if (lost > 0) self._audioRxLost += lost;
          console.warn(`[Audio RX] PACKET LOSS: expected=${expected}, got=${sequenceNumber}, lost=${lost}`);
        }
        self._lastAudioSeq = sequenceNumber;
      }

      // Periodic summary
      if (self._audioRxTotal % 500 === 0) {
        const lossRate = self._audioRxLost > 0 ? ((self._audioRxLost / (self._audioRxTotal + self._audioRxLost)) * 100).toFixed(2) : '0.00';
        console.log(`[Audio RX] total=${self._audioRxTotal} lost=${self._audioRxLost} rate=${lossRate}% lastSeq=${sequenceNumber}`);
      }

      // Decode directly
      const decoder = mediaDecoders.get(
        subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_AUDIO : CHANNEL_NAME.SCREEN_SHARE_AUDIO
      );
      if (!decoder || !decoder.isReadyForAudio) return;

      if (decoder.usingNative !== undefined) {
        try {
          decoder.decode({ type: 'key', timestamp: timestamp * 1000, data: data.slice() });
        } catch (err) { console.error('[Audio] AAC decode error:', err); }
      } else {
        try {
          decoder.decode(new EncodedAudioChunk({ timestamp: timestamp * 1000, type: 'key', data: data.slice() }));
        } catch (err) { console.error('[Audio] decode error:', err); }
      }
      return;
    }

    // ── Reorder buffer path (AUDIO_REORDER_ENABLED = true) ──
    // Lazily create the reorder buffer on first audio packet.
    // The onEmit callback fires packets in correct sequence order.
    if (!self._audioReorderBuffer) {
      self._audioReorderBuffer = new AudioReorderBuffer((seq, ts, audioPayload) => {
        // ── Packet loss detection (after reordering) ──
        if (!self._audioRxTotal) { self._audioRxTotal = 0; self._audioRxLost = 0; }
        self._audioRxTotal++;
        if (self._lastAudioSeq === undefined) {
          self._lastAudioSeq = seq;
        } else {
          const expected = self._lastAudioSeq + 1;
          if (seq !== expected) {
            const lost = seq - expected;
            self._audioRxLost += lost;
            console.warn(`[Audio RX] PACKET LOSS: expected=${expected}, got=${seq}, lost=${lost}`);
          }
          self._lastAudioSeq = seq;
        }

        // Periodic summary log
        if (self._audioRxTotal % 500 === 0) {
          const lossRate = self._audioRxLost > 0 ? ((self._audioRxLost / (self._audioRxTotal + self._audioRxLost)) * 100).toFixed(2) : '0.00';
          console.log(`[Audio RX] total=${self._audioRxTotal} lost=${self._audioRxLost} rate=${lossRate}% lastSeq=${seq}`);
        }

        // Resolve decoder at emit time (may have been recreated)
        const decoder = mediaDecoders.get(
          subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_AUDIO : CHANNEL_NAME.SCREEN_SHARE_AUDIO
        );
        if (!decoder || !decoder.isReadyForAudio) return;

        if (decoder.usingNative !== undefined) {
          // AACDecoder path — pass plain object with copied data
          try {
            decoder.decode({
              type: 'key',
              timestamp: ts * 1000,
              data: audioPayload, // already an isolated copy from push()
            });
          } catch (err) {
            console.error('[Audio] AAC decode error:', err);
          }
        } else {
          // Opus path — use EncodedAudioChunk
          try {
            decoder.decode(new EncodedAudioChunk({
              timestamp: ts * 1000,
              type: "key",
              data: audioPayload,
            }));
          } catch (err) {
            console.error('[Audio] decode error:', err);
          }
        }
      });
      console.log('[Audio] 🔄 AudioReorderBuffer initialized (bufferSize=3, timeout=60ms)');
    }

    // Push into reorder buffer — data.slice() creates an isolated copy
    // since `data` is a view into the shared dataBuffer
    self._audioReorderBuffer.push(sequenceNumber, timestamp, data.slice());
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
      case "ready":
        console.log("[Worker] Video decoder worker is ready");
        break;

      case "configured":
        console.log(`[Worker] External video decoder configured for ${msg.channelName}`);
        break;

      case "videoData": {
        // msg.frame = { format: 'yuv420', yPlane, uPlane, vPlane, width, height }
        const frame = msg.frame;
        if (frame && frame.yPlane && frame.uPlane && frame.vPlane) {
          // Forward directly to main thread without copying YUV buffers.
          // The video-decoder-worker already copies into preallocated buffers;
          // wrapping in another new Uint8Array() here is wasteful on Safari 15.
          self.postMessage({
            type: "videoData",
            frame,
            quality: msg.channelName,
          });
        }
        break;
      }

      case "error":
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
    type: "decode",
    channelName,
    chunk: {
      type,
      timestamp: timestamp * 1000,
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
    type: "configure",
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
      // ── Audio decoder (always local) ──
      const micAudioDecoder = new OpusAudioDecoder(audioInit);
      const audioConfigPromise = micAudioDecoder.configure({ sampleRate: 48000, numberOfChannels: 1, decoderPort: externalDecoderPort });
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, micAudioDecoder);

      // ── Video decoders ──
      if (videoDecoderPort) {
        // iOS 15 path: video decoding is offloaded to external worker.
        // No local H264Decoder instances needed — the external worker
        // creates them when it receives "configure" commands.
        console.log('[Worker] Video decoding offloaded to external video decoder worker');
      } else {
        // Normal path: create local video decoders (native or WASM fallback)
        const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
        const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);
        const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
      }

      await audioConfigPromise;
      console.log('[Audio] OpusDecoder configured, state:', micAudioDecoder.state,
        'mode:', micAudioDecoder.useInlineDecoder ? 'inline' : 'worker');
      break;
    }

    case STREAM_TYPE.SCREEN_SHARE: {
      if (videoDecoderPort) {
        console.log('[Worker] Screen share video decoding offloaded to external worker');
      } else {
        // Use same native/WASM fallback logic as camera path
        const screenDecoder = await createVideoDecoderWithFallback(CHANNEL_NAME.SCREEN_SHARE_720P);
        mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, screenDecoder);
      }
      mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_AUDIO, new OpusAudioDecoder(audioInit));
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
      // ── Audio decoder (always local) ──
      const defaultMicAudioDecoder = new OpusAudioDecoder(audioInit);
      const audioConfigPromise = defaultMicAudioDecoder.configure({ sampleRate: 48000, numberOfChannels: 1, decoderPort: externalDecoderPort });
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, defaultMicAudioDecoder);

      // ── Video decoders ──
      if (videoDecoderPort) {
        console.log('[Worker] Video decoding offloaded to external video decoder worker');
      } else {
        const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
        const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);
        const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
      }

      await audioConfigPromise;
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
      currentChannel.send(encoder.encode("pause"));
    }

    if (targetChannel.readyState === "open") {
      proxyConsole.log(`[Bitrate] Sending "resume" to ${targetChannelName}`);
      targetChannel.send(encoder.encode("resume"));
    }

    currentVideoChannel = targetChannelName;
    setKeyFrameReceived(targetChannelName, false);

    self.postMessage({
      type: "bitrateChanged",
      quality: targetChannelName,
    });

    proxyConsole.log(`[Bitrate] Switched to ${targetChannelName}`);
  } catch (err) {
    proxyConsole.error(`[Bitrate] Failed to switch to ${targetChannelName}:`, err);
    self.postMessage({
      type: "error",
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
      await currentStream.writer.write(encoder.encode("pause"));
    }

    if (targetStream && targetStream.writer) {
      proxyConsole.log(`[Bitrate] Sending "resume" to cam_${quality}`);
      await targetStream.writer.write(encoder.encode("resume"));
    }

    currentVideoChannel = quality;
    setKeyFrameReceived(quality, false);

    self.postMessage({
      type: "bitrateChanged",
      quality,
    });

    proxyConsole.log(`[Bitrate] Switched to ${quality}`);
  } catch (err) {
    proxyConsole.error(`[Bitrate] Failed to switch to ${quality}:`, err);
    self.postMessage({
      type: "error",
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
    type: "log",
    event: "reset",
    message: "Reset all decoders",
  });
}

function stopAll() {
  // Destroy jitter buffer and its setInterval timer (critical — prevents lingering timers after stop)
  if (videoJitterBuffer) {
    videoJitterBuffer.destroy();
    videoJitterBuffer = null;
  }

  // Destroy audio reorder buffer (prevent lingering flush timer + post-destroy callbacks)
  if (self._audioReorderBuffer) {
    self._audioReorderBuffer.destroy();
    self._audioReorderBuffer = null;
  }
  self._lastAudioSeq = undefined;

  if (workletPort) {
    workletPort.postMessage({ type: "stop" });
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
      videoDecoderPort.postMessage({ type: "resetAll" });
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
    type: "log",
    event: "stop",
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
    const MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB
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
      if (this.buffer.length >= 4) {
        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4);
        const messageLength = view.getUint32(0, false);

        const totalLength = 4 + messageLength;
        if (this.buffer.length >= totalLength) {
          const message = this.buffer.slice(4, totalLength);
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
