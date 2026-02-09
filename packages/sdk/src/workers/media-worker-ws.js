import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, SUBSCRIBE_TYPE } from "./publisherConstants.js";
// import { CHANNEL_NAME, SUBSCRIBE_TYPE } from new URL("./publisherConstants.js", import.meta.url);

import CommandSender from "./ClientCommand.js";

let subscribeType = SUBSCRIBE_TYPE.CAMERA;

let videoDecoder360p;
let videoDecoder720p;
let currentVideoChannel = CHANNEL_NAME.VIDEO_360P;
let audioDecoder = null;

let workletPort = null;
let audioEnabled = true;

let video360pConfig;
let video720pConfig;
let audioConfig;

let videoConfigs = new Map();
let videoDecoders = new Map();

let videoIntervalID;
let audioIntervalID;

let keyFrameReceived = false;

const channelStreams = new Map();

// WebRTC specific
let isWebRTC = false;
let webRtcConnection = null;
let webRtcDataChannels = new Map();

// command sender
let commandSender = null;

/** @type {Map<string, WasmFecManager>} Per-channel FEC managers to prevent data mixing */
// const fecManagers = new Map();

// raptorqInit().then(() => {
//   proxyConsole.log("Raptorq WASM module initialized");
//   fecManager = new WasmFecManager();
// });

// function getOrCreateFecManager(channelName) {
//   if (!fecManagers.has(channelName)) {
//     fecManagers.set(channelName, new WasmFecManager());
//   }
//   return fecManagers.get(channelName);
// }

// WebSocket specific
let isWebSocket = false;
const webSocketConnections = new Map();

const proxyConsole = {
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  info: () => {},
  trace: () => {},
  group: () => {},
  groupEnd: () => {},
};

const createVideoInit = (channelName) => ({
  output: (frame) => {
    self.postMessage({ type: "videoData", frame, quality: channelName }, [frame]);
  },
  error: (e) => {
    proxyConsole.error(`Video decoder error (${channelName}):`, e);
    self.postMessage({
      type: "error",
      message: `${channelName} decoder: ${e.message}`,
    });
  },
});

const audioInit = {
  output: (audioData) => {
    const channelData = [];
    for (let i = 0; i < audioData.numberOfChannels; i++) {
      const channel = new Float32Array(audioData.numberOfFrames);
      audioData.copyTo(channel, { planeIndex: i });
      channelData.push(channel);
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
        channelData.map((c) => c.buffer)
      );
    }

    audioData.close();
  },
  error: (e) => {
    self.postMessage({ type: "error", message: e.message });
  },
};

// ------------------------------
// Main entry
// ------------------------------

self.onmessage = async function (e) {
  proxyConsole.warn("Worker received message:", e);
  // if (!e.data || !e.data.type) return;
  const {
    type,
    subscriberType: incomingSubscribeType,
    port,
    quality,
    readable,
    writable,
    channelName,
    dataChannel,
    wsUrl,
  } = e.data;

  switch (type) {
    case "init":
      proxyConsole.warn("[Subscriber worker]: Received init, initializing decoders");
      await initializeDecoders();
      proxyConsole.log("received worker port", port);
      if (port instanceof MessagePort) workletPort = port;
      subscribeType = incomingSubscribeType || SUBSCRIBE_TYPE.CAMERA;
      break;

    case "attachWebSocket":
      if (wsUrl) {
        // proxyConsole.warn(`[Media worker]: Attaching WebSocket for ${channelName}`);
        commandSender = new CommandSender({
          sendDataFn: sendOverWebSocket,
          protocol: "websocket",
          commandType: "subscriber_command",
        });

        isWebSocket = true;
        // const channels = [CHANNEL_NAME.VIDEO_720P, CHANNEL_NAME.AUDIO];
        const channels = [CHANNEL_NAME.VIDEO_360P, CHANNEL_NAME.AUDIO];
        channels.forEach((ch) => attachWebSocket(ch, wsUrl));
        // attachWebSocket(channelName, e.data.wsUrl);
      }
      break;

    case "attachStream":
      if (readable && writable && channelName) {
        commandSender = new CommandSender({
          sendDataFn: sendOverStream,
          protocol: "webtransport",
          commandType: "subscriber_command",
        });
        proxyConsole.warn(`[Publisher worker]: Attaching stream for ${channelName}`);
        attachWebTransportStream(channelName, readable, writable);
      }
      break;

    case "attachDataChannel":
      if (channelName && dataChannel) {
        proxyConsole.warn(`[Publisher worker]: Attaching WebRTC data channel for ${channelName}`);
        attachWebRTCDataChannel(channelName, dataChannel);
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
function attachWebSocket(channelName, wsUrl) {
  const fullUrl = `${wsUrl}/${channelName}`;
  const ws = new WebSocket(fullUrl);

  ws.binaryType = "arraybuffer";

  webSocketConnections.set(channelName, ws);

  ws.onopen = () => {
    proxyConsole.log(`[WebSocket] Connected: ${channelName}`);

    // const initText = { type: "start_stream" };

    // ws.send(JSON.stringify(initText));
    commandSender.startStream(channelName);
    proxyConsole.log(`[WebSocket] Sent subscribe message for ${channelName}`);
  };

  ws.onclose = () => {
    proxyConsole.log(`[WebSocket] Closed: ${channelName}`);
    webSocketConnections.delete(channelName);
  };

  ws.onerror = (error) => {
    proxyConsole.error(`[WebSocket] Error for ${channelName}:`, error);
  };

  ws.onmessage = (event) => {
    processIncomingMessage(channelName, event.data);
  };
}

/// Send data over websocket, dont need to add length prefix
async function sendOverWebSocket(channelName, data) {
  const ws = webSocketConnections.get(channelName);
  if (!ws) {
    proxyConsole.error(`WebSocket ${channelName} not found`);
    return;
  }
  await ws.send(data);
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

function handleWebRtcMessage(channelName, message) {
  try {
    let text = null;
    if (typeof message === "string") {
      text = message;
    } else if (message instanceof Uint8Array || message instanceof ArrayBuffer) {
      const dec = new TextDecoder();
      const maybeText = dec.decode(message);
      if (maybeText.startsWith("{")) text = maybeText;
    }

    if (text) {
      try {
        const json = JSON.parse(text);
        if (json.type === "StreamConfig") {
          handleStreamConfig(channelName, json.config);
          return;
        }
      } catch (e) {
        proxyConsole.warn(`[${channelName}] Non-JSON text:`, text);
        return;
      }
    }
  } catch (err) {
    proxyConsole.error(`[processIncomingMessage] error for ${channelName}:`, err);
  }
  const { sequenceNumber, isFec, packetType, payload } = parseWebRTCPacket(new Uint8Array(message));
  if (isFec) {
    // const channelFecManager = getOrCreateFecManager(channelName);
    // const result = channelFecManager.process_fec_packet(payload, sequenceNumber);
    const result = null; // FEC disabled in ws worker
    if (result) {
      const decodedData = result[0][1];
      processIncomingMessage(channelName, decodedData.buffer);

      return;
    }
  } else {
    processIncomingMessage(channelName, payload.buffer);
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

function handleStreamConfig(channelName, cfg) {
  const desc = base64ToUint8Array(cfg.description);

  if (channelName.startsWith("video_")) {
    const videoConfig = {
      codec: cfg.codec,
      codedWidth: cfg.codedWidth,
      codedHeight: cfg.codedHeight,
      frameRate: cfg.frameRate,
      description: desc,
    };

    videoConfigs.set(channelName, videoConfig);

    configureVideoDecoders(channelName);
  } else if (channelName.startsWith("mic_")) {
    audioConfig = {
      codec: cfg.codec,
      sampleRate: cfg.sampleRate,
      numberOfChannels: cfg.numberOfChannels,
      description: desc,
    };

    if (audioDecoder) audioDecoder.configure(audioConfig);

    try {
      // const dataView = new DataView(desc.buffer);
      // const timestamp = dataView.getUint32(0, false);
      // const data = desc.slice(5);

      // for debugging
      const dataView = new DataView(desc.buffer);
      const timestamp = dataView.getUint32(4, false);
      const data = desc.slice(9);

      const chunk = new EncodedAudioChunk({
        timestamp: timestamp * 1000,
        type: "key",
        data,
      });
      audioDecoder.decode(chunk);
    } catch (error) {
      proxyConsole.log("Error decoding first audio frame:", error);
    }
  }
}

// ------------------------------
// Stream handling (WebTransport)
// ------------------------------

async function attachWebTransportStream(channelName, readable, writable) {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  channelStreams.set(channelName, { reader, writer });

  commandSender.initSubscribeChannelStream(channelName);

  proxyConsole.log(`Attached WebTransport stream for ${channelName}`);

  // const initText = `subscribe:${channelName}`;
  // proxyConsole.log(`Sending init message for ${channelName}:`, initText);

  // const initData = new TextEncoder().encode(initText);
  // const len = initData.length;
  // const out = new Uint8Array(4 + len);
  // const view = new DataView(out.buffer);
  // view.setUint32(0, len, false);
  // out.set(initData, 4);

  // writer.write(out);

  commandSender.startStream(channelName);
  // if (channelName.startsWith("cam_")) readVideoStream(channelName, reader);
  // else if (channelName.startsWith("mic_")) readAudioStream(reader);
  readStream(channelName, reader);
}

async function sendOverStream(channelName, frameBytes) {
  const stream = channelStreams.get(channelName);
  proxyConsole.log("sendOverStream", channelName, frameBytes, "stream", stream);
  if (!stream || !stream.writer) {
    proxyConsole.error(`Stream ${channelName} not found`);
    return;
  }

  try {
    const len = frameBytes.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(frameBytes, 4);
    await stream.writer.write(out);
  } catch (error) {
    proxyConsole.error(`Failed to send over stream ${channelName}:`, error);
    throw error;
  }
}

async function readStream(channelName, reader) {
  const delimitedReader = new LengthDelimitedReader(reader);
  try {
    while (true) {
      const message = await delimitedReader.readMessage();
      if (message === null) break;
      await processIncomingMessage(channelName, message);
    }
  } catch (err) {
    proxyConsole.error(`[readStream] ${channelName}:`, err);
  }
}

async function processIncomingMessage(channelName, message) {
  try {
    let text = null;
    if (typeof message === "string") {
      text = message;
    } else if (message instanceof Uint8Array || message instanceof ArrayBuffer) {
      const dec = new TextDecoder();
      const maybeText = dec.decode(message);
      if (maybeText.startsWith("{")) text = maybeText;
    }

    if (text) {
      proxyConsole.warn(`[${channelName}] Incoming message:`, text);
      try {
        const json = JSON.parse(text);
        if (json.type === "StreamConfig") {
          handleStreamConfig(channelName, json.config);
          return;
        }
      } catch (e) {
        proxyConsole.warn(`[${channelName}] Non-JSON text:`, text);
        return;
      }
    }
  } catch (err) {
    proxyConsole.error(`[processIncomingMessage] error for ${channelName}:`, err);
  }
  if (message instanceof ArrayBuffer) {
    handleBinaryPacket(message);
  } else {
    handleBinaryPacket(message.buffer);
  }
}
let videoCounterTest = 0;
setInterval(() => {
  proxyConsole.log("Receive frame rate:", videoCounterTest / 5);
  videoCounterTest = 0;
}, 5000);

function handleBinaryPacket(dataBuffer) {
  // const dataView = new DataView(dataBuffer);
  // const timestamp = dataView.getUint32(0, false);
  // const frameType = dataView.getUint8(4);
  // const data = dataBuffer.slice(5);
  const dataView = new DataView(dataBuffer);
  const sequenceNumber = dataView.getUint32(0, false);
  const timestamp = dataView.getUint32(4, false);
  const frameType = dataView.getUint8(8);
  const data = dataBuffer.slice(9);

  if (frameType === 0 || frameType === 1) {
    const type = frameType === 0 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      if (videoDecoders.get(CHANNEL_NAME.VIDEO_360P).state === "closed") {
        videoDecoder360p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P));
        const video360pConfig = videoConfigs.get(CHANNEL_NAME.VIDEO_360P);
        proxyConsole.log("Decoder error, Configuring 360p decoder with config:", video360pConfig);
        videoDecoders.get(CHANNEL_NAME.VIDEO_360P).configure(video360pConfig);
      }
      const encodedChunk = new EncodedVideoChunk({
        timestamp: timestamp * 1000,
        type,
        data,
      });

      videoDecoders.get(CHANNEL_NAME.VIDEO_360P).decode(encodedChunk);
    }
    return;
  } else if (frameType === 2 || frameType === 3) {
    // stats.record(sequenceNumber);
    // if (last_720p_frame_sequence === sequenceNumber) {
    //   return;
    // }
    videoCounterTest++;
    last_720p_frame_sequence = sequenceNumber;
    // proxyConsole.log(
    //   `Received video frame - Seq: ${sequenceNumber}, size: ${data.byteLength} bytes`
    // );
    const type = frameType === 2 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      if (videoDecoders.get(CHANNEL_NAME.VIDEO_720P).state === "closed") {
        videoDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
        const config720p = videoConfigs.get(CHANNEL_NAME.VIDEO_720P);
        proxyConsole.log("Decoder error, Configuring 720p decoder with config:", config720p);
        videoDecoders.get(CHANNEL_NAME.VIDEO_720P).configure(config720p);
      }
      const encodedChunk = new EncodedVideoChunk({
        timestamp: timestamp * 1000,
        type,
        data,
      });

      videoDecoders.get(CHANNEL_NAME.VIDEO_720P).decode(encodedChunk);
    }
    return;
  } else if (frameType === 4 || frameType === 5) {
    const type = frameType === 0 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      if (videoDecoders.get(CHANNEL_NAME.VIDEO_1080P).state === "closed") {
        videoDecoder360p = new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1080P));
        videoDecoders.get(CHANNEL_NAME.VIDEO_1080P).configure(videoConfigs.get(CHANNEL_NAME.VIDEO_1080P));
      }
      const encodedChunk = new EncodedVideoChunk({
        timestamp: timestamp * 1000,
        type,
        data,
      });

      videoDecoders.get(CHANNEL_NAME.VIDEO_1080P).decode(encodedChunk);
    }
    return;
  } else if (frameType === 6) {
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
    case SUBSCRIBE_TYPE.CAMERA:
      videoDecoders.set(CHANNEL_NAME.VIDEO_360P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P)));
      videoDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      break;

    case SUBSCRIBE_TYPE.SCREEN:
      videoDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      videoDecoders.set(CHANNEL_NAME.VIDEO_1080P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_1080P)));
      break;

    default:
      videoDecoders.set(CHANNEL_NAME.VIDEO_360P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P)));
      videoDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      break;
  }

  try {
    audioDecoder = new OpusAudioDecoder(audioInit);
  } catch (error) {
    proxyConsole.error("Failed to initialize OpusAudioDecoder:", error);
  }
}

function configureVideoDecoders(channelName) {
  const config = videoConfigs.get(channelName);
  if (!config) return;

  try {
    const decoder = videoDecoders.get(channelName);
    if (decoder.state === "unconfigured") {
      decoder.configure(config);
      // videoFrameRate = config.frameRate;
    }

    self.postMessage({
      type: "codecReceived",
      stream: "video",
      channelName,
      config,
    });
  } catch (error) {
    proxyConsole.error("Failed to configure video decoder:", error);
  }
}

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
    keyFrameReceived = false;

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
    keyFrameReceived = false;

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
  keyFrameReceived = false;

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
    } catch {}
  }
  channelStreams.clear();

  if (videoDecoder360p) videoDecoder360p.close?.();
  if (videoDecoder720p) videoDecoder720p.close?.();
  if (audioDecoder) audioDecoder.close?.();

  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  if (isWebSocket) {
    for (const [name, ws] of webSocketConnections.entries()) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch (e) {
        proxyConsole.error(`Error closing WebSocket ${name}:`, e);
      }
    }
    webSocketConnections.clear();
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
