/**
 * Subscriber - Main class for receiving media streams
 *
 * Refactored to use modular architecture with managers and processors.
 * This class now acts as an orchestrator for all media receiving functionality.
 */

import { EventEmitter } from "../../events/EventEmitter";
import type {
  SubscriberConfig,
  SubscriberInfo,
} from "../../types/media/subscriber.types";
import { WebTransportManager } from "./transports/WebTransportManager";
import { WorkerManager } from "./managers/WorkerManager";
import { PolyfillManager } from "./managers/PolyfillManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";
import { ConnectionStatus } from "../../types/core/ermisClient.types";

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
  // Configuration
  private config: Required<SubscriberConfig>;
  private subscriberId: string;
  private protocol: "webtransport" | "webrtc" | "websocket";
  private subscribeType: "camera" | "screenshare";

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
  private connectionStatus: ConnectionStatus = "disconnected";
  private mediaStream: MediaStream | null = null;

  constructor(config: SubscriberConfig) {
    super();

    // Set default configuration
    this.config = {
      streamId: config.streamId || "",
      roomId: config.roomId || "",
      host: config.host || "stream-gate.bandia.vn",
      userMediaWorker:
        config.userMediaWorker ||
        "sfu-adaptive-trung.ermis-network.workers.dev",
      screenShareWorker:
        config.screenShareWorker || "sfu-screen-share.ermis-network.workers.dev",
      isOwnStream: config.isOwnStream || false,
      protocol: config.protocol || "webtransport",
      subscribeType: config.subscribeType || "camera",
      mediaWorkerUrl: config.mediaWorkerUrl || "/workers/media-worker-ab.js",
      audioWorkletUrl: config.audioWorkletUrl || "/workers/audio-worklet1.js",
      mstgPolyfillUrl: config.mstgPolyfillUrl || "/polyfills/MSTG_polyfill.js",
      subcribeUrl: config.subcribeUrl,
      isScreenSharing: config.isScreenSharing || false,
      streamOutputEnabled:
        config.streamOutputEnabled !== undefined
          ? config.streamOutputEnabled
          : true,
    };

    // Set protocol and subscribeType
    this.protocol = this.config.protocol;
    this.subscribeType = this.config.subscribeType;

    // Generate unique ID
    this.subscriberId = `subscriber_${this.config.streamId}_${Date.now()}`;

    // Initialize managers
    this.initializeManagers();
  }

  /**
   * Initialize all managers and processors
   */
  private initializeManagers(): void {
    // Transport manager
    this.transportManager = new WebTransportManager(this.config.subcribeUrl);

    // Worker manager
    this.workerManager = new WorkerManager(
      this.config.mediaWorkerUrl,
      this.subscriberId
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
        console.log("Transport connected");
      });

      this.transportManager.on("disconnected", ({ reason, error }) => {
        console.log("Transport disconnected:", reason, error);
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
      console.log("Starting subscriber:", this.subscriberId, "protocol:", this.protocol);
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

      // Initialize worker
      if (!this.workerManager) {
        throw new Error("Worker manager not initialized");
      }
      await this.workerManager.init(channel.port2, this.subscribeType);

      // Initialize audio system
      if (this.audioProcessor) {
        await this.audioProcessor.init(
          this.config.audioWorkletUrl,
          channel.port1
        );
      }

      // Initialize video system if needed (not for screen sharing streams)
      if (this.videoProcessor) {
        await this.videoProcessor.init();
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

      // Cleanup all components
      this.cleanup();

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
   */
  toggleAudio(): void {
    if (!this.isStarted || !this.workerManager) {
      return;
    }

    try {
      this.workerManager.toggleAudio();
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Toggle audio failed"),
        "toggleAudio"
      );
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
   */
  getInfo(): SubscriberInfo {
    return {
      streamId: this.config.streamId,
      roomId: this.config.roomId || "",
      host: this.config.host || "",
      isOwnStream: this.config.isOwnStream || false,
      subscriberId: this.subscriberId,
      isStarted: this.isStarted,
      isAudioEnabled: true, // Default to true since we don't track this separately
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
      } else if (this.protocol === "webrtc") {
        await this.attachWebRTCChannels();
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
   */
  private async attachWebTransportStreams(): Promise<void> {
    if (!this.transportManager || !this.workerManager) {
      throw new Error("Managers not initialized");
    }

    console.log("Attaching WebTransport streams...");

    // For SubscriberDev-style (single stream mode) - used by media-worker-dev.js
    if (this.config.mediaWorkerUrl.includes("media-worker-dev")) {
      // Single bidirectional stream for all media
      const mediaStream = await this.transportManager.createBidirectionalStream("media");
      if (mediaStream) {
        this.workerManager.attachStream(
          "media",
          mediaStream.readable,
          mediaStream.writable
        );
      }
      console.log("WebTransport single stream attached successfully");
      return;
    }

    // For SubscriberWs-style (multi-stream mode) - used by media-worker-ab.js
    // Attach video stream (360p)
    const stream360p =
      await this.transportManager.createBidirectionalStream("cam_360p");
    if (stream360p) {
      await this.workerManager.attachStream(
        "cam_360p",
        stream360p.readable,
        stream360p.writable
      );
    }

    // Attach audio stream
    const streamAudio =
      await this.transportManager.createBidirectionalStream("mic_48k");
    if (streamAudio) {
      await this.workerManager.attachStream(
        "mic_48k",
        streamAudio.readable,
        streamAudio.writable
      );
    }

    console.log("WebTransport multi-streams attached successfully");
  }

  /**
   * Attach WebRTC data channels to worker
   */
  private async attachWebRTCChannels(): Promise<void> {
    if (!this.workerManager) {
      throw new Error("Worker manager not initialized");
    }

    console.log("Using WebRTC for media transport");

    try {
      this.webRtc = new RTCPeerConnection();

      // Create data channels
      const streamAudioChannel = await this.createWrtcDataChannel("mic_48k", this.webRtc);
      console.log("Audio data channel created, id:", streamAudioChannel.id);

      const stream360pChannel = await this.createWrtcDataChannel("cam_360p", this.webRtc);
      console.log("360p data channel created, id:", stream360pChannel.id);

      const stream720pChannel = await this.createWrtcDataChannel("cam_720p", this.webRtc);
      console.log("720p data channel created, id:", stream720pChannel.id);

      // Attach channels to worker
      this.workerManager.attachDataChannel("mic_48k", streamAudioChannel);
      this.workerManager.attachDataChannel("cam_720p", stream720pChannel);

      // Create and send offer
      const offer = await this.webRtc.createOffer();
      await this.webRtc.setLocalDescription(offer);

      console.log("[WebRTC subscriber] Created offer, sending to server...");

      const response = await fetch(
        `https://${this.config.host}/meeting/sdp/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer,
            room_id: this.config.roomId,
            stream_id: this.config.streamId,
            action: "subscribe",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const answer = await response.json();
      await this.webRtc.setRemoteDescription(answer);

      console.log("[WebRTC] Data channels attached to worker successfully");
    } catch (error) {
      console.error("[WebRTC] Setup error:", error);
      throw new Error(`WebRTC setup failed: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  }

  /**
   * Create WebRTC data channel
   */
  private async createWrtcDataChannel(
    channelName: "cam_360p" | "cam_720p" | "mic_48k",
    webRtcConnection: RTCPeerConnection
  ): Promise<RTCDataChannel> {
    const id = this.getDataChannelId(channelName);

    const dataChannel = webRtcConnection.createDataChannel(channelName, {
      ordered: false,
      id,
      negotiated: true,
    });

    return dataChannel;
  }

  /**
   * Get data channel ID based on channel name
   */
  private getDataChannelId(channelName: string): number {
    const channelMap: Record<string, number> = {
      "meeting_control": 0,
      "mic_48k": 1,
      "cam_360p": 2,
      "cam_720p": 3,
      "cam_1080p": 4,
      "screen_360p": 5,
      "screen_720p": 6,
      "screen_audio": 7,
    };

    return channelMap[channelName] || 0;
  }

  /**
   * Attach WebSocket connection to worker
   */
  private async attachWebSocketConnection(): Promise<void> {
    if (!this.workerManager) {
      throw new Error("Worker manager not initialized");
    }

    console.log("Using WebSocket for media transport");

    const wsUrl = `wss://${this.config.host}/meeting/${this.config.roomId}/${this.config.streamId}`;
    this.workerManager.attachWebSocket(wsUrl);

    console.log("WebSocket attached successfully");
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
    this.emit("remoteStreamReady", {
      stream,
      streamId: this.config.streamId,
      subscriberId: this.subscriberId,
      roomId: this.config.roomId,
      isOwnStream: this.config.isOwnStream,
    });
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
      console.log("WebRTC connection closed");
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
