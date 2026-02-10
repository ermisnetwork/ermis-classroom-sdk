// import { AacAudioDecoder } from "../aac_decoder/aacDecoder.js";
import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import {log} from "../utils/index.ts";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";

let videoDecoder360p;
let videoDecoder720p;
let currentVideoDecoder;
let currentQuality = "360p";
let audioDecoder;

let ws360p = null;
let ws720p = null;
let wsAudio = null;
let baseUrl = null;

let video360pConfig;
let video720pConfig;
let audioConfig;

let videoFrameRate;
let audioFrameRate;

let videoFrameBuffer = [];
let audioFrameBuffer = [];

let curVideoInterval;
let curAudioInterval;

let videoIntervalID;
let audioIntervalID;

let workletPort = null;
let audioEnabled = true;

let videoCodecReceived = false;
let audioCodecReceived = false;
let keyFrameReceived = false;

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
async function createPolyfillDecoder(quality) {
  const decoder = new H264Decoder();
  const init = createVideoInit(quality);
  decoder.onOutput = init.output;
  decoder.onError = init.error;
  await decoder.configure({ codec: 'avc1.42001f' });
  return decoder;
}

// Helper: Create decoder with fallback
async function createVideoDecoderWithFallback(quality) {
  try {
    const nativeSupported = await isNativeH264DecoderSupported();
    if (nativeSupported) {
      return new VideoDecoder(createVideoInit(quality));
    }
  } catch (e) {
    console.warn("Native VideoDecoder not available, using polyfill");
  }
  return createPolyfillDecoder(quality);
}

const createVideoInit = (quality) => ({
  output: (frame) => {
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
      self.postMessage({ type: "videoData", frame: frame, quality: quality }, [frame]);
    } else if (frame.format === 'yuv420') {
      const rgba = convertYUV420toRGBA(frame.yPlane, frame.uPlane, frame.vPlane, frame.width, frame.height);
      self.postMessage({ 
        type: "videoData", 
        frame: { format: 'rgba', data: rgba, width: frame.width, height: frame.height },
        quality: quality 
      }, [rgba.buffer]);
    }
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

function logStats() {
  setInterval(() => {
    log(
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
      currentVideoDecoder.decode(frameToSend);
    }
  }, interval.rate);
}

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
  const { type, data, port, quality } = e.data;
  switch (type) {
    case "init":
      baseUrl = data.baseUrl;
      log("Media Worker: Initializing with base URL:", baseUrl);
      await initializeDecoders();
      setupWebSockets(quality || "360p");
      if (port && port instanceof MessagePort) {
        log("Media Worker: Received port to connect to Audio Worklet.");
        workletPort = port;
      }
      break;

    case "toggleAudio":
      audioEnabled = !audioEnabled;
      log(
        "Media Worker: Toggling audio. Now audioEnabled =",
        audioEnabled
      );
      self.postMessage({ type: "audio-toggled", audioEnabled });
      break;

    case "switchBitrate":
      handleBitrateSwitch(quality);
      break;

    case "reset":
      log("Media Worker: Resetting decoders and buffers.");
      resetWebsockets();
      break;

    case "stop":
      log("Media Worker: Stopping all operations.");
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

  videoDecoder360p = await createVideoDecoderWithFallback("360p");
  videoDecoder720p = await createVideoDecoderWithFallback("720p");
  currentVideoDecoder = videoDecoder360p;

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
    console.error("Failed to initialize OpusAudioDecoder:", error);
  }

  curVideoInterval = { speed: 0, rate: 1000 / 30 };
  curAudioInterval = { speed: 0, rate: 1000 / (48000 / 1024) };
}

function setupWebSockets(initialQuality = "360p") {
  setupVideoWebSocket(initialQuality);
  setupAudioWebSocket();
}

function setupVideoWebSocket(quality) {
  const wsUrl = `${baseUrl}/cam_${quality}`;
  log(`Setting up video WebSocket for ${quality}:`, wsUrl);

  try {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      log(`Video ${quality} WebSocket connected`);
      self.postMessage({
        type: "log",
        level: "info",
        event: "ws-video-connected",
        message: `Video ${quality} WebSocket connected`,
      });
    };

    ws.onmessage = (event) => handleVideoMessage(event, quality);
    ws.onclose = () => handleVideoClose(quality);
    ws.onerror = (error) => {
      console.error(`Video ${quality} WebSocket error:`, error);
      self.postMessage({
        type: "error",
        message: `Video ${quality} WebSocket error`,
      });
    };

    if (quality === "360p") {
      ws360p = ws;
    } else if (quality === "720p") {
      ws720p = ws;
    }
  } catch (error) {
    console.error(`Failed to create video ${quality} WebSocket:`, error);
    self.postMessage({
      type: "error",
      message: `Failed to create video ${quality} WebSocket: ${error.message}`,
    });
  }
}

function setupAudioWebSocket() {
  const wsUrl = `${baseUrl}/mic_48k`;
  log("Setting up audio WebSocket:", wsUrl);

  try {
    wsAudio = new WebSocket(wsUrl);
    wsAudio.binaryType = "arraybuffer";

    wsAudio.onopen = () => {
      log("Audio WebSocket connected");
      self.postMessage({
        type: "log",
        level: "info",
        event: "ws-audio-connected",
        message: "Audio WebSocket connected",
      });
    };

    wsAudio.onmessage = handleAudioMessage;
    wsAudio.onclose = handleAudioClose;
    wsAudio.onerror = (error) => {
      console.error("Audio WebSocket error:", error);
      self.postMessage({
        type: "error",
        message: "Audio WebSocket error",
      });
    };
  } catch (error) {
    console.error("Failed to create audio WebSocket:", error);
    self.postMessage({
      type: "error",
      message: `Failed to create audio WebSocket: ${error.message}`,
    });
  }
}

async function handleVideoMessage(event, quality) {
  if (typeof event.data === "string") {
    const dataJson = JSON.parse(event.data);

    if (dataJson.type === "StreamConfig") {
      log(`Received video config for ${quality}:`, dataJson);

      const configData = dataJson.config;
      const description = base64ToUint8Array(configData.description);

      const videoConfig = {
        codec: configData.codec,
        codedWidth: configData.codedWidth,
        codedHeight: configData.codedHeight,
        frameRate: configData.frameRate,
        description: description,
      };

      if (quality === "360p") {
        video360pConfig = videoConfig;
      } else if (quality === "720p") {
        video720pConfig = videoConfig;
      }

      // Check if both video configs are ready
      if (video360pConfig && video720pConfig) {
        configureVideoDecoders();
      }

      return;
    }

    if (dataJson.type === "TotalViewerCount") {
      log(
        "[Media worker]: TotalViewerCount received:",
        dataJson.total_viewers
      );
      self.postMessage({
        type: "TotalViewerCount",
        count: dataJson.total_viewers,
      });
      return;
    }

    if (dataJson.type === "ping") {
      return;
    }
  }

  // Handle video frame data (ArrayBuffer)
  if (event.data instanceof ArrayBuffer) {
    const dataView = new DataView(event.data);
    const timestamp = dataView.getUint32(0, false);
    const frameType = dataView.getUint8(4);
    const data = event.data.slice(5);

    // frameType: 0 = key, 1 = delta
    const type = frameType === 0 ? "key" : "delta";

    if (type === "key") {
      keyFrameReceived = true;
    }

    if (!keyFrameReceived) {
      return;
    }

    const decoder = quality === "360p" ? videoDecoder360p : videoDecoder720p;
    const config = quality === "360p" ? video360pConfig : video720pConfig;

    if (decoder.state === "closed") {
      const newDecoder = await createVideoDecoderWithFallback(quality);
      newDecoder.configure(config);
      if (quality === "360p") {
        videoDecoder360p = newDecoder;
      } else {
        videoDecoder720p = newDecoder;
      }
    }

    const encodedChunk = new EncodedVideoChunk({
      timestamp: timestamp * 1000,
      type,
      data,
    });

    const targetDecoder =
      quality === "360p" ? videoDecoder360p : videoDecoder720p;
    targetDecoder.decode(encodedChunk);
  }
}

function handleAudioMessage(event) {
  if (typeof event.data === "string") {
    const dataJson = JSON.parse(event.data);

    if (dataJson.type === "StreamConfig") {
      log("Received audio config:", dataJson);

      const configData = dataJson.config;
      const description = base64ToUint8Array(configData.description);

      audioConfig = {
        codec: configData.codec,
        sampleRate: configData.sampleRate,
        numberOfChannels: configData.numberOfChannels,
        description: description,
      };

      configureAudioDecoder();

      return;
    }

    if (dataJson.type === "ping") {
      return;
    }
  }

  // Handle audio frame data (ArrayBuffer)
  if (event.data instanceof ArrayBuffer && audioEnabled) {
    const dataView = new DataView(event.data);
    const timestamp = dataView.getUint32(0, false);
    const data = event.data.slice(4);

    if (audioDecoder.state === "closed") {
      audioDecoder = new OpusAudioDecoder(audioInit);
      audioDecoder.configure(audioConfig);
    }

    const chunk = new EncodedAudioChunk({
      timestamp: timestamp * 1000,
      type: "key",
      data,
    });

    audioDecoder.decode(chunk);
  }
}

function handleVideoClose(quality) {
  console.warn(`Video ${quality} WebSocket closed`);
  self.postMessage({
    type: "connectionClosed",
    stream: `video-${quality}`,
    message: `Video ${quality} WebSocket closed`,
  });
}

function handleAudioClose() {
  console.warn("Audio WebSocket closed");
  self.postMessage({
    type: "connectionClosed",
    stream: "audio",
    message: "Audio WebSocket closed",
  });
}

function configureVideoDecoders() {
  if (!video360pConfig || !video720pConfig) return;

  try {
    if (videoDecoder360p.state === "unconfigured") {
      videoDecoder360p.configure(video360pConfig);
      videoFrameRate = video360pConfig.frameRate;
    }
    if (videoDecoder720p.state === "unconfigured") {
      videoDecoder720p.configure(video720pConfig);
    }

    videoCodecReceived = true;

    self.postMessage({
      type: "log",
      level: "info",
      event: "video-configured",
      message: "Video decoders configured",
    });

    self.postMessage({
      type: "codecReceived",
      stream: "video",
      video360pConfig,
      video720pConfig,
    });

    if (!videoIntervalID) {
      startSendingVideo(curVideoInterval);
    }
  } catch (error) {
    console.error("Failed to configure video decoders:", error);
    self.postMessage({
      type: "error",
      message: `Failed to configure video decoders: ${error.message}`,
    });
  }
}

function configureAudioDecoder() {
  if (!audioConfig) return;

  try {
    if (audioDecoder.state === "unconfigured") {
      audioDecoder.configure(audioConfig);
      audioFrameRate = audioConfig.sampleRate / 1024;
    }

    audioCodecReceived = true;

    self.postMessage({
      type: "log",
      level: "info",
      event: "audio-configured",
      message: "Audio decoder configured",
    });

    self.postMessage({
      type: "codecReceived",
      stream: "audio",
      audioConfig,
    });

    if (!audioIntervalID) {
      startSendingAudio(curAudioInterval);
    }
  } catch (error) {
    console.error("Failed to configure audio decoder:", error);
    self.postMessage({
      type: "error",
      message: `Failed to configure audio decoder: ${error.message}`,
    });
  }
}

function handleBitrateSwitch(quality) {
  if (quality === currentQuality) {
    return;
  }

  log(`Switching bitrate from ${currentQuality} to ${quality}`);

  // Close old WebSocket and setup new one
  if (quality === "360p" && ws720p) {
    ws720p.close();
    ws720p = null;
    setupVideoWebSocket("360p");
  } else if (quality === "720p" && ws360p) {
    ws360p.close();
    ws360p = null;
    setupVideoWebSocket("720p");
  }

  currentQuality = quality;
  currentVideoDecoder =
    quality === "360p" ? videoDecoder360p : videoDecoder720p;
  keyFrameReceived = false;

  self.postMessage({
    type: "log",
    level: "info",
    event: "bitrate-switched",
    message: `Switched to ${quality}`,
  });

  self.postMessage({
    type: "bitrateChanged",
    quality: quality,
  });
}

function resetWebsockets() {
  closeWebSocket(ws360p);
  closeWebSocket(ws720p);
  closeWebSocket(wsAudio);

  ws360p = null;
  ws720p = null;
  wsAudio = null;

  if (videoDecoder360p) videoDecoder360p.reset();
  if (videoDecoder720p) videoDecoder720p.reset();
  if (audioDecoder) audioDecoder.reset();

  videoCodecReceived = false;
  audioCodecReceived = false;
  keyFrameReceived = false;
  videoFrameBuffer = [];
  audioFrameBuffer = [];

  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  setupWebSockets(currentQuality);

  self.postMessage({
    type: "log",
    level: "info",
    event: "reset",
    message: "Reset all WebSockets and decoders",
  });
}

function stop() {
  if (workletPort) {
    workletPort.postMessage({ type: "stop" });
    workletPort = null;
  }

  closeWebSocket(ws360p);
  closeWebSocket(ws720p);
  closeWebSocket(wsAudio);

  ws360p = null;
  ws720p = null;
  wsAudio = null;

  if (videoDecoder360p) {
    try {
      videoDecoder360p.close();
    } catch (e) {}
    videoDecoder360p = null;
  }

  if (videoDecoder720p) {
    try {
      videoDecoder720p.close();
    } catch (e) {}
    videoDecoder720p = null;
  }

  if (audioDecoder) {
    try {
      audioDecoder.close();
    } catch (e) {}
    audioDecoder = null;
  }

  videoFrameBuffer = [];
  audioFrameBuffer = [];

  clearInterval(videoIntervalID);
  clearInterval(audioIntervalID);

  videoCodecReceived = false;
  audioCodecReceived = false;
  keyFrameReceived = false;

  self.postMessage({
    type: "log",
    level: "info",
    event: "stop",
    message: "Stopped all media operations",
  });
}

function closeWebSocket(ws) {
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    try {
      ws.close();
    } catch (e) {}
  }
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
