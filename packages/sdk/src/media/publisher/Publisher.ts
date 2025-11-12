/**
 * Publisher - Main class for publishing media streams
 *
 * Refactored to use modular architecture with managers and processors.
 * This class now acts as an orchestrator for all media publishing functionality.
 */

import EventEmitter from "../../events/EventEmitter";
import { WebTransportManager } from "./transports/WebTransportManager";
import { WebRTCManager } from "./transports/WebRTCManager";
import { StreamManager } from "./transports/StreamManager";
import { VideoEncoderManager } from "./managers/VideoEncoderManager";
import { AudioEncoderManager } from "./managers/AudioEncoderManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";
import { loadScript } from "./utils/publisher.utils";
import type {
  PublisherConfig,
  VideoConfig,
  AudioConfig,
  SubStreamConfig,
  ChannelName,
  ServerEvent,
  StreamInfo,
  CameraSwitchResult,
  InitAudioRecorder,
} from "../../types/media/publisher.types";

/**
 * Publisher event map
 */
interface PublisherEvents extends Record<string, unknown> {
  statusUpdate: { message: string; isError: boolean };
  streamStart: undefined;
  streamStop: undefined;
  serverEvent: ServerEvent;
  cameraSwitch: CameraSwitchResult;
  connected: undefined;
  disconnected: { reason?: string; error?: unknown };
  error: unknown;
}

/**
 * Publisher class - orchestrates media stream publishing
 */
export class Publisher extends EventEmitter<PublisherEvents> {
  // Configuration
  private options: Required<PublisherConfig>;
  private currentVideoConfig: VideoConfig;
  private currentAudioConfig: AudioConfig;
  private subStreams: SubStreamConfig[];

  // Managers
  private transportManager: WebTransportManager | WebRTCManager | null = null;
  private streamManager: StreamManager | null = null;
  private videoEncoderManager: VideoEncoderManager | null = null;
  private audioEncoderManager: AudioEncoderManager | null = null;

  // Processors
  private videoProcessor: VideoProcessor | null = null;
  private audioProcessor: AudioProcessor | null = null;

  // State
  private isInitialized = false;
  private isPublishing = false;
  private currentStream: MediaStream | null = null;
  private hasCamera = false;
  private hasMic = false;
  private cameraEnabled = true;
  private micEnabled = true;

  // WASM & Dependencies
  private wasmInitialized = false;
  private wasmInitializing = false;
  private wasmInitPromise: Promise<void> | null = null;
  private initAudioRecorder: InitAudioRecorder | null = null;

  constructor(config: PublisherConfig) {
    super();

    // Validate required options
    if (!config.publishUrl) {
      throw new Error("publishUrl is required");
    }

    // Set default options
    this.options = {
      publishUrl: config.publishUrl,
      streamType: config.streamType || "camera",
      streamId: config.streamId || `stream_${Date.now()}`,
      userId: config.userId || null,
      roomId: config.roomId || "default_room",
      useWebRTC: config.useWebRTC || false,
      mediaStream: config.mediaStream || null,
      width: config.width || 1280,
      height: config.height || 720,
      framerate: config.framerate || 30,
      bitrate: config.bitrate || 1_500_000,
      hasCamera: config.hasCamera !== undefined ? config.hasCamera : true,
      hasMic: config.hasMic !== undefined ? config.hasMic : true,
      onStatusUpdate: config.onStatusUpdate || ((msg) => console.log(msg)),
      onStreamStart: config.onStreamStart || (() => { }),
      onStreamStop: config.onStreamStop || (() => { }),
      onServerEvent:
        config.onServerEvent || ((event) => console.log("Event:", event)),
      webRtcServerUrl: config.webRtcServerUrl || "daibo.ermis.network:9993",
    };

    // Setup video configuration
    this.currentVideoConfig = {
      codec: "avc1.640c34",
      width: this.options.width,
      height: this.options.height,
      framerate: this.options.framerate,
      bitrate: this.options.bitrate,
    };

    // Setup audio configuration
    this.currentAudioConfig = {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 1,
    };

    // Setup sub-streams configuration
    this.subStreams = [
      {
        name: "meeting_control",
        channelName: "meeting_control" as ChannelName,
      },
      {
        name: "microphone",
        channelName: "mic_48k" as ChannelName,
      },
      {
        name: "low",
        width: 640,
        height: 360,
        bitrate: 400_000,
        framerate: 30,
        channelName: "cam_360p" as ChannelName,
      },
      {
        name: "high",
        width: 1280,
        height: 720,
        bitrate: 800_000,
        framerate: 30,
        channelName: "cam_720p" as ChannelName,
      },
    ];

    this.hasCamera = this.options.hasCamera;
    this.hasMic = this.options.hasMic;
  }

  /**
   * Initialize the publisher
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      this.updateStatus("Already initialized");
      return;
    }

    try {
      this.updateStatus("Initializing publisher...");

      // Load dependencies
      await this.loadAllDependencies();

      // Create managers
      this.createManagers();

      this.isInitialized = true;
      this.updateStatus("Publisher initialized successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Initialization failed: ${message}`, true);
      throw error;
    }
  }

  /**
   * Load all required dependencies
   */
  private async loadAllDependencies(): Promise<void> {
    try {
      // Load polyfills
      await loadScript("/polyfills/MSTP_polyfill.js");
      console.log("[Publisher] Polyfill loaded");

      // Load WASM encoder
      if (!this.wasmInitialized) {
        if (this.wasmInitializing && this.wasmInitPromise) {
          await this.wasmInitPromise;
        } else {
          this.wasmInitializing = true;
          const wasmModule = await import("../../raptorQ/raptorq_wasm.js");

          this.wasmInitPromise = wasmModule
            .default("../../raptorQ/raptorq_wasm_bg.wasm")
            .then(() => {
              this.wasmInitialized = true;
              this.wasmInitializing = false;
              console.log("[Publisher] WASM encoder loaded");
            })
            .catch((err: Error) => {
              this.wasmInitializing = false;
              throw new Error(`Failed to load WASM: ${err.message}`);
            });

          await this.wasmInitPromise;
        }
      }

      // Load Opus decoder
      const opusModule = await import(
        `/opus_decoder/opusDecoder.js?t=${Date.now()}`
      );
      this.initAudioRecorder =
        opusModule.initAudioRecorder as InitAudioRecorder;
      console.log("[Publisher] Opus decoder loaded");

      this.updateStatus("All dependencies loaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Dependency loading error: ${message}`, true);
      throw error;
    }
  }

  /**
   * Create all managers
   */
  private createManagers(): void {
    // Create StreamManager
    this.streamManager = new StreamManager(this.options.useWebRTC);

    // Create encoder managers
    this.videoEncoderManager = new VideoEncoderManager();

    console.log("[Publisher] Managers created");
  }

  /**
   * Start publishing media stream
   */
  async startPublishing(): Promise<void> {
    if (this.isPublishing) {
      this.updateStatus("Already publishing", true);
      return;
    }

    if (!this.isInitialized) {
      await this.init();
    }

    try {
      this.updateStatus("Starting publishing...");

      // Setup connection
      await this.setupConnection();

      // Get media stream
      await this.getMediaStream();

      // Initialize processors
      await this.initializeProcessors();

      // Start processing
      await this.startProcessing();

      this.isPublishing = true;
      this.options.onStreamStart();
      this.emit("streamStart");
      this.updateStatus("Publishing started successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to start publishing: ${message}`, true);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Setup connection (WebTransport or WebRTC)
   */
  private async setupConnection(): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }

    if (this.options.useWebRTC) {
      await this.setupWebRTCConnection();
    } else {
      await this.setupWebTransportConnection();
    }
  }

  /**
   * Setup WebTransport connection
   */
  private async setupWebTransportConnection(): Promise<void> {
    this.updateStatus("Connecting via WebTransport...");

    this.transportManager = new WebTransportManager({
      url: this.options.publishUrl,
    });

    // Setup event listeners
    this.transportManager.on("connected", () => {
      this.updateStatus("WebTransport connected");
      this.emit("connected");
    });

    this.transportManager.on("disconnected", (data) => {
      this.updateStatus("WebTransport disconnected", true);
      //! Emit the reason for disconnection
      this.emit("disconnected", data as { reason?: string; error?: unknown });
    });

    this.transportManager.on("connectionError", (error) => {
      this.updateStatus("WebTransport connection error", true);
      this.emit("error", error);
    });

    // Connect
    const transport = await this.transportManager.connect();

    // Initialize streams
    const channelNames = this.subStreams.map((s) => s.channelName);
    await this.streamManager!.initWebTransportStreams(transport, channelNames);

    this.updateStatus("WebTransport streams initialized");
  }

  /**
   * Setup WebRTC connection
   */
  private async setupWebRTCConnection(): Promise<void> {
    this.updateStatus("Connecting via WebRTC...");

    this.transportManager = new WebRTCManager(
      this.options.webRtcServerUrl,
      this.options.roomId,
      this.options.streamId,
    );

    // Setup event listeners
    this.transportManager.on("connected", () => {
      this.updateStatus("WebRTC connected");
      this.emit("connected");
    });

    this.transportManager.on("disconnected", (state) => {
      this.updateStatus(`WebRTC disconnected: ${state}`, true);
      //! Emit the reason for disconnection
      this.emit("disconnected", { reason: state as string });
    });

    this.transportManager.on("connectionError", (error) => {
      this.updateStatus("WebRTC connection error", true);
      this.emit("error", error);
    });

    // Connect
    const peerConnection = await this.transportManager.connect();

    // Initialize data channels
    const channelNames = this.subStreams.map((s) => s.channelName);
    await this.streamManager!.initWebRTCChannels(peerConnection, channelNames);

    this.updateStatus("WebRTC data channels initialized");
  }

  /**
   * Get media stream
   */
  private async getMediaStream(): Promise<void> {
    if (this.options.mediaStream) {
      this.currentStream = this.options.mediaStream;
      this.updateStatus("Using pre-configured stream");
      return;
    }

    this.updateStatus("Requesting media stream...");

    const constraints: MediaStreamConstraints = {
      video: this.hasCamera
        ? {
          width: { ideal: this.currentVideoConfig.width },
          height: { ideal: this.currentVideoConfig.height },
          frameRate: { ideal: this.currentVideoConfig.framerate },
        }
        : false,
      audio: this.hasMic
        ? {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
        : false,
    };

    this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);

    const videoTracks = this.currentStream.getVideoTracks();
    const audioTracks = this.currentStream.getAudioTracks();

    this.hasCamera = videoTracks.length > 0;
    this.hasMic = audioTracks.length > 0;

    this.updateStatus(
      `Media stream acquired (video: ${this.hasCamera}, audio: ${this.hasMic})`,
    );
  }

  /**
   * Initialize processors
   */
  private async initializeProcessors(): Promise<void> {
    if (
      !this.currentStream ||
      !this.streamManager ||
      !this.videoEncoderManager
    ) {
      throw new Error("Required components not initialized");
    }

    this.updateStatus("Initializing processors...");

    const videoTracks = this.currentStream.getVideoTracks();
    const audioTracks = this.currentStream.getAudioTracks();

    // Initialize video processor
    if (this.hasCamera && videoTracks.length > 0) {
      this.videoProcessor = new VideoProcessor(
        this.videoEncoderManager,
        this.streamManager,
        this.subStreams,
      );

      await this.videoProcessor.initialize(
        videoTracks[0],
        this.currentVideoConfig,
      );

      // Setup event handlers
      this.setupVideoProcessorEvents();

      this.updateStatus("Video processor initialized");
    }

    // Initialize audio processor
    if (this.hasMic && audioTracks.length > 0 && this.initAudioRecorder) {
      this.audioEncoderManager = new AudioEncoderManager(
        "mic_48k" as ChannelName,
        this.currentAudioConfig,
        this.initAudioRecorder,
      );

      this.audioProcessor = new AudioProcessor(
        this.audioEncoderManager,
        this.streamManager,
        "mic_48k" as ChannelName,
      );

      const audioStream = new MediaStream([audioTracks[0]]);
      await this.audioProcessor.initialize(audioStream);

      // Setup event handlers
      this.setupAudioProcessorEvents();

      this.updateStatus("Audio processor initialized");
    }

    this.updateStatus("Processors initialized successfully");
  }

  /**
   * Setup video processor event handlers
   */
  private setupVideoProcessorEvents(): void {
    if (!this.videoProcessor) return;

    this.videoProcessor.on("started", () => {
      console.log("[Publisher] Video processing started");
    });

    this.videoProcessor.on("stopped", () => {
      console.log("[Publisher] Video processing stopped");
    });

    this.videoProcessor.on("cameraStateChanged", (enabled) => {
      console.log(`[Publisher] Camera ${enabled ? "enabled" : "disabled"}`);
    });

    this.videoProcessor.on("cameraSwitched", () => {
      console.log("[Publisher] Camera switched");
    });

    this.videoProcessor.on("encoderError", ({ encoderName, error }) => {
      console.error(`[Publisher] Encoder ${encoderName} error:`, error);
      this.emit("error", error);
    });

    this.videoProcessor.on("processingError", (error) => {
      console.error("[Publisher] Video processing error:", error);
      this.emit("error", error);
    });
  }

  /**
   * Setup audio processor event handlers
   */
  private setupAudioProcessorEvents(): void {
    if (!this.audioProcessor) return;

    this.audioProcessor.on("started", () => {
      console.log("[Publisher] Audio processing started");
    });

    this.audioProcessor.on("stopped", () => {
      console.log("[Publisher] Audio processing stopped");
    });

    this.audioProcessor.on("micStateChanged", (enabled) => {
      console.log(`[Publisher] Microphone ${enabled ? "enabled" : "disabled"}`);
    });

    this.audioProcessor.on("encoderError", (error) => {
      console.error("[Publisher] Audio encoder error:", error);
      this.emit("error", error);
    });
  }

  /**
   * Start processing
   */
  private async startProcessing(): Promise<void> {
    this.updateStatus("Starting media processing...");

    if (this.videoProcessor) {
      await this.videoProcessor.start();
    }

    if (this.audioProcessor) {
      await this.audioProcessor.start();
    }

    this.updateStatus("Media processing started");
  }

  /**
   * Toggle camera on/off
   */
  async toggleCamera(): Promise<void> {
    if (!this.hasCamera) {
      this.updateStatus("No camera available", true);
      return;
    }

    this.cameraEnabled = !this.cameraEnabled;

    if (this.videoProcessor) {
      this.videoProcessor.setCameraEnabled(this.cameraEnabled);
    }

    this.updateStatus(`Camera ${this.cameraEnabled ? "enabled" : "disabled"}`);
  }

  /**
   * Toggle microphone on/off
   */
  async toggleMic(): Promise<void> {
    if (!this.hasMic) {
      this.updateStatus("No microphone available", true);
      return;
    }

    this.micEnabled = !this.micEnabled;

    if (this.audioProcessor) {
      this.audioProcessor.setMicEnabled(this.micEnabled);
    }

    this.updateStatus(`Microphone ${this.micEnabled ? "enabled" : "disabled"}`);
  }

  /**
   * Switch to different camera device
   */
  async switchCamera(deviceId: string): Promise<CameraSwitchResult> {
    if (!this.hasCamera || !this.isPublishing) {
      throw new Error("Cannot switch camera: not publishing or no camera");
    }

    try {
      this.updateStatus("Switching camera...");

      const videoConstraints: MediaTrackConstraints = {
        deviceId: { exact: deviceId },
        width: { ideal: this.currentVideoConfig.width },
        height: { ideal: this.currentVideoConfig.height },
        frameRate: { ideal: this.currentVideoConfig.framerate },
      };

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        throw new Error("Failed to get video track from new camera");
      }

      // Replace track in current stream
      const oldVideoTrack = this.currentStream!.getVideoTracks()[0];
      this.currentStream!.removeTrack(oldVideoTrack);
      this.currentStream!.addTrack(newVideoTrack);
      oldVideoTrack.stop();

      // Switch in video processor
      if (this.videoProcessor) {
        await this.videoProcessor.switchCamera(newVideoTrack);
      }

      const result: CameraSwitchResult = {
        stream: this.currentStream!,
        videoOnlyStream: newStream,
      };

      this.emit("cameraSwitch", result);
      this.updateStatus("Camera switched successfully");

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to switch camera: ${message}`, true);
      throw error;
    }
  }

  /**
   * Stop publishing
   */
  async stop(): Promise<void> {
    if (!this.isPublishing) {
      return;
    }

    try {
      this.updateStatus("Stopping publisher...");

      // Stop processors
      if (this.videoProcessor) {
        await this.videoProcessor.stop();
        this.videoProcessor = null;
      }

      if (this.audioProcessor) {
        await this.audioProcessor.stop();
        this.audioProcessor = null;
      }

      // Close encoder managers
      if (this.videoEncoderManager) {
        await this.videoEncoderManager.closeAll();
        this.videoEncoderManager = null;
      }

      if (this.audioEncoderManager) {
        await this.audioEncoderManager.stop();
        this.audioEncoderManager = null;
      }

      // Close streams
      if (this.streamManager) {
        await this.streamManager.closeAll();
        this.streamManager = null;
      }

      // Close transport
      if (this.transportManager) {
        if ("close" in this.transportManager) {
          await (this.transportManager as WebTransportManager).close();
        } else {
          (this.transportManager as WebRTCManager).close();
        }
        this.transportManager = null;
      }

      // Stop media tracks
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop());
        this.currentStream = null;
      }

      this.isPublishing = false;
      this.options.onStreamStop();
      this.emit("streamStop");
      this.updateStatus("Publisher stopped");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Error stopping: ${message}`, true);
      throw error;
    }
  }

  /**
   * Update status and emit event
   */
  private updateStatus(message: string, isError = false): void {
    this.options.onStatusUpdate(message, isError);
    this.emit("statusUpdate", { message, isError });

    if (isError) {
      console.error(`[Publisher] ${message}`);
    } else {
      console.log(`[Publisher] ${message}`);
    }
  }

  /**
   * Check if publisher is currently active
   */
  get isActive(): boolean {
    return this.isPublishing;
  }

  /**
   * Get current stream information
   */
  get streamInfo(): StreamInfo {
    return {
      streamType: this.options.streamType,
      config: this.currentVideoConfig,
      sequenceNumber: 0,
      activeStreams: this.streamManager?.getActiveChannels() || [],
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    isPublishing: boolean;
    hasCamera: boolean;
    hasMic: boolean;
    cameraEnabled: boolean;
    micEnabled: boolean;
    videoStats?: ReturnType<VideoProcessor["getStats"]>;
    audioStats?: ReturnType<AudioProcessor["getStats"]>;
    streamStats?: ReturnType<StreamManager["getStats"]>;
  } {
    return {
      isPublishing: this.isPublishing,
      hasCamera: this.hasCamera,
      hasMic: this.hasMic,
      cameraEnabled: this.cameraEnabled,
      micEnabled: this.micEnabled,
      videoStats: this.videoProcessor?.getStats(),
      audioStats: this.audioProcessor?.getStats(),
      streamStats: this.streamManager?.getStats(),
    };
  }
}

export default Publisher;
