import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, STREAM_TYPE } from "./publisherConstants.js";
import raptorqInit, { WasmFecManager } from '../raptorQ/raptorq_wasm.js';

import CommandSender from "./ClientCommand.js";

let subscribeType = STREAM_TYPE.CAMERA;

let currentVideoChannel = CHANNEL_NAME.VIDEO_360P;

let workletPort = null;
let audioEnabled = true;

// Audio subscription control - received from init message
// For screen share, this is determined by whether the publisher has screen share audio
let subscriptionAudioEnabled = true;

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

/** @type {Map<string, WasmFecManager>} Per-channel FEC managers to prevent data mixing */
const fecManagers = new Map();
let isRaptorQInitialized = false;

function getOrCreateFecManager(channelName) {
  if (!fecManagers.has(channelName)) {
    fecManagers.set(channelName, new WasmFecManager());
  }
  return fecManagers.get(channelName);
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

const createVideoInit = (channelName) => ({
  output: (frame) => {
    self.postMessage({ type: 'videoData', frame, quality: channelName }, [frame]);
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
    const channelData = [];
    if (audioData.numberOfChannels === 1) {
      const monoChannel = new Float32Array(audioData.numberOfFrames);
      audioData.copyTo(monoChannel, { planeIndex: 0 });
      channelData.push(monoChannel);
      channelData.push(new Float32Array(monoChannel));
    } else {
      // if mono, duplicate to create stereo
      if (audioData.numberOfChannels === 1) {
        const monoChannel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(monoChannel, { planeIndex: 0 });
        channelData.push(monoChannel);
        channelData.push(new Float32Array(monoChannel));
      } else {
        for (let i = 0; i < audioData.numberOfChannels; i++) {
          const channel = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(channel, { planeIndex: i });
          channelData.push(channel);
        }
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
        },
        channelData.map((c) => c.buffer),
      );
    }

    audioData.close();
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
      console.log(`[Worker] Init with subscribeType=${subscribeType}, audioEnabled=${subscriptionAudioEnabled}, initialQuality=${initialQuality}`);
      await initializeDecoders();
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

  channel.binaryType = "arraybuffer";

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
    proxyConsole.log(`[WebRTC] Sent subscribe message for ${channelName}`);
  };

  channel.onclose = () => {
    proxyConsole.log(`[WebRTC] Data channel closed: ${channelName}`);
  };

  channel.onerror = (error) => {
    proxyConsole.error(`[WebRTC] Data channel error for ${channelName}:`, error);
  };

  channel.onmessage = (event) => {
    handleWebRtcMessage(channelName, event.data);
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
  if (channelName.startsWith('video_')) {
    if (!videoJitterBuffer) initVideoJitterBuffer();
    return videoJitterBuffer;
  }
  if (channelName.startsWith('screen_share_') && !channelName.includes('audio')) {
    if (!screenShareJitterBuffer) initScreenShareJitterBuffer();
    return screenShareJitterBuffer;
  }
  return null;
}

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
        const videoConfig = {
          codec: cfg.codec,
          codedWidth: cfg.codedWidth,
          codedHeight: cfg.codedHeight,
          frameRate: cfg.frameRate,
          description: desc,
        };

        mediaConfigs.set(channelName, videoConfig);

        const decoder = mediaDecoders.get(channelName);
        if (decoder) {
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

        const decoder = mediaDecoders.get(channelName);
        if (decoder) {
          try {
            decoder.configure(audioConfig).then((configResult) => {
              console.log(`[Audio] configured successfully for ${channelName}, result:`, configResult, "state:", decoder.state);
            }).catch((err) => {
              console.error(`[Audio] configure() REJECTED for ${channelName}:`, err);
            });

            try {
              const dataView = new DataView(desc.buffer);
              const timestamp = dataView.getUint32(4, false);
              const data = desc.slice(9);

              const chunk = new EncodedAudioChunk({
                timestamp: timestamp * 1000,
                type: "key",
                data,
              });
              decoder.decode(chunk);
            } catch (err) {
              console.warn(`[Audio] Error decoding first audio frame (${channelName}):`, err);
            }
          } catch (err) {
            console.error(`[Audio] Configure decoder FAIL ${channelName}:`, err);
          }
        } else {
          console.warn(`[Audio] No decoder for audio channel ${channelName}`);
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

async function processIncomingMessage(message) {
  try {
    const dec = new TextDecoder();
    const maybeText = dec.decode(message).trimStart();
    
    if (maybeText.startsWith('{')) {
      try {
        const json = JSON.parse(maybeText);
        console.log(`[processIncomingMessage] Received JSON message:`, json);
        if (json.type === 'DecoderConfigs') {
          handleStreamConfigs(json);
          return;
        }
      } catch (e) {
        proxyConsole.warn(`[processIncomingMessage] Non-JSON text:`, maybeText);
        return;
      }
    }
  } catch (err) {
    proxyConsole.error(`[processIncomingMessage] error:`, err);
  }
  if (message instanceof ArrayBuffer) {
    handleBinaryPacket(message);
  } else {
    handleBinaryPacket(message.buffer);
  }
}

function handleBinaryPacket(dataBuffer) {
  const dataView = new DataView(dataBuffer);
  const sequenceNumber = dataView.getUint32(0, false);
  const timestamp = dataView.getUint32(4, false);
  const frameType = dataView.getUint8(8);
  const data = dataBuffer.slice(9);

  // DEBUG: Only log screen share packets (frameType 4 or 5)
  // if (frameType === 4 || frameType === 5) {
  //   console.warn(`[Worker] 📺 SCREEN_SHARE packet: frameType=${frameType}, seq=${sequenceNumber}, size=${data.byteLength}`);
  // }

  if (frameType === 0 || frameType === 1) {
    const type = frameType === 0 ? "key" : "delta";

    if (type === "key") {
      setKeyFrameReceived(CHANNEL_NAME.VIDEO_360P, true);
    }

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_360P)) {
      let decoder360p = mediaDecoders.get(CHANNEL_NAME.VIDEO_360P);
      const decoderState = decoder360p ? decoder360p.state : null;

      // Recreate decoder if closed or in error state
      if (!decoder360p || decoderState === "closed" || decoderState === "unconfigured") {
        decoder360p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P));
        mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
        const video360pConfig = mediaConfigs.get(CHANNEL_NAME.VIDEO_360P);
        if (video360pConfig) {
          decoder360p.configure(video360pConfig);
        }
      }

      try {
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });
        decoder360p.decode(encodedChunk);
      } catch (err) {
        proxyConsole.error("360p decode error:", err);
        setKeyFrameReceived(CHANNEL_NAME.VIDEO_360P, false); // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 2 || frameType === 3) {
    const type = frameType === 2 ? "key" : "delta";
    if (type === "key") {
      setKeyFrameReceived(CHANNEL_NAME.VIDEO_720P, true);
    }

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_720P)) {
      let decoder720p = mediaDecoders.get(CHANNEL_NAME.VIDEO_720P);
      const decoderState = decoder720p ? decoder720p.state : null;

      // Recreate decoder if closed or in error state
      if (!decoder720p || decoderState === "closed" || decoderState === "unconfigured") {
        decoder720p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P));
        mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
        const config720p = mediaConfigs.get(CHANNEL_NAME.VIDEO_720P);
        if (config720p) {
          proxyConsole.log("Decoder error, Configuring 720p decoder with config:", config720p);
          decoder720p.configure(config720p);
        }
      }

      try {
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });
        decoder720p.decode(encodedChunk);
      } catch (err) {
        proxyConsole.error("720p decode error:", err);
        setKeyFrameReceived(CHANNEL_NAME.VIDEO_720P, false); // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 13 || frameType === 14) {
    // 1080p video frames (CAM_1080P_KEY=13, CAM_1080P_DELTA=14)
    const type = frameType === 13 ? "key" : "delta";
    if (type === "key") {
      setKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P, true);
    }

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P)) {
      let decoder1080p = mediaDecoders.get(CHANNEL_NAME.VIDEO_1080P);
      const decoderState = decoder1080p ? decoder1080p.state : null;

      // Recreate decoder if closed or in error state
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
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });
        decoder1080p.decode(encodedChunk);
      } catch (err) {
        proxyConsole.error("1080p decode error:", err);
        setKeyFrameReceived(CHANNEL_NAME.VIDEO_1080P, false); // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 15 || frameType === 16) {
    // 1440p video frames (CAM_1440P_KEY=15, CAM_1440P_DELTA=16)
    const type = frameType === 15 ? "key" : "delta";
    if (type === "key") {
      setKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P, true);
    }

    if (isKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P)) {
      let decoder1440p = mediaDecoders.get(CHANNEL_NAME.VIDEO_1440P);
      const decoderState = decoder1440p ? decoder1440p.state : null;

      // Recreate decoder if closed or in error state
      if (!decoder1440p || decoderState === "closed" || decoderState === "unconfigured") {
        decoder1440p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1440P));
        mediaDecoders.set(CHANNEL_NAME.VIDEO_1440P, decoder1440p);
        const config1440p = mediaConfigs.get(CHANNEL_NAME.VIDEO_1440P);
        if (config1440p) {
          proxyConsole.log("Configuring 1440p decoder with config:", config1440p);
          decoder1440p.configure(config1440p);
        }
      }

      try {
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });
        decoder1440p.decode(encodedChunk);
      } catch (err) {
        proxyConsole.error("1440p decode error:", err);
        setKeyFrameReceived(CHANNEL_NAME.VIDEO_1440P, false); // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 4 || frameType === 5) {
    // DEBUG: Screen share packet received
    // console.warn(`[Worker] 📺 Screen share packet received! frameType=${frameType}, size=${data.byteLength}`);

    // todo: bind screen share 720p and camera 720p packet same packet type, dont need separate, create and get decoder base on subscribe type!!!!
    let videoDecoderScreenShare720p = mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
    const type = frameType === 4 ? "key" : "delta";

    // DEBUG: Screen share packet received (commented to reduce console noise)
    // console.warn(`[Worker] Screen share decoder exists: ${!!videoDecoderScreenShare720p}, type: ${type}, keyFrameReceived: ${keyFrameReceived}`);


    if (type === "key") {
      setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, true);
    }

    if (isKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P)) {
      const decoderState = videoDecoderScreenShare720p ? videoDecoderScreenShare720p.state : null;

      // Recreate decoder if closed or in error state
      if (!videoDecoderScreenShare720p || decoderState === "closed" || decoderState === "unconfigured") {
        videoDecoderScreenShare720p = new VideoDecoder(createVideoInit(CHANNEL_NAME.SCREEN_SHARE_720P));
        mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, videoDecoderScreenShare720p);
        const screenShare720pConfig = mediaConfigs.get(CHANNEL_NAME.SCREEN_SHARE_720P);
        if (screenShare720pConfig) {
          proxyConsole.log("Recreating screen share 720p decoder with config:", screenShare720pConfig);
          videoDecoderScreenShare720p.configure(screenShare720pConfig);
        }
      }

      try {
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });

        videoDecoderScreenShare720p.decode(encodedChunk);
      } catch (error) {
        proxyConsole.error("Screen share video decode error:", error);
        setKeyFrameReceived(CHANNEL_NAME.SCREEN_SHARE_720P, false); // Wait for next keyframe to recover
      }
    }
    return;
  } else if (frameType === 6) {
    let audioDecoder = mediaDecoders.get(
      subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_AUDIO : CHANNEL_NAME.SCREEN_SHARE_AUDIO
    );
    const chunk = new EncodedAudioChunk({
      timestamp: timestamp * 1000,
      type: "key",
      data,
    });

    try {
      audioDecoder.decode(chunk);
    } catch (err) {
      proxyConsole.error("Audio decode error:", err);
    }
  }
}

// ------------------------------
// Decoder configuration
// ------------------------------

async function initializeDecoders() {
  proxyConsole.log("Initializing camera decoders for subscribe type:", subscribeType);
  switch (subscribeType) {
    case STREAM_TYPE.CAMERA:
      mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_1080P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1080P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_1440P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1440P)));
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, new OpusAudioDecoder({ ...audioInit }));
      break;

    case STREAM_TYPE.SCREEN_SHARE:
      mediaDecoders.set(
        CHANNEL_NAME.SCREEN_SHARE_720P,
        new VideoDecoder(createVideoInit(CHANNEL_NAME.SCREEN_SHARE_720P))
      );
      mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_AUDIO, new OpusAudioDecoder({ ...audioInit }));
      proxyConsole.warn(
        "Initialized screen share decoders:",
        mediaDecoders,
        "video channel",
        CHANNEL_NAME.SCREEN_SHARE_720P,
        "audio channel",
        CHANNEL_NAME.SCREEN_SHARE_AUDIO
      );
      break;

    default:
      mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_1080P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1080P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_1440P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1440P)));
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, new OpusAudioDecoder({ ...audioInit }));
      break;
  }

  // try {
  //   audioDecoder = new OpusAudioDecoder(audioInit);
  // } catch (error) {
  //   proxyConsole.error("Failed to initialize OpusAudioDecoder:", error);
  // }
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
  if (audioDecoder) audioDecoder.reset();

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
