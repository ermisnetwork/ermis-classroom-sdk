import EventEmitter from "../events/EventEmitter.js";
import {
  FRAME_TYPE,
  getFrameType,
  getTransportPacketType,
  CHANNEL_NAME,
  getDataChannelId,
  STREAM_TYPE,
  getSubStreams,
  MEETING_EVENTS,
} from "../constant/publisherConstants.js";

import CommandSender from "./ClientCommand.js";

/**
 * WebRTC Publisher Class - Refactored
 * Handles video/audio streaming via WebTransport/WebRTC
 * Supports both camera and screen share through 'type' parameter
 */
class Publisher extends EventEmitter {
  constructor(options = {}) {
    super();
    // Validate required options
    if (!options.publishUrl) {
      throw new Error("publishUrl is required");
    }

    // Configuration
    this.publishUrl = options.publishUrl;
    this.publishType = options.publishType || STREAM_TYPE.CAMERA; // 'camera' or 'screenshare'
    this.streamId = options.streamId || "test_stream";
    this.roomId = options.roomId || "test_room";
    this.preConfiguredStream = options.mediaStream || null;
    this.protocol = options.protocol || "webtransport"; // 'webtransport', 'webrtc'
    this.webRtcHost = options.webRtcHost || "admin.bandia.vn:9995";

    // Video configuration based on type
    this.currentConfig = this.getDefaultConfig(this.publishType, options);

    // Audio configuration
    this.kSampleRate = 48000;
    this.audioBaseTime = 0;
    this.audioSamplesSent = 0;
    this.audioSamplesPerChunk = 960; // 20ms at 48kHz

    // State variables
    this.stream = null;
    this.micAudioProcessor = null;
    this.videoProcessor = null;
    this.videoReader = null;
    this.webTransport = null;
    this.webRtc = null;
    this.isChannelOpen = false;
    this.isPublishing = false;

    // Media state
    this.videoEnabled = true;
    this.audioEnabled = true;
    this.isHandRaised = false;
    this.hasVideo = options.hasVideo !== undefined ? options.hasVideo : true;
    this.hasAudio = options.hasAudio !== undefined ? options.hasAudio : true;

    // Callbacks
    this.onStatusUpdate = options.onStatusUpdate || ((message, isError) => console.log(message));
    this.onStreamStart = options.onStreamStart || (() => {});
    this.onStreamStop = options.onStreamStop || (() => {});
    this.onServerEvent = options.onServerEvent || ((event) => {});

    // Initialize modules
    this.wasmInitialized = false;
    this.wasmInitializing = false;
    this.wasmInitPromise = null;
    this.initAudioRecorder = null;
    this.WasmEncoder = null;

    // Stream management
    this.publishStreams = new Map();
    this.videoEncoders = new Map();
    this.eventStream = null;

    // Define substreams based on type

    this.currentAudioStream = null;
    this.triggerWorker = null;
    this.workerPing = null;

    this.sequenceNumbers = {};
    this.dcMsgQueues = {};
    this.dcPacketSendTime = {};
    this.userMediaSubChannels = getSubStreams(STREAM_TYPE.CAMERA);
    this.screenSubChannels = getSubStreams(STREAM_TYPE.SCREEN_SHARE);

    // command sender
    // this.commandSender = null;
    this.commandSender =
      this.protocol === "webrtc"
        ? new CommandSender({
            sendDataFn: this.sendOverDataChannel.bind(this),
            protocol: this.protocol,
            commandType: "publisher_command",
          })
        : new CommandSender({
            sendDataFn: this.sendOverStream.bind(this),
            protocol: this.protocol,
            commandType: "publisher_command",
          });

    // Initialize sequence tracking
    this.initializeSequenceTracking();

    // this.videoSentCountTest = 0;
    // this.intervalforStats();

    // screen share state
    this.screenStream = null;
    this.screenVideoProcessor = null;
    this.screenVideoReader = null;
    this.screenAudioProcessor = null;
    this.isScreenSharing = false;
    this.screenVideoEncoder = null;

    this.screenShareWebrtc = null;
  }

  getDefaultConfig(type, options) {
    if (type === STREAM_TYPE.SCREEN_SHARE) {
      return {
        codec: "avc1.640c34",
        width: options.width || 1920,
        height: options.height || 1080,
        framerate: options.framerate || 30,
        bitrate: options.bitrate || 1_500_000,
      };
    } else {
      return {
        codec: "avc1.640c34",
        width: options.width || 1280,
        height: options.height || 720,
        framerate: options.framerate || 30,
        bitrate: options.bitrate || 800_000,
      };
    }
  }

  initializeSequenceTracking() {
    this.userMediaSubChannels.forEach((stream) => {
      const key = stream.channelName;
      this.sequenceNumbers[key] = 0;
      this.dcMsgQueues[key] = [];
      this.dcPacketSendTime[key] = performance.now();
    });
  }

  async init() {
    await this.loadAllDependencies();
    this.onStatusUpdate("Publisher initialized successfully");
    this.initializeQueues();
  }

  initializeQueues() {
    this.userMediaSubChannels.forEach((stream) => {
      if (!stream.channelName.startsWith(CHANNEL_NAME.MEETING_CONTROL)) {
        this.dcMsgQueues[stream.channelName] = [];
      }
    });

    this.gopTracking = {};
    this.needKeyFrame = {};

    this.userMediaSubChannels.forEach((stream) => {
      if (stream.width) {
        // video streams
        this.gopTracking[stream.channelName] = {
          currentGopStart: 0,
          lastKeyFrameIndex: -1,
        };
        this.needKeyFrame[stream.channelName] = false;
      }
    });
  }

  isKeyFrame(frameType) {
    return frameType === 0 || frameType === 7 || frameType === FRAME_TYPE.CONFIG;
  }

  async loadAllDependencies() {
    try {
      if (!document.querySelector('script[src*="MSTP_polyfill.js"]')) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/polyfills/MSTP_polyfill.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load MSTP polyfill"));
          document.head.appendChild(script);
        });
        console.log("Polyfill loaded successfully");
      }

      if (!this.wasmInitialized) {
        if (this.wasmInitializing && this.wasmInitPromise) {
          await this.wasmInitPromise;
        } else {
          this.wasmInitializing = true;
          const { default: init, WasmEncoder } = await import(`/raptorQ/raptorq_wasm.js?t=${Date.now()}`);

          this.WasmEncoder = WasmEncoder;

          this.wasmInitPromise = init(`/raptorQ/raptorq_wasm_bg.wasm?t=${Date.now()}`)
            .then(() => {
              this.wasmInitialized = true;
              this.wasmInitializing = false;
              console.log("WASM encoder module loaded successfully");
            })
            .catch((err) => {
              this.wasmInitializing = false;
              console.error("Failed to load WASM encoder module:", err);
              throw new Error("Failed to load WASM encoder module");
            });

          await this.wasmInitPromise;
        }
      }

      const opusModule = await import(`/opus_decoder/opusDecoder.js?t=${Date.now()}`);
      this.initAudioRecorder = opusModule.initAudioRecorder;
      console.log("Opus decoder module loaded successfully");

      this.onStatusUpdate("All dependencies loaded successfully");
    } catch (error) {
      this.onStatusUpdate(`Dependency loading error: ${error.message}`, true);
      throw error;
    }
  }

  async startPublishing() {
    if (this.isPublishing) {
      this.onStatusUpdate("Already publishing", true);
      return;
    }
    await this.init();

    await this.setupConnection();

    try {
      const videoOnlyStream = await this.getMediaStream();
      this.isPublishing = true;
      await this.startUserMediaStreaming();

      this.onStreamStart();
      this.onStatusUpdate(`Publishing started successfully (${this.publishType})`);

      return videoOnlyStream;
    } catch (error) {
      this.onStatusUpdate(`Failed to start publishing: ${error.message}`, true);
      throw error;
    }
  }

  // Toggle video
  async toggleVideo() {
    if (this.videoEnabled) {
      await this.turnOffVideo();
    } else {
      await this.turnOnVideo();
    }
  }

  // Toggle audio
  async toggleAudio() {
    if (this.audioEnabled) {
      await this.turnOffAudio();
    } else {
      await this.turnOnAudio();
    }
  }

  // Toggle raise hand
  async toggleRaiseHand() {
    const currentState = this.isHandRaised || false;

    if (currentState) {
      await this.lowerHand();
      this.isHandRaised = false;
    } else {
      await this.raiseHand();
      this.isHandRaised = true;
    }

    return this.isHandRaised;
  }

  async turnOffVideo() {
    if (!this.hasVideo) {
      console.warn("Cannot turn off video: no video available");
      return;
    }

    if (!this.videoEnabled) return;

    this.videoEnabled = false;
    this.onStatusUpdate(`${this.publishType} video turned off`);

    const eventType = this.publishType === "screenshare" ? "screenshare_off" : "camera_off";
    await this.sendMeetingEvent(eventType);
  }

  async turnOnVideo() {
    if (!this.hasVideo) {
      console.warn("Cannot turn on video: no video available");
      return;
    }

    if (this.videoEnabled) return;

    this.videoEnabled = true;
    this.onStatusUpdate(`${this.publishType} video turned on`);

    const eventType = this.publishType === "screenshare" ? "screenshare_on" : "camera_on";
    await this.sendMeetingEvent(eventType);
  }

  async turnOffAudio() {
    if (!this.hasAudio) {
      console.warn("Cannot turn off audio: no audio available");
      return;
    }

    if (!this.audioEnabled) return;

    this.audioEnabled = false;
    this.onStatusUpdate(`${this.publishType} audio turned off`);
    console.log("Sending mic_off event to server");

    await this.sendMeetingEvent("mic_off");
  }

  async turnOnAudio() {
    if (!this.hasAudio) {
      console.warn("Cannot turn on audio: no audio available");
      return;
    }

    if (this.audioEnabled) return;

    this.audioEnabled = true;
    this.onStatusUpdate(`${this.publishType} audio turned on`);
    console.log("Sending mic_on event to server");

    await this.sendMeetingEvent("mic_on");
  }

  async switchVideoTrack(deviceId) {
    if (!this.hasVideo) {
      throw new Error("Video not available");
    }

    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    try {
      console.log(`[Publisher] Switching video to device: ${deviceId}`);
      this.onStatusUpdate("Switching video source...");

      const videoConstraints = {
        deviceId: { exact: deviceId },
        width: { ideal: this.currentConfig.width },
        height: { ideal: this.currentConfig.height },
        frameRate: { ideal: this.currentConfig.framerate },
      };

      const audioConstraints =
        this.hasAudio && this.stream?.getAudioTracks().length > 0
          ? {
              sampleRate: this.kSampleRate,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            }
          : false;

      console.log("[Publisher] Requesting new media stream...");
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      });

      if (!newStream.getVideoTracks()[0]) {
        throw new Error("Failed to get video track from new source");
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.stream.getVideoTracks()[0];

      this.stream.removeTrack(oldVideoTrack);
      this.stream.addTrack(newVideoTrack);
      oldVideoTrack.stop();

      await this.handleNewTrack(newVideoTrack);

      this.emit("videoSwitch", {
        deviceId,
        stream: this.stream,
        videoOnlyStream: newStream,
      });

      console.log("[Publisher] Video switched successfully");
      this.onStatusUpdate(`Video switched successfully`);

      return { stream: this.stream, videoOnlyStream: newStream };
    } catch (error) {
      console.error("[Publisher] Failed to switch video:", error);
      this.onStatusUpdate(`Failed to switch video: ${error.message}`, true);
      throw error;
    }
  }

  async handleNewTrack(track) {
    if (!track) {
      throw new Error("No video track found in new stream");
    }
    try {
      const wasPublishing = this.isPublishing;
      this.isPublishing = false;

      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log("Switched to new video track:", track);

      this.videoProcessor = new MediaStreamTrackProcessor(track, this.triggerWorker, true);
      this.videoReader = this.videoProcessor.readable.getReader();
      console.log("New video processor reader created:", this.videoReader);

      let frameCounter = 0;

      const videoEncoders = Array.from(this.videoEncoders.entries());

      this.isPublishing = wasPublishing;

      if (this.isPublishing) {
        this.startVideoFrameProcessing(frameCounter, videoEncoders);
      }

      this.onStatusUpdate("Video track switched successfully", false);
      return true;
    } catch (error) {
      this.isPublishing = false;
      const errorMsg = `Video track switch error: ${error.message}`;
      this.onStatusUpdate(errorMsg, true);
      console.error(errorMsg, error);
      return false;
    }
  }

  startVideoFrameProcessing(initialFrameCounter = 0, videoEncoders) {
    let frameCounter = initialFrameCounter;

    (async () => {
      try {
        while (this.isPublishing) {
          const result = await this.videoReader.read();

          if (result.done) break;

          const frame = result.value;

          if (!window.videoBaseTimestamp) {
            window.videoBaseTimestamp = frame.timestamp;
          }

          if (!this.videoEnabled) {
            frame.close();
            continue;
          }

          frameCounter++;
          const keyFrame = frameCounter % 30 === 0;

          for (let i = 0; i < videoEncoders.length; i++) {
            const [quality, encoderObj] = videoEncoders[i];
            const isLastEncoder = i === videoEncoders.length - 1;

            if (encoderObj.encoder.encodeQueueSize <= 2) {
              const frameToEncode = isLastEncoder ? frame : new VideoFrame(frame);
              encoderObj.encoder.encode(frameToEncode, { keyFrame });
              if (!isLastEncoder) frameToEncode.close();
            }
          }

          frame.close();
        }
      } catch (error) {
        this.onStatusUpdate(`Video processing error: ${error.message}`, true);
        console.error("Video capture error:", error);
      }
    })();
  }

  async switchAudioTrack(deviceId) {
    if (!this.hasAudio) {
      throw new Error("Audio not available");
    }

    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    try {
      console.log(`[Publisher] Switching audio to device: ${deviceId}`);
      this.onStatusUpdate("Switching audio source...");

      const audioConstraints = {
        deviceId: { exact: deviceId },
        sampleRate: this.kSampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      };

      console.log("[Publisher] Requesting new media stream...");
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      if (!newStream.getAudioTracks()[0]) {
        throw new Error("Failed to get audio track from new source");
      }

      this.currentAudioStream = newStream;

      const newAudioTrack = newStream.getAudioTracks()[0];
      console.log("New audio track obtained:", newAudioTrack);

      console.log("[Publisher] Audio switched successfully");
      this.onStatusUpdate(`Audio switched successfully`);

      const videoOnlyStream = new MediaStream();
      const videoTracks = this.stream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("audioSwitch", {
        deviceId,
        stream: this.stream,
        videoOnlyStream,
      });

      return { stream: this.stream, videoOnlyStream };
    } catch (error) {
      console.error("[Publisher] Failed to switch audio:", error);
      this.onStatusUpdate(`Failed to switch audio: ${error.message}`, true);
      throw error;
    }
  }

  async replaceMediaStream(newStream) {
    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    if (!newStream || !(newStream instanceof MediaStream)) {
      throw new Error("Invalid MediaStream provided");
    }

    try {
      console.log("[Publisher] Replacing media stream...");
      this.onStatusUpdate("Replacing media stream...");

      const hasVideo = newStream.getVideoTracks().length > 0;
      const hasAudio = newStream.getAudioTracks().length > 0;

      if (!hasVideo && !hasAudio) {
        throw new Error("MediaStream has no tracks");
      }

      const oldStream = this.stream;
      this.stream = newStream;

      this.hasVideo = hasVideo;
      this.hasAudio = hasAudio;
      this.videoEnabled = hasVideo;
      this.audioEnabled = hasAudio;

      if (hasVideo) {
        console.log("[Publisher] Starting video capture with new stream...");
        await this.startVideoCapture();
      }

      if (hasAudio) {
        console.log("[Publisher] Starting audio streaming with new stream...");
        this.micAudioProcessor = await this.startAudioStreaming(this.stream);
      }

      if (oldStream) {
        console.log("[Publisher] Cleaning up old stream...");
        oldStream.getTracks().forEach((track) => track.stop());
      }

      const videoOnlyStream = new MediaStream();
      if (hasVideo) {
        videoOnlyStream.addTrack(newStream.getVideoTracks()[0]);
      }

      this.emit("mediaStreamReplaced", {
        stream: this.stream,
        videoOnlyStream,
        hasVideo,
        hasAudio,
      });

      console.log("[Publisher] Media stream replaced successfully");
      this.onStatusUpdate("Media stream replaced successfully");

      return { stream: this.stream, videoOnlyStream, hasVideo, hasAudio };
    } catch (error) {
      console.error("[Publisher] Failed to replace media stream:", error);
      this.onStatusUpdate(`Failed to replace media stream: ${error.message}`, true);
      throw error;
    }
  }

  async stopVideoProcessing() {
    if (this.videoReader) {
      try {
        await this.videoReader.cancel();
        this.videoReader = null;
      } catch (error) {
        console.warn("Error canceling video reader:", error);
      }
    }

    if (this.videoProcessor) {
      try {
        this.videoProcessor = null;
      } catch (error) {
        console.warn("Error stopping video processor:", error);
      }
    }

    if (this.videoEncoders && this.videoEncoders.size > 0) {
      this.videoEncoders.forEach((encoderObj) => {
        try {
          if (encoderObj.encoder && encoderObj.encoder.state !== "closed") {
            encoderObj.encoder.close();
          }
        } catch (error) {
          console.warn("Error closing video encoder:", error);
        }
      });
      this.videoEncoders.clear();
    }
  }

  async stopAudioProcessing() {
    if (this.micAudioProcessor) {
      try {
        if (typeof this.micAudioProcessor.stop === "function") {
          await this.micAudioProcessor.stop();
        }
      } catch (error) {
        console.warn("Error stopping audio processor:", error);
      }
      this.micAudioProcessor = null;
    }
  }

  async pinForEveryone(targetStreamId) {
    await this.sendMeetingEvent("pin_for_everyone", targetStreamId);
  }

  async unpinForEveryone(targetStreamId) {
    await this.sendMeetingEvent("unpin_for_everyone", targetStreamId);
  }

  async raiseHand() {
    if (this.isHandRaised) return;

    this.isHandRaised = true;
    await this.sendMeetingEvent("raise_hand");
    this.onStatusUpdate("Hand raised");
  }

  async lowerHand() {
    if (!this.isHandRaised) return;

    this.isHandRaised = false;
    await this.sendMeetingEvent("lower_hand");
    this.onStatusUpdate("Hand lowered");
  }

  async sendMeetingEvent(eventType, targetStreamId = null) {
    if (!eventType) return;

    // if (!this.isChannelOpen || !this.eventStream) {
    //   console.warn(`Skipping ${eventType} event: Event stream not ready`);
    //   return;
    // }

    console.log("[Meeting Event] Sender stream ID:", this.streamId);

    const eventMessage = {
      type: eventType,
      sender_stream_id: this.streamId,
      timestamp: Date.now(),
    };

    if ((eventType === "pin_for_everyone" || eventType === "unpin_for_everyone") && targetStreamId) {
      eventMessage.target_stream_id = targetStreamId;
    }

    try {
      // await this.sendEvent(eventMessage);
      await this.commandSender.sendEvent(eventMessage);
      console.log(`Sent meeting event:`, eventMessage);
    } catch (error) {
      console.error(`Failed to send meeting event ${eventType}:`, error);
      this.onStatusUpdate(`Failed to notify server about ${eventType}`, true);
    }
  }

  async getMediaStream(deviceIds = {}) {
    if (this.preConfiguredStream) {
      this.stream = this.preConfiguredStream;
      console.log("Using pre-configured media stream");

      const audioTracks = this.stream.getAudioTracks();
      const videoTracks = this.stream.getVideoTracks();
      this.hasAudio = audioTracks.length > 0;
      this.hasVideo = videoTracks.length > 0;
      this.audioEnabled = this.hasAudio;
      this.videoEnabled = this.hasVideo;

      console.log(`Pre-configured stream - Video: ${this.hasVideo}, Audio: ${this.hasAudio}`);

      const videoOnlyStream = new MediaStream();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("localStreamReady", {
        stream: this.stream,
        videoOnlyStream: videoOnlyStream,
        type: this.publishType,
        streamId: this.streamId,
        config: this.currentConfig,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });

      return videoOnlyStream;
    }

    const constraints = {};

    if (this.publishType === "camera") {
      if (this.hasAudio) {
        constraints.audio = {
          sampleRate: this.kSampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        };
        if (deviceIds.microphone) {
          constraints.audio.deviceId = { exact: deviceIds.microphone };
        }
      }

      if (this.hasVideo) {
        constraints.video = {
          width: { ideal: this.currentConfig.width },
          height: { ideal: this.currentConfig.height },
          frameRate: { ideal: this.currentConfig.framerate },
        };
        if (deviceIds.camera) {
          constraints.video.deviceId = { exact: deviceIds.camera };
        }
      }

      if (!this.hasAudio && !this.hasVideo) {
        console.warn("Neither video nor audio is enabled");
        return;
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`Media stream obtained - Video: ${this.hasVideo}, Audio: ${this.hasAudio}`);
      } catch (error) {
        console.error("Error accessing media devices:", error);

        if (this.hasAudio && this.hasVideo) {
          console.log("Retrying with fallback...");
          try {
            this.stream = await navigator.mediaDevices.getUserMedia({
              video: constraints.video,
            });
            console.warn("Fallback: Got video only, no audio available");
            this.hasAudio = false;
            this.audioEnabled = false;
          } catch (videoError) {
            try {
              this.stream = await navigator.mediaDevices.getUserMedia({
                audio: constraints.audio,
              });
              console.warn("Fallback: Got audio only, no video available");
              this.hasVideo = false;
              this.videoEnabled = false;
            } catch (audioError) {
              console.error("Failed to get any media stream");
              this.onStatusUpdate("No media devices available - permission denied or no devices found", true);
              return;
            }
          }
        } else {
          console.error(`Failed to access ${this.hasVideo ? "video" : "audio"}`);
          this.onStatusUpdate(
            `Cannot access ${this.hasVideo ? "video" : "audio"} - permission denied or device not found`,
            true
          );
          return;
        }
      }
    } else if (this.publishType === "screenshare") {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stop();
        };
      }
    }

    if (!this.stream) {
      console.warn("No media stream available");
      return;
    }

    const videoOnlyStream = new MediaStream();
    const videoTracks = this.stream.getVideoTracks();

    if (videoTracks.length > 0) {
      videoOnlyStream.addTrack(videoTracks[0]);
    }

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.hasAudio = false;
      this.audioEnabled = false;
      console.log("No audio tracks in stream, disabling audio");
    }

    if (videoTracks.length === 0) {
      this.hasVideo = false;
      this.videoEnabled = false;
      console.log("No video tracks in stream, disabling video");
    }

    this.emit("localStreamReady", {
      stream: this.stream,
      videoOnlyStream: videoOnlyStream,
      type: this.publishType,
      streamId: this.streamId,
      config: this.currentConfig,
      hasAudio: audioTracks.length > 0,
      hasVideo: videoTracks.length > 0,
    });

    const mediaInfo = [];
    if (audioTracks.length > 0) mediaInfo.push("audio");
    if (videoTracks.length > 0) mediaInfo.push("video");

    this.onStatusUpdate(`${this.publishType} stream ready (${mediaInfo.join(" + ") || "no media"})`);
    return videoOnlyStream;
  }

  initVideoEncoders(subStreams) {
    subStreams.forEach((subStream) => {
      if (subStream.width) {
        const encoder = new VideoEncoder({
          output: (chunk, metadata) => this.handleVideoChunk(chunk, metadata, subStream.name, subStream.channelName),
          error: (e) => this.onStatusUpdate(`Encoder ${subStream.name} error: ${e.message}`, true),
        });

        this.videoEncoders.set(subStream.name, {
          encoder,
          channelName: subStream.channelName,
          config: {
            codec: this.currentConfig.codec,
            width: subStream.width,
            height: subStream.height,
            bitrate: subStream.bitrate,
            framerate: this.currentConfig.framerate,
            latencyMode: "realtime",
            hardwareAcceleration: "prefer-hardware",
          },
          metadataReady: false,
          videoDecoderConfig: null,
        });
      }
    });
  }

  async setupConnection() {
    if (this.protocol === "webrtc") {
      await this.setupWebRTCConnection();
    } else {
      await this.setupWebTransportConnection();
    }
  }

  async setupWebTransportConnection() {
    this.webTransport = new WebTransport(this.publishUrl);
    await this.webTransport.ready;
    console.log("WebTransport connected to server");

    for (const subStream of this.userMediaSubChannels) {
      await this.createBidirectionalStream(subStream.channelName);
    }

    await this.sendPublisherState();
    this.isChannelOpen = true;
    this.onStatusUpdate("WebTransport connection established with event stream and media streams");
  }

  async createBidirectionalStream(channelName) {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;

    const writer = writable.getWriter();
    const reader = readable.getReader();

    this.publishStreams.set(channelName, {
      writer,
      reader,
      configSent: false,
      config: null,
    });

    // await this.sendPublisherCommand(CLIENT_COMMANDS.INIT_STREAM, channelName);
    // create command sender for this channel

    this.commandSender.initChannelStream(channelName);
    console.log(`WebTransport bidirectional stream (${channelName}) established`);
    console.log(`Stream created: ${channelName}`);

    if (channelName === CHANNEL_NAME.MEETING_CONTROL) {
      this.setupEventStreamReader(reader);
    }
  }

  async sendPublisherCommand(request, channelName) {
    const requestData = { type: request, channel: channelName };
    const requestJson = JSON.stringify(requestData);
    const requestBytes = new TextEncoder().encode(requestJson);
    await this.sendOverStream(channelName, requestBytes);
  }

  async sendOverStream(channelName, frameBytes) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) {
      console.error(`Stream ${channelName} not found`);
      return;
    }

    try {
      const len = frameBytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(frameBytes, 4);
      await streamData.writer.write(out);
    } catch (error) {
      console.error(`Failed to send over stream ${channelName}:`, error);
      throw error;
    }
  }

  async setupEventStreamReader(reader) {
    const delimitedReader = new LengthDelimitedReader(reader);
    try {
      while (true) {
        const message = await delimitedReader.readMessage();
        if (message === null) break;
        const msg = new TextDecoder().decode(message);
        try {
          const event = JSON.parse(msg);
          console.log("Received event:", event);
          this.onServerEvent(event);
        } catch (e) {
          console.log("Non-JSON event message:", msg);
        }
      }
    } catch (err) {
      console.error(`[readStream] error:`, err);
    }
  }

  async sendOverEventStream(data) {
    const writer = this.publishStreams.get(CHANNEL_NAME.MEETING_CONTROL)?.writer;
    if (!writer) {
      console.error("Event stream writer not available");
      return;
    }

    try {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

      const len = bytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(bytes, 4);
      await writer.write(out);
    } catch (error) {
      console.error("Failed to send over event stream:", error);
      throw error;
    }
  }

  async sendEvent(eventData) {
    const eventJson = JSON.stringify(eventData);
    await this.sendOverEventStream(eventJson);
  }

  async sendPublisherState() {
    const stateEvent = {
      hasCamera: this.hasVideo,
      hasMic: this.hasAudio,
      isCameraOn: this.hasVideo ? this.videoEnabled : false,
      isMicOn: this.hasAudio ? this.audioEnabled : false,
    };

    console.warn("Sending publisher state to server:", stateEvent);

    this.commandSender.sendPublisherState(CHANNEL_NAME.MEETING_CONTROL, stateEvent);

    this.onStatusUpdate("Publisher state sent to server");
  }

  async setupWebRTCConnection(action = STREAM_TYPE.CAMERA) {
    const substreams = action === STREAM_TYPE.SCREEN_SHARE ? this.screenSubChannels : this.userMediaSubChannels;
    try {
      const webRtc = new RTCPeerConnection();

      if (action === STREAM_TYPE.SCREEN_SHARE) {
        this.screenShareWebrtc = webRtc;
      } else {
        this.webRtc = webRtc;
      }

      for (const subStream of substreams) {
        await this.createDataChannel(subStream.channelName);
      }

      const offer = await webRtc.createOffer();
      await webRtc.setLocalDescription(offer);
      console.log("WebRTC offer created and set as local description:", offer);
      const response = await fetch(`https://${this.webRtcHost}/meeting/sdp/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer,
          room_id: this.roomId,
          stream_id: this.streamId,
          action,
        }),
      });
      console.log("Response from WebRTC server:", response);

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const answer = await response.json();
      await webRtc.setRemoteDescription(answer);

      this.isChannelOpen = true;
    } catch (error) {
      console.error("WebRTC setup error:", error);
    }
  }

  async createDataChannel(channelName) {
    const id = getDataChannelId(channelName);

    let webRtc;
    if (
      channelName === CHANNEL_NAME.SCREEN_SHARE_720P ||
      channelName === CHANNEL_NAME.SCREEN_SHARE_1080P ||
      channelName === CHANNEL_NAME.SCREEN_SHARE_AUDIO
    ) {
      webRtc = this.screenShareWebrtc;
    } else {
      webRtc = this.webRtc;
    }
    // Set ordered delivery for control channel
    let ordered = false;
    if (channelName === CHANNEL_NAME.MEETING_CONTROL) {
      ordered = true;
    }
    const dataChannel = webRtc.createDataChannel(channelName, {
      ordered,
      id,
      negotiated: true,
    });

    const bufferAmounts = {
      SMALL: 8192,
      LOW: 16384,
      MEDIUM: 32768,
      HIGH: 65536,
    };

    // Set buffer threshold based on channel type
    if (channelName.includes("1080p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.HIGH;
    } else if (channelName.includes("720p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    } else if (channelName.includes("360p") || channelName === CHANNEL_NAME.MIC_AUDIO) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.LOW;
    } else {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    }

    dataChannel.onbufferedamountlow = () => {
      const queue = this.getQueue(channelName);

      while (queue.length > 0 && dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold) {
        const packet = queue.shift();
        dataChannel.send(packet);
        this.dcPacketSendTime[channelName] = performance.now();
      }
    };

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = async () => {
      this.publishStreams.set(channelName, {
        id,
        dataChannel,
        dataChannelReady: true,
        configSent: false,
        config: null,
      });

      if (channelName === CHANNEL_NAME.MEETING_CONTROL) {
        this.sendPublisherState();
      }
      console.log(`WebRTC data channel (${channelName}) established`);
    };
  }

  async sendOverDataChannel(channelName, packet, frameType) {
    const dataChannel = this.publishStreams.get(channelName)?.dataChannel;

    const dataChannelReady = this.publishStreams.get(channelName)?.dataChannelReady;
    if (!dataChannelReady || !dataChannel || dataChannel.readyState !== "open") {
      console.warn("DataChannel not ready");
      return;
    }

    try {
      const view = new DataView(packet.buffer);
      const sequenceNumber = view.getUint32(0, false);

      const needFecEncode = frameType !== FRAME_TYPE.EVENT && frameType !== FRAME_TYPE.MIC_AUDIO;
      // const needFecEncode = frameType === FRAME_TYPE.VIDEO || frameType == FRAME_TYPE.CONFIG;

      const packetType = getTransportPacketType(frameType);

      // if (needFecEncode && packet.length > 100) {
      if (needFecEncode) {
        const MAX_MTU = 512;
        const MIN_MTU = 100;
        const MIN_CHUNKS = 5;
        const MAX_REDUNDANCY = 10;
        const MIN_REDUNDANCY = 1;
        const REDUNDANCY_RATIO = 0.1;

        let MTU = Math.ceil(packet.length / MIN_CHUNKS);

        if (MTU < MIN_MTU) {
          MTU = MIN_MTU;
        } else if (MTU > MAX_MTU) {
          MTU = MAX_MTU;
        }

        const totalPackets = Math.ceil(packet.length / (MTU - 20));
        let redundancy = Math.ceil(totalPackets * REDUNDANCY_RATIO);
        if (redundancy < MIN_REDUNDANCY) {
          redundancy = MIN_REDUNDANCY;
        } else if (redundancy > MAX_REDUNDANCY) {
          redundancy = MAX_REDUNDANCY;
        }

        if (frameType === FRAME_TYPE.CONFIG) {
          redundancy = 3;
        }

        const HEADER_SIZE = 20;
        const chunkSize = MTU - HEADER_SIZE;

        const encoder = new this.WasmEncoder(packet, chunkSize);

        const configBuf = encoder.getConfigBuffer();

        const configView = new DataView(configBuf.buffer);
        const transferLength = configView.getBigUint64(0, false);
        const symbolSize = configView.getUint16(8, false);
        const sourceBlocks = configView.getUint8(10);
        const subBlocks = configView.getUint16(11, false);
        const alignment = configView.getUint8(13);

        const packets = encoder.encode(redundancy);

        const raptorQConfig = {
          transferLength,
          symbolSize,
          sourceBlocks,
          subBlocks,
          alignment,
        };

        for (let i = 0; i < packets.length; i++) {
          const fecPacket = packets[i];
          const wrapper = this.createFecPacketWithHeader(fecPacket, sequenceNumber, packetType, raptorQConfig);
          this.sendOrQueue(channelName, dataChannel, wrapper);
        }
        return;
      }

      const wrapper = this.createRegularPacketWithHeader(packet, sequenceNumber, packetType);
      this.sendOrQueue(channelName, dataChannel, wrapper);
    } catch (error) {
      console.error("Failed to send over DataChannel:", error);
    }
  }

  sendOrQueue(channelName, dataChannel, packet) {
    const queue = this.getQueue(channelName);

    if (dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold && queue.length === 0) {
      dataChannel.send(packet);
    } else {
      queue.push(packet);
    }
  }

  getQueue(channelName) {
    return this.dcMsgQueues[channelName] || [];
  }

  createFecPacketWithHeader(packet, sequenceNumber, packetType, raptorQConfig) {
    const { transferLength, symbolSize, sourceBlocks, subBlocks, alignment } = raptorQConfig;

    const header = new ArrayBuffer(4 + 1 + 1 + 14);
    const view = new DataView(header);

    view.setUint32(0, sequenceNumber, false);
    view.setUint8(4, 0xff);
    view.setUint8(5, packetType);
    view.setBigUint64(6, transferLength, false);
    view.setUint16(14, symbolSize, false);
    view.setUint8(16, sourceBlocks);
    view.setUint16(17, subBlocks, false);
    view.setUint8(19, alignment);

    const wrapper = new Uint8Array(header.byteLength + packet.length);
    wrapper.set(new Uint8Array(header), 0);
    wrapper.set(packet, header.byteLength);

    return wrapper;
  }

  createRegularPacketWithHeader(packet, sequenceNumber, packetType) {
    const wrapper = new Uint8Array(6 + packet.length);
    const view = new DataView(wrapper.buffer);

    view.setUint32(0, sequenceNumber, false);
    view.setUint8(4, 0x00);
    view.setUint8(5, packetType);
    wrapper.set(packet, 6);

    return wrapper;
  }

  async startUserMediaStreaming() {
    if (this.hasVideo && this.stream?.getVideoTracks().length > 0) {
      await this.startVideoCapture();
    } else {
      console.log("Skipping video capture: no video available");
    }

    if (this.hasAudio && this.stream?.getAudioTracks().length > 0) {
      this.micAudioProcessor = await this.startAudioStreaming(this.stream);
    } else {
      console.log("Skipping audio streaming: no audio available");
    }
  }

  async startVideoCapture() {
    if (!this.stream) {
      console.warn("No media stream available for video");
      return;
    }

    const videoTracks = this.stream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.warn("No video track found in stream");
      return;
    }

    this.initVideoEncoders(this.userMediaSubChannels);

    this.videoEncoders.forEach((encoderObj) => {
      encoderObj.encoder.configure(encoderObj.config);
    });

    this.triggerWorker = new Worker("/polyfills/triggerWorker.js");
    this.triggerWorker.postMessage({ frameRate: this.currentConfig.framerate });

    const track = this.stream.getVideoTracks()[0];
    this.videoProcessor = new MediaStreamTrackProcessor(track, this.triggerWorker, true);

    this.videoReader = this.videoProcessor.readable.getReader();

    let frameCounter = 0;

    const videoEncoders = Array.from(this.videoEncoders.entries());

    if (this.isPublishing) {
      this.startVideoFrameProcessing(frameCounter, videoEncoders);
    }
  }

  async startAudioStreaming(stream, channelName = CHANNEL_NAME.MIC_AUDIO) {
    if (!stream) {
      console.warn("No media stream available for audio");
      return null;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn("No audio track found in stream");
      return null;
    }

    const audioRecorderOptions = {
      encoderApplication: 2051,
      encoderComplexity: 0,
      encoderFrameSize: 20,
      timeSlice: 100,
    };

    let newAudioStream = new MediaStream([audioTrack]);
    if (channelName == CHANNEL_NAME.MIC_AUDIO) {
      this.currentAudioStream = newAudioStream;
    }
    const audioRecorder = await this.initAudioRecorder(newAudioStream, audioRecorderOptions);
    audioRecorder.ondataavailable = (typedArray) => this.handleAudioChunk(typedArray, channelName);

    await audioRecorder.start({
      timeSlice: audioRecorderOptions.timeSlice,
    });
    return audioRecorder;
  }

  handleVideoChunk(chunk, metadata, quality, channelName) {
    const encoderObj = this.videoEncoders.get(quality);
    if (!encoderObj) return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    if (metadata && metadata.decoderConfig && !encoderObj.metadataReady) {
      encoderObj.videoDecoderConfig = {
        codec: metadata.decoderConfig.codec,
        codedWidth: metadata.decoderConfig.codedWidth,
        codedHeight: metadata.decoderConfig.codedHeight,
        frameRate: this.currentConfig.framerate,
        description: metadata.decoderConfig.description,
      };
      encoderObj.metadataReady = true;
      this.sendStreamConfig(channelName, encoderObj.videoDecoderConfig, "video");
    }

    if (!streamData.configSent) return;

    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);
    const frameType = getFrameType(channelName, chunk.type);
    const packet = this.createPacketWithHeader(chunkData, chunk.timestamp, frameType, channelName);

    if (this.protocol === "webrtc") {
      this.sendOverDataChannel(channelName, packet, frameType);
      return;
    } else {
      this.sendOverStream(channelName, packet);
    }
  }

  handleAudioChunk(typedArray, channelName) {
    if (!this.audioEnabled) return;
    if (!this.isChannelOpen || !typedArray || typedArray.byteLength === 0) return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    try {
      const dataArray = new Uint8Array(typedArray);

      if (
        dataArray.length >= 4 &&
        dataArray[0] === 79 &&
        dataArray[1] === 103 &&
        dataArray[2] === 103 &&
        dataArray[3] === 83
      ) {
        if (!streamData.configSent && !streamData.config) {
          const description = this.createPacketWithHeader(
            dataArray,
            performance.now() * 1000,
            FRAME_TYPE.MIC_AUDIO,
            channelName
          );

          const audioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 1,
            description: description,
          };

          streamData.config = audioConfig;
          this.sendStreamConfig(channelName, audioConfig, "audio");
        }

        if (this.audioBaseTime === 0 && window.videoBaseTimestamp) {
          this.audioBaseTime = window.videoBaseTimestamp;
          window.audioStartPerfTime = performance.now();
          this.audioSamplesSent = 0;
        } else if (this.audioBaseTime === 0 && !window.videoBaseTimestamp) {
          this.audioBaseTime = performance.now() * 1000;
          this.audioSamplesSent = 0;
        }

        const timestamp = this.audioBaseTime + Math.floor((this.audioSamplesSent * 1000000) / this.kSampleRate);
        if (streamData.configSent) {
          const packet = this.createPacketWithHeader(dataArray, timestamp, FRAME_TYPE.MIC_AUDIO, channelName);
          if (this.protocol === "webrtc") {
            this.sendOverDataChannel(channelName, packet, FRAME_TYPE.MIC_AUDIO);
          } else {
            this.sendOverStream(channelName, packet);
          }
        }

        this.audioSamplesSent += this.audioSamplesPerChunk;
      }
    } catch (error) {
      console.error("Failed to send audio data:", error);
    }
  }

  async sendStreamConfig(channelName, config, mediaType) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData || streamData.configSent) return;

    try {
      let configPacket;

      if (mediaType === "video") {
        const vConfigUint8 = new Uint8Array(config.description);
        const vConfigBase64 = this.uint8ArrayToBase64(vConfigUint8);

        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "video",
          config: {
            codec: config.codec,
            codedWidth: config.codedWidth,
            codedHeight: config.codedHeight,
            frameRate: config.frameRate,
            quality: config.quality,
            description: vConfigBase64,
          },
        };
      } else if (mediaType === "audio") {
        const aConfigBase64 = this.uint8ArrayToBase64(new Uint8Array(config.description));

        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "audio",
          config: {
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            description: aConfigBase64,
          },
        };
      }

      this.commandSender.sendMediaConfig(channelName, JSON.stringify(configPacket));

      streamData.configSent = true;
      streamData.config = config;

      console.log(`[Stream Config] ✅ Config sent successfully for ${channelName}`);
      this.onStatusUpdate(`Config sent for stream: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send config for ${channelName}:`, error);
    }
  }

  createPacketWithHeader(data, timestamp, type, channelName) {
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    let adjustedTimestamp = timestamp;
    if (window.videoBaseTimestamp) {
      adjustedTimestamp = timestamp - window.videoBaseTimestamp;
    }

    let safeTimestamp = Math.floor(adjustedTimestamp / 1000);
    if (safeTimestamp < 0) safeTimestamp = 0;

    const HEADER_SIZE = 9;
    const MAX_TS = 0xffffffff;
    const MIN_TS = 0;

    if (safeTimestamp > MAX_TS) safeTimestamp = MAX_TS;
    if (safeTimestamp < MIN_TS) safeTimestamp = MIN_TS;

    const packet = new Uint8Array(HEADER_SIZE + (data instanceof ArrayBuffer ? data.byteLength : data.length));

    packet[8] = type;

    const view = new DataView(packet.buffer, 0, 8);
    view.setUint32(0, sequenceNumber, false);
    view.setUint32(4, safeTimestamp, false);

    packet.set(data instanceof ArrayBuffer ? new Uint8Array(data) : data, HEADER_SIZE);

    return packet;
  }

  getAndIncrementSequence(channelName) {
    if (!(channelName in this.sequenceNumbers)) {
      this.sequenceNumbers[channelName] = 0;
    }
    const current = this.sequenceNumbers[channelName];
    this.sequenceNumbers[channelName]++;
    return current;
  }

  uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  async stop() {
    if (!this.isPublishing) {
      return;
    }

    try {
      this.isPublishing = false;

      // Close video encoders
      for (const [quality, encoderObj] of this.videoEncoders) {
        if (encoderObj.encoder && encoderObj.encoder.state !== "closed") {
          await encoderObj.encoder.flush();
          encoderObj.encoder.close();
        }
      }
      this.videoEncoders.clear();

      // Stop audio processor
      if (this.micAudioProcessor && typeof this.micAudioProcessor.stop === "function") {
        await this.micAudioProcessor.stop();
        this.micAudioProcessor = null;
      }

      // Close all streams
      for (const [channelName, streamData] of this.publishStreams) {
        if (streamData.writer) {
          await streamData.writer.close();
        }
      }
      this.publishStreams.clear();

      // Close event stream
      if (this.eventStream && this.eventStream.writer) {
        await this.eventStream.writer.close();
        this.eventStream = null;
      }

      // Close WebTransport
      if (this.webTransport) {
        this.webTransport.close();
        this.webTransport = null;
      }

      // Close WebRTC
      if (this.webRtc) {
        this.webRtc.close();
        this.webRtc = null;
      }

      // Stop all tracks
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      // Reset state
      this.isChannelOpen = false;
      this.initializeSequenceTracking();
      this.audioBaseTime = 0;
      this.audioSamplesSent = 0;

      // Clear global variables
      window.videoBaseTimestamp = null;
      window.audioStartPerfTime = null;

      if (this.triggerWorker) {
        this.triggerWorker.terminate();
        this.triggerWorker = null;
      }
      if (this.workerPing) {
        this.workerPing.terminate();
        this.workerPing = null;
      }

      this.onStreamStop();
      this.onStatusUpdate("Publishing stopped");
      if (this.isScreenSharing) {
        await this.stopShareScreen();
      }
    } catch (error) {
      this.onStatusUpdate(`Error stopping publishing: ${error.message}`, true);
      throw error;
    }
  }

  // Getters for state
  get isActive() {
    return this.isPublishing;
  }

  get streamInfo() {
    return {
      type: this.publishType,
      config: this.currentConfig,
      activeStreams: Array.from(this.publishStreams.keys()),
    };
  }

  ////////// ! Move screen share to separate class !//////////

  async startShareScreen(screenMediaStream) {
    console.log("Starting screen sharing with provided MediaStream:", screenMediaStream);
    if (this.isScreenSharing) {
      this.onStatusUpdate("Already sharing screen", true);
      return;
    }

    if (!this.isChannelOpen) {
      throw new Error("Connection not established. Start publishing first.");
    }

    if (!screenMediaStream || !(screenMediaStream instanceof MediaStream)) {
      throw new Error("Invalid screen MediaStream provided");
    }

    this.sendMeetingEvent(MEETING_EVENTS.START_SCREEN_SHARE);

    try {
      this.screenStream = screenMediaStream;

      // Validate stream has tracks
      const hasVideo = this.screenStream.getVideoTracks().length > 0;
      const hasAudio = this.screenStream.getAudioTracks().length > 0;

      if (!hasVideo) {
        throw new Error("Screen stream must have at least a video track");
      }

      console.warn(`Screen share stream received - Video: ${hasVideo}, Audio: ${hasAudio}`);

      // Handle screen share stop when user stops from browser UI
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log("Screen share stopped by user");
          this.stopShareScreen();
        };
      }
      this.isScreenSharing = true;

      // create WebRTC connection for screen share

      // Initialize screen share channels
      // this.initializeScreenShareStreams();

      // Create channels based on protocol
      if (this.protocol === "webtransport") {
        await this.createBidirectionalStream(CHANNEL_NAME.SCREEN_SHARE_720P);
        if (hasAudio) {
          await this.createBidirectionalStream(CHANNEL_NAME.SCREEN_SHARE_AUDIO);
        }
      } else if (this.protocol === "webrtc") {
        await this.setupWebRTCConnection(STREAM_TYPE.SCREEN_SHARE);
        // await this.createDataChannel(CHANNEL_NAME.SCREEN_SHARE_720P, STREAM_TYPE.SCREEN_SHARE);
        // if (hasAudio) {
        // await this.createDataChannel(CHANNEL_NAME.SCREEN_SHARE_AUDIO, STREAM_TYPE.SCREEN_SHARE);
        // }
      }

      // Start video encoding
      await this.startScreenVideoCapture();

      // Start audio if available
      if (hasAudio) {
        await this.startScreenAudioStreaming();
      }

      this.onStatusUpdate(`Screen sharing started (Video: ${hasVideo}, Audio: ${hasAudio})`);

      // Send event to server
      // await this.sendMeetingEvent("screenshare_on");

      // Emit event for UI updates
      this.emit("screenShareStarted", {
        stream: this.screenStream,
        hasVideo,
        hasAudio,
      });

      return {
        stream: this.screenStream,
        hasVideo,
        hasAudio,
      };
    } catch (error) {
      this.onStatusUpdate(`Failed to start screen sharing: ${error.message}`, true);
      throw error;
    }
  }

  // 4. Add startScreenVideoCapture method
  async startScreenVideoCapture() {
    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (!videoTrack) return;

    this.initVideoEncoders(this.screenSubChannels);

    this.screenVideoEncoder = this.videoEncoders.get(CHANNEL_NAME.SCREEN_SHARE_720P);
    const screenVideoEncoder = this.videoEncoders.get(CHANNEL_NAME.SCREEN_SHARE_720P).encoder;
    const screenEncoderConfig = this.videoEncoders.get(CHANNEL_NAME.SCREEN_SHARE_720P).config;
    screenVideoEncoder.configure(screenEncoderConfig);

    // Create processor
    this.screenVideoProcessor = new MediaStreamTrackProcessor(videoTrack);
    this.screenVideoReader = this.screenVideoProcessor.readable.getReader();

    // Start processing frames
    (async () => {
      let frameCounter = 0;
      try {
        while (this.isScreenSharing) {
          const result = await this.screenVideoReader.read();
          if (result.done) break;

          const frame = result.value;
          frameCounter++;
          const keyFrame = frameCounter % 30 === 0;
          if (screenVideoEncoder.encodeQueueSize <= 2) {
            screenVideoEncoder.encode(frame, { keyFrame });
          }
          frame.close();
        }
      } catch (error) {
        console.error("Screen video processing error:", error);
      }
    })();
  }

  // 5. Add startScreenAudioStreaming method
  async startScreenAudioStreaming() {
    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (!audioTrack) return;

    const audioRecorderOptions = {
      encoderApplication: 2051,
      encoderComplexity: 0,
      encoderFrameSize: 20,
      timeSlice: 100,
    };

    const screenAudioStream = new MediaStream([audioTrack]);
    this.screenAudioProcessor = await this.initAudioRecorder(screenAudioStream, audioRecorderOptions);

    this.screenAudioProcessor.ondataavailable = (typedArray) =>
      this.handleAudioChunk(typedArray, CHANNEL_NAME.SCREEN_SHARE_AUDIO);

    await this.screenAudioProcessor.start({
      timeSlice: audioRecorderOptions.timeSlice,
    });
  }

  // 6. Add stopShareScreen method
  async stopShareScreen() {
    if (!this.isScreenSharing) return;

    try {
      this.isScreenSharing = false;

      // Close encoder
      if (this.screenVideoEncoder?.encoder && this.screenVideoEncoder.encoder.state !== "closed") {
        await this.screenVideoEncoder.encoder.flush();
        this.screenVideoEncoder.encoder.close();
      }
      this.screenVideoEncoder = null;

      // Stop audio processor
      if (this.screenAudioProcessor && typeof this.screenAudioProcessor.stop === "function") {
        await this.screenAudioProcessor.stop();
        this.screenAudioProcessor = null;
      }

      // Stop reader
      if (this.screenVideoReader) {
        await this.screenVideoReader.cancel();
        this.screenVideoReader = null;
      }

      // Stop processor
      this.screenVideoProcessor = null;

      // Stop stream tracks
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }

      // Send event
      await this.sendMeetingEvent("screenshare_off");

      this.onStatusUpdate("Screen sharing stopped");
    } catch (error) {
      this.onStatusUpdate(`Error stopping screen share: ${error.message}`, true);
      throw error;
    }
  }
}

export default Publisher;

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
