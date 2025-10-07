// import { AacAudioDecoder } from "../aac_decoder/aacDecoder.js";
import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";

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

const videoInit = {
  output: (frame) => {
    self.postMessage(
      {
        type: "videoData",
        frame: frame,
      },
      [frame]
    );
  },
  error: (e) => {
    console.error("Video decoder error:", e);
    self.postMessage({ type: "error", message: e.message });
  },
};

function logStats() {
  setInterval(() => {
    console.log(
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
      console.log("Media Worker: Initializing with stream url:", mediaUrl);
      await initializeDecoders();
      setupWebSocket();
      if (port && port instanceof MessagePort) {
        console.log("Media Worker: Received port to connect to Audio Worklet.");
        workletPort = port;
      }
      break;

    case "toggle-audio":
      audioEnabled = !audioEnabled;
      console.log(
        "Media Worker: Toggling audio. Now audioEnabled =",
        audioEnabled
      );
      self.postMessage({ type: "audio-toggled", audioEnabled });
      break;

    case "reset":
      console.log("Media Worker: Resetting decoders and buffers.");
      resetWebsocket();
      break;
    case "stop":
      console.log("Media Worker: Stopping all operations.");
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
  videoDecoder = new VideoDecoder(videoInit);
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

function handleMediaWsMessage(event) {
  if (typeof event.data === "string") {
    const dataJson = JSON.parse(event.data);
    if (dataJson.type === "TotalViewerCount") {
      console.log(
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
        console.log("Decoded first audio frame to initialize decoder.");
      } catch (error) {
        console.log("Error decoding first audio frame:", error);
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
          videoDecoder = new VideoDecoder(videoInit);
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
      console.warn("[Media worker]: Received config data (unexpected):", data);
      return;
    }
    // Unknown type
  }
}

function handleMediaWsClose() {
  console.warn("Media WebSocket closed");
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
