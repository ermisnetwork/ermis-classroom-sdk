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
import { ChannelName, TRANSPORT } from "../../constants";

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
    initialQuality: "cam_360p" | "cam_720p" | "cam_1080p" | "cam_1440p";
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
  private baseReconnectDelay: number = TRANSPORT.RECONNECT_BASE_DELAY;
  private maxReconnectDelay: number = TRANSPORT.MAX_RECONNECT_DELAY;
  private isReconnecting = false;

  // Watchdog — safety net for edge case where transport stays open but frames stop
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameTime = 0;  // 0 means no frame received yet
  private isPaused = false;   // true when pauseStream() is active — suppress watchdog
  private readonly WATCHDOG_TIMEOUT_MS = 15_000;  // 15s without frame → reconnect
  private readonly WATCHDOG_INTERVAL_MS = 3_000;   // check every 3s

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
      initialQuality: config.initialQuality || "cam_360p",
      onStatus: config.onStatus,
    };

    log("Subscriber config protocol:", this.config.protocol);

    // Set protocol and subscribeType
    this.protocol = this.config.protocol;
    // this.protocol = "webtransport"; // force webtransport
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
   * @param skipVideoProcessor - If true, do NOT create a new VideoProcessor.
   *   Used during soft reconnect to preserve the existing VideoProcessor
   *   (and its alive MediaStreamTrackGenerator) so the video track stays alive.
   */
  private initializeManagers(skipVideoProcessor = false): void {
    // Worker manager
    this.workerManager = new WorkerManager(
      this.config.mediaWorkerUrl,
      this.subscriberId,
      this.protocol,
    );

    // iOS 15: override worklet URL to use lite version (plain array buffers,
    // smaller sizes, no softClip/crossfade — prevents crackling on older chips)
    if (this.workerManager.needsExternalDecoderWorker()) {
      this.config.audioWorkletUrl = "/workers/audio-worklet-lite.js";
      log('[Subscriber] iOS 15 detected — using audio-worklet-lite.js');
    }

    // Polyfill manager
    this.polyfillManager = new PolyfillManager(this.config.mstgPolyfillUrl);

    // Video processor — skip during soft reconnect to preserve existing track
    if (!skipVideoProcessor) {
      this.videoProcessor = new VideoProcessor();
    }
    // else: keep existing this.videoProcessor alive — its track stays live
    //   and new worker frames will flow into it automatically

    // Audio processor
    this.audioProcessor = new AudioProcessor(
      this.subscriberId,
      this.config.isOwnStream
    );

    // Setup event listeners
    // Pass skipVideoProcessor so we do NOT re-register videoProcessor listeners
    // (they would accumulate: frameProcessed would fire N times per frame)
    this.setupManagerListeners(skipVideoProcessor);
  }

  /**
   * Setup event listeners for all managers
   * @param skipVideoProcessor - If true, skip adding listeners to videoProcessor
   *   (used during soft reconnect to prevent duplicate listener accumulation)
   */
  private setupManagerListeners(skipVideoProcessor = false): void {
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
        // // drop frame for avoid memory leak
        // frame.close();
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

      // Transport closed — trigger auto-reconnect (subscriber-side connection drop)
      this.workerManager.on("streamClosed", () => {
        if (this.isStarted && !this.isReconnecting) {
          log("[Subscriber] Transport stream closed — auto-reconnecting...");
          this.reconnect().catch(err => {
            console.error("[Subscriber] Auto-reconnect failed:", err);
          });
        }
      });
    }

    // Video processor events
    // Only register if we own this videoProcessor instance (i.e. not a soft-reconnect preserve)
    if (this.videoProcessor && !skipVideoProcessor) {
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
          await this.workerManager.waitForWasmReady(TRANSPORT.WASM_READY_TIMEOUT);
          log("[Subscriber] WASM ready");
        } catch (wasmError) {
          // Don't fail the entire subscriber start — WASM may still init in background
          console.warn("[Subscriber] WASM ready timeout, continuing anyway:", wasmError);
        }
      }

      // Attach streams to worker (WebTransport, WebRTC, or WebSocket) with retry
      await this.attachStreamsWithRetry();

      // Switch to initial quality if not default (cam_360p)
      // Moved to worker init: initialQuality is now passed to worker during initialization
      // so it sends the correct quality in init_channel_stream command
      /*
      if (this.config.initialQuality !== "cam_360p") {
        log(`[Subscriber] Switching to initial quality: ${this.config.initialQuality}`);
        this.workerManager.switchBitrate(this.config.initialQuality);
      }
      */

      this.isStarted = true;
      this.updateConnectionStatus("connected");
      this.emit("started", { subscriber: this });

      // Start watchdog after successfully connected
      this.startWatchdog();
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

      // Stop watchdog
      this.stopWatchdog();

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
  switchBitrate(quality: "cam_360p" | "cam_720p" | "cam_1080p" | "cam_1440p"): void {
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
      this.isPaused = true;  // Suspend watchdog — no frames expected while paused
      this.workerManager.pauseStream();
    } catch (error) {
      this.isPaused = false;
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
      this.isPaused = false;
      this.lastFrameTime = Date.now();  // Reset baseline so watchdog doesn't fire immediately
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
          this.attachWebTransportStreams(ChannelName.CAM_360P);
        } else if (this.subscribeType === "screen_share") {
          this.attachWebTransportStreams(ChannelName.SCREEN_SHARE_720P);
        }
      } else if (this.protocol === "websocket") {
        await this.attachWebSocketConnection();
      } else if (this.protocol === "webrtc") {
        if (this.subscribeType === "camera") {
          this.attachDataChannel(this.config.initialQuality as ChannelName);
          this.attachDataChannel(ChannelName.MIC_48K);
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
    if (!this.workerManager) {
      throw new Error("Managers not initialized");
    }

    const webTpUrl = this.config.subcribeUrl;
    if (!webTpUrl) {
      throw new Error("Subscribe URL not provided");
    }

    log("Attaching WebTransport streams — worker will create session:", webTpUrl);

    // Tell the worker to create the WebTransport session itself.
    // The worker opens the bidi stream for commands and calls
    // receiveUnidirectional() for GOP streams — no DataCloneError possible.
    this.workerManager.attachWebTransportUrl(
      webTpUrl,
      channelName,
      this.config.localStreamId,
    );
    log("✅ attachWebTransportUrl sent to worker");
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
        log(`[ICE] State: ${rtc.iceConnectionState}`);

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
        log(`[Subscriber] Data channel ${mediaChannel} closed`);
        console.error(`[Subscriber] Closed: ${mediaChannel}`, {
          readyState: dataChannel.readyState,
          iceConnectionState: rtc.iceConnectionState,
          connectionState: rtc.connectionState,
          bufferedAmount: dataChannel.bufferedAmount,
        });
      };

      log(`Data channel created for ${mediaChannel}, id:`, dataChannel.id);
      this.workerManager.attachDataChannel(mediaChannel, dataChannel);

      const offer = await rtc.createOffer();
      await rtc.setLocalDescription(offer);


      const channel = `${this.config.streamId}:${mediaChannel}`;

      log(`[WebRTC subscriber] Created offer for ${mediaChannel}, sending to server...`);

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

      log(`[WebRTC] Channel ${mediaChannel} setup completed`);

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
      // Update watchdog timestamp on every received frame
      this.lastFrameTime = Date.now();
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
   * Soft cleanup — only kills transport/worker layer, preserves videoProcessor.
   * This keeps the MediaStreamTrackGenerator alive so the video element
   * shows the last frame (freeze) instead of going black during reconnect.
   */
  private softCleanup(): void {
    // Stop watchdog
    this.stopWatchdog();
    this.lastFrameTime = 0;

    // Kill worker (stops sending frames — video naturally freezes on last frame)
    if (this.workerManager) {
      this.workerManager.terminate();
      this.workerManager = null;
    }

    // Kill audio processor
    if (this.audioProcessor) {
      this.audioProcessor.cleanup();
      this.audioProcessor = null;
    }

    // Kill transport manager
    if (this.transportManager) {
      this.transportManager.disconnect();
      this.transportManager = null;
    }

    // Polyfill manager can be re-used
    this.polyfillManager = null;

    // ✅ videoProcessor intentionally kept alive — last frame stays visible
    // Reset pause state — reconnect starts fresh regardless
    this.isPaused = false;

    log("[Subscriber] softCleanup() done — videoProcessor preserved");
  }

  /**
   * Start watchdog timer — safety net for edge cases where transport stays
   * open but frames stop arriving (e.g. server-side issue).
   * Fires reconnect if no frame received within WATCHDOG_TIMEOUT_MS.
   * Does NOT fire while stream is intentionally paused.
   */
  private startWatchdog(): void {
    this.stopWatchdog(); // clear any existing
    this.lastFrameTime = Date.now(); // treat connect time as baseline
    this.watchdogTimer = setInterval(() => {
      // Skip if not active, already reconnecting, no baseline, or intentionally paused
      if (!this.isStarted || this.isReconnecting || this.lastFrameTime === 0 || this.isPaused) return;
      const elapsed = Date.now() - this.lastFrameTime;
      if (elapsed > this.WATCHDOG_TIMEOUT_MS) {
        log(`[Subscriber] ⏱ Watchdog: no frame for ${elapsed}ms — auto-reconnecting...`);
        this.reconnect().catch(err => {
          console.error("[Subscriber] Watchdog auto-reconnect failed:", err);
        });
      }
    }, this.WATCHDOG_INTERVAL_MS);
  }

  /**
   * Stop watchdog timer
   */
  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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

    log("[Subscriber] 🔄 Starting soft reconnection (preserving video track)...");
    this.isReconnecting = true;
    this.reconnectAttempts = 0;

    try {
      // Soft cleanup: kill transport/worker only, keep videoProcessor alive
      // → video element shows last frame (freeze) instead of going black
      this.softCleanup();

      // Re-initialize managers — pass skipVideoProcessor=true to preserve
      // the existing VideoProcessor and its alive MediaStreamTrackGenerator.
      // New worker frames will flow into the same track automatically.
      this.initializeManagers(/* skipVideoProcessor= */ true);

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

      // ❌ Do NOT call videoProcessor.init() — it's still alive and writing to
      // the same MediaStreamTrackGenerator. New frames from the new worker will
      // flow into it automatically, resuming the video without any visible cut.

      // Attach streams with retry
      await this.attachStreamsWithRetry();

      this.isStarted = true;
      this.updateConnectionStatus("connected");

      // Restart watchdog
      this.startWatchdog();

      this.emit("reconnected", { subscriber: this });
      globalEventBus.emit(GlobalEvents.SUBSCRIBER_RECONNECTED, { streamId: this.config.streamId });
      log("[Subscriber] ✅ Soft reconnection completed — video resumes on same track");
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
