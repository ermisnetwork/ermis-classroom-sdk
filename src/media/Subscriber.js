import EventEmitter from "../events/EventEmitter.js";

/**
 * Enhanced Subscriber class for receiving media streams
 * Refactored from EnhancedSubscriber with better structure
 */
class Subscriber extends EventEmitter {
  constructor(config) {
    super();

    // Configuration
    this.streamId = config.streamId || "";
    this.roomId = config.roomId || "";
    this.host = config.host || "stream-gate.bandia.vn";
    this.isOwnStream = config.isOwnStream || false;

    // Media configuration
    this.mediaWorkerUrl = config.mediaWorkerUrl || "/workers/media-worker-ab.js";
    this.audioWorkletUrl =
      config.audioWorkletUrl || "/workers/audio-worklet1.js";
    this.mstgPolyfillUrl =
      config.mstgPolyfillUrl || "/polyfills/MSTG_polyfill.js";

    // State
    this.isStarted = false;
    this.isAudioEnabled = true;
    this.connectionStatus = "disconnected"; // 'disconnected', 'connecting', 'connected', 'failed'

    // Media components
    this.worker = null;
    this.audioWorkletNode = null;
    this.videoGenerator = null;
    this.videoWriter = null;
    this.mediaStream = null;

    // Unique subscriber ID
    this.subscriberId = `subscriber_${this.streamId}_${Date.now()}`;

    // Audio mixer reference (will be set externally)
    this.audioMixer = null;
  }

  /**
   * Start the subscriber
   */
  async start() {
    if (this.isStarted) {
      throw new Error("Subscriber already started");
    }

    try {
      console.log("Starting subscriber:", this.subscriberId);
      this.emit("starting", { subscriber: this });
      this._updateConnectionStatus("connecting");

      const channel = new MessageChannel();

      await this._loadPolyfill();
      await this._initWorker(channel.port2);
      await this._initAudioSystem(channel.port1);
      this._initVideoSystem();

      this.isStarted = true;
      this._updateConnectionStatus("connected");
      this.emit("started", { subscriber: this });
    } catch (error) {
      this._updateConnectionStatus("failed");
      this.emit("error", { subscriber: this, error, action: "start" });
      throw error;
    }
  }

  /**
   * Stop the subscriber
   */
  stop() {
    if (!this.isStarted) {
      return;
    }

    try {
      this.emit("stopping", { subscriber: this });

      // Remove from audio mixer
      if (this.audioMixer) {
        this.audioMixer.removeSubscriber(this.subscriberId);
      }

      // Terminate worker
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      // Emit stream removal event for app integration
      if (this.mediaStream) {
        this.emit("streamRemoved", {
          streamId: this.streamId,
          subscriberId: this.subscriberId,
          roomId: this.roomId
        });
      }

      // Close video components
      this._cleanupVideoSystem();

      // Clear references
      this.audioWorkletNode = null;
      this.mediaStream = null;

      this.isStarted = false;
      this._updateConnectionStatus("disconnected");
      this.emit("stopped", { subscriber: this });
    } catch (error) {
      this.emit("error", { subscriber: this, error, action: "stop" });
    }
  }

  /**
   * Toggle audio on/off
   */
  async toggleAudio() {
    if (!this.isStarted || !this.worker) {
      throw new Error("Subscriber not started");
    }

    try {
      this.worker.postMessage({ type: "toggleAudio" });
      this.isAudioEnabled = !this.isAudioEnabled;

      this.emit("audioToggled", {
        subscriber: this,
        enabled: this.isAudioEnabled,
      });

      return this.isAudioEnabled;
    } catch (error) {
      this.emit("error", { subscriber: this, error, action: "toggleAudio" });
      throw error;
    }
  }

  /**
   * Set audio mixer reference
   */
  setAudioMixer(audioMixer) {
    this.audioMixer = audioMixer;
  }

  /**
   * Get subscriber info
   */
  getInfo() {
    return {
      subscriberId: this.subscriberId,
      streamId: this.streamId,
      roomId: this.roomId,
      host: this.host,
      isOwnStream: this.isOwnStream,
      isStarted: this.isStarted,
      isAudioEnabled: this.isAudioEnabled,
      connectionStatus: this.connectionStatus,
    };
  }

  /**
   * Load MediaStreamTrackGenerator polyfill if needed
   */
  async _loadPolyfill() {
    // Skip if browser already supports it
    if (window.MediaStreamTrackGenerator) {
      console.log("✅ Browser already supports MediaStreamTrackGenerator");
      return;
    }

    // Determine the polyfill URL (absolute)
    const url = this.mstgPolyfillUrl || `${location.origin}/polyfills/MSTG_polyfill.js`;
    console.log("⚙️ Loading MSTG polyfill from:", url);

    // Prevent loading twice
    if (document.querySelector(`script[src="${url}"]`)) {
      console.log("ℹ️ MSTG polyfill already loaded");
      return;
    }

    // Dynamically load the script
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;

      script.onload = () => {
        console.log("✅ MSTG polyfill loaded successfully");
        resolve();
      };

      script.onerror = (err) => {
        console.error("❌ Failed to load MSTG polyfill:", err);
        reject(err);
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Initialize media worker
   */
  async _initWorker(channelPort) {
    try {
      this.worker = new Worker(`${this.mediaWorkerUrl}?t=${Date.now()}`, {
        type: "module",
      });

      this.worker.onmessage = (e) => this._handleWorkerMessage(e);
      this.worker.onerror = (error) => {
        this.emit("error", {
          subscriber: this,
          error: new Error(`Media Worker error: ${error.message}`),
          action: "workerError",
        });
      };

      const mediaUrl = `wss://sfu-adaptive-bitrate-webrtc.ermis-network.workers.dev/meeting/${this.roomId}/${this.streamId}`;
      console.log("try to init worker with url:", mediaUrl);

      this.worker.postMessage(
        {
          type: "init",
          data: { mediaUrl },
          port: channelPort,
          quality: "360p", // default quality
        },
        [channelPort]
      );
    } catch (error) {
      throw new Error(`Worker initialization failed: ${error.message}`);
    }
  }

  switchBitrate(quality) {
    // 360p | 720p
    if (this.worker) {
      this.worker.postMessage({
        type: "switchBitrate",
        quality,
      });
    }
  }

  /**
   * Initialize audio system with mixer
   */
  async _initAudioSystem(channelPort) {
    try {
      // Skip audio setup for own stream to prevent echo
      if (this.isOwnStream) {
        this.emit("audioSkipped", {
          subscriber: this,
          reason: "Own stream - preventing echo",
        });
        return;
      }

      // Audio mixer should be set externally before starting
      if (this.audioMixer) {
        console.warn(
          "Adding subscriber to audio mixer in new subscriber:",
          this.subscriberId
        );
        this.audioWorkletNode = await this.audioMixer.addSubscriber(
          this.subscriberId,
          this.audioWorkletUrl,
          this.isOwnStream,
          channelPort
        );

        if (this.audioWorkletNode) {
          this.audioWorkletNode.port.onmessage = (event) => {
            const { type, bufferMs, isPlaying, newBufferSize } = event.data;
            this.emit("audioStatus", {
              subscriber: this,
              type,
              bufferMs,
              isPlaying,
              newBufferSize,
            });
          };
        }
      }

      this.emit("audioInitialized", { subscriber: this });
    } catch (error) {
      throw new Error(`Audio system initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize video system
   */
  _initVideoSystem() {
    try {
      if (typeof MediaStreamTrackGenerator === "function") {
        this.videoGenerator = new MediaStreamTrackGenerator({
          kind: "video",
        });
      } else {
        throw new Error(
          "MediaStreamTrackGenerator not supported in this browser"
        );
      }

      this.videoWriter = this.videoGenerator.writable;

      // Create MediaStream with video track only
      this.mediaStream = new MediaStream([this.videoGenerator]);

      // Emit remote stream ready event for app integration
      this.emit("remoteStreamReady", {
        stream: this.mediaStream,
        streamId: this.streamId,
        subscriberId: this.subscriberId,
        roomId: this.roomId,
        isOwnStream: this.isOwnStream
      });
      this.emit("videoInitialized", { subscriber: this });
    } catch (error) {
      throw new Error(`Video system initialization failed: ${error.message}`);
    }
  }

  /**
   * Cleanup video system
   */
  _cleanupVideoSystem() {
    try {
      // Close video writer
      if (this.videoWriter) {
        try {
          const writer = this.videoWriter.getWriter();
          writer.releaseLock();
        } catch (e) {
          // Writer might already be released
        }
        this.videoWriter = null;
      }

      // Stop video generator
      if (this.videoGenerator) {
        try {
          if (this.videoGenerator.stop) {
            this.videoGenerator.stop();
          }
        } catch (e) {
          // Generator might already be stopped
        }
        this.videoGenerator = null;
      }
    } catch (error) {
      console.warn("Error cleaning video system:", error);
    }
  }

  /**
   * Handle messages from media worker
   */
  _handleWorkerMessage(e) {
    const {
      type,
      frame,
      message,
      channelData,
      sampleRate,
      numberOfChannels,
      timeStamp,
      subscriberId,
      audioEnabled,
    } = e.data;

    switch (type) {
      case "videoData":
        this._handleVideoData(frame);
        break;

      case "status":
        this.emit("status", { subscriber: this, message, isError: false });
        break;

      case "error":
        this.emit("status", { subscriber: this, message, isError: true });
        this.emit("error", {
          subscriber: this,
          error: new Error(message),
          action: "workerMessage",
        });
        break;

      case "audio-toggled":
        this.emit("audioToggled", {
          subscriber: this,
          enabled: audioEnabled,
        });
        break;

      case "skipping":
        this.emit("frameSkipped", { subscriber: this });
        break;

      case "resuming":
        this.emit("frameResumed", { subscriber: this });
        break;

      default:
        console.log(`Unknown worker message type: ${type}`, e.data);
    }
  }

  /**
   * Handle video data from worker
   */
  async _handleVideoData(frame) {
    if (this.videoWriter && frame) {
      try {
        const writer = this.videoWriter.getWriter();
        await writer.write(frame);
        writer.releaseLock();

        this.emit("videoFrameProcessed", { subscriber: this });
      } catch (error) {
        this.emit("error", {
          subscriber: this,
          error: new Error(`Video write error: ${error.message}`),
          action: "videoWrite",
        });
      }
    }
  }

  /**
   * Update connection status
   */
  _updateConnectionStatus(status) {
    if (this.connectionStatus === status) return;

    const previousStatus = this.connectionStatus;
    this.connectionStatus = status;

    this.emit("connectionStatusChanged", {
      subscriber: this,
      status,
      previousStatus,
    });
  }
}

export default Subscriber;
