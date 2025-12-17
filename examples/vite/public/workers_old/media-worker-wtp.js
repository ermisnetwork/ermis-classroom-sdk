import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";

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

let videoFrameRate;
let audioFrameRate;

let curVideoInterval;
let curAudioInterval;

let videoIntervalID;
let audioIntervalID;

let videoCodecReceived = false;
let audioCodecReceived = false;
let keyFrameReceived = false;

const channelStreams = new Map();

// ------------------------------
// Decoder setup
// ------------------------------

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
  const { type, port, quality, readable, writable, channelName } = e.data;

  switch (type) {
    case "init":
      await initializeDecoders();
      if (port instanceof MessagePort) workletPort = port;
      break;

    case "attachStream":
      if (readable && writable && channelName) {
        console.warn(`[Publisher worker]: Attaching stream for ${channelName}`);
        attachWebTransportStream(channelName, readable, writable);
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
// Stream handling
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

  if (channelName.startsWith("cam_")) readVideoStream(channelName, reader);
  else if (channelName.startsWith("mic_")) readAudioStream(reader);
}

async function readVideoStream(channelName, reader) {
  console.warn(`Starting to read video stream: ${channelName}`);
  const quality = channelName.includes("360p") ? "360p" : "720p";

  const delimitedReader = new LengthDelimitedReader(reader);
  const textDecoder = new TextDecoder();

  try {
    while (true) {
      const message = await delimitedReader.readMessage();
      if (message === null) {
        console.log("Stream closed");
        break;
      }

      try {
        const text = textDecoder.decode(message);
        if (text.startsWith("{")) {
          console.log("Received Video text message", text);
          let dataJson;
          try {
            dataJson = JSON.parse(text);
          } catch (error) {
            console.error("error while parse config", error);
          }
          console.log("Received video config", dataJson);
          if (dataJson.type === "StreamConfig") {
            const cfg = dataJson.config;
            const desc = base64ToUint8Array(cfg.description);
            const videoConfig = {
              codec: cfg.codec,
              codedWidth: cfg.codedWidth,
              codedHeight: cfg.codedHeight,
              frameRate: cfg.frameRate,
              description: desc,
            };

            if (quality === "360p") video360pConfig = videoConfig;
            else video720pConfig = videoConfig;

            configureVideoDecoders(quality);
            continue;
          }
        } else {
        }
      } catch (e) {}
      handleVideoBinaryPacket(message.buffer, quality);
    }
  } catch (error) {
    console.error("Stream error:", error);
  }
}

function handleVideoBinaryPacket(dataBuffer, quality) {
  const dataView = new DataView(dataBuffer);
  const timestamp = dataView.getUint32(0, false);
  const frameType = dataView.getUint8(4);
  const data = dataBuffer.slice(5);

  if (
    frameType !== 0 &&
    frameType !== 1 &&
    frameType !== 2 &&
    frameType !== 3
  ) {
    console.warn("Unknown video frame type:", frameType);
    console.warn("Data buffer:", dataBuffer);
    return;
  }

  if (frameType === 0 || frameType === 1) {
    // Video 360p
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
    // Video 720p
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
  }
}

async function readAudioStream(reader) {
  console.warn(`Starting to read audio stream`);
  const delimitedReader = new LengthDelimitedReader(reader);
  const textDecoder = new TextDecoder();

  try {
    while (true) {
      const message = await delimitedReader.readMessage();
      if (message === null) {
        console.log("Stream closed");
        break;
      }

      try {
        const text = textDecoder.decode(message);

        if (text.startsWith("{")) {
          console.log("receiver message in audio channel ", text);
          try {
            let dataJson;
            try {
              dataJson = JSON.parse(text);
            } catch (error) {
              console.error("error while parse config", error);
            }
            console.log("received audio config", dataJson);
            if (dataJson.type === "StreamConfig") {
              const cfg = dataJson.config;
              const desc = base64ToUint8Array(cfg.description);

              audioConfig = {
                codec: cfg.codec,
                sampleRate: cfg.sampleRate,
                numberOfChannels: cfg.numberOfChannels,
                description: desc,
              };

              audioDecoder.configure(audioConfig);
              try {
                const dataView = new DataView(desc.buffer);
                const timestamp = dataView.getUint32(0, false);
                const data = desc.slice(5);

                const chunk = new EncodedAudioChunk({
                  timestamp: timestamp * 1000,
                  type: "key",
                  data,
                });
                audioDecoder.decode(chunk);
              } catch (error) {
                console.log("Error decoding first audio frame:", error);
              }

              // configureAudioDecoder();
              continue;
            }
          } catch {
            console.warn("Non-JSON text message:", msg);
          }
        }
      } catch (e) {}
      if (audioEnabled) {
        handleAudioBinaryPacket(message.buffer);
      }
    }
  } catch (error) {
    console.error("Stream error:", error);
  }
}

function handleAudioBinaryPacket(dataBuffer) {
  const dataView = new DataView(dataBuffer);
  const timestamp = dataView.getUint32(0, false);
  const frameType = dataView.getUint8(4);
  const data = dataBuffer.slice(5);

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

  curVideoInterval = { speed: 0, rate: 1000 / 30 };
  curAudioInterval = { speed: 0, rate: 1000 / (48000 / 1024) };
}

function configureVideoDecoders(quality) {
  const config = quality === "360p" ? video360pConfig : video720pConfig;
  if (!config) return;

  try {
    const decoder = quality === "360p" ? videoDecoder360p : videoDecoder720p;
    if (decoder.state === "unconfigured") {
      decoder.configure(config);
      videoFrameRate = config.frameRate;
    }

    videoCodecReceived = true;
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

function configureAudioDecoder() {
  if (!audioConfig) return;
  try {
    if (audioDecoder.state === "unconfigured") {
      audioDecoder.configure(audioConfig);
      audioFrameRate = audioConfig.sampleRate / 1024;
    }

    audioCodecReceived = true;
    self.postMessage({
      type: "codecReceived",
      stream: "audio",
      audioConfig,
    });
  } catch (error) {
    console.error("Failed to configure audio decoder:", error);
  }
}

// ------------------------------
// Maintenance
// ------------------------------

// function handleBitrateSwitch(quality) {
//   if (quality === currentQuality) return;

//   currentQuality = quality;
//   currentVideoDecoder =
//     quality === "360p" ? videoDecoder360p : videoDecoder720p;
//   keyFrameReceived = false;

//   self.postMessage({
//     type: "bitrateChanged",
//     quality,
//   });
// }

async function handleBitrateSwitch(quality) {
  if (quality === currentQuality) {
    console.log(`[Bitrate] Already at ${quality}, no switch needed.`);
    return;
  }

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
    currentVideoDecoder =
      quality === "360p" ? videoDecoder360p : videoDecoder720p;
    keyFrameReceived = false;

    self.postMessage({
      type: "bitrateChanged",
      quality,
    });

    console.log(`[Bitrate] Switched from ${currentQuality} to ${quality}`);
  } catch (err) {
    console.error(`[Bitrate] Failed to switch to ${quality}:`, err);
    self.postMessage({
      type: "error",
      message: `Failed to switch bitrate: ${err.message}`,
    });
  }
}

function resetDecoders() {
  if (videoDecoder360p) videoDecoder360p.reset();
  if (videoDecoder720p) videoDecoder720p.reset();
  if (audioDecoder) audioDecoder.reset();

  videoCodecReceived = false;
  audioCodecReceived = false;
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
        const view = new DataView(
          this.buffer.buffer,
          this.buffer.byteOffset,
          4
        );
        const messageLength = view.getUint32(0, false); // false = big-endian

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
