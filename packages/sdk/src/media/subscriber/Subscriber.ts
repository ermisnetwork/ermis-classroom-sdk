/**
 * Subscriber - Main class for receiving media streams
 *
 * Refactored to use modular architecture with managers and processors.
 * This class now acts as an orchestrator for all media receiving functionality.
 */

import { EventEmitter } from "../../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../../events/GlobalEventBus";
import type {
  SubscriberConfig,
  SubscriberInfo,
  SubscriberProtocol,
  SubscribeType,
  StreamMode,
} from "../../types/media/subscriber.types";
import { WebTransportManager } from "./transports/WebTransportManager";
import { WorkerManager } from "./managers/WorkerManager";
import { PolyfillManager } from "./managers/PolyfillManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";
import { ConnectionStatus } from "../../types/core/ermisClient.types";
import { log, BrowserDetection } from "../../utils";

// Event type definitions
interface SubscriberEvents extends Record<string, unknown> {
  starting: { subscriber: Subscriber };
  started: { subscriber: Subscriber };
  stopping: { subscriber: Subscriber };
  stopped: { subscriber: Subscriber };
  streamRemoved: {
    streamId: string;
    subscriberId: string;
    roomId: string;
  };
  audioToggled: { subscriber: Subscriber; enabled: boolean };
  audioSkipped: { subscriber: Subscriber; reason: string };
  audioInitialized: { subscriber: Subscriber };
  audioStatus: {
    subscriber: Subscriber;
    type: string;
    bufferMs?: number;
    isPlaying?: boolean;
    newBufferSize?: number;
  };
  videoInitialized: { subscriber: Subscriber };
  remoteStreamReady: {
    stream: MediaStream;
    streamId: string;
    subscriberId: string;
    roomId: string;
    isOwnStream: boolean;
  };
  frameSkipped: { subscriber: Subscriber };
  frameResumed: { subscriber: Subscriber };
  videoFrameProcessed: { subscriber: Subscriber };
  connectionStatusChanged: {
    subscriber: Subscriber;
    status: ConnectionStatus;
    previousStatus: ConnectionStatus;
  };
  status: {
    subscriber: Subscriber;
    message: string;
    isError: boolean;
  };
  error: {
    subscriber: Subscriber;
    error: Error;
    action:
    | "start"
    | "stop"
    | "toggleAudio"
    | "switchBitrate"
    | "videoWrite"
    | "workerMessage";
  };
}

/**
 * Subscriber class - orchestrates media stream receiving
 */
export class Subscriber extends EventEmitter<SubscriberEvents> {
  // Configuration - make required fields explicit
  private config: {
    localStreamId: string;
    streamId: string;
    roomId: string;
    host: string;
    isOwnStream: boolean;
    protocol: SubscriberProtocol;
    subscribeType: SubscribeType;
    mediaWorkerUrl: string;
    audioWorkletUrl: string;
    mstgPolyfillUrl: string;
    subcribeUrl: string;
    isScreenSharing: boolean;
    streamOutputEnabled: boolean;
    streamMode: StreamMode;
    audioEnabled: boolean;
    onStatus?: (msg: string, isError: boolean) => void;
  };
  private subscriberId: string;
  private protocol: SubscriberProtocol;
  private subscribeType: SubscribeType;

  // Managers
  private transportManager: WebTransportManager | null = null;
  private workerManager: WorkerManager | null = null;
  private polyfillManager: PolyfillManager | null = null;

  // WebRTC specific
  private webRtc: RTCPeerConnection | null = null;

  // Processors
  private videoProcessor: VideoProcessor | null = null;
  private audioProcessor: AudioProcessor | null = null;

  // State
  private isStarted = false;
  private isAudioEnabled = true; // MATCH SubscriberDev.js
  private connectionStatus: ConnectionStatus = "disconnected";
  private mediaStream: MediaStream | null = null;

  constructor(config: SubscriberConfig) {
    super();

    // Set default configuration
    this.config = {
      localStreamId: config.localStreamId || "",
      streamId: config.streamId || "",
      roomId: config.roomId || "",
      host: config.host,
      isOwnStream: config.isOwnStream || false,
      protocol: config.protocol || this.detectProtocol(),
      subscribeType: config.subscribeType || "camera",
      mediaWorkerUrl: config.mediaWorkerUrl || "/workers/media-worker-dev.js",
      audioWorkletUrl: config.audioWorkletUrl || "/workers/audio-worklet.js",
      mstgPolyfillUrl: config.mstgPolyfillUrl || "/polyfills/MSTG_polyfill.js",
      subcribeUrl: config.subcribeUrl,
      isScreenSharing: config.isScreenSharing || false,
      streamOutputEnabled:
        config.streamOutputEnabled !== undefined
          ? config.streamOutputEnabled
          : true,
      streamMode: config.streamMode || "single",
      audioEnabled: config.audioEnabled ?? true,
      onStatus: config.onStatus,
    };

    log("Subscriber config protocol:", this.config.protocol);

    // Set protocol and subscribeType
    this.protocol = this.config.protocol;
    // this.protocol = "webtransport";
    this.subscribeType = this.config.subscribeType;

    // Generate unique ID
    this.subscriberId = `subscriber_${this.config.streamId}_${Date.now()}`;

    // Setup status callback listener if provided
    if (this.config.onStatus) {
      this.on("status", ({ message, isError }) => {
        this.config.onStatus?.(message, isError);
      });
    }

    // Initialize managers
    this.initializeManagers();
  }

  /**
   * Detect the best protocol based on browser capabilities
   * Safari uses websocket, other browsers use webtransport
   */
  private detectProtocol(): SubscriberProtocol {
    const transportInfo = BrowserDetection.determineTransport();
    const protocol = transportInfo.useWebRTC ? 'websocket' : 'webtransport';
    log(`[Subscriber] Browser detection - useWebRTC: ${transportInfo.useWebRTC}, protocol: ${protocol}`);
    return protocol;
  }

  /**
   * Initialize all managers and processors
   */
  private initializeManagers(): void {
    // Transport manager - only initialize for webtransport protocol
    // For websocket protocol, connection is handled differently
    if (this.protocol === 'webtransport') {
      this.transportManager = new WebTransportManager(this.config.subcribeUrl);
    } else {
      this.transportManager = null;
      log(`[Subscriber] Skipping WebTransportManager initialization for protocol: ${this.protocol}`);
    }

    // Worker manager
    this.workerManager = new WorkerManager(
      this.config.mediaWorkerUrl,
      this.subscriberId,
    );

    // Polyfill manager
    this.polyfillManager = new PolyfillManager(this.config.mstgPolyfillUrl);

    // Video processor
    this.videoProcessor = new VideoProcessor();

    // Audio processor
    this.audioProcessor = new AudioProcessor(
      this.subscriberId,
      this.config.isOwnStream
    );

    // Setup event listeners
    this.setupManagerListeners();
  }

  /**
   * Setup event listeners for all managers
   */
  private setupManagerListeners(): void {
    // Transport manager events
    if (this.transportManager) {
      this.transportManager.on("connected", () => {
        log("Transport connected");
      });

      this.transportManager.on("disconnected", ({ reason, error }) => {
        log("Transport disconnected:", reason, error);
        this.updateConnectionStatus("disconnected");
      });

      this.transportManager.on("error", ({ error }) => {
        this.handleError(error, "start");
      });
    }

    // Worker manager events
    if (this.workerManager) {
      this.workerManager.on("videoData", async ({ frame }) => {
        await this.handleVideoFrame(frame);
      });

      this.workerManager.on("status", ({ message, isError }) => {
        this.emit("status", { subscriber: this, message, isError });
      });

      this.workerManager.on("audioToggled", ({ enabled }) => {
        this.emit("audioToggled", { subscriber: this, enabled });
      });

      this.workerManager.on("frameSkipped", () => {
        this.emit("frameSkipped", { subscriber: this });
      });

      this.workerManager.on("frameResumed", () => {
        this.emit("frameResumed", { subscriber: this });
      });

      this.workerManager.on("error", ({ error }) => {
        this.handleError(error, "workerMessage");
      });
    }

    // Video processor events
    if (this.videoProcessor) {
      this.videoProcessor.on("initialized", ({ stream }) => {
        log("[Subscriber] VideoProcessor initialized with stream:", {
          streamId: this.config.streamId,
          tracks: stream.getTracks().length,
        });

        this.mediaStream = stream;
        this.emit("videoInitialized", { subscriber: this });
        this.emitRemoteStreamReady(stream);
      });

      this.videoProcessor.on("frameProcessed", () => {
        this.emit("videoFrameProcessed", { subscriber: this });
      });

      this.videoProcessor.on("error", ({ error }) => {
        this.handleError(error, "videoWrite");
      });
    }

    // Audio processor events
    if (this.audioProcessor) {
      this.audioProcessor.on("initialized", () => {
        this.emit("audioInitialized", { subscriber: this });
      });

      this.audioProcessor.on(
        "status",
        ({ type, bufferMs, isPlaying, newBufferSize }) => {
          this.emit("audioStatus", {
            subscriber: this,
            type,
            bufferMs,
            isPlaying,
            newBufferSize,
          });
        }
      );

      this.audioProcessor.on("skipped", ({ reason }) => {
        this.emit("audioSkipped", { subscriber: this, reason });
      });

      this.audioProcessor.on("error", ({ error }) => {
        this.handleError(error, "start");
      });
    }
  }

  /**
   * Start the subscriber
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error("Subscriber already started");
    }

    try {
      log("Starting subscriber:", this.subscriberId, "protocol:", this.protocol);
      this.emit("starting", { subscriber: this });
      this.updateConnectionStatus("connecting");

      // Create message channel for worker communication
      const channel = new MessageChannel();

      // Load polyfill if needed
      if (this.polyfillManager) {
        await this.polyfillManager.load();
      }

      // Connect to WebTransport only if protocol is webtransport
      if (this.protocol === "webtransport") {
        if (!this.transportManager) {
          throw new Error("Transport manager not initialized");
        }
        await this.transportManager.connect();
      }

      // Initialize worker with audioEnabled config
      if (!this.workerManager) {
        throw new Error("Worker manager not initialized");
      }
      await this.workerManager.init(channel.port2, this.subscribeType, this.config.audioEnabled);

      // Initialize audio system only if audio is enabled for this subscription
      // For screen share without audio, skip audio initialization to avoid "Audio mixer not set" error
      if (this.audioProcessor && this.config.audioEnabled) {
        await this.audioProcessor.init(
          this.config.audioWorkletUrl,
          channel.port1
        );
      } else if (!this.config.audioEnabled) {
        log("[Subscriber] Skipping audio initialization - audioEnabled is false");
      }

      // Initialize video system if needed (not for screen sharing streams)
      // MATCH SubscriberDev.js: _initVideoSystem() is NOT awaited
      if (this.videoProcessor) {
        log("[Subscriber] Initializing video processor for:", this.subscriberId);
        this.videoProcessor.init(); // ❗ NO await
        log("[Subscriber] Video processor init() called");
      }

      // Attach streams to worker (WebTransport, WebRTC, or WebSocket)
      await this.attachStreams();

      this.isStarted = true;
      this.updateConnectionStatus("connected");
      this.emit("started", { subscriber: this });
    } catch (error) {
      this.updateConnectionStatus("failed");
      this.handleError(
        error instanceof Error ? error : new Error("Start failed"),
        "start"
      );
      throw error;
    }
  }

  /**
   * Stop the subscriber
   * MATCH EXACT LOGIC FROM SubscriberDev.js
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }

    try {
      this.emit("stopping", { subscriber: this });

      // Emit stream removal event
      if (this.mediaStream) {
        this.emit("streamRemoved", {
          streamId: this.config.streamId,
          subscriberId: this.subscriberId,
          roomId: this.config.roomId,
        });
      }

      // Cleanup all components (includes removing from audio mixer)
      this.cleanup();

      // Clear references (MATCH JS version)
      this.mediaStream = null;

      this.isStarted = false;
      this.updateConnectionStatus("disconnected");
      this.emit("stopped", { subscriber: this });
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Stop failed"),
        "stop"
      );
    }
  }

  /**
   * Toggle audio on/off
   * MATCH EXACT LOGIC FROM SubscriberDev.js
   */
  toggleAudio(): boolean {
    if (!this.isStarted || !this.workerManager) {
      throw new Error("Subscriber not started");
    }

    try {
      this.workerManager.toggleAudio();
      this.isAudioEnabled = !this.isAudioEnabled;

      this.emit("audioToggled", {
        subscriber: this,
        enabled: this.isAudioEnabled,
      });

      return this.isAudioEnabled;
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Toggle audio failed"),
        "toggleAudio"
      );
      throw error;
    }
  }

  /**
   * Switch video quality/bitrate
   */
  switchBitrate(quality: "360p" | "720p"): void {
    if (!this.workerManager) {
      return;
    }

    try {
      this.workerManager.switchBitrate(quality);
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Switch bitrate failed"),
        "switchBitrate"
      );
    }
  }

  /**
   * Set audio mixer for audio output
   */
  setAudioMixer(audioMixer: unknown): void {
    if (this.audioProcessor) {
      // Type assertion since AudioMixer is defined in media/types
      this.audioProcessor.setAudioMixer(audioMixer as never);
    }
  }

  /**
   * Get subscriber info
   * MATCH EXACT STRUCTURE FROM SubscriberDev.js
   */
  getInfo(): SubscriberInfo {
    return {
      subscriberId: this.subscriberId,
      streamId: this.config.streamId,
      roomId: this.config.roomId || "",
      host: this.config.host || "",
      isOwnStream: this.config.isOwnStream || false,
      isStarted: this.isStarted,
      isAudioEnabled: this.isAudioEnabled,
      connectionStatus: this.connectionStatus,
    };
  }

  /**
   * Get subscriber ID
   */
  getSubscriberId(): string {
    return this.subscriberId;
  }

  /**
   * Get media stream
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Check if subscriber is started
   */
  get started(): boolean {
    return this.isStarted;
  }

  // ==================== Private Helper Methods ====================

  /**
   * Attach streams to worker (WebTransport, WebRTC, or WebSocket)
   */
  private async attachStreams(): Promise<void> {
    if (!this.workerManager) {
      throw new Error("Worker manager not initialized");
    }

    try {
      if (this.protocol === "webtransport") {
        await this.attachWebTransportStreams();
      } else if (this.protocol === "websocket") {
        await this.attachWebSocketConnection();
      }
    } catch (error) {
      throw new Error(
        `Failed to attach streams: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Attach WebTransport streams to worker
   * ⚠️ CRITICAL: SubscriberDev.js uses SINGLE stream mode only (no channelName param)
   * Worker does NOT use channelName - it only needs readable/writable streams
   */
  private async attachWebTransportStreams(): Promise<void> {
    if (!this.transportManager || !this.workerManager) {
      throw new Error("Managers not initialized");
    }

    log("Attaching WebTransport streams...");

    // Use the subcribeUrl from config (already constructed in Room.ts with correct webtpUrl)
    const webTpUrl = this.config.subcribeUrl;
    if (!webTpUrl) {
      throw new Error("Subscribe URL not provided");
    }
    log("Trying to connect to WebTransport to subscribe:", webTpUrl);

    log('this.config', this.config);

    const wt = new WebTransport(webTpUrl);
    await wt.ready;

    // SINGLE bidirectional stream (no channelName - worker doesn't use it)
    const mediaStream = await wt.createBidirectionalStream();
    this.workerManager.attachStream(
      "media",  // channelName not used by worker, just for logging
      mediaStream.readable,
      mediaStream.writable,
      this.config.localStreamId
    );
    log("✅ WebTransport stream attached");
  }

  /**
   * Attach WebSocket connection to worker
   */
  private async attachWebSocketConnection(): Promise<void> {
    if (!this.workerManager) {
      throw new Error("Worker manager not initialized");
    }

    log("Using WebSocket for media transport");

    const wsUrl = `wss://${this.config.host}/meeting/${this.config.roomId}/${this.config.streamId}`;
    this.workerManager.attachWebSocket(wsUrl, this.config.localStreamId);

    log("WebSocket attached successfully");
  }

  /**
   * Handle video frame from worker
   */
  private async handleVideoFrame(frame: VideoFrame): Promise<void> {
    if (this.videoProcessor) {
      await this.videoProcessor.writeFrame(frame);
      this.emit("videoFrameProcessed", { subscriber: this });
    }
  }

  /**
   * Emit remote stream ready event
   */
  private emitRemoteStreamReady(stream: MediaStream): void {
    log("[Subscriber] Emitting REMOTE_STREAM_READY:", {
      streamId: this.config.streamId,
      subscribeType: this.config.subscribeType,
      hasTracks: stream.getTracks().length,
    });

    const eventData = {
      stream,
      streamId: this.config.streamId,
      subscribeType: this.config.subscribeType,
    };

    globalEventBus.emit(GlobalEvents.REMOTE_STREAM_READY, eventData);
    log("[Subscriber] ✅ REMOTE_STREAM_READY emitted successfully");
  }

  /**
   * Cleanup all resources
   */
  private cleanup(): void {
    // Cleanup video processor
    if (this.videoProcessor) {
      this.videoProcessor.cleanup();
    }

    // Cleanup audio processor
    if (this.audioProcessor) {
      this.audioProcessor.cleanup();
    }

    // Cleanup worker manager
    if (this.workerManager) {
      this.workerManager.terminate();
    }

    // Cleanup transport manager
    if (this.transportManager) {
      this.transportManager.disconnect();
    }

    // Cleanup WebRTC connection
    if (this.webRtc) {
      this.webRtc.close();
      this.webRtc = null;
      log("WebRTC connection closed");
    }

    // Clear references
    this.mediaStream = null;
  }

  /**
   * Handle errors with proper event emission
   */
  private handleError(error: Error, action: string): void {
    this.emit("error", {
      subscriber: this,
      error,
      action: action as
        | "start"
        | "stop"
        | "toggleAudio"
        | "switchBitrate"
        | "videoWrite"
        | "workerMessage",
    });
  }

  /**
   * Update connection status
   */
  private updateConnectionStatus(status: ConnectionStatus): void {
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
