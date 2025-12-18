import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, STREAM_TYPE } from "./publisherConstants.js";

import CommandSender from "./ClientCommand.js";

let subscribeType = STREAM_TYPE.CAMERA;

let currentVideoChannel = CHANNEL_NAME.VIDEO_360P;

let workletPort = null;
let audioEnabled = true;

let mediaConfigs = new Map();

let mediaDecoders = new Map();

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

let webSocketConnection = null;
let webTPStreamReader = null;
let webTPStreamWriter = null;

// WebSocket specific
let isWebSocket = false;

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
    self.postMessage({ type: "videoData", frame, quality: channelName }, [frame]);
  },
  error: (e) => {
    proxyConsole.error(`Video decoder error (${channelName}):`, e);
    self.postMessage({
      type: "error",
      message: `${channelName} decoder: ${e.message}`,
    });
    // Attempt to recover by resetting keyframe flag - next keyframe will reinitialize decoder
    keyFrameReceived = false;
    proxyConsole.warn(`[Recovery] Reset keyframe flag for ${channelName} decoder, waiting for next keyframe`);
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
  const { type, port, quality, readable, writable, channelName, dataChannel, wsUrl, localStreamId } = e.data;

  switch (type) {
    case "init":
      if (port instanceof MessagePort) workletPort = port;
      subscribeType = e.data.subscribeType || STREAM_TYPE.CAMERA;
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
        attachWebTransportStream(readable, writable);
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
    commandSender.initSubscribeChannelStream(subscribeType);

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
        if (json.type === "DecoderConfigs") {
          handleStreamConfigs(channelName, json.config);
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
    const result = fecManager.process_fec_packet(payload, sequenceNumber);
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

function handleStreamConfigs(json) {
  if (json.type !== "DecoderConfigs") return;

  for (const [key, value] of Object.entries(json)) {
    if (key === "type") continue;

    try {
      const stream = JSON.parse(value);
      if (stream.type !== "StreamConfig") continue;

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
            decoder.configure(audioConfig);

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
              proxyConsole.warn(`Error decoding first audio frame (${channelName}):`, err);
            }
          } catch (err) {
            proxyConsole.warn(`Configure decoder fail ${channelName}:`, err);
          }
        } else {
          proxyConsole.warn(`No decoder for audio channel ${channelName}`);
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

async function attachWebTransportStream(readable, writable) {
  webTPStreamReader = readable.getReader();
  webTPStreamWriter = writable.getWriter();

  commandSender.initSubscribeChannelStream(subscribeType);

  proxyConsole.log(`Attached WebTransport stream`);

  commandSender.startStream();
  readStream(webTPStreamReader);
}

async function sendOverStream(frameBytes) {
  if (!webTPStreamWriter) {
    proxyConsole.error(`WebTransport stream not found`);
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
    proxyConsole.error(`Failed to send over stream:`, error);
    throw error;
  }
}

async function readStream(reader) {
  const delimitedReader = new LengthDelimitedReader(reader);
  try {
    while (true) {
      const message = await delimitedReader.readMessage();
      if (message === null) break;
      await processIncomingMessage(message);
    }
  } catch (err) {
    proxyConsole.error(`[readStream] error:`, err);
  }
}

async function processIncomingMessage(message) {
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
        if (json.type === "DecoderConfigs") {
          handleStreamConfigs(json);
          return;
        }
      } catch (e) {
        proxyConsole.warn(`[processIncomingMessage] Non-JSON text:`, text);
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

// let videoCounterTest = 0;
// setInterval(() => {
//   proxyConsole.log("Receive frame rate:", videoCounterTest / 5);
//   videoCounterTest = 0;
// }, 5000);

function handleBinaryPacket(dataBuffer) {
  const dataView = new DataView(dataBuffer);
  const sequenceNumber = dataView.getUint32(0, false);
  const timestamp = dataView.getUint32(4, false);
  const frameType = dataView.getUint8(8);
  const data = dataBuffer.slice(9);

  // DEBUG: Only log screen share packets (frameType 4 or 5)
  if (frameType === 4 || frameType === 5) {
    console.warn(`[Worker] 📺 SCREEN_SHARE packet: frameType=${frameType}, seq=${sequenceNumber}, size=${data.byteLength}`);
  }


  if (frameType === 0 || frameType === 1) {
    const type = frameType === 0 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
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
        keyFrameReceived = false; // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 2 || frameType === 3) {
    const type = frameType === 2 ? "key" : "delta";
    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
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
        keyFrameReceived = false; // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 4 || frameType === 5) {
    // DEBUG: Screen share packet received
    console.warn(`[Worker] 📺 Screen share packet received! frameType=${frameType}, size=${data.byteLength}`);

    // todo: bind screen share 720p and camera 720p packet same packet type, dont need separate, create and get decoder base on subscribe type!!!!
    let videoDecoderScreenShare720p = mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
    const type = frameType === 4 ? "key" : "delta";

    console.warn(`[Worker] Screen share decoder exists: ${!!videoDecoderScreenShare720p}, type: ${type}, keyFrameReceived: ${keyFrameReceived}`);


    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      try {
        if (mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P).state === "closed") {
          videoDecoderScreenShare720p = new VideoDecoder(createVideoInit(CHANNEL_NAME.SCREEN_SHARE_720P));
          const screenShare720pConfig = mediaConfigs.get(CHANNEL_NAME.SCREEN_SHARE_720P);
          proxyConsole.log("Decoder error, Configuring screen share 720p decoder with config:", screenShare720pConfig);
          mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P).configure(screenShare720pConfig);
        }
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });

        videoDecoderScreenShare720p.decode(encodedChunk);
      } catch (error) {
        proxyConsole.error("Screen share video decode error:", error);
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
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, new OpusAudioDecoder(audioInit));
      break;

    case STREAM_TYPE.SCREEN_SHARE:
      mediaDecoders.set(
        CHANNEL_NAME.SCREEN_SHARE_720P,
        new VideoDecoder(createVideoInit(CHANNEL_NAME.SCREEN_SHARE_720P))
      );
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

    default:
      mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_360P)));
      mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, new VideoDecoder(createVideoInit(CHANNEL_NAME.VIDEO_720P)));
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, new OpusAudioDecoder(audioInit));
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
