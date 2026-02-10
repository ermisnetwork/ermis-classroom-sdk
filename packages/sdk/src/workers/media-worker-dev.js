import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { CHANNEL_NAME, STREAM_TYPE } from "./publisherConstants.js";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";

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

const createVideoInit = (channelName) => ({
  output: (frame) => {
    // Native VideoDecoder outputs VideoFrame - send directly (transferable)
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
      if (!self._frameCount) self._frameCount = 0;
      self._frameCount++;
      self.postMessage({ type: "videoData", frame, quality: channelName }, [frame]);
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
      type: "error",
      message: `${channelName} decoder: ${e.message}`,
    });
    keyFrameReceived = false;
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
      for (let i = 0; i < audioData.numberOfChannels; i++) {
        const channel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(channel, { planeIndex: i });
        channelData.push(channel);
      }
    }

    // iOS 15 Debug: Log audio data being sent to worklet
    if (!self._audioFrameCount) self._audioFrameCount = 0;
    self._audioFrameCount++;
    if (self._audioFrameCount <= 5 || self._audioFrameCount % 100 === 0) {
      console.log('[iOS15 Audio DEBUG] Sending audio to worklet, frame#:', self._audioFrameCount, 
        'channels:', channelData.length, 
        'frames:', audioData.numberOfFrames,
        'workletPort:', workletPort ? 'CONNECTED' : 'NULL');
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
    } else {
      console.error('[iOS15 Audio DEBUG] workletPort is NULL! Cannot send audio data');
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
      // Get audioEnabled from init message - for screen share, this determines if we should subscribe to audio
      subscriptionAudioEnabled = e.data.audioEnabled !== undefined ? e.data.audioEnabled : true;
      console.log(`[Worker] Init with subscribeType=${subscribeType}, audioEnabled=${subscriptionAudioEnabled}`);
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
    // Use subscriptionAudioEnabled for audio option - dynamically determined based on publisher's screen share audio
    const options = {
      audio: subscribeType === STREAM_TYPE.CAMERA ? true : subscriptionAudioEnabled,
      video: true,
    };
    proxyConsole.log(`[WebSocket] Connected to ${wsUrl}, options:`, options);
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
        if (!isNativeDecoder && desc && desc.length > 0) {
          videoConfig.description = desc;
        }

        mediaConfigs.set(channelName, videoConfig);

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
              // DEBUG: Log the desc structure to understand iOS 15 issue
              console.log(`[Audio Debug] desc length: ${desc.length}, first 16 bytes:`, Array.from(desc.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
              
              const dataView = new DataView(desc.buffer);
              const timestamp = dataView.getUint32(4, false);
              const data = desc.slice(9);
              console.log(`[Audio Debug] data:`, data);

              // DEBUG: Check if data is a valid OggS page with BOS
              const isOggS = data.length >= 4 && data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53;
              const headerType = data.length > 5 ? data[5] : -1;
              const hasBOS = (headerType & 0x02) !== 0;
              console.log(`[Audio Debug] After slice(9): OggS=${isOggS}, headerType=0x${headerType.toString(16)}, BOS=${hasBOS}, length=${data.length}`);
              if (data.length >= 40) {
                console.log(`[Audio Debug] Bytes 35-40 (channel info):`, Array.from(data.slice(35, 41)).map(b => b.toString(16).padStart(2, '0')).join(' '));
              }

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
  // Use subscriptionAudioEnabled for audio option - dynamically determined based on publisher's screen share audio
  const options = {
    audio: subscribeType === STREAM_TYPE.CAMERA ? true : subscriptionAudioEnabled,
    video: true,
  };
  proxyConsole.warn(`[WebTransport] Attached stream, options:`, options);

  commandSender.initSubscribeChannelStream(subscribeType, options);

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

async function handleBinaryPacket(dataBuffer) {
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
      let decoder360p = mediaDecoders.get(CHANNEL_NAME.VIDEO_360P);
      const decoderState = decoder360p ? decoder360p.state : null;

      // Recreate decoder if closed or in error state
      if (!decoder360p || decoderState === "closed" || decoderState === "unconfigured") {
        decoder360p = await createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
        const video360pConfig = mediaConfigs.get(CHANNEL_NAME.VIDEO_360P);
        if (video360pConfig) {
          decoder360p.configure(video360pConfig);
        }
      }

      try {
        // Skip empty data
        if (data.byteLength === 0) {
          return;
        }
        
        // Debug: Log decoder state and frame info
        if (!self._decodeCount) self._decodeCount = 0;
        self._decodeCount++;
        
        // Check if using polyfill (H264Decoder wrapper) or native VideoDecoder
        // Guard against VideoDecoder not existing on iOS 15
        const hasNativeVideoDecoder = typeof VideoDecoder !== 'undefined';
        const isPolyfill = decoder360p.usingNative === false || !hasNativeVideoDecoder || !(decoder360p instanceof VideoDecoder);
        
        if (isPolyfill) {
          // WASM decoder expects plain object with .data property
          decoder360p.decode({
            type,
            timestamp: timestamp * 1000,
            data: new Uint8Array(data),
          });
        } else {
          // Native VideoDecoder expects EncodedVideoChunk
          const encodedChunk = new EncodedVideoChunk({
            timestamp: timestamp * 1000,
            type,
            data,
          });
          decoder360p.decode(encodedChunk);
        }
      } catch (err) {
        console.error("360p decode error:", err);
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
        decoder720p = await createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);
        mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
        const config720p = mediaConfigs.get(CHANNEL_NAME.VIDEO_720P);
        if (config720p) {
          proxyConsole.log("Decoder error, Configuring 720p decoder with config:", config720p);
          decoder720p.configure(config720p);
        }
      }

      try {
        // Skip empty data
        if (data.byteLength === 0) {
          return;
        }
        
        // Check if using polyfill or native
        // Guard against VideoDecoder not existing on iOS 15
        const hasNativeVideoDecoder = typeof VideoDecoder !== 'undefined';
        const isPolyfill = decoder720p.usingNative === false || !hasNativeVideoDecoder || !(decoder720p instanceof VideoDecoder);
        
        if (isPolyfill) {
          decoder720p.decode({
            type,
            timestamp: timestamp * 1000,
            data: new Uint8Array(data),
          });
        } else {
          const encodedChunk = new EncodedVideoChunk({
            timestamp: timestamp * 1000,
            type,
            data,
          });
          decoder720p.decode(encodedChunk);
        }
      } catch (err) {
        console.error("720p decode error:", err);
        keyFrameReceived = false; // Wait for next keyframe
      }
    }
    return;
  } else if (frameType === 4 || frameType === 5) {
    // todo: bind screen share 720p and camera 720p packet same packet type, dont need separate, create and get decoder base on subscribe type!!!!
    let videoDecoderScreenShare720p = mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
    const type = frameType === 4 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (keyFrameReceived) {
      try {
        if (mediaDecoders.get(CHANNEL_NAME.SCREEN_SHARE_720P).state === "closed") {
          videoDecoderScreenShare720p = await createVideoDecoderWithFallback(CHANNEL_NAME.SCREEN_SHARE_720P);
          mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, videoDecoderScreenShare720p);
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
    // iOS 15 Debug: Track audio frame reception
    if (!self._audioPacketCount) self._audioPacketCount = 0;
    self._audioPacketCount++;
    if (self._audioPacketCount <= 5 || self._audioPacketCount % 100 === 0) {
      console.log('[iOS15 Audio DEBUG] Audio packet received, frame#:', self._audioPacketCount, 
        'timestamp:', timestamp, 'dataLen:', data.byteLength);
    }

    let audioDecoder = mediaDecoders.get(
      subscribeType === STREAM_TYPE.CAMERA ? CHANNEL_NAME.MIC_AUDIO : CHANNEL_NAME.SCREEN_SHARE_AUDIO
    );
    
    if (!audioDecoder) {
      console.error('[iOS15 Audio DEBUG] audioDecoder is NULL/undefined!');
      return;
    }

    // iOS 15 Debug: Check decoder state before decode
    if (self._audioPacketCount <= 5) {
      console.log('[iOS15 Audio DEBUG] audioDecoder state:', audioDecoder.state,
        'hasWorker:', !!audioDecoder.decoderWorker,
        'frameCounter:', audioDecoder.frameCounter);
    }

    const chunk = new EncodedAudioChunk({
      timestamp: timestamp * 1000,
      type: "key",
      data,
    });

    try {
      audioDecoder.decode(chunk);
      
      // iOS 15 Debug: Log after decode call
      if (self._audioPacketCount <= 5) {
        console.log('[iOS15 Audio DEBUG] decode() called successfully, frameCounter now:', audioDecoder.frameCounter);
      }
    } catch (err) {
      console.error('[iOS15 Audio DEBUG] Audio decode error:', err);
    }
  }
}

// ------------------------------
// Decoder configuration
// ------------------------------

async function initializeDecoders() {
  proxyConsole.log("Initializing camera decoders for subscribe type:", subscribeType);
  switch (subscribeType) {
    case STREAM_TYPE.CAMERA: {
      const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
      const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);
      
      const micAudioDecoder = new OpusAudioDecoder(audioInit);
      console.log('[iOS15 Audio DEBUG] Created OpusAudioDecoder, configuring...');
      
      // Initialize audio immediately, don't wait for video
      const audioConfigPromise = micAudioDecoder.configure({ sampleRate: 48000, numberOfChannels: 1 });
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, micAudioDecoder);

      // Wait for video decoders concurrently
      const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
      mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
      mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
      
      await audioConfigPromise; // Ensure audio is configured (fast)
      console.log('[iOS15 Audio DEBUG] OpusAudioDecoder configured, state:', micAudioDecoder.state,
        'hasWorker:', !!micAudioDecoder.decoderWorker);
      break;
    }

    case STREAM_TYPE.SCREEN_SHARE: {
      const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.SCREEN_SHARE_720P);

      const screenAudioDecoder = new OpusAudioDecoder(audioInit);
      const audioConfigPromise = screenAudioDecoder.configure({ sampleRate: 48000, numberOfChannels: 1 });
      mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_AUDIO, screenAudioDecoder);

      const decoderScreen720p = await video720pPromise;
      mediaDecoders.set(CHANNEL_NAME.SCREEN_SHARE_720P, decoderScreen720p);
      
      await audioConfigPromise;

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
      const video360pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_360P);
      const video720pPromise = createVideoDecoderWithFallback(CHANNEL_NAME.VIDEO_720P);

      const defaultMicAudioDecoder = new OpusAudioDecoder(audioInit);
      const audioConfigPromise = defaultMicAudioDecoder.configure({ sampleRate: 48000, numberOfChannels: 1 });
      mediaDecoders.set(CHANNEL_NAME.MIC_AUDIO, defaultMicAudioDecoder);

      const [decoder360p, decoder720p] = await Promise.all([video360pPromise, video720pPromise]);
      mediaDecoders.set(CHANNEL_NAME.VIDEO_360P, decoder360p);
      mediaDecoders.set(CHANNEL_NAME.VIDEO_720P, decoder720p);
      
      await audioConfigPromise;
      break;
    }
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
