import EventEmitter from "../events/EventEmitter.js";

/**
 * WebRTC Publisher Class
 * Handles video/audio streaming via WebTransport
 */
export default class Publisher extends EventEmitter {
  constructor(options = {}) {
    super();

    // Validate required options
    if (!options.publishUrl) {
      throw new Error("publishUrl is required");
    }

    // Configuration
    this.publishUrl = options.publishUrl;
    this.streamType = options.streamType || "camera"; // 'camera' or 'display'
    this.streamId = options.streamId || "test_stream";
    this.userId = options.userId || null; // User ID for screen share tile mapping
    this.roomId = options.roomId || "test_room";
    this.useWebRTC = options.useWebRTC || false;
    this.preConfiguredStream = options.mediaStream || null;

    // Video configuration
    this.currentConfig = {
      codec: "avc1.640c34",
      width: options.width || 1280,
      height: options.height || 720,
      framerate: options.framerate || 30,
      bitrate: options.bitrate || 1_500_000,
    };

    // Audio configuration
    this.kSampleRate = 48000;
    this.opusBaseTime = 0;
    this.opusSamplesSent = 0;
    this.opusSamplesPerChunk = 960; // 20ms at 48kHz
    this.opusChunkCount = 0;

    // State variables
    this.stream = null;
    this.audioProcessor = null;
    this.videoProcessor = null;
    this.videoReader = null;
    this.screenVideoProcessor = null;
    this.screenVideoReader = null;
    this.webTransport = null;
    this.webRtc = null;
    this.isChannelOpen = false;
    this.sequenceNumber = 0;
    this.isPublishing = false;

    this.cameraEnabled = true;
    this.micEnabled = true;
    this.isHandRaised = false;
    this.hasCamera = options.hasCamera !== undefined ? options.hasCamera : true;
    this.hasMic = options.hasMic !== undefined ? options.hasMic : true;

    // Callbacks
    this.onStatusUpdate =
      options.onStatusUpdate || ((message, isError) => console.log(message));
    this.onStreamStart = options.onStreamStart || (() => { });
    this.onStreamStop = options.onStreamStop || (() => { });
    this.onServerEvent = options.onServerEvent || ((event) => { });

    // Initialize modules
    this.wasmInitialized = false;
    this.wasmInitializing = false;
    this.wasmInitPromise = null;
    this.initAudioRecorder = null;
    this.WasmEncoder = null;

    // Stream management
    this.publishStreams = new Map(); // key: channelName, value: {writer, reader, configSent, config}
    this.videoEncoders = new Map();
    // this.fecEncoders = new Map();
    this.eventStream = null; // Dedicated event stream

    this.webRtcServerUrl =
      options.webRtcServerUrl || "daibo.ermis.network:9993";

    this.subStreams = [
      {
        name: "meeting_control",
        channelName: CHANNEL_NAME.MEETING_CONTROL,
      },
      {
        name: "microphone",
        channelName: CHANNEL_NAME.MICROPHONE,
      },
      {
        name: "low",
        width: 640,
        height: 360,
        bitrate: 400_000,
        framerate: 30,
        channelName: CHANNEL_NAME.CAMERA_360P,
      },
      {
        name: "high",
        width: 1280,
        height: 720,
        bitrate: 800_000,
        framerate: 30,
        channelName: CHANNEL_NAME.CAMERA_720P,
      },
      {
        name: "screen",
        width: 1920,
        height: 1080,
        bitrate: 2_000_000,
        framerate: 30,
        channelName: CHANNEL_NAME.SCREEN_SHARE_1080P,
      },
    ];

    this.currentCamAudioStream = null;
    this.currentScreenAudioStream = null;
    this.triggerWorker = null;
  }

  async init() {
    await this.loadAllDependencies();
    this.onStatusUpdate("Publisher initialized successfully");
  }

  async loadAllDependencies() {
    try {
      if (!document.querySelector('script[src*="MSTP_polyfill.js"]')) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/polyfills/MSTP_polyfill.js";
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error("Failed to load MSTP polyfill"));
          document.head.appendChild(script);
        });
        console.log("Polyfill loaded successfully");
      }

      if (!this.wasmInitialized) {
        if (this.wasmInitializing && this.wasmInitPromise) {
          await this.wasmInitPromise;
        } else {
          this.wasmInitializing = true;
          const { default: init, WasmEncoder } = await import(
            "../raptorQ/raptorq_wasm.js"
          );

          this.WasmEncoder = WasmEncoder;

          this.wasmInitPromise = init("../raptorQ/raptorq_wasm_bg.wasm")
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

      const opusModule = await import(
        `/opus_decoder/opusDecoder.js?t=${Date.now()}`
      );
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

    // Setup WebTransport connection
    await this.setupConnection();

    try {
      // Get media stream based on type
      await this.getMediaStream();
      this.isPublishing = true;
      // Start streaming
      await this.startStreaming();

      this.onStreamStart();
      this.onStatusUpdate("Publishing started successfully");
    } catch (error) {
      this.onStatusUpdate(`Failed to start publishing: ${error.message}`, true);
      throw error;
    }
  }

  // Toggle camera
  async toggleCamera() {
    if (this.cameraEnabled) {
      await this.turnOffCamera();
    } else {
      await this.turnOnCamera();
    }
  }

  // Toggle mic
  async toggleMic() {
    if (this.micEnabled) {
      await this.turnOffMic();
    } else {
      await this.turnOnMic();
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

  // Turn off camera (stop encoding video frames)
  async turnOffCamera() {
    if (!this.hasCamera) {
      console.warn("Cannot turn off camera: no camera available");
      return;
    }

    if (!this.cameraEnabled) return;

    this.cameraEnabled = false;
    this.onStatusUpdate("Camera turned off");

    // Send camera_off event to server
    await this.sendMeetingEvent("camera_off");
  }

  // Turn on camera (resume encoding video frames)
  async turnOnCamera() {
    if (!this.hasCamera) {
      console.warn("Cannot turn on camera: no camera available");
      return;
    }

    if (this.cameraEnabled) return;

    this.cameraEnabled = true;
    this.onStatusUpdate("Camera turned on");

    // Send camera_on event to server
    await this.sendMeetingEvent("camera_on");
  }

  // Turn off mic (stop encoding audio chunks)
  async turnOffMic() {
    if (!this.hasMic) {
      console.warn("Cannot turn off mic: no microphone available");
      return;
    }

    if (!this.micEnabled) return;

    this.micEnabled = false;
    this.onStatusUpdate("Mic turned off");

    // Send mic_off event to server
    await this.sendMeetingEvent("mic_off");
  }

  async turnOnMic() {
    if (!this.hasMic) {
      console.warn("Cannot turn on mic: no microphone available");
      return;
    }

    if (this.micEnabled) return;

    this.micEnabled = true;
    this.onStatusUpdate("Mic turned on");

    await this.sendMeetingEvent("mic_on");
  }

  /*
    * Switch to a different camera by deviceId
    just switches the video track in the existing stream, handle new track 
  */
  async switchCamera(deviceId) {
    if (!this.hasCamera) {
      throw new Error("Camera not available");
    }

    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    try {
      console.log(`[Publisher] Switching camera to device: ${deviceId}`);
      this.onStatusUpdate("Switching camera...");

      const videoConstraints = {
        deviceId: { exact: deviceId },
        width: { ideal: this.currentConfig.width },
        height: { ideal: this.currentConfig.height },
        frameRate: { ideal: this.currentConfig.framerate },
      };

      const audioConstraints =
        this.hasMic && this.stream?.getAudioTracks().length > 0
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
        throw new Error("Failed to get video track from new camera");
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.stream.getVideoTracks()[0];

      this.stream.removeTrack(oldVideoTrack);
      this.stream.addTrack(newVideoTrack);
      oldVideoTrack.stop();

      this.handleNewTrack(newVideoTrack);

      this.emit("cameraSwitch", {
        deviceId,
        stream: this.stream,
        videoOnlyStream: newStream,
      });

      console.log("[Publisher] Camera switched successfully");
      this.onStatusUpdate(`Camera switched successfully`);

      return { stream: this.stream, videoOnlyStream: newStream };
    } catch (error) {
      console.error("[Publisher] Failed to switch camera:", error);
      this.onStatusUpdate(`Failed to switch camera: ${error.message}`, true);
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

      //wait a bit to ensure all frames are processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Close existing video reader and processor
      // if (this.videoReader) {
      //   this.videoReader.cancel();
      // }

      // if (this.videoProcessor) {
      //   if (this.videoProcessor.readable) {
      //     this.videoProcessor.readable.cancel();
      //   }
      // }

      console.log("Switched to new video track:", track);

      // Initialize new video processor
      this.videoProcessor = new MediaStreamTrackProcessor(
        track,
        this.triggerWorker,
        true
      );

      this.videoReader = this.videoProcessor.readable.getReader();
      console.log("New video processor reader created:", this.videoReader);

      // Reset frame counter and base timestamp
      // window.videoBaseTimestamp = undefined;
      let frameCounter = 0;

      // Get list of camera encoders
      const cameraEncoders = Array.from(this.videoEncoders.entries()).filter(
        ([_, obj]) => obj.channelName.startsWith("cam")
      );

      // Restart video frame processing
      this.isPublishing = wasPublishing;

      if (this.isPublishing) {
        this.startVideoFrameProcessing(frameCounter, cameraEncoders);
      }

      this.onStatusUpdate("Camera switched successfully", false);
      return true;
    } catch (error) {
      this.isPublishing = false;
      const errorMsg = `Camera switch error: ${error.message}`;
      this.onStatusUpdate(errorMsg, true);
      console.error(errorMsg, error);
      return false;
    }
  }

  startVideoFrameProcessing(initialFrameCounter = 0, cameraEncoders) {
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

          if (!this.cameraEnabled) {
            console.log("Camera disabled, skipping frame");
            frame.close();
            continue;
          }

          frameCounter++;
          const keyFrame = frameCounter % 30 === 0;

          for (let i = 0; i < cameraEncoders.length; i++) {
            const [quality, encoderObj] = cameraEncoders[i];
            const isLastEncoder = i === cameraEncoders.length - 1;

            if (encoderObj.encoder.encodeQueueSize <= 2) {
              const frameToEncode = isLastEncoder
                ? frame
                : new VideoFrame(frame);
              encoderObj.encoder.encode(frameToEncode, { keyFrame });
              frameToEncode.close();
            }
          }
        }
      } catch (error) {
        this.onStatusUpdate(`Video processing error: ${error.message}`, true);
        console.error("Video capture error:", error);
      }
    })();
  }

  async switchMicrophone(deviceId) {
    if (!this.hasMic) {
      throw new Error("Microphone not available");
    }

    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    try {
      console.log(`[Publisher] Switching microphone to device: ${deviceId}`);
      this.onStatusUpdate("Switching microphone...");

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
        throw new Error("Failed to get audio track from new microphone");
      }

      //just switch the audio track in the existing stream
      this.currentCamAudioStream = newStream;

      const newAudioTrack = newStream.getAudioTracks()[0];
      console.log("New audio track obtained:", newAudioTrack);

      console.log("[Publisher] Microphone switched successfully");
      this.onStatusUpdate(`Microphone switched successfully`);
      const videoOnlyStream = new MediaStream();
      const videoTracks = this.stream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }
      this.emit("microphoneSwitch", {
        deviceId,
        stream: this.stream,
        videoOnlyStream,
      });

      return { stream: this.stream, videoOnlyStream };
    } catch (error) {
      console.error("[Publisher] Failed to switch microphone:", error);
      this.onStatusUpdate(
        `Failed to switch microphone: ${error.message}`,
        true
      );
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

      const wasVideoActive = this.hasCamera && this.cameraEnabled;
      const wasAudioActive = this.hasMic && this.micEnabled;

      // if (wasVideoActive && hasVideo) {
      //   console.log("[Publisher] Stopping video processing...");
      //   await this.stopVideoProcessing();
      // }

      // if (wasAudioActive && hasAudio) {
      //   console.log("[Publisher] Stopping audio processing...");
      //   await this.stopAudioProcessing();
      // }

      const oldStream = this.stream;
      this.stream = newStream;

      this.hasCamera = hasVideo;
      this.hasMic = hasAudio;
      this.cameraEnabled = hasVideo;
      this.micEnabled = hasAudio;

      if (hasVideo) {
        console.log("[Publisher] Starting video capture with new stream...");
        await this.startVideoCapture();
      }

      if (hasAudio) {
        console.log("[Publisher] Starting audio streaming with new stream...");
        this.audioProcessor = await this.startOpusAudioStreaming();
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
      this.onStatusUpdate(
        `Failed to replace media stream: ${error.message}`,
        true
      );
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
    if (this.audioProcessor) {
      try {
        if (typeof this.audioProcessor.stop === "function") {
          await this.audioProcessor.stop();
        }
      } catch (error) {
        console.warn("Error stopping audio processor:", error);
      }
      this.audioProcessor = null;
    }
  }

  async pinForEveryone(targetStreamId) {
    await this.sendMeetingEvent("pin_for_everyone", targetStreamId);
  }
  async unpinForEveryone(targetStreamId) {
    await this.sendMeetingEvent("unpin_for_everyone", targetStreamId);
  }

  // Raise hand
  async raiseHand() {
    if (this.isHandRaised) return;

    this.isHandRaised = true;
    await this.sendMeetingEvent("raise_hand");
    this.onStatusUpdate("Hand raised");
  }

  // Lower hand
  async lowerHand() {
    if (!this.isHandRaised) return;

    this.isHandRaised = false;
    await this.sendMeetingEvent("lower_hand");
    this.onStatusUpdate("Hand lowered");
  }

  /**
   * Send meeting control event to server
   */
  async sendMeetingEvent(eventType, targetStreamId = null) {
    if (!eventType) return;

    if (!this.isChannelOpen || !this.eventStream) {
      console.warn(`Skipping ${eventType} event: Event stream not ready`);
      return;
    }
    console.log("[Meeting Event] Sender stream ID:", this.streamId);

    const eventMessage = {
      type: eventType,
      sender_stream_id: this.streamId,
      timestamp: Date.now(),
    };

    if (
      (eventType === "pin_for_everyone" ||
        eventType === "unpin_for_everyone") &&
      targetStreamId
    ) {
      eventMessage.target_stream_id = targetStreamId;
    }

    try {
      await this.sendEvent(eventMessage);
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
      this.hasMic = audioTracks.length > 0;
      this.hasCamera = videoTracks.length > 0;
      this.micEnabled = this.hasMic;
      this.cameraEnabled = this.hasCamera;

      console.log(
        `Pre-configured stream - Video: ${this.hasCamera}, Audio: ${this.hasMic}`
      );

      const videoOnlyStream = new MediaStream();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("localStreamReady", {
        stream: this.stream,
        videoOnlyStream: videoOnlyStream,
        streamType: this.streamType,
        streamId: this.streamId,
        config: this.currentConfig,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });

      return videoOnlyStream;
    }

    if (this.streamType === "camera") {
      const constraints = {};

      if (this.hasMic) {
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

      if (this.hasCamera) {
        constraints.video = {
          width: { ideal: this.currentConfig.width },
          height: { ideal: this.currentConfig.height },
          frameRate: { ideal: this.currentConfig.framerate },
        };
        if (deviceIds.camera) {
          constraints.video.deviceId = { exact: deviceIds.camera };
        }
      }

      // Check if at least one media type is requested
      if (!this.hasMic && !this.hasCamera) {
        console.warn("Neither camera nor microphone is enabled");
        return;
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(
          `Media stream obtained - Video: ${this.hasCamera}, Audio: ${this.hasMic}`
        );
      } catch (error) {
        console.error("Error accessing media devices:", error);

        // Try fallback: request without the failed device
        if (this.hasMic && this.hasCamera) {
          console.log("Retrying with fallback...");
          try {
            // Try video only
            this.stream = await navigator.mediaDevices.getUserMedia({
              video: constraints.video,
            });
            console.warn("Fallback: Got video only, no audio available");
            this.hasMic = false;
            this.micEnabled = false;
          } catch (videoError) {
            try {
              // Try audio only
              this.stream = await navigator.mediaDevices.getUserMedia({
                audio: constraints.audio,
              });
              console.warn("Fallback: Got audio only, no video available");
              this.hasCamera = false;
              this.cameraEnabled = false;
            } catch (audioError) {
              console.error("Failed to get any media stream");
              this.onStatusUpdate(
                "No media devices available - permission denied or no devices found",
                true
              );
              // Don't throw, just return - this allows the app to continue without media
              return;
            }
          }
        } else {
          // Single device requested but failed
          console.error(
            `Failed to access ${this.hasCamera ? "camera" : "microphone"}`
          );
          this.onStatusUpdate(
            `Cannot access ${this.hasCamera ? "camera" : "microphone"
            } - permission denied or device not found`,
            true
          );
          // Don't throw, just return
          return;
        }
      }
    } else if (this.streamType === "display") {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      // Handle user stopping screen share via browser UI
      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stop();
        };
      }
    }

    // Check if we got a stream
    if (!this.stream) {
      console.warn("No media stream available");
      return;
    }

    // Create video-only stream for display
    const videoOnlyStream = new MediaStream();
    const videoTracks = this.stream.getVideoTracks();

    if (videoTracks.length > 0) {
      videoOnlyStream.addTrack(videoTracks[0]);
    }

    // Update device availability based on actual tracks
    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.hasMic = false;
      this.micEnabled = false;
      console.log("No audio tracks in stream, disabling microphone");
    }

    if (videoTracks.length === 0) {
      this.hasCamera = false;
      this.cameraEnabled = false;
      console.log("No video tracks in stream, disabling camera");
    }

    // Emit local stream ready event for app integration
    this.emit("localStreamReady", {
      stream: this.stream, // Full stream with audio + video
      videoOnlyStream: videoOnlyStream, // Video only stream
      streamType: this.streamType,
      streamId: this.streamId,
      config: this.currentConfig,
      hasAudio: audioTracks.length > 0,
      hasVideo: videoTracks.length > 0,
    });

    const mediaInfo = [];
    if (audioTracks.length > 0) mediaInfo.push("audio");
    if (videoTracks.length > 0) mediaInfo.push("video");

    this.onStatusUpdate(
      `${this.streamType} stream ready (${mediaInfo.join(" + ") || "no media"})`
    );
    return videoOnlyStream;
  }

  initVideoEncoders() {
    this.subStreams.forEach((subStream) => {
      if (
        !subStream.channelName.startsWith(CHANNEL_NAME.MICROPHONE) &&
        !subStream.channelName.startsWith(CHANNEL_NAME.MEETING_CONTROL)
      ) {
        console.log(`Setting up encoder for ${subStream.name}`);
        const encoder = new VideoEncoder({
          output: (chunk, metadata) =>
            this.handleVideoChunk(
              chunk,
              metadata,
              subStream.name,
              subStream.channelName
            ),
          error: (e) =>
            this.onStatusUpdate(
              `Encoder ${subStream.name} error: ${e.message}`,
              true
            ),
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
    if (this.useWebRTC) {
      await this.setupWebRTCConnection();
    } else {
      await this.setupWebTransportConnection();
    }
  }

  async setupWebTransportConnection() {
    this.webTransport = new WebTransport(this.publishUrl);
    await this.webTransport.ready;
    console.log("WebTransport connected to server");

    await this.createEventStream();

    for (const subStream of this.subStreams) {
      await this.createBidirectionalStream(subStream.channelName);
      // if (!subStream.channelName.startsWith("screen")) {
      // }
    }

    await this.sendPublisherState();
    this.isChannelOpen = true;
    this.onStatusUpdate(
      "WebTransport connection established with event stream and media streams"
    );
  }

  async setupWebRTCConnection() {
    try {
      this.webRtc = new RTCPeerConnection();

      for (const subStream of this.subStreams) {
        if (!subStream.channelName.startsWith("screen")) {
          await this.createDataChannel(subStream.channelName);
        }
      }

      const offer = await this.webRtc.createOffer();
      await this.webRtc.setLocalDescription(offer);

      const response = await fetch(
        `https://${this.webRtcServerUrl}/meeting/sdp/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer,
            room_id: this.roomId,
            stream_id: this.streamId,
          }),
        }
      );
      console.log("Response from WebRTC server:", response);

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const answer = await response.json();
      await this.webRtc.setRemoteDescription(answer);

      this.isChannelOpen = true;
    } catch (error) {
      console.error("WebRTC setup error:", error);
    }
  }

  async createEventStream() {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;

    const writer = writable.getWriter();
    const reader = readable.getReader();

    this.eventStream = { writer, reader };

    console.log("WebTransport event stream established");

    const initData = new TextEncoder().encode("meeting_control");
    await this.sendOverEventStream(initData);

    // Setup reader cho event stream
    this.setupEventStreamReader(reader);

    this.setupPingWorker();
  }

  setupPingWorker() {
    const senderType = this.useWebRTC ? "webrtc" : "webtransport";
    const workerPing = new Worker("polyfills/intervalWorker.js");
    workerPing.postMessage({ interval: 1000 });
    let lastPingTime = Date.now();
    workerPing.onmessage = (e) => {
      const ping = new TextEncoder().encode("ping");
      if (senderType === "webrtc") {
        this.sendOverDataChannel("meeting_control", ping, FRAME_TYPE.PING);
        console.log("Ping sent over WebRTC DataChannel");
      } else if (senderType === "webtransport") {
        console.log("Ping sent over WebTransport event stream");
        this.sendOverEventStream(ping);
      }
      if (Date.now() - lastPingTime > 1200) {
        console.warn("Ping delay detected, connection may be unstable");
      }
      lastPingTime = Date.now();
    };
  }

  setupEventStreamReader(reader) {
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            console.log("Event stream closed by server");
            break;
          }
          if (value) {
            const msg = new TextDecoder().decode(value);
            try {
              const event = JSON.parse(msg);
              this.onServerEvent(event);
            } catch (e) {
              console.log("Non-JSON event message:", msg);
            }
          }
        }
      } catch (err) {
        console.error("Error reading from event stream:", err);
      }
    })();
  }

  async sendOverEventStream(data) {
    if (!this.eventStream) {
      console.error("Event stream not available");
      return;
    }

    try {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;

      const len = bytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(bytes, 4);
      await this.eventStream.writer.write(out);
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
      type: "PublisherState",
      streamId: this.streamId,
      hasCamera: this.hasCamera,
      hasMic: this.hasMic,
      cameraEnabled: this.hasCamera ? this.cameraEnabled : false,
      micEnabled: this.hasMic ? this.micEnabled : false,
      streamType: this.streamType, // 'camera' or 'display'
      timestamp: Date.now(),
    };

    if (this.useWebRTC) {
      const dataJson = JSON.stringify(stateEvent);
      const eventToSend = new TextEncoder().encode(dataJson);
      this.sendOverDataChannel(
        CHANNEL_NAME.MEETING_CONTROL,
        eventToSend,
        FRAME_TYPE.EVENT
      );
    } else {
      await this.sendEvent(stateEvent);
    }

    this.onStatusUpdate("Publisher state sent to server");
  }

  async createDataChannel(channelName) {
    const id = getDataChannelId(channelName);

    const dataChannel = this.webRtc.createDataChannel(channelName, {
      ordered: false,
      id,
      negotiated: true,
    });

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
        console.warn("datachannel state", dataChannel.readyState);
        this.sendPublisherState();
        this.setupPingWorker();
      }
      console.log(`WebRTC data channel (${channelName}) established`);
    };
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

    console.log(
      `WebTransport bidirectional stream (${channelName}) established`
    );

    const initData = new TextEncoder().encode(channelName);
    await this.sendOverStream(channelName, initData);

    // this.setupStreamReader(channelName, reader);

    console.log(`Stream created: ${channelName}`);
  }

  // setupStreamReader(channelName, reader) {
  //   (async () => {
  //     try {
  //       while (true) {
  //         const { value, done } = await reader.read();
  //         if (done) {
  //           console.log(`Stream ${channelName} closed by server`);
  //           break;
  //         }
  //         if (value) {
  //           const msg = new TextDecoder().decode(value);
  //           if (msg.startsWith("ack:") || msg.startsWith("config:")) {
  //             console.log(`${channelName} received:`, msg);
  //           }
  //         }
  //       }
  //     } catch (err) {
  //       console.error(`Error reading from stream ${channelName}:`, err);
  //     }
  //   })();
  // }

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
      // Check if using WebTransport (has writer) or WebRTC DataChannel
      if (streamData.writer) {
        await streamData.writer.write(out);
      } else if (streamData.dataChannel && streamData.dataChannel.readyState === 'open') {
        streamData.dataChannel.send(out);
      } else {
        console.error(`Stream ${channelName} has no valid writer or dataChannel`);
        throw new Error(`Stream ${channelName} is not ready`);
      }
    } catch (error) {
      console.error(`Failed to send over stream ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Send data over WebRTC DataChannel with FEC encoding for keyframes
   * @param {Uint8Array} packet - Packet created by createPacketWithHeader of binary data
   * @param {number} sequenceNumber - Sequence number | required for ordering and FEC
   * @param {number} packetType - Frame type (0-8, 0xFF for ping, 0xFE for event)
   */
  async sendOverDataChannel(channelName, packet, frameType) {
    const dataChannel = this.publishStreams.get(channelName)?.dataChannel;
    const sequenceNumber = this.sequenceNumber;

    const dataChannelReady =
      this.publishStreams.get(channelName)?.dataChannelReady;
    if (
      !dataChannelReady ||
      !dataChannel ||
      dataChannel.readyState !== "open"
    ) {
      console.warn("DataChannel not ready");
      return;
    }

    try {
      const needFecEncode =
        frameType === 0 ||
        frameType === 2 ||
        frameType === 4 ||
        frameType === 7 ||
        frameType === FRAME_TYPE.CONFIG;
      packet.length > 1000;

      // define packetType , video : 0x00, audio 0x01, ping: 0xFF, event: 0xFE, config: 0xFD
      const packetType = getTransportPacketType(frameType);

      if (needFecEncode && packet.length > 100) {
        let fecPackets = 2;

        const MTU = 1024;
        const HEADER_SIZE = 20; // 4 + 1 + 1 + 14
        const chunkSize = MTU - HEADER_SIZE; // = 1004

        const encoder = new this.WasmEncoder(packet, chunkSize);

        const configBuf = encoder.getConfigBuffer();

        // parse config buffer
        // - 8 bytes: transfer_length (u64)
        // - 2 bytes: symbol_size (u16)
        // - 1 byte:  num_source_blocks (u8)
        // - 2 bytes: num_sub_blocks (u16)
        // - 1 byte:  symbol_alignment (u8)
        const view = new DataView(configBuf.buffer);
        const transferLength = view.getBigUint64(0, false);
        const symbolSize = view.getUint16(8, false);
        const sourceBlocks = view.getUint8(10);
        const subBlocks = view.getUint16(11, false);
        const alignment = view.getUint8(13);

        const packets = encoder.encode(fecPackets);

        const raptorQConfig = {
          transferLength,
          symbolSize,
          sourceBlocks,
          subBlocks,
          alignment,
        };

        for (let i = 0; i < packets.length; i++) {
          const fecPacket = packets[i];
          const wrapper = this.createFecPacketWithHeader(
            fecPacket,
            sequenceNumber,
            packetType,
            raptorQConfig
          );
          dataChannel.send(wrapper);
        }
        return;
      }

      // No FEC encoding - send with regular wrapper

      const wrapper = this.createRegularPacketWithHeader(
        packet,
        sequenceNumber,
        packetType
      );

      dataChannel.send(wrapper);
    } catch (error) {
      console.error("Failed to send over DataChannel:", error);
    }
  }

  /**
   * Create regular packet with standard header (non-FEC)
   * @param {Uint8Array} packet - Raw packet data
   * @param {number} sequenceNumber - Sequence number for packet ordering
   * @param {number} packetType - Packet type (0x00: video, 0x01: audio, etc.)
   * @returns {Uint8Array} - Wrapped packet with standard header
   */
  createFecPacketWithHeader(packet, sequenceNumber, packetType, raptorQConfig) {
    const { transferLength, symbolSize, sourceBlocks, subBlocks, alignment } =
      raptorQConfig;

    // Create header: 4 bytes seq + 1 byte FEC marker + 1 byte packet type + 14 bytes RaptorQ header
    const header = new ArrayBuffer(4 + 1 + 1 + 14);
    const view = new DataView(header);

    // 4 bytes chunk id (sequence number)
    view.setUint32(0, sequenceNumber, false); // big-endian
    // 1 byte FEC marker
    view.setUint8(4, 0xff); // FEC marker
    // 1 byte packet type
    view.setUint8(5, packetType);
    // 14 bytes RaptorQ packet header
    view.setBigUint64(6, transferLength, false);
    view.setUint16(14, symbolSize, false);
    view.setUint8(16, sourceBlocks);
    view.setUint16(17, subBlocks, false);
    view.setUint8(19, alignment);

    // Combine header and packet data
    const wrapper = new Uint8Array(header.byteLength + packet.length);
    wrapper.set(new Uint8Array(header), 0);
    wrapper.set(packet, header.byteLength);

    return wrapper;
  }

  /**
   * Create regular packet with standard header (non-FEC)
   * @param {Uint8Array} packet - Raw packet data
   * @param {number} sequenceNumber - Sequence number for packet ordering
   * @param {number} packetType - Packet type (0x00: video, 0x01: audio, etc.)
   * @returns {Uint8Array} - Wrapped packet with standard header
   */
  createRegularPacketWithHeader(packet, sequenceNumber, packetType) {
    // Create wrapper: 4 bytes seq + 1 byte FEC flag + 1 byte packet type + data
    const wrapper = new Uint8Array(6 + packet.length);
    const view = new DataView(wrapper.buffer);

    // 4 bytes sequence number
    view.setUint32(0, sequenceNumber, false);
    // 1 byte FEC flag (0x00 = not FEC)
    view.setUint8(4, 0x00);
    // 1 byte packet type
    view.setUint8(5, packetType);
    // Copy packet data
    wrapper.set(packet, 6);

    return wrapper;
  }

  async startStreaming() {
    // Start video capture if camera is available
    if (this.hasCamera && this.stream?.getVideoTracks().length > 0) {
      await this.startVideoCapture();
    } else {
      console.log("Skipping video capture: no camera available");
    }

    // Start audio streaming if microphone is available
    if (this.hasMic && this.stream?.getAudioTracks().length > 0) {
      this.audioProcessor = await this.startOpusAudioStreaming();
    } else {
      console.log("Skipping audio streaming: no microphone available");
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

    this.initVideoEncoders();

    this.videoEncoders.forEach((encoderObj) => {
      console.log(
        `Configuring encoder for ${encoderObj.channelName}`,
        encoderObj,
        "config",
        encoderObj.config
      );
      encoderObj.encoder.configure(encoderObj.config);
    });

    this.triggerWorker = new Worker("/polyfills/triggerWorker.js");
    this.triggerWorker.postMessage({ frameRate: this.currentConfig.framerate });

    const track = this.stream.getVideoTracks()[0];
    console.log("Using video track:", track);
    this.videoProcessor = new MediaStreamTrackProcessor(
      track,
      this.triggerWorker,
      true
    );

    this.videoReader = this.videoProcessor.readable.getReader();
    console.log("Video processor reader created:", this.videoReader);

    let frameCounter = 0;

    const cameraEncoders = Array.from(this.videoEncoders.entries()).filter(
      ([_, obj]) => obj.channelName.startsWith("cam")
    );

    if (this.isPublishing) {
      this.startVideoFrameProcessing(frameCounter, cameraEncoders);
    }

    // Process video frames
    // (async () => {
    //   try {
    //     while (this.isPublishing) {
    //       const result = await this.videoReader.read();

    //       if (result.done) break;

    //       const frame = result.value;

    //       if (!window.videoBaseTimestamp) {
    //         window.videoBaseTimestamp = frame.timestamp;
    //       }

    //       if (!this.cameraEnabled) {
    //         console.log("Camera disabled, skipping frame");
    //         frame.close();
    //         continue;
    //       }

    //       frameCounter++;
    //       const keyFrame = frameCounter % 30 === 0;

    //       for (let i = 0; i < cameraEncoders.length; i++) {
    //         const [quality, encoderObj] = cameraEncoders[i];
    //         const isLastEncoder = i === cameraEncoders.length - 1;

    //         if (encoderObj.encoder.encodeQueueSize <= 2) {
    //           const frameToEncode = isLastEncoder
    //             ? frame
    //             : new VideoFrame(frame);
    //           encoderObj.encoder.encode(frameToEncode, { keyFrame });
    //           frameToEncode.close();
    //         }
    //       }
    //     }
    //   } catch (error) {
    //     this.onStatusUpdate(`Video processing error: ${error.message}`, true);
    //     console.error("Video capture error:", error);
    //   }
    // })();
  }

  async startOpusAudioStreaming() {
    if (!this.stream) {
      console.warn("No media stream available for audio");
      return null;
    }

    const audioTrack = this.stream.getAudioTracks()[0];
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

    this.currentCamAudioStream = new MediaStream([audioTrack]);
    const audioRecorder = await this.initAudioRecorder(
      this.currentCamAudioStream,
      audioRecorderOptions
    );
    audioRecorder.ondataavailable = (typedArray) =>
      this.handleOpusAudioChunk(typedArray, CHANNEL_NAME.MICROPHONE);

    await audioRecorder.start({
      timeSlice: audioRecorderOptions.timeSlice,
    });
    console.log("this publish streams", this.publishStreams);
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
      console.warn(
        "Video config ready for",
        channelName,
        encoderObj.videoDecoderConfig
      );
      this.sendStreamConfig(
        channelName,
        encoderObj.videoDecoderConfig,
        "video"
      );
    }

    if (!streamData.configSent) return;

    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);
    const frameType = getFrameType(channelName, chunk.type);
    const packet = this.createPacketWithHeader(
      chunkData,
      chunk.timestamp,
      frameType
    );

    if (this.useWebRTC) {
      this.sendOverDataChannel(channelName, packet, frameType);
      this.sequenceNumber++;
      return;
    } else {
      this.sendOverStream(channelName, packet);
    }
  }

  handleOpusAudioChunk(typedArray, channelName) {
    if (!this.micEnabled) return;
    if (!this.isChannelOpen || !typedArray || typedArray.byteLength === 0)
      return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    try {
      const dataArray = new Uint8Array(typedArray);

      // Check for Opus header "OggS"
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
            FRAME_TYPE.AUDIO
          );

          const audioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 1,
            description: description,
          };

          console.log(
            `[Audio Config] Preparing to send config for ${channelName}`,
            audioConfig
          );
          streamData.config = audioConfig;
          console.warn("Send mic_48k config", audioConfig);
          this.sendStreamConfig(channelName, audioConfig, "audio");
        }

        // Initialize timing
        if (this.opusBaseTime === 0 && window.videoBaseTimestamp) {
          this.opusBaseTime = window.videoBaseTimestamp;
          window.audioStartPerfTime = performance.now();
          this.opusSamplesSent = 0;
          this.opusChunkCount = 0;
        } else if (this.opusBaseTime === 0 && !window.videoBaseTimestamp) {
          this.opusBaseTime = performance.now() * 1000;
          this.opusSamplesSent = 0;
          this.opusChunkCount = 0;
        }

        const timestamp =
          this.opusBaseTime +
          Math.floor((this.opusSamplesSent * 1000000) / this.kSampleRate);
        if (streamData.configSent) {
          const packet = this.createPacketWithHeader(
            dataArray,
            timestamp,
            FRAME_TYPE.AUDIO
          );
          if (this.useWebRTC) {
            // audio chunk dont need fec and sequence number
            this.sendOverDataChannel(channelName, packet, FRAME_TYPE.AUDIO);
          } else {
            this.sendOverStream(channelName, packet);
          }
        }
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
        const aConfigBase64 = this.uint8ArrayToBase64(
          new Uint8Array(config.description)
        );

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
      console.log(
        `[Stream Config] Sending ${mediaType} config for ${channelName}`,
        configPacket
      );
      const packet = new TextEncoder().encode(JSON.stringify(configPacket));
      if (this.useWebRTC) {
        this.sendOverDataChannel(channelName, packet, FRAME_TYPE.CONFIG);
      } else {
        await this.sendOverStream(channelName, packet);
      }

      streamData.configSent = true;
      streamData.config = config;

      console.log(
        `[Stream Config] ✅ Config sent successfully for ${channelName}`
      );
      this.onStatusUpdate(`Config sent for stream: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send config for ${channelName}:`, error);
    }
  }

  createPacketWithHeader(data, timestamp, type) {
    let adjustedTimestamp = timestamp;
    if (window.videoBaseTimestamp) {
      adjustedTimestamp = timestamp - window.videoBaseTimestamp;
    }

    let safeTimestamp = Math.floor(adjustedTimestamp / 1000);
    if (safeTimestamp < 0) safeTimestamp = 0;

    const HEADER_SIZE = 5;
    const MAX_TS = 0xffffffff;
    const MIN_TS = 0;

    if (safeTimestamp > MAX_TS) safeTimestamp = MAX_TS;
    if (safeTimestamp < MIN_TS) safeTimestamp = MIN_TS;

    const packet = new Uint8Array(
      HEADER_SIZE +
      (data instanceof ArrayBuffer ? data.byteLength : data.length)
    );
    // type mapping
    // video-360p-key = 0
    // video-360p-delta = 1
    // video-720p-key = 2
    // video-720p-delta = 3
    // video-1080p-key = 4
    // video-1080p-delta = 5
    // audio = 6
    // config = 7
    // ping = 8

    packet[4] = type;

    const view = new DataView(packet.buffer, 0, 4);
    view.setUint32(0, safeTimestamp, false);

    packet.set(
      data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      HEADER_SIZE
    );

    return packet;
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

  /**
   * Start screen sharing
   */
  async startShareScreen(stream) {
    if (!stream) {
      throw new Error("No stream provided for screen sharing");
    }

    this.screenStream = stream;
    this.isScreenSharing = true;

    const channelName = "screen_share_1080p";

    try {
      // Create WebTransport stream for screen share
      await this.createBidirectionalStream(channelName);

      // Send start_share_screen event
      const startEvent = {
        type: "start_share_screen",
        sender_stream_id: this.streamId,
      };
      await this.sendEvent(startEvent);

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) {
        throw new Error("No video track found in screen share stream");
      }

      // Setup screen share video encoder
      const screenConfig = this.subStreams.find(
        (s) => s.channelName === channelName
      );

      const screenEncoder = new VideoEncoder({
        output: (chunk, metadata) =>
          this.handleScreenVideoChunk(chunk, metadata, channelName),
        error: (e) =>
          this.onStatusUpdate(`Screen encoder error: ${e.message}`, true),
      });

      const encoderConfig = {
        codec: this.currentConfig.codec,
        width: screenConfig.width,
        height: screenConfig.height,
        bitrate: screenConfig.bitrate,
        framerate: screenConfig.framerate,
        latencyMode: "realtime",
        hardwareAcceleration: "prefer-hardware",
      };

      screenEncoder.configure(encoderConfig);

      this.screenVideoEncoder = {
        encoder: screenEncoder,
        config: encoderConfig,
        metadataReady: false,
        videoDecoderConfig: null,
      };

      // Track whether screen share has audio
      this.hasScreenAudio = !!audioTrack;
      console.log("[Publisher] Screen share audio track:", this.hasScreenAudio);

      // Setup screen share audio if available
      if (audioTrack) {
        const audioRecorderOptions = {
          encoderApplication: 2051,
          encoderComplexity: 0,
          encoderFrameSize: 20,
          timeSlice: 100,
        };

        this.currentScreenAudioStream = new MediaStream([audioTrack]);
        console.log("[Publisher] Screen share audio recorder options:", audioRecorderOptions);
        this.screenAudioRecorder = await this.initAudioRecorder(
          this.currentScreenAudioStream,
          audioRecorderOptions
        );

        this.screenAudioRecorder.ondataavailable = (typedArray) => {
          this.handleScreenAudioChunk(typedArray, channelName);
        };

        await this.screenAudioRecorder.start({
          timeSlice: audioRecorderOptions.timeSlice,
        });

        this.screenAudioBaseTime = 0;
        this.screenAudioSamplesSent = 0;
      }

      // Start video processing
      const screenTriggerWorker = new Worker("/polyfills/triggerWorker.js");
      screenTriggerWorker.postMessage({ frameRate: screenConfig.framerate });

      this.screenVideoProcessor = new MediaStreamTrackProcessor(
        videoTrack,
        screenTriggerWorker,
        true
      );

      this.screenVideoReader = this.screenVideoProcessor.readable.getReader();
      let frameCounter = 0;

      // Handle video track ending (when user clicks Chrome's "Stop sharing" button)
      videoTrack.onended = async () => {
        console.log("[Publisher] Screen share video track ended (user stopped sharing)");
        await this.stopShareScreen();
        // Emit event to notify UI
        this.emit("screenShareStopped", {
          reason: "user_stopped",
          timestamp: Date.now()
        });
      };

      // Process screen share video frames
      (async () => {
        try {
          while (this.isScreenSharing) {
            const result = await this.screenVideoReader.read();
            if (result.done) break;

            const frame = result.value;

            if (!window.screenBaseTimestamp) {
              window.screenBaseTimestamp = frame.timestamp;
            }

            frameCounter++;
            const keyFrame = frameCounter % 30 === 0;

            if (this.screenVideoEncoder.encoder.encodeQueueSize <= 2) {
              this.screenVideoEncoder.encoder.encode(frame, { keyFrame });
            }

            frame.close();
          }
        } catch (error) {
          this.onStatusUpdate(
            `Screen share video error: ${error.message}`,
            true
          );
          console.error("Screen share video error:", error);
        }
      })();

      this.onStatusUpdate("Screen sharing started");
      console.log("[Publisher] Screen sharing started, waiting for server confirmation to pin");
    } catch (error) {
      console.error("[Publisher] Error starting screen share:", error);

      this.onStatusUpdate(
        `Failed to start screen share: ${error.message}`,
        true
      );
      this.stopShareScreen();
      throw error;
    }
  }

  /**
   * Stop screen sharing
   */
  async stopShareScreen() {
    if (!this.isScreenSharing) {
      return;
    }

    try {
      this.isScreenSharing = false;

      const channelName = "screen_share_1080p";

      // Send stop event to server
      const stopEvent = {
        type: "stop_share_screen",
        sender_stream_id: this.streamId,
      };
      await this.sendEvent(stopEvent);

      // Cancel screen video reader first
      if (this.screenVideoReader) {
        try {
          await this.screenVideoReader.cancel();
          this.screenVideoReader = null;
        } catch (error) {
          console.warn("Error canceling screen video reader:", error);
        }
      }

      // Stop screen video processor
      if (this.screenVideoProcessor) {
        this.screenVideoProcessor = null;
      }

      // Stop and close video encoder
      if (this.screenVideoEncoder && this.screenVideoEncoder.encoder) {
        if (this.screenVideoEncoder.encoder.state !== "closed") {
          await this.screenVideoEncoder.encoder.flush();
          this.screenVideoEncoder.encoder.close();
        }
        this.screenVideoEncoder = null;
      }

      // Stop audio recorder
      if (
        this.screenAudioRecorder &&
        typeof this.screenAudioRecorder.stop === "function"
      ) {
        await this.screenAudioRecorder.stop();
        this.screenAudioRecorder = null;
      }

      // Close screen share stream
      const streamData = this.publishStreams.get(channelName);
      if (streamData && streamData.writer) {
        await streamData.writer.close();
        this.publishStreams.delete(channelName);
      }

      // Stop all tracks in screen stream
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }

      // Reset state
      this.hasScreenAudio = false;
      this.screenAudioBaseTime = 0;
      this.screenAudioSamplesSent = 0;
      this.screenAudioConfig = null;
      window.screenBaseTimestamp = null;

      this.onStatusUpdate("Screen sharing stopped");
      console.log("[Publisher] Screen sharing stopped, waiting for server confirmation to unpin");
    } catch (error) {
      this.onStatusUpdate(
        `Error stopping screen share: ${error.message}`,
        true
      );
      throw error;
    }
  }

  /**
   * Handle screen share video chunks
   */
  handleScreenVideoChunk(chunk, metadata, channelName) {
    if (!this.screenVideoEncoder) return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    // Handle metadata
    if (
      metadata &&
      metadata.decoderConfig &&
      !this.screenVideoEncoder.metadataReady
    ) {
      this.screenVideoEncoder.videoDecoderConfig = {
        codec: metadata.decoderConfig.codec,
        codedWidth: metadata.decoderConfig.codedWidth,
        codedHeight: metadata.decoderConfig.codedHeight,
        frameRate: this.screenVideoEncoder.config.framerate,
        description: metadata.decoderConfig.description,
      };
      this.screenVideoEncoder.metadataReady = true;

      console.log(
        "Screen video config ready:",
        this.screenVideoEncoder.videoDecoderConfig
      );

      // Only send configs if:
      // 1. No screen audio, OR
      // 2. Audio config is ready
      if (!this.hasScreenAudio || this.screenAudioConfig) {
        this.sendScreenDecoderConfigs(channelName);
      } else {
        console.log("Video config ready, waiting for audio config...");
      }
    }

    if (!streamData.configSent) return;

    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);
    const frameType = chunk.type === "key" ? 4 : 5; // screen_share_1080p key/delta

    const packet = this.createPacketWithHeader(
      chunkData,
      chunk.timestamp,
      frameType
    );

    if (this.useWebRTC) {
      this.sequenceNumber++;
      this.sendOverDataChannel(channelName, packet, frameType);
    } else {
      this.sendOverStream(channelName, packet);
    }
  }

  /**
   * Handle screen share audio chunks
   */
  handleScreenAudioChunk(typedArray, channelName) {
    if (!this.isScreenSharing || !typedArray || typedArray.byteLength === 0)
      return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    try {
      const dataArray = new Uint8Array(typedArray);

      // Check for Opus header
      if (
        dataArray.length >= 4 &&
        dataArray[0] === 79 &&
        dataArray[1] === 103 &&
        dataArray[2] === 103 &&
        dataArray[3] === 83
      ) {
        if (!this.screenAudioConfig) {
          const description = this.createPacketWithHeader(
            dataArray,
            performance.now() * 1000,
            FRAME_TYPE.AUDIO
          );

          this.screenAudioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 2,
            description: description,
          };

          console.log("Screen audio config ready:", this.screenAudioConfig);
          this.sendScreenDecoderConfigs(channelName);
        }

        // Initialize timing
        if (this.screenAudioBaseTime === 0 && window.screenBaseTimestamp) {
          this.screenAudioBaseTime = window.screenBaseTimestamp;
          this.screenAudioSamplesSent = 0;
        } else if (
          this.screenAudioBaseTime === 0 &&
          !window.screenBaseTimestamp
        ) {
          this.screenAudioBaseTime = performance.now() * 1000;
          this.screenAudioSamplesSent = 0;
        }

        const timestamp =
          this.screenAudioBaseTime +
          Math.floor((this.screenAudioSamplesSent * 1000000) / 48000);

        if (streamData.configSent) {
          const packet = this.createPacketWithHeader(
            dataArray,
            timestamp,
            FRAME_TYPE.AUDIO
          );
          if (this.useWebRTC) {
            // audio chunk dont need fec and sequence number
            this.sendOverDataChannel(channelName, packet, FRAME_TYPE.AUDIO);
          } else {
            this.sendOverStream(channelName, packet);
          }
        }

        this.screenAudioSamplesSent += 960;
      }
    } catch (error) {
      console.error("Failed to send screen audio data:", error);
    }
  }

  /**
   * Send screen share decoder configs
   */
  async sendScreenDecoderConfigs(channelName) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData || streamData.configSent) return;

    const videoReady =
      this.screenVideoEncoder && this.screenVideoEncoder.metadataReady;
    // Video config is required, audio config is optional
    if (!videoReady) {
      console.log("SendScreenDecoderConfig: Video config not ready yet");
      return;
    }

    // If we have screen audio but no audio config yet, wait for it
    if (this.hasScreenAudio && !this.screenAudioConfig) {
      console.log("SendScreenDecoderConfig: Waiting for audio config...");
      return;
    }

    try {
      const vConfigUint8 = new Uint8Array(
        this.screenVideoEncoder.videoDecoderConfig.description
      );
      const vConfigBase64 = this.uint8ArrayToBase64(vConfigUint8);

      const config = {
        type: "DecoderConfigs",
        channelName: channelName,
        videoConfig: {
          codec: this.screenVideoEncoder.videoDecoderConfig.codec,
          codedWidth: this.screenVideoEncoder.videoDecoderConfig.codedWidth,
          codedHeight: this.screenVideoEncoder.videoDecoderConfig.codedHeight,
          frameRate: this.screenVideoEncoder.videoDecoderConfig.frameRate,
          description: vConfigBase64,
        },
      };

      if (this.screenAudioConfig) {
        const aConfigBase64 = this.uint8ArrayToBase64(
          new Uint8Array(this.screenAudioConfig.description)
        );

        config.audioConfig = {
          codec: this.screenAudioConfig.codec,
          sampleRate: this.screenAudioConfig.sampleRate,
          numberOfChannels: this.screenAudioConfig.numberOfChannels,
          description: aConfigBase64,
        };
      }

      console.log("Sending screen share decoder configs:", config);
      const packet = new TextEncoder().encode(JSON.stringify(config));
      if (this.useWebRTC) {
        await this.sendOverDataChannel(channelName, packet, FRAME_TYPE.CONFIG);
      } else {
        await this.sendOverStream(channelName, packet);
      }

      streamData.configSent = true;
      this.onStatusUpdate(`Screen share configs sent for: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send screen share configs:`, error);
    }
  }

  async stop() {
    if (!this.isPublishing) {
      return;
    }

    try {
      this.isPublishing = false;

      // Stop screen sharing if active
      if (this.isScreenSharing) {
        await this.stopShareScreen();
      }

      // Close video encoders
      for (const [quality, encoderObj] of this.videoEncoders) {
        if (encoderObj.encoder && encoderObj.encoder.state !== "closed") {
          await encoderObj.encoder.flush();
          encoderObj.encoder.close();
        }
      }
      this.videoEncoders.clear();

      // Stop audio processor
      if (
        this.audioProcessor &&
        typeof this.audioProcessor.stop === "function"
      ) {
        await this.audioProcessor.stop();
        this.audioProcessor = null;
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

      // Stop all tracks
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      // Reset state
      this.isChannelOpen = false;
      this.sequenceNumber = 0;
      this.opusBaseTime = 0;
      this.opusSamplesSent = 0;
      this.opusChunkCount = 0;

      // Clear global variables
      window.videoBaseTimestamp = null;
      window.audioStartPerfTime = null;

      this.onStreamStop();
      this.onStatusUpdate("Publishing stopped");
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
      streamType: this.streamType,
      config: this.currentConfig,
      sequenceNumber: this.sequenceNumber,
      activeStreams: Array.from(this.publishStreams.keys()),
    };
  }
}

/**
 * Frame type constants for different media streams and control messages
 */
const FRAME_TYPE = {
  // Video frame types
  CAM_360P_KEY: 0,
  CAM_360P_DELTA: 1,
  CAM_720P_KEY: 2,
  CAM_720P_DELTA: 3,
  SCREEN_SHARE_KEY: 4,
  SCREEN_SHARE_DELTA: 5,
  // Audio frame type
  AUDIO: 6,
  // Control message types
  CONFIG: 0xfd,
  EVENT: 0xfe,
  PING: 0xff,
};

/**
 * Transport packet type constants for network protocol
 */
const TRANSPORT_PACKET_TYPE = {
  VIDEO: 0x00,
  AUDIO: 0x01,
  CONFIG: 0xfd,
  EVENT: 0xfe,
  PING: 0xff,
};

/**
 * Helper function to get frame type based on channel name and chunk type
 * @param {string} channelName - Channel name (cam_360p, cam_720p, screen_share_1080p)
 * @param {string} chunkType - Chunk type ("key" or "delta")
 * @returns {number} Frame type constant
 */
function getFrameType(channelName, chunkType) {
  switch (channelName) {
    case CHANNEL_NAME.CAMERA_360P:
      return chunkType === "key"
        ? FRAME_TYPE.CAM_360P_KEY
        : FRAME_TYPE.CAM_360P_DELTA;
    case CHANNEL_NAME.CAMERA_720P:
      return chunkType === "key"
        ? FRAME_TYPE.CAM_720P_KEY
        : FRAME_TYPE.CAM_720P_DELTA;
    case CHANNEL_NAME.SCREEN_SHARE_1080P:
      return chunkType === "key"
        ? FRAME_TYPE.SCREEN_SHARE_KEY
        : FRAME_TYPE.SCREEN_SHARE_DELTA;
    default:
      return FRAME_TYPE.CAM_720P_KEY;
    // fallback
  }
}

/**
 * Helper function to get transport packet type from frame type
 * @param {number} frameType - Frame type constant
 * @returns {number} Transport packet type constant
 */
function getTransportPacketType(frameType) {
  switch (frameType) {
    case FRAME_TYPE.PING:
      return TRANSPORT_PACKET_TYPE.PING;
    case FRAME_TYPE.EVENT:
      return TRANSPORT_PACKET_TYPE.EVENT;
    case FRAME_TYPE.CONFIG:
      return TRANSPORT_PACKET_TYPE.CONFIG;
    case FRAME_TYPE.AUDIO:
      return TRANSPORT_PACKET_TYPE.AUDIO;
    default:
      return TRANSPORT_PACKET_TYPE.VIDEO;
    // All video frame types
  }
}

/**
 * Channel name constants for different media streams
 */
const CHANNEL_NAME = {
  // Control channels
  MEETING_CONTROL: "meeting_control",
  // Audio channels
  MICROPHONE: "mic_48k",
  // Video channels - Camera
  CAMERA_360P: "cam_360p",
  CAMERA_720P: "cam_720p",
  // Video channels - Screen share
  SCREEN_SHARE_1080P: "screen_share_1080p",
};

/**
 * Helper function to get data channel ID from channel name
 * @param {string} channelName - Channel name
 * @returns {number} Data channel ID for WebRTC
 */
function getDataChannelId(channelName) {
  switch (channelName) {
    case CHANNEL_NAME.MEETING_CONTROL:
      return 0;
    case CHANNEL_NAME.MICROPHONE:
      return 1;
    case CHANNEL_NAME.CAMERA_360P:
      return 2;
    case CHANNEL_NAME.CAMERA_720P:
      return 3;
    case CHANNEL_NAME.SCREEN_SHARE_1080P:
      return 4;
    default:
      return 5;
    // fallback
  }
}
