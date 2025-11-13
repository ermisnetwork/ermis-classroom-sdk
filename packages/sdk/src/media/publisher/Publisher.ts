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
import { ChannelName } from "../../types/media/publisher.types";
import type {
  PublisherConfig,
  VideoEncoderConfig,
  AudioEncoderConfig,
  SubStreamConfig,
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
  audioSwitch: { deviceId: string; stream: MediaStream; videoOnlyStream: MediaStream };
  videoSwitch: { deviceId: string; stream: MediaStream; videoOnlyStream: MediaStream };
  mediaStreamReplaced: { stream: MediaStream; videoOnlyStream: MediaStream; hasVideo: boolean; hasAudio: boolean };
  screenShareStarted: { stream: MediaStream; hasVideo: boolean; hasAudio: boolean };
  localStreamReady: { stream: MediaStream; videoOnlyStream: MediaStream; type: string; streamId: string; config: VideoEncoderConfig; hasAudio: boolean; hasVideo: boolean };
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
  private currentVideoConfig: VideoEncoderConfig;
  private currentAudioConfig: AudioEncoderConfig;
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
  private screenStream: MediaStream | null = null;
  private hasCamera = false;
  private hasMic = false;
  private cameraEnabled = true;
  private micEnabled = true;
  private isHandRaised = false;
  private isScreenSharing = false;

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

          // Load WASM module as ES module
          this.wasmInitPromise = new Promise(async (resolve, reject) => {
            try {
              // Dynamically import as module using data URL trick
              const scriptUrl = '/raptorQ/raptorq_wasm.js';
              const response = await fetch(scriptUrl);
              const scriptContent = await response.text();

              // Create a blob URL to load as module
              const blob = new Blob([scriptContent], { type: 'application/javascript' });
              const blobUrl = URL.createObjectURL(blob);

              const wasmModule = await import(/* @vite-ignore */ blobUrl);
              await wasmModule.default('/raptorQ/raptorq_wasm_bg.wasm');

              URL.revokeObjectURL(blobUrl);

              this.wasmInitialized = true;
              this.wasmInitializing = false;
              console.log("[Publisher] WASM encoder loaded");
              resolve();
            } catch (err: any) {
              this.wasmInitializing = false;
              reject(new Error(`Failed to initialize WASM: ${err.message}`));
            }
          });

          await this.wasmInitPromise;
        }
      }

      // Load Opus decoder via script tag
      if (!this.initAudioRecorder) {
        await new Promise(async (resolve, reject) => {
          try {
            const scriptUrl = `/opus_decoder/opusDecoder.js`;
            const response = await fetch(scriptUrl);
            const scriptContent = await response.text();

            // Create blob URL to load as module
            const blob = new Blob([scriptContent], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);

            const opusModule = await import(/* @vite-ignore */ blobUrl);
            this.initAudioRecorder = opusModule.initAudioRecorder as InitAudioRecorder;

            URL.revokeObjectURL(blobUrl);

            console.log("[Publisher] Opus decoder loaded");
            resolve(true);
          } catch (err: any) {
            reject(new Error(`Failed to load Opus decoder: ${err.message}`));
          }
        });
      }

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

      const audioTracks = this.currentStream.getAudioTracks();
      const videoTracks = this.currentStream.getVideoTracks();
      this.hasCamera = videoTracks.length > 0;
      this.hasMic = audioTracks.length > 0;
      this.cameraEnabled = this.hasCamera;
      this.micEnabled = this.hasMic;

      console.log(`Pre-configured stream - Video: ${this.hasCamera}, Audio: ${this.hasMic}`);

      const videoOnlyStream = new MediaStream();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("localStreamReady", {
        stream: this.currentStream,
        videoOnlyStream: videoOnlyStream,
        type: this.options.streamType,
        streamId: this.options.streamId,
        config: this.currentVideoConfig,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });

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

    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoTracks = this.currentStream.getVideoTracks();
      const audioTracks = this.currentStream.getAudioTracks();

      this.hasCamera = videoTracks.length > 0;
      this.hasMic = audioTracks.length > 0;

      const videoOnlyStream = new MediaStream();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      if (audioTracks.length === 0) {
        this.hasMic = false;
        this.micEnabled = false;
        console.log("No audio tracks in stream, disabling audio");
      }

      if (videoTracks.length === 0) {
        this.hasCamera = false;
        this.cameraEnabled = false;
        console.log("No video tracks in stream, disabling video");
      }

      this.emit("localStreamReady", {
        stream: this.currentStream,
        videoOnlyStream: videoOnlyStream,
        type: this.options.streamType,
        streamId: this.options.streamId,
        config: this.currentVideoConfig,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });

      const mediaInfo = [];
      if (audioTracks.length > 0) mediaInfo.push("audio");
      if (videoTracks.length > 0) mediaInfo.push("video");

      this.updateStatus(
        `Media stream acquired (${mediaInfo.join(" + ") || "no media"})`,
      );
    } catch (error) {
      console.error("Error accessing media devices:", error);

      // Fallback logic - try video only, then audio only
      if (this.hasCamera && this.hasMic) {
        console.log("Retrying with fallback...");
        try {
          this.currentStream = await navigator.mediaDevices.getUserMedia({
            video: constraints.video as MediaTrackConstraints,
          });
          console.warn("Fallback: Got video only, no audio available");
          this.hasMic = false;
          this.micEnabled = false;
        } catch (videoError) {
          try {
            this.currentStream = await navigator.mediaDevices.getUserMedia({
              audio: constraints.audio as MediaTrackConstraints,
            });
            console.warn("Fallback: Got audio only, no video available");
            this.hasCamera = false;
            this.cameraEnabled = false;
          } catch (audioError) {
            console.error("Failed to get any media stream");
            this.updateStatus("No media devices available - permission denied or no devices found", true);
            throw audioError;
          }
        }
      } else {
        console.error(`Failed to access ${this.hasCamera ? "video" : "audio"}`);
        this.updateStatus(
          `Cannot access ${this.hasCamera ? "video" : "audio"} - permission denied or device not found`,
          true
        );
        throw error;
      }
    }
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
   * Toggle video (alias for toggleCamera for backward compatibility)
   */
  async toggleVideo(): Promise<void> {
    return this.toggleCamera();
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
   * Toggle audio (alias for toggleMic for backward compatibility)
   */
  async toggleAudio(): Promise<void> {
    return this.toggleMic();
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
   * Switch video track (alias for switchCamera for backward compatibility)
   */
  async switchVideoTrack(deviceId: string): Promise<CameraSwitchResult> {
    if (!this.hasCamera || !this.isPublishing) {
      throw new Error("Cannot switch video: not publishing or no camera");
    }

    try {
      this.updateStatus("Switching video source...");

      const videoConstraints: MediaTrackConstraints = {
        deviceId: { exact: deviceId },
        width: { ideal: this.currentVideoConfig.width },
        height: { ideal: this.currentVideoConfig.height },
        frameRate: { ideal: this.currentVideoConfig.framerate },
      };

      const audioConstraints = this.hasMic && this.currentStream?.getAudioTracks().length
        ? {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
        : false;

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      });

      if (!newStream.getVideoTracks()[0]) {
        throw new Error("Failed to get video track from new source");
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.currentStream!.getVideoTracks()[0];

      this.currentStream!.removeTrack(oldVideoTrack);
      this.currentStream!.addTrack(newVideoTrack);
      oldVideoTrack.stop();

      // Handle new track processing
      await this.handleNewTrack(newVideoTrack);

      const result: CameraSwitchResult = {
        stream: this.currentStream!,
        videoOnlyStream: newStream,
      };

      this.emit("videoSwitch", {
        deviceId,
        stream: this.currentStream!,
        videoOnlyStream: newStream,
      });

      this.updateStatus("Video switched successfully");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to switch video: ${message}`, true);
      throw error;
    }
  }

  /**
   * Handle new video track (internal method for track switching)
   */
  private async handleNewTrack(track: MediaStreamTrack): Promise<boolean> {
    if (!track) {
      throw new Error("No video track found in new stream");
    }

    try {
      const wasPublishing = this.isPublishing;
      this.isPublishing = false;

      // Small delay to ensure clean transition
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log("Switched to new video track:", track);

      // Switch in video processor
      if (this.videoProcessor) {
        await this.videoProcessor.switchCamera(track);
      }

      this.isPublishing = wasPublishing;

      this.updateStatus("Video track switched successfully", false);
      return true;
    } catch (error) {
      this.isPublishing = false;
      const errorMsg = `Video track switch error: ${error instanceof Error ? error.message : "Unknown"}`;
      this.updateStatus(errorMsg, true);
      console.error(errorMsg, error);
      return false;
    }
  }

  /**
   * Switch audio track to different microphone device
   */
  async switchAudioTrack(deviceId: string): Promise<{ stream: MediaStream; videoOnlyStream: MediaStream }> {
    if (!this.hasMic || !this.isPublishing) {
      throw new Error("Cannot switch audio: not publishing or no microphone");
    }

    try {
      this.updateStatus("Switching audio source...");

      const audioConstraints: MediaTrackConstraints = {
        deviceId: { exact: deviceId },
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      };

      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      if (!newStream.getAudioTracks()[0]) {
        throw new Error("Failed to get audio track from new source");
      }

      const newAudioTrack = newStream.getAudioTracks()[0];
      console.log("New audio track obtained:", newAudioTrack);

      // Switch in audio processor
      if (this.audioProcessor) {
        await this.audioProcessor.switchAudioTrack(newAudioTrack);
      }

      const videoOnlyStream = new MediaStream();
      const videoTracks = this.currentStream?.getVideoTracks() || [];
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("audioSwitch", {
        deviceId,
        stream: this.currentStream!,
        videoOnlyStream,
      });

      this.updateStatus("Audio switched successfully");
      return { stream: this.currentStream!, videoOnlyStream };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to switch audio: ${message}`, true);
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
   * Get current media stream (for backward compatibility)
   * @deprecated Use getCurrentStream() instead
   */
  get stream(): MediaStream | null {
    return this.currentStream;
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
    isHandRaised: boolean;
    isScreenSharing: boolean;
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
      isHandRaised: this.isHandRaised,
      isScreenSharing: this.isScreenSharing,
      videoStats: this.videoProcessor?.getStats(),
      audioStats: this.audioProcessor?.getStats(),
      streamStats: this.streamManager?.getStats(),
    };
  }

  // ==================== Camera/Mic Control Methods ====================

  /**
   * Turn on camera (resume video encoding)
   */
  async turnOnCamera(): Promise<void> {
    if (!this.hasCamera) {
      console.warn("Cannot turn on camera: no camera available");
      return;
    }

    if (this.cameraEnabled) {
      return;
    }

    this.cameraEnabled = true;
    this.updateStatus("Camera turned on");

    // Send camera_on event to server
    await this.sendMeetingEvent("camera_on");
  }

  /**
   * Turn off camera (stop video encoding)
   */
  async turnOffCamera(): Promise<void> {
    if (!this.hasCamera) {
      console.warn("Cannot turn off camera: no camera available");
      return;
    }

    if (!this.cameraEnabled) {
      return;
    }

    this.cameraEnabled = false;
    this.updateStatus("Camera turned off");

    // Send camera_off event to server
    await this.sendMeetingEvent("camera_off");
  }

  /**
   * Turn on microphone (resume audio encoding)
   */
  async turnOnMic(): Promise<void> {
    if (!this.hasMic) {
      console.warn("Cannot turn on mic: no microphone available");
      return;
    }

    if (this.micEnabled) {
      return;
    }

    this.micEnabled = true;
    this.updateStatus("Mic turned on");

    // Send mic_on event to server
    await this.sendMeetingEvent("mic_on");
  }

  /**
   * Turn off microphone (stop audio encoding)
   */
  async turnOffMic(): Promise<void> {
    if (!this.hasMic) {
      console.warn("Cannot turn off mic: no microphone available");
      return;
    }

    if (!this.micEnabled) {
      return;
    }

    this.micEnabled = false;
    this.updateStatus("Mic turned off");

    // Send mic_off event to server
    await this.sendMeetingEvent("mic_off");
  }

  // ==================== Hand Raise Methods ====================

  /**
   * Raise hand
   */
  async raiseHand(): Promise<void> {
    if (this.isHandRaised) {
      return;
    }

    this.isHandRaised = true;
    await this.sendMeetingEvent("raise_hand");
    this.updateStatus("Hand raised");
  }

  /**
   * Lower hand
   */
  async lowerHand(): Promise<void> {
    if (!this.isHandRaised) {
      return;
    }

    this.isHandRaised = false;
    await this.sendMeetingEvent("lower_hand");
    this.updateStatus("Hand lowered");
  }

  /**
   * Toggle raise hand
   */
  async toggleRaiseHand(): Promise<boolean> {
    if (this.isHandRaised) {
      await this.lowerHand();
    } else {
      await this.raiseHand();
    }

    return this.isHandRaised;
  }

  // ==================== Pin/Unpin Methods ====================

  /**
   * Pin stream for everyone
   */
  async pinForEveryone(targetStreamId: string): Promise<void> {
    if (!targetStreamId) {
      console.warn("Target stream ID required for pinning");
      return;
    }

    await this.sendMeetingEvent("pin_for_everyone", targetStreamId);
    this.updateStatus(`Pinned stream ${targetStreamId} for everyone`);
  }

  /**
   * Unpin stream for everyone
   */
  async unpinForEveryone(targetStreamId: string): Promise<void> {
    if (!targetStreamId) {
      console.warn("Target stream ID required for unpinning");
      return;
    }

    await this.sendMeetingEvent("unpin_for_everyone", targetStreamId);
    this.updateStatus(`Unpinned stream ${targetStreamId} for everyone`);
  }

  // ==================== Screen Share Methods ====================

  /**
   * Start screen sharing
   * @param screenMediaStream - Optional pre-configured screen stream. If not provided, will request screen capture.
   * @returns The screen share MediaStream
   */
  async startShareScreen(
    screenMediaStream?: MediaStream,
  ): Promise<MediaStream> {
    if (this.isScreenSharing) {
      throw new Error("Screen sharing already active");
    }

    if (!this.isPublishing) {
      throw new Error("Connection not established. Start publishing first.");
    }

    try {
      this.updateStatus("Starting screen share...");

      // Use provided stream or get new screen share stream
      if (screenMediaStream) {
        this.screenStream = screenMediaStream;
        this.updateStatus("Using pre-configured screen stream");
      } else {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: true,
        });
        this.updateStatus("Screen capture acquired");
      }

      // Validate stream has tracks
      const hasVideo = this.screenStream.getVideoTracks().length > 0;
      const hasAudio = this.screenStream.getAudioTracks().length > 0;

      if (!hasVideo) {
        throw new Error("Screen stream must have at least a video track");
      }

      console.warn(`Screen share stream received - Video: ${hasVideo}, Audio: ${hasAudio}`);

      this.isScreenSharing = true;

      // Setup track ended listener
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log("Screen share stopped by user");
          this.stopShareScreen().catch((error) => {
            console.error("Error stopping screen share:", error);
          });
        };
      }

      // Send screen_share_start event
      await this.sendMeetingEvent("screenshare_on");

      // Emit screenShareStarted event
      this.emit("screenShareStarted", {
        stream: this.screenStream,
        hasVideo,
        hasAudio,
      });

      this.updateStatus(`Screen sharing started (Video: ${hasVideo}, Audio: ${hasAudio})`);

      return this.screenStream;
    } catch (error) {
      this.isScreenSharing = false;
      this.screenStream = null;
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to start screen share: ${message}`, true);
      throw error;
    }
  }

  /**
   * Stop screen sharing
   */
  async stopShareScreen(): Promise<void> {
    if (!this.isScreenSharing || !this.screenStream) {
      return;
    }

    try {
      this.updateStatus("Stopping screen share...");

      // Stop all tracks
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      this.isScreenSharing = false;

      // Send screen_share_stop event
      await this.sendMeetingEvent("screenshare_off");

      this.updateStatus("Screen sharing stopped");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Error stopping screen share: ${message}`, true);
      throw error;
    }
  }

  // ==================== Stream Switching Methods ====================

  /**
   * Switch microphone to a different device
   */
  async switchMicrophone(deviceId: string): Promise<void> {
    if (!deviceId) {
      throw new Error("Device ID is required");
    }

    try {
      this.updateStatus(`Switching to microphone: ${deviceId}...`);

      // Get new audio stream
      const newAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const newAudioTrack = newAudioStream.getAudioTracks()[0];

      if (!newAudioTrack) {
        throw new Error("Failed to get audio track from new stream");
      }

      if (!this.currentStream) {
        throw new Error("No current stream available");
      }

      // Replace track in current stream
      const oldAudioTrack = this.currentStream.getAudioTracks()[0];
      if (oldAudioTrack) {
        this.currentStream.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }
      this.currentStream.addTrack(newAudioTrack);

      // Switch in audio processor
      if (this.audioProcessor) {
        await this.audioProcessor.switchAudioTrack(newAudioTrack);
      }

      this.updateStatus("Microphone switched successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to switch microphone: ${message}`, true);
      throw error;
    }
  }

  /**
   * Replace the entire media stream
   */
  async replaceMediaStream(newStream: MediaStream): Promise<void> {
    if (!newStream) {
      throw new Error("New stream is required");
    }

    try {
      this.updateStatus("Replacing media stream...");

      // Stop old stream
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop());
      }

      // Set new stream
      this.currentStream = newStream;

      const videoTracks = newStream.getVideoTracks();
      const audioTracks = newStream.getAudioTracks();

      this.hasCamera = videoTracks.length > 0;
      this.hasMic = audioTracks.length > 0;

      // Update video processor
      if (this.hasCamera && videoTracks.length > 0 && this.videoProcessor) {
        await this.videoProcessor.switchCamera(videoTracks[0]);
      }

      // Update audio processor
      if (this.hasMic && audioTracks.length > 0 && this.audioProcessor) {
        await this.audioProcessor.switchAudioTrack(audioTracks[0]);
      }

      const videoOnlyStream = new MediaStream();
      if (this.hasCamera) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      this.emit("mediaStreamReplaced", {
        stream: this.currentStream,
        videoOnlyStream,
        hasVideo: this.hasCamera,
        hasAudio: this.hasMic,
      });

      this.updateStatus("Media stream replaced successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.updateStatus(`Failed to replace media stream: ${message}`, true);
      throw error;
    }
  }

  // ==================== Meeting Event Methods ====================

  /**
   * Send meeting control event to server
   */
  async sendMeetingEvent(
    eventType: string,
    targetStreamId?: string,
  ): Promise<void> {
    if (!eventType) {
      return;
    }

    if (!this.streamManager) {
      console.warn(`Skipping ${eventType} event: Stream manager not ready`);
      return;
    }

    console.log("[Meeting Event] Sender stream ID:", this.options.streamId);

    const eventMessage: Record<string, unknown> = {
      type: eventType,
      sender_stream_id: this.options.streamId,
      timestamp: Date.now(),
    };

    if (
      (eventType === "pin_for_everyone" || eventType === "unpin_for_everyone") &&
      targetStreamId
    ) {
      eventMessage.target_stream_id = targetStreamId;
    }

    try {
      await this.sendEvent(eventMessage);
      console.log("Sent meeting event:", eventMessage);
    } catch (error) {
      console.error(`Failed to send meeting event ${eventType}:`, error);
      this.updateStatus(`Failed to notify server about ${eventType}`, true);
    }
  }

  /**
   * Send event through event stream
   */
  async sendEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.streamManager) {
      throw new Error("Stream manager not initialized");
    }

    await this.streamManager.sendData(ChannelName.MEETING_CONTROL, event);
  }

  /**
   * Send publisher state to server
   */
  async sendPublisherState(): Promise<void> {
    const state = {
      type: "publisher_state",
      stream_id: this.options.streamId,
      camera_enabled: this.cameraEnabled,
      mic_enabled: this.micEnabled,
      hand_raised: this.isHandRaised,
      screen_sharing: this.isScreenSharing,
      timestamp: Date.now(),
    };

    try {
      await this.sendEvent(state);
      console.log("Sent publisher state:", state);
    } catch (error) {
      console.error("Failed to send publisher state:", error);
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Get current media stream (public access)
   */
  getCurrentStream(): MediaStream | null {
    return this.currentStream;
  }

  /**
   * Get screen share stream
   */
  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  /**
   * Check if camera is enabled
   */
  isCameraEnabled(): boolean {
    return this.cameraEnabled;
  }

  /**
   * Check if microphone is enabled
   */
  isMicEnabled(): boolean {
    return this.micEnabled;
  }

  /**
   * Check if hand is raised
   */
  isHandRaisedStatus(): boolean {
    return this.isHandRaised;
  }

  /**
   * Check if screen sharing is active
   */
  isScreenSharingActive(): boolean {
    return this.isScreenSharing;
  }
}

export default Publisher;
