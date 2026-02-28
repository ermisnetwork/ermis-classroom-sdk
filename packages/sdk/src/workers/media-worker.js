// import { AacAudioDecoder } from "../aac_decoder/aacDecoder.js";
import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";

// import { OpusAudioDecoder } from "../opus_decoder/opusDecoder";

// importScripts("../opus_decoder/opusDecoder.js?v=1");
// importScripts("./polyfills/audioData.min.js");
// importScripts("./polyfills/encodedAudioChunk.min.js");

let videoDecoder;
let audioDecoder;
let mediaWebsocket = null;
let videoConfig;
let videoFrameRate;
let audioFrameRate;
let audioConfig;
let videoFrameBuffer = [];
let audioFrameBuffer = [];
let curVideoInterval;
let curAudioInterval;
let videoIntervalID;
let audioIntervalID;
let workletPort = null;

let audioEnabled = true;

let mediaUrl = null;

let videoCodecReceived = false;
let audioCodecReceived = false;
let keyFrameReceived = false;

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

// Helper: Convert YUV420 to RGBA for transfer to main thread
function convertYUV420toRGBA(yPlane, uPlane, vPlane, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const uvWidth = width >> 1;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const yIndex = j * width + i;
      const uvIndex = (j >> 1) * uvWidth + (i >> 1);
      const y = yPlane[yIndex];
      const u = uPlane[uvIndex] - 128;
      const v = vPlane[uvIndex] - 128;
      let r = y + 1.402 * v;
      let g = y - 0.344136 * u - 0.714136 * v;
      let b = y + 1.772 * u;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      const rgbaIndex = yIndex * 4;
      rgba[rgbaIndex] = r;
      rgba[rgbaIndex + 1] = g;
      rgba[rgbaIndex + 2] = b;
      rgba[rgbaIndex + 3] = 255;
    }
  }
  return rgba;
}

// Helper: Create polyfill decoder
async function createPolyfillDecoder() {
  const decoder = new H264Decoder();
  decoder.onOutput = videoInit.output;
  decoder.onError = videoInit.error;
  await decoder.configure({ codec: 'avc1.42001f' });
  return decoder;
}

// Helper: Create decoder with fallback
async function createVideoDecoderWithFallback() {
  try {
    const nativeSupported = await isNativeH264DecoderSupported();
    if (nativeSupported) {
      return new VideoDecoder(videoInit);
    }
  } catch (e) {
    proxyConsole.warn("Native VideoDecoder not available, using polyfill");
  }
  return createPolyfillDecoder();
}

const videoInit = {
  output: (frame) => {
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
      self.postMessage({ type: "videoData", frame: frame }, [frame]);
    } else if (frame.format === 'yuv420') {
      const rgba = convertYUV420toRGBA(frame.yPlane, frame.uPlane, frame.vPlane, frame.width, frame.height);
      self.postMessage({ 
        type: "videoData", 
        frame: { format: 'rgba', data: rgba, width: frame.width, height: frame.height }
      }, [rgba.buffer]);
    }
  },
  error: (e) => {
    proxyConsole.error("Video decoder error:", e);
    self.postMessage({ type: "error", message: e.message });
  },
};

function logStats() {
  setInterval(() => {
    proxyConsole.log(
      "Buffer stats:",
      videoFrameBuffer.length,
      audioFrameBuffer.length
    );
  }, 5000);
}

function startSendingVideo(interval) {
  clearInterval(videoIntervalID);
  videoIntervalID = setInterval(() => {
    const len = videoFrameBuffer.length;

    if (len > 15 && curVideoInterval.speed !== 3) {
      curVideoInterval.speed = 3;
      curVideoInterval.rate = (1000 / videoFrameRate) * 0.75;
      startSendingVideo(curVideoInterval);
    } else if (len > 10 && len <= 15 && curVideoInterval.speed !== 2) {
      curVideoInterval.speed = 2;
      curVideoInterval.rate = (1000 / videoFrameRate) * 0.85;
      startSendingVideo(curVideoInterval);
    } else if (len <= 10 && len > 5 && curVideoInterval.speed !== 1) {
      curVideoInterval.speed = 1;
      curVideoInterval.rate = 1000 / videoFrameRate;
      startSendingVideo(curVideoInterval);
    } else if (len <= 5 && curVideoInterval.speed !== 0) {
      curVideoInterval.speed = 0;
      curVideoInterval.rate = (1000 / videoFrameRate) * 1.05;
      startSendingVideo(curVideoInterval);
    }

    const frameToSend = videoFrameBuffer.shift();
    if (frameToSend) {
      videoDecoder.decode(frameToSend);
    }
  }, interval.rate);
}

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
          channelData: channelData,
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

function startSendingAudio(interval) {
  clearInterval(audioIntervalID);

  audioIntervalID = setInterval(() => {
    const len = audioFrameBuffer.length;

    if (len > 15 && curAudioInterval.speed !== 2) {
      curAudioInterval.speed = 2;
      curAudioInterval.rate = (1000 / audioFrameRate) * 0.85;
      startSendingAudio(curAudioInterval);
      return;
    }

    if (len > 10 && len <= 15 && curAudioInterval.speed !== 1) {
      curAudioInterval.speed = 1;
      curAudioInterval.rate = (1000 / audioFrameRate) * 0.93;
      startSendingAudio(curAudioInterval);
      return;
    }

    if (len <= 10 && len > 5 && curAudioInterval.speed !== 0) {
      curAudioInterval.speed = 0;
      curAudioInterval.rate = 1000 / audioFrameRate;
      startSendingAudio(curAudioInterval);
      return;
    }

    if (len <= 5 && curAudioInterval.speed !== -1) {
      curAudioInterval.speed = -1;
      curAudioInterval.rate = (1000 / audioFrameRate) * 1.05;
      startSendingAudio(curAudioInterval);
      return;
    }

    const frameToSend = audioFrameBuffer.shift();

    if (frameToSend) {
      if (audioDecoder.state === "configured") {
        try {
          audioDecoder.decode(frameToSend);
        } catch (error) {
          self.postMessage({
            type: "error",
            message: `Audio decode error: ${error.message}`,
          });

          if (error.message.includes("unconfigured codec")) {
            clearInterval(audioIntervalID);
            audioPlaybackStarted = false;
            self.postMessage({
              type: "status",
              message: "Audio decoder reset due to error",
            });
          }
        }
      } else {
        audioFrameBuffer.unshift(frameToSend);

        self.postMessage({
          type: "status",
          message: `Waiting for audio decoder (${audioDecoder.state})`,
        });

        if (audioDecoder.state === "unconfigured" && audioConfig) {
          try {
            audioDecoder.configure(audioConfig);
            self.postMessage({
              type: "status",
              message: "Audio decoder reconfigured",
            });
          } catch (e) {
            self.postMessage({
              type: "error",
              message: `Failed to reconfigure audio: ${e.message}`,
            });
          }
        }
      }
    }
  }, interval.rate);
}

self.onmessage = async function (e) {
  const { type, data, port } = e.data;
  switch (type) {
    case "init":
      mediaUrl = data.mediaUrl;
      proxyConsole.log("Media Worker: Initializing with stream url:", mediaUrl);
      await initializeDecoders();
      setupWebSocket();
      if (port && port instanceof MessagePort) {
        proxyConsole.log("Media Worker: Received port to connect to Audio Worklet.");
        workletPort = port;
      }
      break;

    case "toggle-audio":
      audioEnabled = !audioEnabled;
      proxyConsole.log(
        "Media Worker: Toggling audio. Now audioEnabled =",
        audioEnabled
      );
      self.postMessage({ type: "audio-toggled", audioEnabled });
      break;

    case "reset":
      proxyConsole.log("Media Worker: Resetting decoders and buffers.");
      resetWebsocket();
      break;
    case "stop":
      proxyConsole.log("Media Worker: Stopping all operations.");
      stop();
      break;
  }
};

async function initializeDecoders() {
  self.postMessage({
    type: "log",
    level: "info",
    event: "init-decoders",
    message: "Initializing decoders",
  });
  videoDecoder = await createVideoDecoderWithFallback();
  try {
    audioDecoder = new OpusAudioDecoder(audioInit);
    self.postMessage({
      type: "log",
      level: "info",
      event: "opus-decoder-init",
      message: "OpusAudioDecoder initialized successfully",
    });
  } catch (error) {
    self.postMessage({
      type: "log",
      level: "error",
      event: "opus-decoder-init-fail",
      message: "Failed to initialize OpusAudioDecoder: " + error.message,
    });
    proxyConsole.error("Failed to initialize OpusAudioDecoder:", error);
  }
}

function setupWebSocket() {
  mediaWebsocket = new WebSocket(mediaUrl);
  mediaWebsocket.binaryType = "arraybuffer";
  mediaWebsocket.onopen = () => {
    self.postMessage({
      type: "log",
      level: "info",
      event: "ws-connected",
      message: "media websocket Connected",
    });
  };
  mediaWebsocket.onmessage = handleMediaWsMessage;
  mediaWebsocket.onclose = handleMediaWsClose;
}

async function handleMediaWsMessage(event) {
  if (typeof event.data === "string") {
    const dataJson = JSON.parse(event.data);
    if (dataJson.type === "TotalViewerCount") {
      proxyConsole.log(
        "[Media worker]: TotalViewerCount received from websocket:",
        dataJson.total_viewers
      );
      self.postMessage({
        type: "TotalViewerCount",
        count: dataJson.total_viewers,
      });
      return;
    }

    if (
      dataJson.type === "DecoderConfigs" &&
      (!videoCodecReceived || !audioCodecReceived)
    ) {
      videoConfig = dataJson.videoConfig;
      audioConfig = dataJson.audioConfig;
      videoFrameRate = videoConfig.frameRate;
      audioFrameRate = audioConfig.sampleRate / 1024;
      const vConfigRecv = videoConfig.description;
      videoConfig.description = base64ToUint8Array(videoConfig.description);

      const audioConfigDescription = base64ToUint8Array(
        audioConfig.description
      );
      videoDecoder.configure(videoConfig);
      audioDecoder.configure(audioConfig);

      // decode first audio frame to trigger audio decoder
      try {
        const dataView = new DataView(audioConfigDescription.buffer);
        const timestamp = dataView.getUint32(0, false);
        const data = audioConfigDescription.slice(5);

        const chunk = new EncodedAudioChunk({
          timestamp: timestamp * 1000,
          type: "key",
          data,
        });
        audioDecoder.decode(chunk);
        proxyConsole.log("Decoded first audio frame to initialize decoder.");
      } catch (error) {
        proxyConsole.log("Error decoding first audio frame:", error);
      }
      videoCodecReceived = true;
      audioCodecReceived = true;
      self.postMessage({
        type: "codecReceived",
        stream: "both",
        videoConfig,
        audioConfig,
      });
      return;
    }

    if (event.data === "publish") {
      videoDecoder.reset();
      audioDecoder.reset();
      videoCodecReceived = false;
      audioCodecReceived = false;
      videoCodecDescriptionReceived = false;
      audioCodecDescriptionReceived = false;
      return;
    }
    if (event.data === "ping") {
      return;
    }
  }
  // Nhận frame (ArrayBuffer)
  if (event.data instanceof ArrayBuffer) {
    const dataView = new DataView(event.data);
    const timestamp = dataView.getUint32(0, false);
    const frameType = dataView.getUint8(4);
    const data = event.data.slice(5);
    let type;
    if (frameType === 0) type = "key";
    else if (frameType === 1) type = "delta";
    else if (frameType === 2) type = "audio";
    else if (frameType === 3) type = "config";
    else type = "unknown";

    if (type === "audio") {
      if (!audioEnabled) return;
      // Audio
      if (audioDecoder.state === "closed") {
        audioDecoder = new AudioDecoder(audioInit);
        audioDecoder.configure(audioConfig);
      }
      const chunk = new EncodedAudioChunk({
        timestamp: timestamp * 1000,
        type: "key",
        data,
      });
      audioDecoder.decode(chunk);
      return;
    } else if (type === "key" || type === "delta") {
      // Video
      type === "key" && (keyFrameReceived = true);
      if (keyFrameReceived) {
        if (videoDecoder.state === "closed") {
          videoDecoder = await createVideoDecoderWithFallback();
          videoDecoder.configure(videoConfig);
        }
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
          // duration: 1000000 / Math.ceil(videoFrameRate),
        });
        // videoFrameBuffer.push(encodedChunk);
        videoDecoder.decode(encodedChunk);

        return;
      }
    } else if (type === "config") {
      // Config data
      proxyConsole.warn("[Media worker]: Received config data (unexpected):", data);
      return;
    }
    // Unknown type
  }
}

function handleMediaWsClose() {
  proxyConsole.warn("Media WebSocket closed");
  self.postMessage({
    type: "connectionClosed",
    stream: "media",
    message: "Media WebSocket closed",
  });
}

function resetWebsocket() {
  // Đóng websocket cũ nếu còn mở
  if (mediaWebsocket && mediaWebsocket.readyState !== WebSocket.CLOSED) {
    try {
      mediaWebsocket.close();
    } catch (e) {}
    mediaWebsocket = null;
  }

  // Reset decoder, buffer, trạng thái
  if (videoDecoder) {
    videoDecoder.reset();
  }
  if (audioDecoder) {
    audioDecoder.reset();
  }
  videoCodecReceived = false;
  audioCodecReceived = false;
  videoCodecDescriptionReceived = false;
  audioCodecDescriptionReceived = false;
  videoFrameBuffer = [];
  audioFrameBuffer = [];
  videoPlaybackStarted = false;
  audioPlaybackStarted = false;
  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  setupWebSocket();

  self.postMessage({
    type: "log",
    level: "info",
    event: "reset",
    message: "Resetting decoders and buffers",
  });
}

function stop() {
  if (workletPort) {
    workletPort.postMessage({ type: "stop" });
    workletPort = null;
  }

  if (mediaWebsocket) {
    try {
      mediaWebsocket.close();
    } catch (e) {}
    mediaWebsocket = null;
  }

  if (videoDecoder) {
    try {
      videoDecoder.close();
    } catch (e) {}
    videoDecoder = null;
  }
  if (audioDecoder) {
    try {
      audioDecoder.close();
    } catch (e) {}
    audioDecoder = null;
  }

  videoFrameBuffer = [];
  audioFrameBuffer = [];
  videoPlaybackStarted = false;
  audioPlaybackStarted = false;
  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  videoCodecReceived = false;
  audioCodecReceived = false;
  videoCodecDescriptionReceived = false;
  audioCodecDescriptionReceived = false;

  self.postMessage({
    type: "log",
    level: "info",
    event: "stop",
    message: "Stopped all media operations",
  });
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
