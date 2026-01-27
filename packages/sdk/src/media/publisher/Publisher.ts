import EventEmitter from "../../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../../events/GlobalEventBus";
import {
  PublisherConfig,
  StreamInfo,
  ServerEvent,
  SubStream,
  ParticipantPermissions,
  ChannelName,
  PinType,
} from '../../types';
import { getSubStreams, MEETING_EVENTS } from '../../constants';
import { WebTransportManager } from "./transports/WebTransportManager";
import { WebRTCManager } from "./transports/WebRTCManager";
import { StreamManager } from "./transports/StreamManager";
import { VideoEncoderManager } from "./managers/VideoEncoderManager";
import { AudioEncoderManager } from "./managers/AudioEncoderManager";
import { AACEncoderManager } from "./managers/AACEncoderManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";
import { LivestreamAudioMixer } from "../audioMixer/LivestreamAudioMixer";
import { log } from "../../utils";
import { SUB_STREAMS } from "../../constants/publisherConstants";

interface PublisherEvents extends Record<string, unknown> {
  statusUpdate: { message: string; isError: boolean };
  streamStart: undefined;
  streamStop: undefined;
  localStreamReady: {
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    type: string;
    streamId?: string;
    config: {
      codec: string;
      width: number;
      height: number;
      framerate: number;
      bitrate: number;
    };
    hasAudio: boolean;
    hasVideo: boolean;
  };
  localScreenShareReady: {
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    streamId?: string;
    config: {
      codec: string;
      width: number;
      height: number;
      framerate: number;
      bitrate: number;
    };
    hasAudio: boolean;
    hasVideo: boolean;
  };
  screenShareStarted: {
    stream: MediaStream;
    hasVideo: boolean;
    hasAudio: boolean;
  };
  screenShareStopped: undefined;
  serverEvent: ServerEvent;
  connected: undefined;
  disconnected: { reason?: string };
  error: unknown;
  mediaStreamReplaced: {
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    hasVideo: boolean;
    hasAudio: boolean;
  };
  // Reconnection events
  streamReconnecting: { attempt: number; maxAttempts: number; delay: number };
  streamReconnected: undefined;
  streamReconnectionFailed: { reason: string };
  connectionHealthChanged: { isHealthy: boolean };
  livestreamStarted: { tabStream: MediaStream; mixedAudioStream: MediaStream };
  livestreamStopped: undefined;
  recordingStarted: { tabStream: MediaStream; mixedAudioStream: MediaStream };
  recordingStopped: undefined;
  tabCaptureError: unknown;
}

export class Publisher extends EventEmitter<PublisherEvents> {
  private options: PublisherConfig;
  private subStreams: SubStream[];
  private hasVideo = false;
  private hasAudio = false;
  private videoEnabled = true;
  private audioEnabled = true;
  private isPublishing = false;
  private isHandRaised = false;
  private currentStream: MediaStream | null = null;
  private webTransportManager: WebTransportManager | null = null;
  private webRtcManager: WebRTCManager | null = null;
  private streamManager: StreamManager | null = null;
  private videoEncoderManager: VideoEncoderManager | null = null;
  private audioEncoderManager: AudioEncoderManager | null = null;
  private videoProcessor: VideoProcessor | null = null;
  private audioProcessor: AudioProcessor | null = null;
  private InitAudioRecorder: any = null;
  private permissions: ParticipantPermissions;

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 10000; // 10 seconds
  private isReconnecting = false;
  private connectionHealthChecker: ReturnType<typeof setInterval> | null = null;

  // Livestream state
  private isLivestreaming = false;
  // Recording state
  private isRecording = false;
  private isCapturingTab = false; // Lock to prevent concurrent tab capture requests
  private recordingPermissionGranted = false; // Indicates if permission was pre-granted via requestRecordingPermissions
  private livestreamVideoProcessor: VideoProcessor | null = null;
  private livestreamAudioProcessor: AudioProcessor | null = null;
  private livestreamVideoEncoderManager: VideoEncoderManager | null = null;
  private livestreamAudioEncoderManager: AACEncoderManager | null = null;
  private livestreamAudioMixer: LivestreamAudioMixer | null = null;
  private tabStream: MediaStream | null = null;
  private mixedAudioStream: MediaStream | null = null;

  constructor(config: PublisherConfig) {
    super();
    this.options = config;
    this.subStreams = getSubStreams(config.streamType || "camera", {
      can_publish: this.options.permissions.can_publish,
      can_publish_sources: this.options.permissions.can_publish_sources,
    });
    this.permissions = this.options.permissions;

    if (config.onStatusUpdate) {
      this.on("statusUpdate", ({ message, isError }) => {
        config.onStatusUpdate!(message, isError);
      });
    }
  }

  async init(): Promise<void> {
    try {
      this.updateStatus("Initializing publisher...");
      await this.loadDependencies();
      this.updateStatus("Publisher initialized");
    } catch (error) {
      console.error("[Publisher] Initialization failed:", error);
      this.updateStatus("Initialization failed", true);
      throw error;
    }
  }

  private async loadDependencies(): Promise<void> {
    try {
      await this.loadPolyfills();
      const audioModule = await import("../../opus_decoder/opusDecoder");

      if (!audioModule || !audioModule.initAudioRecorder) {
        throw new Error("Failed to load initAudioRecorder from opus decoder module");
      }

      this.InitAudioRecorder = audioModule.initAudioRecorder;
      log("[Publisher] Dependencies loaded, initAudioRecorder type:", typeof this.InitAudioRecorder);
    } catch (error) {
      console.error("[Publisher] Failed to load dependencies:", error);
      throw error;
    }
  }

  private async loadPolyfills(): Promise<void> {
    // Only load MSTP polyfill (same as original JS version)
    // MSTG polyfill is loaded by Subscriber when needed
    log("[Publisher] 🔧 loadPolyfills() v2.0 - TypeScript version");
    if (!document.querySelector('script[src*="MSTP_polyfill.js"]')) {
      log("[Publisher] Loading MSTP polyfill from /polyfills/MSTP_polyfill.js");
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/polyfills/MSTP_polyfill.js";
        script.onload = () => {
          log("[Publisher] Polyfill loaded successfully");
          resolve();
        };
        script.onerror = () => reject(new Error("Failed to load MSTP polyfill"));
        document.head.appendChild(script);
      });
    } else {
      log("[Publisher] ℹ️ MSTP polyfill already loaded");
    }
  }

  async startPublishing(): Promise<void> {
    if (this.isPublishing) {
      console.warn("[Publisher] Already publishing");
      return;
    }

    try {
      this.updateStatus("Starting publishing...");

      // Load dependencies if not already loaded
      if (!this.InitAudioRecorder) {
        await this.loadDependencies();
      }

      const stream = await this.getMediaStream();
      this.currentStream = stream;

      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();

      this.hasVideo = videoTracks.length > 0;
      this.hasAudio = audioTracks.length > 0;
      log("[Publisher] hasVideo: ", this.hasVideo);
      log("[Publisher] hasAudio: ", this.hasAudio);
      // Check initial track enabled state from the stream
      // If track exists but is disabled, set our state accordingly
      if (this.hasVideo) {
        this.videoEnabled = videoTracks[0].enabled;
        log("[Publisher] Initial video enabled state:", this.videoEnabled);
      }
      if (this.hasAudio) {
        this.audioEnabled = audioTracks[0].enabled;
        log("[Publisher] Initial audio enabled state:", this.audioEnabled);
      }

      if (this.options.useWebRTC) {
        await this.setupWebRTCConnectionWithRetry();
      } else {
        await this.setupWebTransportConnectionWithRetry();
      }

      await this.initializeProcessors();
      await this.startMediaProcessing();

      this.isPublishing = true;
      this.updateStatus("Publishing started");
      this.emit("streamStart");

      // Send initial state to server so other clients know the mic/camera status
      // This is important when user joins with mic/camera already disabled
      await this.sendInitialState();

      // Start connection health monitoring
      this.startConnectionHealthMonitoring();

      if (this.options.onStreamStart) {
        this.options.onStreamStart();
      }
    } catch (error) {
      console.error("[Publisher] Failed to start publishing:", error);
      this.updateStatus("Failed to start publishing", true);
      await this.stop();
      throw error;
    }
  }

  /**
   * Send initial mic/camera state to server
   * Called after publishing starts to notify other clients of the initial state
   */
  private async sendInitialState(): Promise<void> {
    try {
      // Send camera state if video is available
      if (this.hasVideo) {
        const cameraEvent = this.videoEnabled ? MEETING_EVENTS.CAMERA_ON : MEETING_EVENTS.CAMERA_OFF;
        await this.sendMeetingEvent(cameraEvent);
        log("[Publisher] Sent initial camera state:", this.videoEnabled ? "ON" : "OFF");
      }

      // Send mic state if audio is available
      if (this.hasAudio) {
        const micEvent = this.audioEnabled ? MEETING_EVENTS.MIC_ON : MEETING_EVENTS.MIC_OFF;
        await this.sendMeetingEvent(micEvent);
        log("[Publisher] Sent initial mic state:", this.audioEnabled ? "ON" : "OFF");
      }
    } catch (error) {
      console.error("[Publisher] Failed to send initial state:", error);
      // Don't throw - this is not critical for publishing to work
    }
  }

  private async getMediaStream(): Promise<MediaStream> {
    let stream: MediaStream;

    if (this.options.mediaStream) {
      stream = this.options.mediaStream;
    } else {
      const constraints: MediaStreamConstraints = {};

      if (this.options.hasCamera !== false) {
        constraints.video = {
          width: { ideal: this.options.width || 1280 },
          height: { ideal: this.options.height || 720 },
          frameRate: { ideal: this.options.framerate || 30 },
        };
      }

      if (this.options.hasMic !== false) {
        constraints.audio = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
      }

      const streamType = this.options.streamType || "camera";

      if (streamType === "display") {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: false,
        });

        if (constraints.audio) {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio });
          audioStream.getAudioTracks().forEach(track => displayStream.addTrack(track));
        }

        stream = displayStream;
      } else {
        // Handle case when both mic and camera are unavailable
        if (!constraints.video && !constraints.audio) {
          log("[Publisher] No mic and no camera available, creating empty MediaStream");
          stream = new MediaStream();
        } else {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        }
      }
    }

    // Create video-only stream for UI
    const videoOnlyStream = new MediaStream();
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoOnlyStream.addTrack(videoTracks[0]);
    }

    const audioTracks = stream.getAudioTracks();

    // Check if tracks are enabled (not just present)
    const videoEnabled = videoTracks.length > 0 && videoTracks[0].enabled;
    const audioEnabled = audioTracks.length > 0 && audioTracks[0].enabled;

    const eventData = {
      stream,
      videoOnlyStream,
      type: this.options.streamType || "camera",
      streamId: this.options.streamId,
      config: {
        codec: "avc1.640c34",
        width: this.options.width || 1280,
        height: this.options.height || 720,
        framerate: this.options.framerate || 30,
        bitrate: this.options.bitrate || 2000000,
      },
      hasAudio: audioTracks.length > 0,
      hasVideo: videoTracks.length > 0,
      audioEnabled,
      videoEnabled,
    };

    // Emit to global event bus
    globalEventBus.emit(GlobalEvents.LOCAL_STREAM_READY, eventData);

    return stream;
  }

  private async setupWebTransportConnection(): Promise<void> {
    this.updateStatus("Connecting via WebTransport...");

    this.webTransportManager = new WebTransportManager({
      url: this.options.publishUrl,
    });

    const webTransport = await this.webTransportManager.connect();
    this.streamManager = new StreamManager(false, this.options.streamId);

    // Set publisher state before initializing streams so correct state is sent to server
    this.streamManager.setPublisherState({
      hasMic: this.hasAudio,
      hasCamera: this.hasVideo,
      isMicOn: this.audioEnabled,
      isCameraOn: this.videoEnabled,
    });

    // StreamManager now emits to globalEventBus directly - no need to re-emit
    // Filter channels based on actual device availability
    const channelNames: ChannelName[] = this.subStreams
      .map(s => s.channelName as ChannelName)
      .filter(channelName => {
        // MEETING_CONTROL is always required
        if (channelName === ChannelName.MEETING_CONTROL) return true;
        // MICROPHONE only if we have audio
        if (channelName === ChannelName.MICROPHONE) return this.hasAudio;
        // Video channels only if we have video
        if (channelName === ChannelName.VIDEO_360P || channelName === ChannelName.VIDEO_720P) return this.hasVideo;
        // Allow other channels by default
        return true;
      });

    log("[Publisher] WebTransport channels to initialize (filtered by device availability):", channelNames);

    // Only initialize if there are channels (at minimum MEETING_CONTROL)
    if (channelNames.length === 0) {
      throw new Error("No channels available - at least MEETING_CONTROL should be present");
    }

    await this.streamManager.initWebTransportStreams(webTransport, channelNames);

    this.updateStatus("WebTransport connected");
    this.emit("connected");
    globalEventBus.emit(GlobalEvents.PUBLISHER_CONNECTED, { streamId: this.options.streamId });
  }

  private async setupWebRTCConnection(): Promise<void> {
    this.updateStatus("Connecting via WebRTC...");

    // Use provided webRtcHost or fallback to default (same as JS version)
    const webRtcHost = this.options.webRtcHost;

    if (!webRtcHost) throw new Error("WebRTC host not provided");

    // Initialize StreamManager first
    this.streamManager = new StreamManager(true, this.options.streamId);

    // Set publisher state before initializing streams so correct state is sent to server
    this.streamManager.setPublisherState({
      hasMic: this.hasAudio,
      hasCamera: this.hasVideo,
      isMicOn: this.audioEnabled,
      isCameraOn: this.videoEnabled,
    });

    // StreamManager now emits to globalEventBus directly - no need to re-emit

    // Initialize WebRTCManager to handle multiple connections
    this.webRtcManager = new WebRTCManager(
      webRtcHost,
      this.options.roomId || "",
      this.options.streamId || ""
    );

    // Set WebRTC manager reference for screen share support
    this.streamManager.setWebRTCManager(this.webRtcManager);

    // Get channel names from subStreams, filtered by actual device availability
    const channelNames: ChannelName[] = this.subStreams
      .map(s => s.channelName as ChannelName)
      .filter(channelName => {
        // MEETING_CONTROL is always required
        if (channelName === ChannelName.MEETING_CONTROL) return true;
        // MICROPHONE only if we have audio
        if (channelName === ChannelName.MICROPHONE) return this.hasAudio;
        // Video channels only if we have video
        if (channelName === ChannelName.VIDEO_360P || channelName === ChannelName.VIDEO_720P) return this.hasVideo;
        // Allow other channels by default
        return true;
      });

    log("[Publisher] Setting up WebRTC for channels (filtered by device availability):", channelNames);

    // Only initialize if there are channels (at minimum MEETING_CONTROL)
    if (channelNames.length === 0) {
      throw new Error("No channels available - at least MEETING_CONTROL should be present");
    }

    // Connect all channels (WebRTCManager handles creating multiple peer connections)
    await this.webRtcManager.connectMultipleChannels(channelNames, this.streamManager);

    this.updateStatus("WebRTC connected");
    this.emit("connected");
    globalEventBus.emit(GlobalEvents.PUBLISHER_CONNECTED, { streamId: this.options.streamId });
  }

  private async initializeProcessors(): Promise<void> {
    if (!this.currentStream || !this.streamManager) {
      throw new Error("Stream or StreamManager not initialized");
    }

    if (this.hasVideo) {
      this.videoEncoderManager = new VideoEncoderManager();
      this.videoProcessor = new VideoProcessor(
        this.videoEncoderManager,
        this.streamManager,
        this.subStreams as any
      );

      this.videoProcessor.on("encoderError", (error) => {
        console.error("[Publisher] Video encoder error:", error);
        this.updateStatus("Video encoder error", true);
      });

      this.videoProcessor.on("processingError", (error) => {
        console.error("[Publisher] Video processing error:", error);
        this.updateStatus("Video processing error", true);
      });

      log("[Publisher] Video processor initialized");
    }

    if (this.hasAudio) {
      const audioConfig = {
        sampleRate: 48000,
        numberOfChannels: 1,
      };

      if (!this.InitAudioRecorder || typeof this.InitAudioRecorder !== 'function') {
        throw new Error(`InitAudioRecorder is not available or not a function: ${typeof this.InitAudioRecorder}`);
      }

      this.audioEncoderManager = new AudioEncoderManager(
        ChannelName.MICROPHONE,
        audioConfig,
        this.InitAudioRecorder
      );

      this.audioProcessor = new AudioProcessor(
        this.audioEncoderManager,
        this.streamManager,
        ChannelName.MICROPHONE
      );

      this.audioProcessor.on("encoderError", (error) => {
        console.error("[Publisher] Audio encoder error:", error);
        this.updateStatus("Audio encoder error", true);
      });

      log("[Publisher] Audio processor initialized");
    }
  }

  private async startMediaProcessing(): Promise<void> {
    if (!this.currentStream) {
      throw new Error("Media stream not available");
    }

    if (this.hasVideo && this.videoProcessor) {
      const videoTrack = this.currentStream.getVideoTracks()[0];
      if (videoTrack) {
        // Extract actual video dimensions from the track
        const { calculateSubStreamResolutions, getVideoTrackDimensions } = await import('../../utils/videoResolutionHelper');
        const actualDimensions = getVideoTrackDimensions(videoTrack);

        if (actualDimensions) {
          const { width: actualWidth, height: actualHeight } = actualDimensions;
          log("[Publisher] Actual video track dimensions:", `${actualWidth}x${actualHeight}`);

          // Calculate proportional resolutions for 360p and 720p
          const { video360p, video720p } = calculateSubStreamResolutions(actualWidth, actualHeight);

          // Update subStreams with calculated dimensions
          this.subStreams = this.subStreams.map(subStream => {
            if (subStream.channelName === ChannelName.VIDEO_360P) {
              return {
                ...subStream,
                width: video360p.width,
                height: video360p.height
              };
            }
            if (subStream.channelName === ChannelName.VIDEO_720P) {
              return {
                ...subStream,
                width: video720p.width,
                height: video720p.height
              };
            }
            return subStream;
          });

          // Re-initialize VideoProcessor with updated subStreams
          this.videoProcessor = new VideoProcessor(
            this.videoEncoderManager!,
            this.streamManager!,
            this.subStreams as any
          );

          this.videoProcessor.on("encoderError", (error) => {
            console.error("[Publisher] Video encoder error:", error);
            this.updateStatus("Video encoder error", true);
          });

          this.videoProcessor.on("processingError", (error) => {
            console.error("[Publisher] Video processing error:", error);
            this.updateStatus("Video processing error", true);
          });
        } else {
          log("[Publisher] Could not get actual video dimensions, using default subStreams config");
        }

        const baseConfig = {
          codec: "avc1.640c34",
          width: this.options.width || 1280,
          height: this.options.height || 720,
          framerate: this.options.framerate || 30,
          bitrate: this.options.bitrate || 2000000,
        };

        await this.videoProcessor.initialize(videoTrack, baseConfig);
        await this.videoProcessor.start();
        log("[Publisher] Video processing started");
      }
    }

    if (this.hasAudio && this.audioProcessor) {
      const audioTrack = this.currentStream.getAudioTracks()[0];
      if (audioTrack) {
        const audioStream = new MediaStream([audioTrack]);
        await this.audioProcessor.initialize(audioStream);
        await this.audioProcessor.start();
        log("[Publisher] Audio processing started");
      }
    }
  }

  async toggleVideo(): Promise<void> {
    if (this.videoEnabled) {
      await this.turnOffVideo();
    } else {
      await this.turnOnVideo();
    }
  }

  async turnOffVideo(): Promise<void> {
    if (!this.hasVideo || !this.videoProcessor) return;

    this.videoProcessor.setCameraEnabled(false);
    this.videoEnabled = false;

    const eventType = this.options.streamType === "display" ? MEETING_EVENTS.STOP_SCREEN_SHARE : MEETING_EVENTS.CAMERA_OFF;
    await this.sendMeetingEvent(eventType);

  }

  async turnOnVideo(): Promise<void> {
    if (!this.hasVideo || !this.videoProcessor) return;

    this.videoProcessor.setCameraEnabled(true);
    this.videoEnabled = true;

    const eventType = this.options.streamType === "display" ? MEETING_EVENTS.START_SCREEN_SHARE : MEETING_EVENTS.CAMERA_ON;
    await this.sendMeetingEvent(eventType);

  }

  async toggleAudio(): Promise<void> {
    if (this.audioEnabled) {
      await this.turnOffAudio();
    } else {
      await this.turnOnAudio();
    }
  }

  async turnOffAudio(): Promise<void> {
    if (!this.hasAudio || !this.audioProcessor) return;

    this.audioProcessor.setMicEnabled(false);
    this.audioEnabled = false;
    await this.sendMeetingEvent(MEETING_EVENTS.MIC_OFF);

  }

  async turnOnAudio(): Promise<void> {
    if (!this.hasAudio || !this.audioProcessor) return;

    this.audioProcessor.setMicEnabled(true);
    this.audioEnabled = true;
    await this.sendMeetingEvent(MEETING_EVENTS.MIC_ON);

  }

  async toggleMic(): Promise<void> {
    return this.toggleAudio();
  }

  async toggleCamera(): Promise<void> {
    return this.toggleVideo();
  }

  /**
   * Get current video enabled state
   */
  isVideoOn(): boolean {
    return this.videoEnabled;
  }

  /**
   * Get current audio enabled state
   */
  isAudioOn(): boolean {
    return this.audioEnabled;
  }

  async switchVideoDevice(deviceId: string): Promise<{ videoOnlyStream: MediaStream } | null> {
    if (!this.hasVideo || !this.videoProcessor) {
      throw new Error("Video not available");
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        await this.videoProcessor.switchCamera(newVideoTrack);

        const oldVideoTrack = this.currentStream?.getVideoTracks()[0];
        if (oldVideoTrack) {
          this.currentStream?.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }
        this.currentStream?.addTrack(newVideoTrack);

        log("[Publisher] Video device switched");

        const videoOnlyStream = new MediaStream([newVideoTrack]);
        return { videoOnlyStream };
      }
      return null;
    } catch (error) {
      console.error("[Publisher] Failed to switch video device:", error);
      throw error;
    }
  }

  async switchAudioDevice(deviceId: string): Promise<void> {
    if (!this.hasAudio || !this.audioProcessor) {
      throw new Error("Audio not available");
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      if (newAudioTrack) {
        await this.audioProcessor.switchAudioTrack(newAudioTrack);

        const oldAudioTrack = this.currentStream?.getAudioTracks()[0];
        if (oldAudioTrack) {
          this.currentStream?.removeTrack(oldAudioTrack);
          oldAudioTrack.stop();
        }
        this.currentStream?.addTrack(newAudioTrack);

        log("[Publisher] Audio device switched");
      }
    } catch (error) {
      console.error("[Publisher] Failed to switch audio device:", error);
      throw error;
    }
  }

  async raiseHand(): Promise<void> {
    if (this.isHandRaised) return;

    this.isHandRaised = true;
    await this.sendMeetingEvent(MEETING_EVENTS.RAISE_HAND);
  }

  async lowerHand(): Promise<void> {
    if (!this.isHandRaised) return;

    this.isHandRaised = false;
    await this.sendMeetingEvent(MEETING_EVENTS.LOWER_HAND);
  }
  async pinForEveryone(targetStreamId: string, pinType: PinType = PinType.User): Promise<void> {
    await this.sendMeetingEvent(MEETING_EVENTS.PIN_FOR_EVERYONE, {
      target_stream_id: targetStreamId,
      pin_type: pinType,
    });
  }
  async unPinForEveryone(targetStreamId: string, pinType: PinType = PinType.User): Promise<void> {
    await this.sendMeetingEvent(MEETING_EVENTS.UNPIN_FOR_EVERYONE, {
      target_stream_id: targetStreamId,
      pin_type: pinType,
    });
  }
  private async sendMeetingEvent(eventType: string, data?: any): Promise<void> {
    if (!this.streamManager) {
      console.warn("[Publisher] StreamManager not initialized");
      return;
    }
    // Spread data fields at top level (server expects has_audio, has_video at top level, not nested in data)
    const event = {
      type: eventType,
      sender_stream_id: this.options.streamId || "",
      timestamp: Date.now(),
      ...(data || {}),
    };
    console.warn(`[Publisher] 📤 Sending meeting event:`, JSON.stringify(event, null, 2));
    await this.streamManager.sendEvent(event);
  }

  /**
   * Wait for config to be sent for a specific channel
   * @param channelName - Channel to wait for config
   * @param timeout - Timeout in milliseconds (default 10000ms)
   */
  private async waitForConfigSent(channelName: ChannelName, timeout = 2000): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }

    // Check if already sent
    if (this.streamManager.isConfigSent(channelName)) {
      log(`[Publisher] Config already sent for ${channelName}`);
      return;
    }

    log(`[Publisher] Waiting for config to be sent for ${channelName}...`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 100; // Check every 100ms

      const intervalId = setInterval(() => {
        if (this.streamManager?.isConfigSent(channelName)) {
          clearInterval(intervalId);
          log(`[Publisher] Config sent for ${channelName} after ${Date.now() - startTime}ms`);
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(intervalId);
          reject(new Error(`Timeout waiting for config to be sent for ${channelName}`));
        }
      }, checkInterval);
    });
  }

  /// send custom event to specific targets
  /// targets = [] => send to whole room
  /// targets = ['streamId1', 'streamId2'] => send to specific stream ids
  async sendCustomEvent(targets: string[], eventData: any): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }

    await this.streamManager.sendCustomEvent(targets, eventData);
  }

  async stop(): Promise<void> {
    // Always attempt cleanup regardless of isPublishing state to ensure no resources leak (like heartbeat)

    try {
      this.updateStatus("Stopping publisher...");

      // Stop connection health monitoring
      this.stopConnectionHealthMonitoring();

      // Stop heartbeat immediately to prevent errors during cleanup
      if (this.streamManager) {
        this.streamManager.stopHeartbeat();
      }

      // Stop livestream first if active
      if (this.isLivestreaming) {
        await this.stopLivestream();
      }



      if (this.videoProcessor) {
        await this.videoProcessor.stop();
        this.videoProcessor = null;
      }

      if (this.audioProcessor) {
        await this.audioProcessor.stop();
        this.audioProcessor = null;
      }

      if (this.videoEncoderManager) {
        await this.videoEncoderManager.closeAll();
        this.videoEncoderManager = null;
      }

      if (this.audioEncoderManager) {
        await this.audioEncoderManager.stop();
        this.audioEncoderManager = null;
      }

      if (this.webTransportManager) {
        await this.webTransportManager.close();
        this.webTransportManager = null;
      }

      if (this.webRtcManager) {
        await this.webRtcManager.close();
        this.webRtcManager = null;
      }

      if (this.currentStream) {
        this.currentStream.getTracks().forEach(track => track.stop());
        this.currentStream = null;
      }

      this.updateStatus("Publisher stopped");
      this.emit("streamStop");

      if (this.options.onStreamStop) {
        this.options.onStreamStop();
      }

      log("[Publisher] Stopped successfully");
    } catch (error: any) {
      console.error("[Publisher] Error during stop:", error);
      this.updateStatus("Error stopping publisher", true);
    } finally {
      this.isPublishing = false;
    }
  }

  async sendEvent(eventData: any): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }
    await this.streamManager.sendEvent(eventData);
  }

  /**
   * Reconnect streams for channels that were unbanned
   * Called when local participant receives update_permission event with allowed: true
   * 
   * When banned, server sends STOP_SENDING to close the stream but the stream still exists
   * on client side. We need to close the old stream and create a new one.
   * 
   * @param channelNames - Array of channel names to reconnect (e.g., ["mic_48k", "video_360p", "video_720p"])
   */
  async reconnectStreams(channelNames: ChannelName[]): Promise<void> {
    if (!this.isPublishing || !this.streamManager) {
      log("[Publisher] Cannot reconnect streams - not publishing or no stream manager");
      return;
    }

    try {
      log("[Publisher] 🔄 Reconnecting streams for channels:", channelNames);

      if (this.options.useWebRTC) {
        // WebRTC: DON'T close data channels - server interprets channel close as participant leaving
        // Instead, check if channels are still open and just reset config state
        const channelsToRecreate: ChannelName[] = [];

        for (const channelName of channelNames) {
          const stream = this.streamManager.getStream(channelName);
          if (stream?.dataChannel?.readyState === 'open') {
            // Data channel is still open - just reset config and resend
            log(`[Publisher] WebRTC channel ${channelName} is still open, resetting config only`);
            this.streamManager.resetConfigSent(channelName);
          } else {
            // Data channel is closed/errored - need to recreate
            log(`[Publisher] WebRTC channel ${channelName} needs full reconnection`);
            channelsToRecreate.push(channelName);
          }
        }

        // Only recreate channels that need it
        if (channelsToRecreate.length > 0 && this.webRtcManager) {
          log("[Publisher] Recreating WebRTC channels:", channelsToRecreate);
          await this.webRtcManager.connectMultipleChannels(channelsToRecreate, this.streamManager);
          log("[Publisher] ✅ WebRTC channels recreated");
        }
      } else {
        // WebTransport: Close and recreate streams (server handles this correctly)
        for (const channelName of channelNames) {
          if (this.streamManager.isStreamReady(channelName)) {
            log(`[Publisher] Closing old stream ${channelName} before reconnecting...`);
            await this.streamManager.closeStream(channelName);
          }
        }

        log("[Publisher] Channels to reconnect:", channelNames);

        // WebTransport: reconnect via WebTransportManager
        if (this.webTransportManager) {
          const webTransport = this.webTransportManager.getTransport();
          if (webTransport) {
            await this.streamManager.initWebTransportStreams(webTransport, channelNames);
            log("[Publisher] ✅ WebTransport streams reconnected");
          } else {
            // WebTransport connection lost, need full reconnect
            log("[Publisher] ⚠️ WebTransport connection lost, attempting full reconnect...");
            await this.webTransportManager.close();
            const newWebTransport = await this.webTransportManager.connect();
            await this.streamManager.initWebTransportStreams(newWebTransport, channelNames);
            log("[Publisher] ✅ WebTransport fully reconnected");
          }
        }
      }

      // Resend config for reconnected channels
      // Audio config
      if (channelNames.includes(ChannelName.MICROPHONE) && this.audioProcessor && this.audioEncoderManager) {
        log("[Publisher] Resending audio config...");
        // Manually resend saved audio config
        await this.audioProcessor.resendConfig();
      }

      // Video config - resend saved config directly
      const videoChannels = channelNames.filter(
        (ch: ChannelName) => ch === ChannelName.VIDEO_360P || ch === ChannelName.VIDEO_720P
      );
      if (videoChannels.length > 0 && this.videoProcessor) {
        log("[Publisher] Video channels reconnected, resending config...");
        // Resend saved config and request keyframe
        await this.videoProcessor.requestKeyframe();
      }

      this.updateStatus("Streams reconnected");
    } catch (error) {
      console.error("[Publisher] Failed to reconnect streams:", error);
      this.updateStatus("Failed to reconnect streams", true);
      throw error;
    }
  }

  /**
   * Update permissions and reconnect streams if needed
   * Called when local participant's permissions change
   * 
   * @param permissionChanged - Changed permissions from server
   */
  async handlePermissionChange(permissionChanged: {
    can_publish_sources?: Array<[string, boolean]>;
  }): Promise<void> {
    if (!permissionChanged.can_publish_sources) {
      return;
    }

    // Find channels that were just unbanned (changed from false to true)
    const channelsToReconnect: ChannelName[] = [];

    for (const [channel, allowed] of permissionChanged.can_publish_sources) {
      if (allowed) {
        // Channel was unbanned, need to reconnect
        channelsToReconnect.push(channel as ChannelName);
        log(`[Publisher] Channel ${channel} was unbanned, will reconnect`);
      } else {
        log(`[Publisher] Channel ${channel} was banned`);
        // Note: We don't need to do anything when banned - server will reject packets
      }
    }

    if (channelsToReconnect.length > 0) {
      await this.reconnectStreams(channelsToReconnect);
    }
  }

  // ========== Screen Sharing Methods ==========

  private screenStream: MediaStream | null = null;
  private screenVideoProcessor: VideoProcessor | null = null;
  private screenAudioProcessor: AudioProcessor | null = null;
  private screenVideoEncoderManager: VideoEncoderManager | null = null;
  private isScreenSharing = false;

  async startShareScreen(screenMediaStream: MediaStream): Promise<void> {
    if (this.isScreenSharing) {
      this.updateStatus("Already sharing screen", true);
      return;
    }

    if (!this.streamManager) {
      throw new Error("Connection not established. Start publishing first.");
    }

    if (!screenMediaStream || !(screenMediaStream instanceof MediaStream)) {
      throw new Error("Invalid screen MediaStream provided");
    }

    try {
      this.screenStream = screenMediaStream;

      // Validate stream has tracks
      const hasVideo = this.screenStream.getVideoTracks().length > 0;
      const hasAudio = this.screenStream.getAudioTracks().length > 0;

      if (!hasVideo) {
        throw new Error("Screen stream must have at least a video track");
      }

      console.warn(`[Publisher] Screen share stream - Video: ${hasVideo}, Audio: ${hasAudio}`);

      // Handle screen share stop when user stops from browser UI
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log("[Publisher] Screen share stopped by user");
          this.stopShareScreen();
        };
      }

      this.isScreenSharing = true;


      await this.streamManager.addStream(ChannelName.SCREEN_SHARE_720P);

      if (hasAudio) {
        await this.streamManager.addStream(ChannelName.SCREEN_SHARE_AUDIO);
      }

      // Wait for data channels to be ready before starting video capture
      await this.streamManager.waitForStreamReady(ChannelName.SCREEN_SHARE_720P);
      if (hasAudio) {
        await this.streamManager.waitForStreamReady(ChannelName.SCREEN_SHARE_AUDIO);
      }

      await this.startScreenVideoCapture();

      // Start audio if available
      if (hasAudio) {
        await this.startScreenAudioStreaming();
      }

      // Wait for video config to be sent before announcing screen share
      log(`[Publisher] Waiting for screen share video config to be sent...`);
      await this.waitForConfigSent(ChannelName.SCREEN_SHARE_720P, 2000);
      log(`[Publisher] Screen share video config sent successfully`);

      // Also wait for audio config if we have audio
      if (hasAudio) {
        log(`[Publisher] Waiting for screen share audio config to be sent...`);
        await this.waitForConfigSent(ChannelName.SCREEN_SHARE_AUDIO, 2000);
        log(`[Publisher] Screen share audio config sent successfully`);
      }

      // Send event with has_audio so subscribers know whether to subscribe to audio
      console.warn(`[Publisher] Sending START_SCREEN_SHARE event with has_audio: ${hasAudio}`);


      // Create video-only stream for UI (similar to localStreamReady)
      const videoOnlyStream = new MediaStream();
      const videoTracks = this.screenStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      const screenShareData = {
        stream: this.screenStream,
        videoOnlyStream,
        streamId: this.options.streamId,
        config: {
          codec: "avc1.640c34",
          width: 1280,
          height: 720,
          framerate: 20,
          bitrate: 1000000,
        },
        hasAudio,
        hasVideo,
      };
      log("[Publisher] Screen share data: ", screenShareData);
      // Emit to global event bus
      globalEventBus.emit(GlobalEvents.LOCAL_SCREEN_SHARE_READY, screenShareData);

      // Also emit screenShareStarted for backward compatibility
      this.emit("screenShareStarted", {
        stream: this.screenStream,
        hasVideo,
        hasAudio,
      });
      await this.sendMeetingEvent(MEETING_EVENTS.START_SCREEN_SHARE, {
        has_audio: hasAudio,
      });

      // If livestreaming and screen share has audio, add it to the livestream mix
      if (this.isLivestreaming && hasAudio && this.livestreamAudioMixer && this.screenStream) {
        log("[Publisher] Adding screen share audio to active livestream mix");
        const screenAudioStream = new MediaStream(this.screenStream.getAudioTracks());
        this.livestreamAudioMixer.addScreenShareAudio(screenAudioStream);
      }

      this.updateStatus(`Screen sharing started (Video: ${hasVideo}, Audio: ${hasAudio})`);

    } catch (error) {
      this.updateStatus(`Failed to start screen sharing: ${error}`, true);
      throw error;
    }
  }

  private async startScreenVideoCapture(): Promise<void> {
    if (!this.screenStream || !this.streamManager) return;

    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Initialize video encoder manager for screen share
    const screenSubStreams = getSubStreams("screen_share", {
      can_publish: this.options.permissions.can_publish,
      can_publish_sources: this.options.permissions.can_publish_sources,
    });
    this.screenVideoEncoderManager = new VideoEncoderManager();

    // Create video processor for screen share
    this.screenVideoProcessor = new VideoProcessor(
      this.screenVideoEncoderManager,
      this.streamManager,
      screenSubStreams as any
    );

    this.screenVideoProcessor.on("encoderError", (error) => {
      console.error("[Publisher] Screen video encoder error:", error);
      this.updateStatus("Screen video encoder error", true);
    });

    this.screenVideoProcessor.on("processingError", (error) => {
      console.error("[Publisher] Screen video processing error:", error);
      this.updateStatus("Screen video processing error", true);
    });

    // Initialize and start video processing
    const baseConfig = {
      codec: "avc1.640c34",
      width: 1280,
      height: 720,
      framerate: 20, // Lower framerate for screen share
      bitrate: 1000000, // 1 Mbps for screen share
    };

    await this.screenVideoProcessor.initialize(videoTrack, baseConfig);
    await this.screenVideoProcessor.start();

    log("[Publisher] Screen video processing started");
  }

  private async startScreenAudioStreaming(): Promise<void> {
    if (!this.screenStream || !this.streamManager) return;

    const audioTrack = this.screenStream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (!this.InitAudioRecorder || typeof this.InitAudioRecorder !== 'function') {
      throw new Error(`InitAudioRecorder is not available for screen audio`);
    }

    const audioConfig = {
      sampleRate: 48000,
      numberOfChannels: 1,
    };

    // Create audio encoder manager for screen share audio
    const screenAudioEncoderManager = new AudioEncoderManager(
      ChannelName.SCREEN_SHARE_AUDIO,
      audioConfig,
      this.InitAudioRecorder
    );

    // Create audio processor for screen share
    this.screenAudioProcessor = new AudioProcessor(
      screenAudioEncoderManager,
      this.streamManager,
      ChannelName.SCREEN_SHARE_AUDIO
    );

    this.screenAudioProcessor.on("encoderError", (error) => {
      console.error("[Publisher] Screen audio encoder error:", error);
      this.updateStatus("Screen audio encoder error", true);
    });

    // Initialize with screen audio stream
    const screenAudioStream = new MediaStream([audioTrack]);
    await this.screenAudioProcessor.initialize(screenAudioStream);
    await this.screenAudioProcessor.start();

    log("[Publisher] Screen audio processing started");
  }

  async stopShareScreen(): Promise<void> {
    if (!this.isScreenSharing) return;

    try {
      this.isScreenSharing = false;

      // Stop video processor
      if (this.screenVideoProcessor) {
        await this.screenVideoProcessor.stop();
        this.screenVideoProcessor = null;
      }

      // Close video encoder manager
      if (this.screenVideoEncoderManager) {
        await this.screenVideoEncoderManager.closeAll();
        this.screenVideoEncoderManager = null;
      }

      // Stop audio processor
      if (this.screenAudioProcessor) {
        await this.screenAudioProcessor.stop();
        this.screenAudioProcessor = null;
      }

      // Stop stream tracks
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }

      // Send STOP_SCREEN_SHARE event
      await this.sendMeetingEvent(MEETING_EVENTS.STOP_SCREEN_SHARE);

      // If livestreaming, remove screen share audio from the mix
      if (this.isLivestreaming && this.livestreamAudioMixer) {
        log("[Publisher] Removing screen share audio from livestream mix");
        this.livestreamAudioMixer.removeScreenShareAudio();
      }

      this.updateStatus("Screen sharing stopped");

      // Emit to global event bus so Room can update state
      globalEventBus.emit(GlobalEvents.SCREEN_SHARE_STOPPED);

      // Emit event for backward compatibility
      this.emit("screenShareStopped");

    } catch (error) {
      this.updateStatus(`Error stopping screen share: ${error}`, true);
      throw error;
    }
  }

  async replaceMediaStream(newStream: MediaStream): Promise<{
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    hasVideo: boolean;
    hasAudio: boolean;
  }> {
    if (!this.isPublishing) {
      throw new Error("Not currently publishing");
    }

    if (!newStream || !(newStream instanceof MediaStream)) {
      throw new Error("Invalid MediaStream provided");
    }

    try {
      log("[Publisher] Replacing media stream...");
      this.updateStatus("Replacing media stream...");

      const videoTracks = newStream.getVideoTracks();
      const audioTracks = newStream.getAudioTracks();
      const hasVideo = videoTracks.length > 0;
      const hasAudio = audioTracks.length > 0;

      if (!hasVideo && !hasAudio) {
        throw new Error("MediaStream has no tracks");
      }

      const oldStream = this.currentStream;
      this.currentStream = newStream;

      // Update flags
      this.hasVideo = hasVideo;
      this.hasAudio = hasAudio;
      this.videoEnabled = hasVideo;
      this.audioEnabled = hasAudio;

      // Restart video processor with new track
      if (hasVideo && this.videoProcessor) {
        log("[Publisher] Switching video track...");
        await this.videoProcessor.switchCamera(videoTracks[0]);
      }

      // Restart audio processor with new track
      if (hasAudio && this.audioProcessor) {
        log("[Publisher] Switching audio track...");
        await this.audioProcessor.switchAudioTrack(audioTracks[0]);
      }

      // Clean up old stream
      if (oldStream) {
        log("[Publisher] Cleaning up old stream...");
        oldStream.getTracks().forEach((track) => track.stop());
      }

      // Create video-only stream
      const videoOnlyStream = new MediaStream();
      if (hasVideo) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      // Emit event
      this.emit("mediaStreamReplaced", {
        stream: this.currentStream,
        videoOnlyStream,
        hasVideo,
        hasAudio,
      });

      log("[Publisher] Media stream replaced successfully");
      this.updateStatus("Media stream replaced successfully");

      return {
        stream: this.currentStream,
        videoOnlyStream,
        hasVideo,
        hasAudio,
      };
    } catch (error) {
      console.error("[Publisher] Failed to replace media stream:", error);
      this.updateStatus("Failed to replace media stream", true);
      throw error;
    }
  }

  private updateStatus(message: string, isError: boolean = false): void {
    log(`[Publisher] ${message}`);
    this.emit("statusUpdate", { message, isError });
  }

  get isActive(): boolean {
    return this.isPublishing;
  }

  get streamInfo(): StreamInfo | null {
    if (!this.isPublishing) return null;

    return {
      streamType: this.options.streamType || "camera",
      config: {
        codec: "avc1.640c34",
        width: this.options.width || 1280,
        height: this.options.height || 720,
        framerate: this.options.framerate || 30,
        bitrate: this.options.bitrate || 2000000,
      },
      sequenceNumber: 0,
      activeStreams: this.subStreams.map(s => s.channelName),
    };
  }

  get mediaStream(): MediaStream | null {
    return this.currentStream;
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
   * Setup WebTransport connection with retry logic
   */
  private async setupWebTransportConnectionWithRetry(): Promise<void> {
    let lastError: Error | null = null;
    this.reconnectAttempts = 0;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await this.setupWebTransportConnection();
        this.reconnectAttempts = 0;
        if (this.isReconnecting) {
          this.emit("streamReconnected");
          globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTED, { streamId: this.options.streamId });
          log("[Publisher] ✅ WebTransport reconnection successful");
        }
        return;
      } catch (error) {
        lastError = error as Error;
        this.reconnectAttempts++;

        log(`[Publisher] ❌ WebTransport connection failed (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          break;
        }

        const delay = this.calculateBackoffDelay();
        this.emit("streamReconnecting", {
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTING, {
          streamId: this.options.streamId,
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        this.updateStatus(`Reconnecting WebTransport (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        await this.delay(delay);
      }
    }

    this.emit("streamReconnectionFailed", { reason: lastError?.message || "Unknown error" });
    globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTION_FAILED, {
      streamId: this.options.streamId,
      reason: lastError?.message || "Unknown error",
    });
    this.updateStatus("WebTransport reconnection failed", true);
    throw lastError;
  }

  /**
   * Setup WebRTC connection with retry logic
   */
  private async setupWebRTCConnectionWithRetry(): Promise<void> {
    let lastError: Error | null = null;
    this.reconnectAttempts = 0;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await this.setupWebRTCConnection();
        this.reconnectAttempts = 0;
        if (this.isReconnecting) {
          this.emit("streamReconnected");
          globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTED, { streamId: this.options.streamId });
          log("[Publisher] ✅ WebRTC reconnection successful");
        }
        return;
      } catch (error) {
        lastError = error as Error;
        this.reconnectAttempts++;

        log(`[Publisher] ❌ WebRTC connection failed (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          break;
        }

        const delay = this.calculateBackoffDelay();
        this.emit("streamReconnecting", {
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTING, {
          streamId: this.options.streamId,
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          delay,
        });
        this.updateStatus(`Reconnecting WebRTC (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        await this.delay(delay);
      }
    }

    this.emit("streamReconnectionFailed", { reason: lastError?.message || "Unknown error" });
    globalEventBus.emit(GlobalEvents.PUBLISHER_RECONNECTION_FAILED, {
      streamId: this.options.streamId,
      reason: lastError?.message || "Unknown error",
    });
    this.updateStatus("WebRTC reconnection failed", true);
    throw lastError;
  }

  /**
   * Start monitoring connection health
   * Checks every 5 seconds and attempts reconnection if connection is lost
   */
  startConnectionHealthMonitoring(): void {
    if (this.connectionHealthChecker) {
      return; // Already monitoring
    }

    log("[Publisher] Starting connection health monitoring");
    let wasHealthy = true;

    this.connectionHealthChecker = setInterval(async () => {
      if (!this.isPublishing || this.isReconnecting) {
        return;
      }

      const isHealthy = this.checkConnectionHealth();

      // Emit health change event if status changed
      if (isHealthy !== wasHealthy) {
        this.emit("connectionHealthChanged", { isHealthy });
        globalEventBus.emit(GlobalEvents.PUBLISHER_CONNECTION_HEALTH_CHANGED, {
          streamId: this.options.streamId,
          isHealthy,
        });
        wasHealthy = isHealthy;
      }

      if (!isHealthy) {
        log("[Publisher] ⚠️ Connection health check failed, attempting reconnection...");
        await this.handleConnectionFailure();
      }
    }, 5000);
  }

  /**
   * Stop connection health monitoring
   */
  stopConnectionHealthMonitoring(): void {
    if (this.connectionHealthChecker) {
      clearInterval(this.connectionHealthChecker);
      this.connectionHealthChecker = null;
      log("[Publisher] Connection health monitoring stopped");
    }
  }

  /**
   * Check if the current connection is healthy
   */
  private checkConnectionHealth(): boolean {
    // If we're not publishing (e.g. stopped), we don't consider connection unhealthy
    if (!this.isPublishing) return true;

    if (this.options.useWebRTC) {
      // Check if WebRTC manager exists and has connected peer connections
      if (!this.webRtcManager) return false;
      return this.webRtcManager.isRTCConnected();
    } else {
      // Check if WebTransport is connected
      if (!this.webTransportManager) return false;
      return this.webTransportManager.isTransportConnected();
    }
  }

  /**
   * Handle connection failure - attempt to reconnect
   */
  private async handleConnectionFailure(): Promise<void> {
    if (this.isReconnecting) {
      log("[Publisher] Already reconnecting, skipping...");
      return;
    }

    if (!this.isPublishing) {
      log("[Publisher] Publisher stopped, skipping reconnection");
      return;
    }

    this.isReconnecting = true;
    this.updateStatus("Connection lost, reconnecting...");

    try {
      await this.reconnect();
      this.updateStatus("Reconnected successfully");
    } catch (error) {
      console.error("[Publisher] Reconnection failed:", error);
      this.updateStatus("Reconnection failed", true);
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Stop media processing (for reconnection)
   */
  private async stopProcessing(): Promise<void> {
    // Stop heartbeat first to prevent errors during cleanup
    if (this.streamManager) {
      this.streamManager.stopHeartbeat();
    }

    if (this.videoProcessor) {
      await this.videoProcessor.stop();
    }

    if (this.audioProcessor) {
      await this.audioProcessor.stop();
    }
  }

  /**
   * Reconnect publisher - full connection re-establishment
   * Can be called manually or automatically by health monitor
   */
  async reconnect(): Promise<void> {
    if (!this.isPublishing) {
      throw new Error("Cannot reconnect - not currently publishing");
    }

    log("[Publisher] 🔄 Starting reconnection process...");
    this.isReconnecting = true;
    this.reconnectAttempts = 0;

    try {
      // Stop current processing
      await this.stopProcessing();

      // Close current transport connections
      if (this.webTransportManager) {
        await this.webTransportManager.close();
        this.webTransportManager = null;
      }

      if (this.webRtcManager) {
        await this.webRtcManager.close();
        this.webRtcManager = null;
      }

      this.streamManager = null;

      // Small delay before reconnecting
      await this.delay(500);

      // Reconnect transport with retry
      if (this.options.useWebRTC) {
        await this.setupWebRTCConnectionWithRetry();
      } else {
        await this.setupWebTransportConnectionWithRetry();
      }

      // Re-initialize processors
      await this.initializeProcessors();

      // Restart media processing
      await this.startMediaProcessing();

      // Send initial state to sync with server
      await this.sendInitialState();

      log("[Publisher] ✅ Reconnection completed successfully");
      this.emit("connected");
    } catch (error) {
      console.error("[Publisher] ❌ Reconnection failed:", error);
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
    log("[Publisher] Reconnection config updated:", {
      maxAttempts: this.maxReconnectAttempts,
      baseDelay: this.baseReconnectDelay,
      maxDelay: this.maxReconnectDelay,
    });
  }

  // ==========================================
  // LIVESTREAM METHODS
  // ==========================================

  /**
   * Start livestreaming - captures current tab and mixes audio
   * Uses the existing connection to publish on LIVESTREAM_VIDEO and LIVESTREAM_AUDIO channels
   */
  async startLivestream(): Promise<void> {
    if (this.isLivestreaming) {
      console.warn("[Publisher] Already livestreaming");
      return;
    }

    if (!this.isPublishing) {
      throw new Error("Publisher must be publishing before starting livestream");
    }

    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }

    try {
      this.updateStatus("Starting livestream...");

      // Check if livestream/recording infrastructure is already set up (channels ready, processors running)
      const needsInfrastructureSetup = !this.isRecording && !this.livestreamVideoEncoderManager;
      if (needsInfrastructureSetup) {
        // If we don't have a stream (no pre-grant), capture it
        if (!this.tabStream) {
          await this.captureCurrentTab();
          if (!this.tabStream) {
            throw new Error("Failed to capture tab stream");
          }
        }

        // Mix audio streams
        await this.setupLivestreamAudioMixing();

        // Add livestream channels using StreamManager (works for both WebRTC and WebTransport)
        log("[Publisher] Adding livestream channels...");
        await this.streamManager.addStream(ChannelName.LIVESTREAM_720P);
        await this.streamManager.addStream(ChannelName.LIVESTREAM_AUDIO);

        // Wait for channels to be ready
        await this.streamManager.waitForStreamReady(ChannelName.LIVESTREAM_720P);
        await this.streamManager.waitForStreamReady(ChannelName.LIVESTREAM_AUDIO);
        log("[Publisher] Livestream channels ready");

        // Initialize processors for livestream
        await this.initializeLivestreamProcessors();

        // Start media processing
        await this.startLivestreamProcessing();
      } else if (this.isRecording) {
        log("[Publisher] Reusing active recording infrastructure for livestream");
        // Ensure tab stream is available (should be if recording, but safety check)
        if (!this.tabStream) {
          await this.captureCurrentTab();
        }
      }

      this.isLivestreaming = true;
      this.updateStatus("Livestream started");

      this.emit("livestreamStarted", {
        tabStream: this.tabStream!,
        mixedAudioStream: this.mixedAudioStream!,
      });
      globalEventBus.emit(GlobalEvents.LIVESTREAM_STARTED, undefined);

      // Send event to server
      await this.sendMeetingEvent(MEETING_EVENTS.START_LIVESTREAM);

      log("[Publisher] Livestream started successfully");
    } catch (error) {
      console.error("[Publisher] Failed to start livestream:", error);
      this.updateStatus("Failed to start livestream", true);
      await this.stopLivestream();
      throw error;
    }
  }

  /**
   * Stop livestreaming
   */
  async stopLivestream(): Promise<void> {
    if (!this.isLivestreaming) return;

    try {
      this.updateStatus("Stopping livestream...");

      // Only cleanup infrastructure if recording is not active
      if (!this.isRecording) {
        // Stop livestream processors
        if (this.livestreamVideoProcessor) {
          await this.livestreamVideoProcessor.stop();
          this.livestreamVideoProcessor = null;
        }

        if (this.livestreamAudioProcessor) {
          await this.livestreamAudioProcessor.stop();
          this.livestreamAudioProcessor = null;
        }

        // Stop encoder managers
        if (this.livestreamVideoEncoderManager) {
          await this.livestreamVideoEncoderManager.closeAll();
          this.livestreamVideoEncoderManager = null;
        }

        if (this.livestreamAudioEncoderManager) {
          await this.livestreamAudioEncoderManager.stop();
          this.livestreamAudioEncoderManager = null;
        }

        // Cleanup audio mixer
        if (this.livestreamAudioMixer) {
          await this.livestreamAudioMixer.cleanup();
          this.livestreamAudioMixer = null;
        }

        // Stop tab stream
        if (this.tabStream) {
          this.tabStream.getTracks().forEach((track) => track.stop());
          this.tabStream = null;
        }

        this.mixedAudioStream = null;
      } else {
        log("[Publisher] Recording is active, keeping infrastructure running");
      }

      this.isLivestreaming = false;

      this.updateStatus("Livestream stopped");
      this.emit("livestreamStopped", undefined);
      globalEventBus.emit(GlobalEvents.LIVESTREAM_STOPPED, undefined);

      // Send event to server
      await this.sendMeetingEvent(MEETING_EVENTS.STOP_LIVESTREAM);

      log("[Publisher] Livestream stopped successfully");
    } catch (error) {
      console.error("[Publisher] Error stopping livestream:", error);
      this.updateStatus("Error stopping livestream", true);
    }
  }

  /**
   * Capture current browser tab
   */
  private async captureCurrentTab(): Promise<void> {
    if (this.tabStream) {
      log("[Publisher] Tab stream already exists, skipping capture");
      return;
    }

    // If permission was pre-granted but stream was lost, request again
    if (this.recordingPermissionGranted && !this.tabStream) {
      log("[Publisher] Permission was granted but stream lost, requesting again");
      const result = await this.requestRecordingPermissions();
      if (!result.granted) {
        throw new Error("Failed to re-acquire tab stream");
      }
      return;
    }

    if (this.isCapturingTab) {
      log("[Publisher] Tab capture already in progress, waiting...");
      const startTime = Date.now();
      while (this.isCapturingTab) {
        if (Date.now() - startTime > 30000) { // 30s timeout
          throw new Error("Timeout waiting for pending tab capture");
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (this.tabStream) {
          log("[Publisher] Tab stream became available from pending capture");
          return;
        }
      }
    }

    this.isCapturingTab = true;
    this.updateStatus("Capturing current tab...");

    try {
      const displayMediaOptions: DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
        selfBrowserSurface?: string;
      } = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15 },
        },
        audio: true,
      };

      // Chrome-specific options for preferring current tab
      displayMediaOptions.preferCurrentTab = true;
      displayMediaOptions.selfBrowserSurface = "include";

      this.tabStream = await navigator.mediaDevices.getDisplayMedia(
        displayMediaOptions as DisplayMediaStreamOptions
      );

      const hasVideo = this.tabStream.getVideoTracks().length > 0;
      const hasAudio = this.tabStream.getAudioTracks().length > 0;

      log(`[Publisher] Tab captured - Video: ${hasVideo}, Audio: ${hasAudio}`);

      if (!hasVideo) {
        throw new Error("Tab capture must have video");
      }

      // Handle tab capture stop (user stops from browser UI)
      const videoTrack = this.tabStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log("[Publisher] Tab capture stopped by user (browser UI)");
          // If livestreaming, stop it
          if (this.isLivestreaming) {
            log("[Publisher] Stopping livestream due to tab capture end");
            this.stopLivestream();
          }
          // If recording, stop it
          if (this.isRecording) {
            log("[Publisher] Stopping recording due to tab capture end");
            this.stopRecording();
          }
        };
      }

      this.updateStatus("Tab captured successfully");
    } catch (error) {
      console.error("[Publisher] Tab capture failed:", error);
      this.emit("tabCaptureError", error);
      throw error;
    } finally {
      this.isCapturingTab = false;
    }
  }

  /**
   * Setup audio mixing (tab audio + mic)
   */
  private async setupLivestreamAudioMixing(): Promise<void> {
    this.updateStatus("Setting up audio mixing...");

    // Initialize audio mixer
    this.livestreamAudioMixer = new LivestreamAudioMixer({
      micVolume: 1.0,
      tabAudioVolume: 1.0,
      screenShareVolume: 1.0,
      debug: false,
    });
    await this.livestreamAudioMixer.initialize();

    // Get tab audio stream (if available)
    let tabAudioStream: MediaStream | null = null;
    if (this.tabStream && this.tabStream.getAudioTracks().length > 0) {
      tabAudioStream = new MediaStream(this.tabStream.getAudioTracks());
    }

    // Mix the audio streams (mic from current stream + tab audio)
    this.mixedAudioStream = await this.livestreamAudioMixer.mixAudioStreams(
      this.currentStream,
      tabAudioStream
    );

    // If currently screen sharing with audio, add it to the mix
    if (this.isScreenSharing && this.screenStream) {
      const screenAudioTracks = this.screenStream.getAudioTracks();
      if (screenAudioTracks.length > 0) {
        log("[Publisher] Adding screen share audio to livestream mix");
        const screenAudioStream = new MediaStream(screenAudioTracks);
        this.livestreamAudioMixer.addScreenShareAudio(screenAudioStream);
      }
    }

    log("[Publisher] Audio mixing setup complete");
  }

  /**
   * Initialize processors for livestream channels
   */
  private async initializeLivestreamProcessors(): Promise<void> {
    if (!this.tabStream || !this.streamManager) {
      throw new Error("Tab stream or StreamManager not initialized");
    }

    // Video processor for livestream
    this.livestreamVideoEncoderManager = new VideoEncoderManager();
    this.livestreamVideoProcessor = new VideoProcessor(
      this.livestreamVideoEncoderManager,
      this.streamManager,
      [SUB_STREAMS.LIVESTREAM_720P] as SubStream[]
    );

    this.livestreamVideoProcessor.on("encoderError", (error) => {
      console.error("[Publisher] Livestream video encoder error:", error);
      this.updateStatus("Livestream video encoder error", true);
    });

    // Audio processor for livestream - use AAC encoder for HLS compatibility
    if (this.mixedAudioStream) {
      const audioConfig = {
        sampleRate: 48000,
        numberOfChannels: 2, // Stereo for better HLS compatibility
      };

      this.livestreamAudioEncoderManager = new AACEncoderManager(
        ChannelName.LIVESTREAM_AUDIO,
        audioConfig
      );

      this.livestreamAudioProcessor = new AudioProcessor(
        this.livestreamAudioEncoderManager as any, // AACEncoderManager has compatible interface
        this.streamManager,
        ChannelName.LIVESTREAM_AUDIO
      );

      this.livestreamAudioProcessor.on("encoderError", (error) => {
        console.error("[Publisher] Livestream audio encoder error:", error);
        this.updateStatus("Livestream audio encoder error", true);
      });
    }

    log("[Publisher] Livestream processors initialized");
  }

  /**
   * Start livestream media processing
   */
  private async startLivestreamProcessing(): Promise<void> {
    if (!this.tabStream) {
      throw new Error("Tab stream not available");
    }

    // Start video processing
    if (this.livestreamVideoProcessor) {
      const videoTrack = this.tabStream.getVideoTracks()[0];
      if (videoTrack) {
        const baseConfig = {
          codec: "avc1.640c34",
          width: 1280,
          height: 720,
          framerate: 15,
          bitrate: 1_500_000,
        };

        await this.livestreamVideoProcessor.initialize(videoTrack, baseConfig);
        await this.livestreamVideoProcessor.start();
        log("[Publisher] Livestream video processing started");
      }
    }

    // Start audio processing
    if (this.livestreamAudioProcessor && this.mixedAudioStream) {
      await this.livestreamAudioProcessor.initialize(this.mixedAudioStream);
      await this.livestreamAudioProcessor.start();
      log("[Publisher] Livestream audio processing started");
    }
  }

  /**
   * Set microphone volume in the livestream mix
   * @param volume - Volume level (0-1)
   */
  setLivestreamMicVolume(volume: number): void {
    if (this.livestreamAudioMixer) {
      this.livestreamAudioMixer.setMicVolume(volume);
    }
  }

  /**
   * Set tab audio volume in the livestream mix
   * @param volume - Volume level (0-1)
   */
  setLivestreamTabAudioVolume(volume: number): void {
    if (this.livestreamAudioMixer) {
      this.livestreamAudioMixer.setTabAudioVolume(volume);
    }
  }

  /**
   * Set screen share audio volume in the livestream mix
   * @param volume - Volume level (0-1)
   */
  setLivestreamScreenShareVolume(volume: number): void {
    if (this.livestreamAudioMixer) {
      this.livestreamAudioMixer.setScreenShareVolume(volume);
    }
  }

  /**
   * Check if currently livestreaming
   */
  get isLivestreamActive(): boolean {
    return this.isLivestreaming;
  }

  /**
   * Get the tab video stream (for preview)
   */
  get livestreamTabStream(): MediaStream | null {
    return this.tabStream;
  }

  // ==========================================
  // === Recording Methods (Independent)    ===
  // ==========================================

  /**
   * Start recording - captures current tab and mixes audio
   * Uses the same channels as livestream (LIVESTREAM_720P, LIVESTREAM_AUDIO)
   * but sends START_RECORD event to server instead of START_LIVESTREAM
   */
  async startRecording(): Promise<void> {
    if (this.isRecording) {
      console.warn("[Publisher] Already recording");
      return;
    }

    if (!this.isPublishing) {
      throw new Error("Publisher must be publishing before starting recording");
    }

    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }

    // Check if livestream/recording infrastructure is already set up (channels ready, processors running)
    const needsInfrastructureSetup = !this.isLivestreaming && !this.livestreamVideoEncoderManager;
    try {
      this.updateStatus("Starting recording...");

      if (needsInfrastructureSetup) {
        // If we don't have a stream (no pre-grant), capture it
        if (!this.tabStream) {
          await this.captureCurrentTab();
          if (!this.tabStream) {
            throw new Error("Failed to capture tab stream");
          }
        }

        // Mix audio streams
        await this.setupLivestreamAudioMixing();

        // Add channels using StreamManager
        log("[Publisher] Adding recording channels...");
        await this.streamManager.addStream(ChannelName.LIVESTREAM_720P);
        await this.streamManager.addStream(ChannelName.LIVESTREAM_AUDIO);

        // Wait for channels to be ready
        await this.streamManager.waitForStreamReady(ChannelName.LIVESTREAM_720P);
        await this.streamManager.waitForStreamReady(ChannelName.LIVESTREAM_AUDIO);
        log("[Publisher] Recording channels ready");

        // Initialize processors
        await this.initializeLivestreamProcessors();

        // Start media processing
        await this.startLivestreamProcessing();
      }

      this.isRecording = true;
      this.updateStatus("Recording started");

      this.emit("recordingStarted", {
        tabStream: this.tabStream!,
        mixedAudioStream: this.mixedAudioStream!,
      });
      globalEventBus.emit(GlobalEvents.RECORDING_STARTED, undefined);

      // Wait for configs to be sent before sending START_RECORD
      log("[Publisher] Waiting for recording configs to be sent...");
      await Promise.all([
        this.waitForConfigSent(ChannelName.LIVESTREAM_720P, 5000),
        this.waitForConfigSent(ChannelName.LIVESTREAM_AUDIO, 5000),
      ]);
      log("[Publisher] Recording configs sent, sending START_RECORD event");

      // Send event to server
      await this.sendMeetingEvent(MEETING_EVENTS.START_RECORD);

      // Force a keyframe to ensure recording starts cleanly
      if (this.livestreamVideoEncoderManager) {
        const names = this.livestreamVideoEncoderManager.getEncoderNames();
        if (names.length > 0) {
          log("[Publisher] Requesting keyframe for recording start");
          this.livestreamVideoEncoderManager.requestKeyframe(names[0]);
        }
      }

      log("[Publisher] Recording started successfully");
    } catch (error) {
      console.error("[Publisher] Failed to start recording:", error);
      this.updateStatus("Failed to start recording", true);
      await this.stopRecording();
      throw error;
    }
  }

  /**
   * Stop recording
   */
  async stopRecording(): Promise<void> {
    if (!this.isRecording) return;

    try {
      this.updateStatus("Stopping recording...");

      // Only cleanup infrastructure if livestream is not active
      if (!this.isLivestreaming) {
        log("[Publisher] Cleaning up infrastructure (no livestream active)");
        // Stop processors
        if (this.livestreamVideoProcessor) {
          await this.livestreamVideoProcessor.stop();
          this.livestreamVideoProcessor = null;
        }

        if (this.livestreamAudioProcessor) {
          await this.livestreamAudioProcessor.stop();
          this.livestreamAudioProcessor = null;
        }

        // Stop encoder managers
        if (this.livestreamVideoEncoderManager) {
          await this.livestreamVideoEncoderManager.closeAll();
          this.livestreamVideoEncoderManager = null;
        }

        if (this.livestreamAudioEncoderManager) {
          await this.livestreamAudioEncoderManager.stop();
          this.livestreamAudioEncoderManager = null;
        }

        // Cleanup audio mixer
        if (this.livestreamAudioMixer) {
          await this.livestreamAudioMixer.cleanup();
          this.livestreamAudioMixer = null;
        }

        // Stop tab stream
        if (this.tabStream) {
          const tracks = this.tabStream.getTracks();
          tracks.forEach((track) => {
            track.stop();
          });
          this.tabStream = null;
          log("[Publisher] Tab stream stopped");
        } else {
          log("[Publisher] No tab stream to stop");
        }

        this.mixedAudioStream = null;
      } else {
        log("[Publisher] Livestream is active, keeping infrastructure running");
      }

      this.isRecording = false;

      this.updateStatus("Recording stopped");
      this.emit("recordingStopped", undefined);
      globalEventBus.emit(GlobalEvents.RECORDING_STOPPED, undefined);

      // Send event to server
      await this.sendMeetingEvent(MEETING_EVENTS.STOP_RECORD);

      log("[Publisher] Recording stopped successfully");
    } catch (error) {
      console.error("[Publisher] Error stopping recording:", error);
      this.updateStatus("Error stopping recording", true);
    }
  }

  /**
   * Check if currently recording
   */
  get isRecordingActive(): boolean {
    return this.isRecording;
  }

  // ==========================================
  // === Recording Permission Methods       ===
  // ==========================================

  /**
   * Request recording permissions (screen sharing with audio) before joining a meeting.
   * This allows teachers to grant permission in the waiting room.
   * 
   * Distinguishes between:
   * - User denial (missingVideo/missingAudio) - user chose not to grant
   * - System unavailability (videoUnavailable/audioUnavailable) - system doesn't support
   * 
   * @returns Promise with permission result
   */
  async requestRecordingPermissions(): Promise<{
    granted: boolean;
    stream?: MediaStream;
    error?: Error;
    // User denial flags (when granted = false)
    missingVideo?: boolean;
    missingAudio?: boolean;
    // System unavailability flags (when granted = true but feature unavailable)
    videoUnavailable?: boolean;
    audioUnavailable?: boolean;
  }> {
    try {
      // If already have permission with valid stream, return early
      if (this.tabStream && this.recordingPermissionGranted) {
        return {
          granted: true,
          stream: this.tabStream,
        };
      }

      const displayMediaOptions: DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
        selfBrowserSurface?: string;
      } = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15 },
        },
        audio: true, // Request audio capture from tab
      };

      // Chrome-specific options for preferring current tab
      displayMediaOptions.preferCurrentTab = true;
      displayMediaOptions.selfBrowserSurface = "include";

      this.tabStream = await navigator.mediaDevices.getDisplayMedia(
        displayMediaOptions as DisplayMediaStreamOptions
      );

      const videoTracks = this.tabStream.getVideoTracks();
      const audioTracks = this.tabStream.getAudioTracks();

      const hasVideo = videoTracks.length > 0;
      const hasAudio = audioTracks.length > 0;

      // Get display surface type to determine if audio/video SHOULD be available
      let displaySurface: string | undefined;
      if (hasVideo) {
        const settings = videoTracks[0].getSettings() as MediaTrackSettings & { displaySurface?: string };
        displaySurface = settings.displaySurface;
      }

      log(`[Publisher] Recording permission check - Video: ${hasVideo}, Audio: ${hasAudio}, Surface: ${displaySurface}`);

      // Determine if audio SHOULD be available based on display surface
      // "browser" = tab sharing (audio available)
      // "window" or "monitor" = window/screen sharing (audio may not be available)
      const isTabSharing = displaySurface === "browser";
      const audioShouldBeAvailable = isTabSharing;

      // Case 1: No video at all - this is always a denial (can't share without video)
      if (!hasVideo) {
        this.tabStream.getTracks().forEach(track => track.stop());
        this.tabStream = null;

        return {
          granted: false,
          error: new Error("Screen sharing requires video."),
          missingVideo: true,
        };
      }

      // Case 2: Has video, check audio
      if (!hasAudio) {
        if (audioShouldBeAvailable) {
          // Tab sharing but user unchecked audio → User denial
          this.tabStream.getTracks().forEach(track => track.stop());
          this.tabStream = null;

          return {
            granted: false,
            error: new Error("Tab audio is required for recording. Please enable audio when sharing."),
            missingAudio: true,
          };
        } else {
          // Window/screen sharing - audio not available → System limitation, still grant
          this.recordingPermissionGranted = true;
          log("[Publisher] Recording permission granted - video available, audio unavailable (system limitation)");

          // Setup onended handler
          this.setupTabStreamEndedHandler();

          return {
            granted: true,
            stream: this.tabStream,
            audioUnavailable: true,
          };
        }
      }

      // Case 3: Both video and audio available
      this.recordingPermissionGranted = true;
      log("[Publisher] Recording permission granted - both video and audio available");

      // Setup onended handler
      this.setupTabStreamEndedHandler();

      return {
        granted: true,
        stream: this.tabStream,
      };
    } catch (error) {
      log("[Publisher] Recording permission denied:", error);
      return {
        granted: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Setup handler for when tab capture is stopped by user via browser UI
   */
  private setupTabStreamEndedHandler(): void {
    if (!this.tabStream) return;

    const videoTrack = this.tabStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        log("[Publisher] Tab capture stopped by user (browser UI)");
        this.recordingPermissionGranted = false;
        this.tabStream = null;

        if (this.isLivestreaming) {
          this.stopLivestream();
        }
        if (this.isRecording) {
          this.stopRecording();
        }
      };
    }
  }

  /**
   * Check if recording permission has been granted
   */
  isRecordingPermissionGranted(): boolean {
    return this.recordingPermissionGranted && this.tabStream !== null;
  }

  /**
   * Release the pre-granted recording permission and stop the stream.
   * Call this if the user decides not to join the meeting.
   */
  releaseRecordingPermissions(): void {
    if (this.tabStream) {
      this.tabStream.getTracks().forEach(track => track.stop());
      this.tabStream = null;
    }
    this.recordingPermissionGranted = false;
    log("[Publisher] Recording permissions released");
  }

  /**
   * Set a pre-granted tab stream from external source (e.g., React provider).
   * This allows the stream captured in waiting room to be used by startRecording.
   */
  setPreGrantedTabStream(stream: MediaStream): void {
    if (this.tabStream) {
      log("[Publisher] Replacing existing tabStream with pre-granted stream");
      // Stop existing stream tracks
      this.tabStream.getTracks().forEach(track => track.stop());
    }

    this.tabStream = stream;
    this.recordingPermissionGranted = true;

    // Setup onended handler
    this.setupTabStreamEndedHandler();

    log("[Publisher] Pre-granted tab stream set successfully");
  }
}
