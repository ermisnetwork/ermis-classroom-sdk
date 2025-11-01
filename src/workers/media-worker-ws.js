import { OpusAudioDecoder } from "./opus_decoder/opusDecoder.js";
import "./polyfills/audioData.js";
import "./polyfills/encodedAudioChunk.js";

import init, { WasmFecManager } from "./raptorQ/raptorq_wasm.js";
// import { JitterBuffer } from "./jitterBuffer.js";

let fecManager;

(async () => {
  const wasm = await init();

  console.log(Object.keys(wasm));
  console.log("✅ WASM modules loaded");
  fecManager = new WasmFecManager();
})();

let videoDecoder360p;
let videoDecoder720p;
let currentVideoDecoder;
let currentQuality = "360p";
let audioDecoder = null;

let workletPort = null;
let audioEnabled = true;

let video360pConfig;
let video720pConfig;
let audioConfig;

let videoIntervalID;
let audioIntervalID;

let keyFrameReceived = false;

const channelStreams = new Map();

// WebRTC specific
let isWebRTC = false;
let webRtcConnection = null;
let webRtcDataChannels = new Map();
// let fecManager = null;

// raptorqInit().then(() => {
//   console.log("Raptorq WASM module initialized");
//   fecManager = new WasmFecManager();
// });

// WebSocket specific
let isWebSocket = false;
const webSocketConnections = new Map();

// const jitterBuffer = new JitterBuffer({
//   maxBufferSize: 100,
//   maxWaitTime: 200,
//   maxSequenceGap: 1000,
//   handleBinaryPacket: handleBinaryPacket,
// });
// ------------------------------
// Decoder setup
// ------------------------------

// For debugging packet stats
// class PacketStats {
//   constructor() {
//     this.lastSeq = null;
//     this.total = 0;
//     this.missed = 0;
//     this.outOfOrder = 0;

//     this.lastPrint = Date.now();
//     this.printInterval = 5000;
//   }

//   record(seq) {
//     this.total++;

//     if (this.lastSeq === null) {
//       this.lastSeq = seq;
//       return;
//     }

//     if (seq === this.lastSeq + 1) {
//       this.lastSeq = seq;
//     } else if (seq > this.lastSeq + 1) {
//       this.missed += seq - this.lastSeq - 1;
//       this.lastSeq = seq;
//     } else {
//       // seq <= lastSeq
//       this.outOfOrder++;
//     }

//     const now = Date.now();
//     if (now - this.lastPrint >= this.printInterval) {
//       this.printStats();
//       this.lastPrint = now;
//     }
//   }

//   printStats() {
//     console.log(
//       `[${new Date().toLocaleTimeString()}] ` +
//         `total=${this.total}, missed=${this.missed}, outOfOrder=${this.outOfOrder}`
//     );
//   }
// }
class PacketStats {
  constructor() {
    this.maxSeq = null;
    this.total = 0;
    this.lateArrival = 0; // Packets đến muộn nhưng fill gap

    this.lastPrint = Date.now();
    this.printInterval = 5000;
  }

  record(seq) {
    this.total++;

    if (this.maxSeq === null) {
      this.maxSeq = seq;
      return;
    }

    if (seq > this.maxSeq) {
      this.maxSeq = seq;
    } else {
      this.lateArrival++;
    }

    const now = Date.now();
    if (now - this.lastPrint >= this.printInterval) {
      this.printStats();
      this.lastPrint = now;
    }
  }

  printStats() {
    const expectedTotal = this.maxSeq + 1;
    const missed = expectedTotal - this.total;
    const lossRate = ((missed / expectedTotal) * 100).toFixed(2);

    console.log(
      `[${new Date().toLocaleTimeString()}] ` +
        `total=${this.total}, missed=${missed} (${lossRate}%), ` +
        `lateArrival=${this.lateArrival}`
    );
  }
}
const stats = new PacketStats();

const createVideoInit = (quality) => ({
  output: (frame) => {
    self.postMessage({ type: "videoData", frame, quality }, [frame]);
  },
  error: (e) => {
    console.error(`Video decoder error (${quality}):`, e);
    self.postMessage({
      type: "error",
      message: `${quality} decoder: ${e.message}`,
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
  console.warn("Worker received message:", e);
  // if (!e.data || !e.data.type) return;
  const { type, port, quality, readable, writable, channelName, dataChannel, wsUrl } = e.data;

  switch (type) {
    case "init":
      console.warn("[Subscriber worker]: Received init, initializing decoders");
      await initializeDecoders();
      console.log("received worker port", port);
      if (port instanceof MessagePort) workletPort = port;
      break;

    case "attachWebSocket":
      if (wsUrl) {
        console.warn(`[Publisher worker]: Attaching WebSocket for ${channelName}`);

        isWebSocket = true;
        const channels = [`cam_720p`, `mic_48k`];
        channels.forEach((ch) => attachWebSocket(ch, wsUrl));
        // attachWebSocket(channelName, e.data.wsUrl);
      }
      break;

    case "attachStream":
      if (readable && writable && channelName) {
        console.warn(`[Publisher worker]: Attaching stream for ${channelName}`);
        attachWebTransportStream(channelName, readable, writable);
      }
      break;

    case "attachDataChannel":
      if (channelName && dataChannel) {
        console.warn(`[Publisher worker]: Attaching WebRTC data channel for ${channelName}`);
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
    console.log(`[WebSocket] Connected: ${channelName}`);

    const initText = `subscribe:${channelName}`;
    const initData = new TextEncoder().encode(initText);
    const len = initData.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(initData, 4);

    ws.send(out);
    console.log(`[WebSocket] Sent subscribe message for ${channelName}`);
  };

  ws.onclose = () => {
    console.log(`[WebSocket] Closed: ${channelName}`);
    webSocketConnections.delete(channelName);
  };

  ws.onerror = (error) => {
    console.error(`[WebSocket] Error for ${channelName}:`, error);
  };

  ws.onmessage = (event) => {
    processIncomingMessage(channelName, event.data);
  };
}

// ------------------------------
// WebRTC Setup
// ------------------------------
function attachWebRTCDataChannel(channelName, channel) {
  webRtcDataChannels.set(channelName, channel);

  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    console.log(`[WebRTC] Data channel opened: ${channelName}`);

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
    console.log(`[WebRTC] Data channel closed: ${channelName}`);
  };

  channel.onerror = (error) => {
    console.error(`[WebRTC] Data channel error for ${channelName}:`, error);
  };

  channel.onmessage = (event) => {
    // processIncomingMessage(channelName, event.data);
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
        console.warn(`[${channelName}] Non-JSON text:`, text);
        return;
      }
    }
  } catch (err) {
    console.error(`[processIncomingMessage] error for ${channelName}:`, err);
  }
  const { sequenceNumber, isFec, packetType, payload } = parseWebRTCPacket(new Uint8Array(message));
  // if (!channelName.includes("cam_360p")) {
  //   console.log(
  //     `[WebRTC] Channel name ${channelName} Packet details - Seq: ${sequenceNumber}, FEC: ${isFec}, Type: ${packetType}, Payload length: ${payload.length}`
  //   );
  //   return;
  // }
  if (isFec) {
    const result = fecManager.process_fec_packet(payload, sequenceNumber);
    if (result) {
      const decodedData = result[0][1];
      // jitterBuffer.processWithJitterBuffer(sequenceNumber, decodedData.buffer);
      // handleBinaryPacket(decodedData.buffer);
      processIncomingMessage(channelName, decodedData.buffer);

      return;
    }
  } else {
    // jitterBuffer.processWithJitterBuffer(sequenceNumber, payload.buffer);
    // handleBinaryPacket(payload.buffer);
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
  console.log(`[Config] Receive stream config of channel: ${channelName}:`, cfg);

  const desc = base64ToUint8Array(cfg.description);

  if (channelName.startsWith("cam_")) {
    const quality = channelName.includes("360p") ? "360p" : "720p";
    const videoConfig = {
      codec: cfg.codec,
      codedWidth: cfg.codedWidth,
      codedHeight: cfg.codedHeight,
      frameRate: cfg.frameRate,
      description: desc,
    };

    if (quality === "360p") video360pConfig = videoConfig;
    else video720pConfig = videoConfig;
    console.log("config video decoder for:", quality, videoConfig);

    configureVideoDecoders(quality);
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
      console.log("Error decoding first audio frame:", error);
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
  console.log(`Attached WebTransport stream for ${channelName}`);

  const initText = `subscribe:${channelName}`;
  console.log(`Sending init message for ${channelName}:`, initText);

  const initData = new TextEncoder().encode(initText);
  const len = initData.length;
  const out = new Uint8Array(4 + len);
  const view = new DataView(out.buffer);
  view.setUint32(0, len, false);
  out.set(initData, 4);

  writer.write(out);

  // if (channelName.startsWith("cam_")) readVideoStream(channelName, reader);
  // else if (channelName.startsWith("mic_")) readAudioStream(reader);
  readStream(channelName, reader);
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
    console.error(`[readStream] ${channelName}:`, err);
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
      try {
        const json = JSON.parse(text);
        if (json.type === "StreamConfig") {
          handleStreamConfig(channelName, json.config);
          return;
        }
      } catch (e) {
        console.warn(`[${channelName}] Non-JSON text:`, text);
        return;
      }
    }
  } catch (err) {
    console.error(`[processIncomingMessage] error for ${channelName}:`, err);
  }
  if (message instanceof ArrayBuffer) {
    handleBinaryPacket(message);
  } else {
    handleBinaryPacket(message.buffer);
  }
}
let videoCounterTest = 0;
setInterval(() => {
  console.log("Receive frame rate:", videoCounterTest / 5);
  videoCounterTest = 0;
}, 5000);
let last_720p_frame_sequence = 0;
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
      if (videoDecoder360p.state === "closed") {
        videoDecoder360p = new VideoDecoder(createVideoInit("360p"));
        videoDecoder360p.configure(video360pConfig);
      }
      const encodedChunk = new EncodedVideoChunk({
        timestamp: timestamp * 1000,
        type,
        data,
      });

      videoDecoder360p.decode(encodedChunk);
    }
    return;
  } else if (frameType === 2 || frameType === 3) {
    // stats.record(sequenceNumber);
    // if (last_720p_frame_sequence === sequenceNumber) {
    //   return;
    // }
    videoCounterTest++;
    last_720p_frame_sequence = sequenceNumber;
    // console.log(
    //   `Received video frame - Seq: ${sequenceNumber}, size: ${data.byteLength} bytes`
    // );
    const type = frameType === 2 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      if (videoDecoder720p.state === "closed") {
        videoDecoder720p = new VideoDecoder(createVideoInit("720p"));
        videoDecoder720p.configure(video720pConfig);
      }
      const encodedChunk = new EncodedVideoChunk({
        timestamp: timestamp * 1000,
        type,
        data,
      });

      videoDecoder720p.decode(encodedChunk);
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
      console.error("Audio decode error:", err);
    }
  }
}

// ------------------------------
// Decoder configuration
// ------------------------------

async function initializeDecoders() {
  console.log("Initializing decoders...");
  videoDecoder360p = new VideoDecoder(createVideoInit("360p"));
  videoDecoder720p = new VideoDecoder(createVideoInit("720p"));
  currentVideoDecoder = videoDecoder360p;

  try {
    audioDecoder = new OpusAudioDecoder(audioInit);
  } catch (error) {
    console.error("Failed to initialize OpusAudioDecoder:", error);
  }

  // curVideoInterval = { speed: 0, rate: 1000 / 30 };
  // curAudioInterval = { speed: 0, rate: 1000 / (48000 / 1024) };
}

function configureVideoDecoders(quality) {
  const config = quality === "360p" ? video360pConfig : video720pConfig;
  if (!config) return;

  try {
    const decoder = quality === "360p" ? videoDecoder360p : videoDecoder720p;
    if (decoder.state === "unconfigured") {
      decoder.configure(config);
      // videoFrameRate = config.frameRate;
    }

    // videoCodecReceived = true;
    self.postMessage({
      type: "codecReceived",
      stream: "video",
      video360pConfig,
      video720pConfig,
    });
  } catch (error) {
    console.error("Failed to configure video decoder:", error);
  }
}

// ------------------------------
// Bitrate Switching
// ------------------------------

async function handleBitrateSwitch(quality) {
  if (quality === currentQuality) {
    console.log(`[Bitrate] Already at ${quality}, no switch needed.`);
    return;
  }

  if (isWebRTC) {
    await handleWebRTCBitrateSwitch(quality);
  } else {
    await handleWebTransportBitrateSwitch(quality);
  }
}

async function handleWebRTCBitrateSwitch(quality) {
  try {
    const currentChannel = webRtcDataChannels.get(`cam_${currentQuality}`);
    const targetChannel = webRtcDataChannels.get(`cam_${quality}`);

    if (!targetChannel || targetChannel.readyState !== "open") {
      console.warn(`[Bitrate] Target channel cam_${quality} not ready.`);
      return;
    }

    const encoder = new TextEncoder();

    if (currentChannel && currentChannel.readyState === "open") {
      console.log(`[Bitrate] Sending "pause" to cam_${currentQuality}`);
      currentChannel.send(encoder.encode("pause"));
    }

    if (targetChannel.readyState === "open") {
      console.log(`[Bitrate] Sending "resume" to cam_${quality}`);
      targetChannel.send(encoder.encode("resume"));
    }

    currentQuality = quality;
    currentVideoDecoder = quality === "360p" ? videoDecoder360p : videoDecoder720p;
    keyFrameReceived = false;

    self.postMessage({
      type: "bitrateChanged",
      quality,
    });

    console.log(`[Bitrate] Switched to ${quality}`);
  } catch (err) {
    console.error(`[Bitrate] Failed to switch to ${quality}:`, err);
    self.postMessage({
      type: "error",
      message: `Failed to switch bitrate: ${err.message}`,
    });
  }
}

async function handleWebTransportBitrateSwitch(quality) {
  const currentStream = channelStreams.get(`cam_${currentQuality}`);
  const targetStream = channelStreams.get(`cam_${quality}`);

  if (!targetStream) {
    console.warn(`[Bitrate] Target stream cam_${quality} not attached.`);
    return;
  }

  try {
    const encoder = new TextEncoder();

    if (currentStream && currentStream.writer) {
      console.log(`[Bitrate] Sending "pause" to cam_${currentQuality}`);
      await currentStream.writer.write(encoder.encode("pause"));
    }

    if (targetStream && targetStream.writer) {
      console.log(`[Bitrate] Sending "resume" to cam_${quality}`);
      await targetStream.writer.write(encoder.encode("resume"));
    }

    currentQuality = quality;
    currentVideoDecoder = quality === "360p" ? videoDecoder360p : videoDecoder720p;
    keyFrameReceived = false;

    self.postMessage({
      type: "bitrateChanged",
      quality,
    });

    console.log(`[Bitrate] Switched to ${quality}`);
  } catch (err) {
    console.error(`[Bitrate] Failed to switch to ${quality}:`, err);
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
        console.error(`Error closing channel ${name}:`, e);
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
        console.error(`Error closing WebSocket ${name}:`, e);
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
