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
import { ChannelName, getDataChannelId } from "../../constants";

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
  // Reconnection events
  reconnecting: { subscriber: Subscriber; attempt: number; maxAttempts: number; delay: number };
  reconnected: { subscriber: Subscriber };
  reconnectionFailed: { subscriber: Subscriber; reason: string };
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
    initialQuality: "video_360p" | "video_720p" | "video_1080p" | "video_1440p";
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

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 10000; // 10 seconds
  private isReconnecting = false;

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
      initialQuality: config.initialQuality || "video_360p",
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
    // !! turn off unused WebTransportManager!!!
    // if (this.protocol === 'webtransport') {
    //   this.transportManager = new WebTransportManager(this.config.subcribeUrl);
    // } else {
    //   this.transportManager = null;
    //   log(`[Subscriber] Skipping WebTransportManager initialization for protocol: ${this.protocol}`);
    // }

    // Worker manager
    this.workerManager = new WorkerManager(
      this.config.mediaWorkerUrl,
      this.subscriberId,
      this.protocol,
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
      // if (this.protocol === "webtransport") {
      //   if (!this.transportManager) {
      //     throw new Error("Transport manager not initialized");
      //   }
      //   await this.transportManager.connect();
      // }

      // Initialize worker with audioEnabled config
      if (!this.workerManager) {
        throw new Error("Worker manager not initialized");
      }
      await this.workerManager.init(
        channel.port2,
        this.subscribeType,
        this.config.audioEnabled,
        this.config.initialQuality,
        true
      );

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

      if (this.protocol === "webrtc" && this.workerManager) {
        log("[Subscriber] Waiting for WASM ready from WorkerManager...");
        try {
          await this.workerManager.waitForWasmReady(5000);
          console.log("[Subscriber] WASM ready");
        } catch (wasmError) {
          // Don't fail the entire subscriber start — WASM may still init in background
          console.warn("[Subscriber] WASM ready timeout, continuing anyway:", wasmError);
        }
      }

      // Attach streams to worker (WebTransport, WebRTC, or WebSocket) with retry
      await this.attachStreamsWithRetry();

      // Switch to initial quality if not default (video_360p)
      // Moved to worker init: initialQuality is now passed to worker during initialization
      // so it sends the correct quality in init_channel_stream command
      /*
      if (this.config.initialQuality !== "video_360p") {
        log(`[Subscriber] Switching to initial quality: ${this.config.initialQuality}`);
        this.workerManager.switchBitrate(this.config.initialQuality);
      }
      */

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
  switchBitrate(quality: "video_360p" | "video_720p" | "video_1080p" | "video_1440p"): void {
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
   * Send start stream command to server
   */
  startStream(): void {
    if (!this.workerManager) {
      return;
    }

    try {
      this.workerManager.startStream();
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Start stream failed"),
        "start"
      );
    }
  }

  /**
   * Send stop stream command to server
   */
  stopStream(): void {
    if (!this.workerManager) {
      return;
    }

    try {
      this.workerManager.stopStream();
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Stop stream failed"),
        "stop"
      );
    }
  }

  /**
   * Send pause stream command to server
   */
  pauseStream(): void {
    if (!this.workerManager) {
      return;
    }

    try {
      this.workerManager.pauseStream();
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Pause stream failed"),
        "stop"
      );
    }
  }

  /**
   * Send resume stream command to server
   */
  resumeStream(): void {
    if (!this.workerManager) {
      return;
    }

    try {
      this.workerManager.resumeStream();
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Resume stream failed"),
        "start"
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
        if (this.subscribeType === "camera") {
          this.attachWebTransportStreams(ChannelName.VIDEO_360P);
        } else if (this.subscribeType === "screen_share") {
          this.attachWebTransportStreams(ChannelName.SCREEN_SHARE_720P);
        }
      } else if (this.protocol === "websocket") {
        await this.attachWebSocketConnection();
      } else if (this.protocol === "webrtc") {
        if (this.subscribeType === "camera") {
          this.attachDataChannel(ChannelName.VIDEO_360P);
          this.attachDataChannel(ChannelName.MICROPHONE);
        } else if (this.subscribeType === "screen_share") {
          this.attachDataChannel(ChannelName.SCREEN_SHARE_720P);
          if (this.config.audioEnabled) {
            this.attachDataChannel(ChannelName.SCREEN_SHARE_AUDIO);
          }
        }
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
  private async attachWebTransportStreams(channelName: ChannelName): Promise<void> {
    // if (!this.transportManager || !this.workerManager) {
    //   throw new Error("Managers not initialized");
    // }
    if (!this.workerManager) {
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
      channelName,  // channelName not used by worker, just for logging
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
   * Attach data channel via WebRTC to worker
   */
  async attachDataChannel(mediaChannel: ChannelName): Promise<{
    rtc: RTCPeerConnection;
    dataChannel: RTCDataChannel;
  }> {
    try {
      if (!this.workerManager || !mediaChannel) throw new Error("Worker manager not initialized or mediaChannel not provided");

      const rtc = new RTCPeerConnection();

      // const dataChannel = await this.createWrtcDataChannel(mediaChannel, rtc);
      const dataChannel = rtc.createDataChannel(mediaChannel, {
        ordered: false,
        id: 0,
        negotiated: true,
      });

      rtc.oniceconnectionstatechange = () => {
        console.log(`[ICE] State: ${rtc.iceConnectionState}`);

        if (rtc.iceConnectionState === 'failed' ||
          rtc.iceConnectionState === 'disconnected') {
          console.error('ICE connection lost!');
        }
      };

      dataChannel.onerror = (error) => {
        console.error(`[Subscriber] Data channel ${mediaChannel} error:`, error);
        console.error(`[Subscriber] Closed: ${mediaChannel}`, {
          readyState: dataChannel.readyState,
          iceConnectionState: rtc.iceConnectionState,
          connectionState: rtc.connectionState,
          bufferedAmount: dataChannel.bufferedAmount,
        });
      };

      dataChannel.onclose = () => {
        console.log(`[Subscriber] Data channel ${mediaChannel} closed`);
        console.error(`[Subscriber] Closed: ${mediaChannel}`, {
          readyState: dataChannel.readyState,
          iceConnectionState: rtc.iceConnectionState,
          connectionState: rtc.connectionState,
          bufferedAmount: dataChannel.bufferedAmount,
        });
      };

      console.log(`Data channel created for ${mediaChannel}, id:`, dataChannel.id);
      this.workerManager.attachDataChannel(mediaChannel, dataChannel);

      const offer = await rtc.createOffer();
      await rtc.setLocalDescription(offer);

    
      const channel = `${this.config.streamId}:${mediaChannel}`;
      
      console.log(`[WebRTC subscriber] Created offer for ${mediaChannel}, sending to server...`);

      const response = await fetch(`https://${this.config.host}/meeting/sdp/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer,
          room_id: this.config.roomId,
          stream_id: this.config.localStreamId,
          action: "subscriber_offer",
          channel: channel,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const answer = await response.json();
      await rtc.setRemoteDescription(answer);

      console.log(`[WebRTC] Channel ${mediaChannel} setup completed`);

      return { rtc, dataChannel };
    } catch (error: any) {
      console.error(`[WebRTC] Setup error for ${mediaChannel}:`, error);
      self.postMessage({
        type: "error",
        message: `WebRTC setup failed for ${mediaChannel}: ${error.message}`,
      });
      throw error;
    }
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

  // ========== Reconnection Methods ==========

  /**
   * Calculate exponential backoff delay for reconnection
   */
  private calculateBackoffDelay(): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    // Add jitter (±20%) to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Delay helper for async/await
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Attach streams with retry logic
   */
  private async attachStreamsWithRetry(): Promise<void> {
    let lastError: Error | null = null;
    this.reconnectAttempts = 0;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await this.attachStreams();
        this.reconnectAttempts = 0;
        if (this.isReconnecting) {
          log("[Subscriber] ✅ Stream attachment successful after retry");
        }
        return;
      } catch (error) {
        lastError = error as Error;
        this.reconnectAttempts++;

        log(`[Subscriber] ❌ Stream attachment failed (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          break;
        }

        const delay = this.calculateBackoffDelay();
        this.emit("reconnecting", {
          subscriber: this,
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        globalEventBus.emit(GlobalEvents.SUBSCRIBER_RECONNECTING, {
          streamId: this.config.streamId,
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        this.emit("status", {
          subscriber: this,
          message: `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
          isError: false,
        });

        await this.delay(delay);
      }
    }

    this.emit("reconnectionFailed", {
      subscriber: this,
      reason: lastError?.message || "Unknown error",
    });
    globalEventBus.emit(GlobalEvents.SUBSCRIBER_RECONNECTION_FAILED, {
      streamId: this.config.streamId,
      reason: lastError?.message || "Unknown error",
    });
    throw lastError;
  }

  /**
   * Reconnect subscriber - full connection re-establishment
   * Can be called manually or automatically
   */
  async reconnect(): Promise<void> {
    if (this.isReconnecting) {
      log("[Subscriber] Already reconnecting, skipping...");
      return;
    }

    log("[Subscriber] 🔄 Starting reconnection process...");
    this.isReconnecting = true;
    this.reconnectAttempts = 0;

    try {
      // Cleanup existing connections but preserve config
      this.cleanup();

      // Re-initialize managers
      this.initializeManagers();

      // Create a new message channel for worker communication
      const channel = new MessageChannel();

      // Load polyfill if needed
      if (this.polyfillManager) {
        await this.polyfillManager.load();
      }

      // Initialize worker
      if (!this.workerManager) {
        throw new Error("Worker manager not initialized");
      }
      await this.workerManager.init(channel.port2, this.subscribeType, this.config.audioEnabled);

      // Initialize audio system if enabled
      if (this.audioProcessor && this.config.audioEnabled) {
        await this.audioProcessor.init(
          this.config.audioWorkletUrl,
          channel.port1
        );
      }

      // Initialize video system
      if (this.videoProcessor) {
        this.videoProcessor.init();
      }

      // Attach streams with retry
      await this.attachStreamsWithRetry();

      this.isStarted = true;
      this.updateConnectionStatus("connected");

      this.emit("reconnected", { subscriber: this });
      globalEventBus.emit(GlobalEvents.SUBSCRIBER_RECONNECTED, { streamId: this.config.streamId });
      log("[Subscriber] ✅ Reconnection completed successfully");
    } catch (error) {
      console.error("[Subscriber] ❌ Reconnection failed:", error);
      this.updateConnectionStatus("failed");
      this.emit("reconnectionFailed", {
        subscriber: this,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
      globalEventBus.emit(GlobalEvents.SUBSCRIBER_RECONNECTION_FAILED, {
        streamId: this.config.streamId,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Get current reconnection state
   */
  getReconnectionState(): {
    isReconnecting: boolean;
    attempts: number;
    maxAttempts: number;
  } {
    return {
      isReconnecting: this.isReconnecting,
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    };
  }

  /**
   * Configure reconnection parameters
   */
  setReconnectionConfig(config: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
  }): void {
    if (config.maxAttempts !== undefined) {
      this.maxReconnectAttempts = config.maxAttempts;
    }
    if (config.baseDelay !== undefined) {
      this.baseReconnectDelay = config.baseDelay;
    }
    if (config.maxDelay !== undefined) {
      this.maxReconnectDelay = config.maxDelay;
    }
    log("[Subscriber] Reconnection config updated:", {
      maxAttempts: this.maxReconnectAttempts,
      baseDelay: this.baseReconnectDelay,
      maxDelay: this.maxReconnectDelay,
    });
  }
}

export default Subscriber;
