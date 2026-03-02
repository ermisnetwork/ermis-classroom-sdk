// import { AacAudioDecoder } from "../aac_decoder/aacDecoder.js";
import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";
import { H264Decoder, isNativeH264DecoderSupported } from "../codec-polyfill/video-codec-polyfill.js";

let videoDecoderFor360p;
let videoDecoderFor720p;
let videoDecoderForScreenShare;
let currentVideoDecoder;
let currentQuality = "360p";
let audioDecoder;
let mediaWebsocket = null;
let video360pConfig;
let video720pConfig;
let screenShareConfig;
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

let isScreenSharing = false;


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
    proxyConsole.warn("Native VideoDecoder not available, using polyfill");
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
    proxyConsole.error(`Video decoder error (${quality}):`, e);
    self.postMessage({
      type: "error",
      message: `${quality} decoder: ${e.message}`,
    });
  },
});

function logStats() {
  setInterval(() => {
    proxyConsole.log("Buffer stats:", videoFrameBuffer.length, audioFrameBuffer.length);
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
  const { type, data, port, quality, isShare } = e.data;
  switch (type) {
    case "init":
      mediaUrl = data.mediaUrl;
      proxyConsole.log("Media Worker: Initializing with stream url:", mediaUrl);
      isScreenSharing = isShare;
      await initializeDecoders(isScreenSharing);

      setupWebSocket(quality);
      if (port && port instanceof MessagePort) {
        proxyConsole.log("Media Worker: Received port to connect to Audio Worklet.");
        workletPort = port;
      }
      break;

    case "toggleAudio":
      audioEnabled = !audioEnabled;
      proxyConsole.log("Media Worker: Toggling audio. Now audioEnabled =", audioEnabled);
      self.postMessage({ type: "audio-toggled", audioEnabled });
      break;

    case "switchBitrate":
      handleBitrateSwitch(quality);
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

async function initializeDecoders(isScreenSharing = false) {
  self.postMessage({
    type: "log",
    level: "info",
    event: "init-decoders",
    message: "Initializing decoders",
  });

  // Khởi tạo 2 video decoder
  if (isScreenSharing) {
    videoDecoderForScreenShare = await createVideoDecoderWithFallback("screen");
    currentVideoDecoder = videoDecoderForScreenShare;
  } else {
    videoDecoderFor360p = await createVideoDecoderWithFallback("360p");
    videoDecoderFor720p = await createVideoDecoderWithFallback("720p");
    currentVideoDecoder = videoDecoderFor360p; // Mặc định dùng 360p
  }
  videoDecoderFor360p = await createVideoDecoderWithFallback("360p");
  videoDecoderFor720p = await createVideoDecoderWithFallback("720p");
  currentVideoDecoder = videoDecoderFor360p; // Mặc định dùng 360p

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

function setupWebSocket(initialQuality = "360p") {
  mediaWebsocket = new WebSocket(mediaUrl);
  mediaWebsocket.binaryType = "arraybuffer";
  mediaWebsocket.onopen = () => {
    if (!isScreenSharing) {
      mediaWebsocket.send(JSON.stringify({ quality: initialQuality }));
      self.postMessage({
        type: "log",
        level: "info",
        event: "ws-connected",
        message: "media websocket Connected",
      });
    }
  };
  mediaWebsocket.onmessage = handleMediaWsMessage;
  mediaWebsocket.onclose = handleMediaWsClose;
}

function handleBitrateSwitch(quality) {
  // Gửi yêu cầu lên server
  if (mediaWebsocket && mediaWebsocket.readyState === WebSocket.OPEN) {
    const message = {
      quality,
    };
    proxyConsole.log(`Switching bitrate to ${quality}, message:`, message);
    mediaWebsocket.send(JSON.stringify(message));

    // Chuyển decoder
    if (quality === "360p") {
      currentVideoDecoder = videoDecoderFor360p;
      currentQuality = "360p";
    } else if (quality === "720p") {
      currentVideoDecoder = videoDecoderFor720p;
      currentQuality = "720p";
    }

    // Reset keyframe flag để chờ keyframe mới
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
  } else {
    proxyConsole.error("WebSocket not ready for bitrate switch");
  }
}

async function handleMediaWsMessage(event) {
  if (typeof event.data === "string") {
    const dataJson = JSON.parse(event.data);
    if (dataJson.type === "TotalViewerCount") {
      proxyConsole.log("[Media worker]: TotalViewerCount received from websocket:", dataJson.total_viewers);
      self.postMessage({
        type: "TotalViewerCount",
        count: dataJson.total_viewers,
      });
      return;
    }

    if (dataJson.type === "DecoderConfigs" && (!videoCodecReceived || !audioCodecReceived)) {
      if (isScreenSharing) {
        screenShareConfig = dataJson.videoConfig;
        videoFrameRate = screenShareConfig.frameRate;
        screenShareConfig.description = base64ToUint8Array(screenShareConfig.description);
        videoDecoderForScreenShare.configure(screenShareConfig);
        currentVideoDecoder = videoDecoderForScreenShare;
        currentQuality = "screen";
      } else {
        video360pConfig = dataJson.video360pConfig;
        video720pConfig = dataJson.video720pConfig;

        videoFrameRate = video360pConfig.frameRate;

        video360pConfig.description = base64ToUint8Array(video360pConfig.description);
        video720pConfig.description = base64ToUint8Array(video720pConfig.description);
        videoDecoderFor360p.configure(video360pConfig);
        videoDecoderFor720p.configure(video720pConfig);
      }

      audioConfig = dataJson.audioConfig;
      audioFrameRate = audioConfig.sampleRate / 1024;
      const audioConfigDescription = base64ToUint8Array(audioConfig.description);

      audioDecoder.configure(audioConfig);

      // Decode first audio frame để khởi tạo audio decoder
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
      if (isScreenSharing) {
        self.postMessage({
          type: "codecReceived",
          stream: "screen",
          screenShareConfig,
          audioConfig,
        });
      } else {
        self.postMessage({
          type: "codecReceived",
          stream: "both",
          video360pConfig,
          video720pConfig,
          audioConfig,
        });
      }
      return;
    }

    if (event.data === "publish") {
      videoDecoderFor360p.reset();
      videoDecoderFor720p.reset();
      audioDecoder.reset();
      videoCodecReceived = false;
      audioCodecReceived = false;
      keyFrameReceived = false;
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

    // Mapping frameType theo định nghĩa mới
    // video-360p-key = 0
    // video-360p-delta = 1
    // video-720p-key = 2
    // video-720p-delta = 3
    // video-1080p-key = 4
    // video-1080p-delta = 5
    // audio = 6
    // config = 7
    // other = 8

    if (frameType === 6) {
      // Audio frame
      if (!audioEnabled) return;

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
      return;
    } else if (frameType === 0 || frameType === 1) {
      // Video 360p
      const type = frameType === 0 ? "key" : "delta";

      if (type === "key") {
        keyFrameReceived = true;
      }

      if (keyFrameReceived) {
        if (videoDecoderFor360p.state === "closed") {
          videoDecoderFor360p = await createVideoDecoderWithFallback("360p");
          videoDecoderFor360p.configure(video360pConfig);
        }
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });

        // if (currentQuality === "360p") {
        videoDecoderFor360p.decode(encodedChunk);
        // }
      }
      return;
    } else if (frameType === 2 || frameType === 3) {
      // Video 720p
      const type = frameType === 2 ? "key" : "delta";

      if (type === "key") {
        keyFrameReceived = true;
      }

      if (keyFrameReceived) {
        if (videoDecoderFor720p.state === "closed") {
          videoDecoderFor720p = await createVideoDecoderWithFallback("720p");
          videoDecoderFor720p.configure(video720pConfig);
        }
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });

        // if (currentQuality === "720p") {
        videoDecoderFor720p.decode(encodedChunk);
        // }
      }
      return;
    } else if (frameType === 4 || frameType === 5) {
      const type = frameType === 4 ? "key" : "delta";

      if (type === "key") {
        keyFrameReceived = true;
      }

      if (keyFrameReceived) {
        if (videoDecoderForScreenShare.state === "closed") {
          videoDecoderForScreenShare = await createVideoDecoderWithFallback("screen");
          videoDecoderForScreenShare.configure(screenShareConfig);
        }
        const encodedChunk = new EncodedVideoChunk({
          timestamp: timestamp * 1000,
          type,
          data,
        });

        videoDecoderForScreenShare.decode(encodedChunk);
      }
      return;
    } else if (frameType === 7) {
      // Config data
      proxyConsole.warn("[Media worker]: Received config data (unexpected):", data);
      return;
    }
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
  if (videoDecoderFor360p) {
    videoDecoderFor360p.reset();
  }
  if (videoDecoderFor720p) {
    videoDecoderFor720p.reset();
  }
  if (audioDecoder) {
    audioDecoder.reset();
  }

  videoCodecReceived = false;
  audioCodecReceived = false;
  keyFrameReceived = false;
  videoFrameBuffer = [];
  audioFrameBuffer = [];
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

  if (videoDecoderFor360p) {
    try {
      videoDecoderFor360p.close();
    } catch (e) {}
    videoDecoderFor360p = null;
  }
  if (videoDecoderFor720p) {
    try {
      videoDecoderFor720p.close();
    } catch (e) {}
    videoDecoderFor720p = null;
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

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
