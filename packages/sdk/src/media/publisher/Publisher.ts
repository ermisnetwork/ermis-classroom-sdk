import EventEmitter from "../../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../../events/GlobalEventBus";
import {
  PublisherConfig,
  StreamInfo,
  ServerEvent,
  SubStream,
  ParticipantPermissions,
  ChannelName,
} from '../../types';
import { getSubStreams, MEETING_EVENTS } from '../../constants';
import { WebTransportManager } from "./transports/WebTransportManager";
import { WebRTCManager } from "./transports/WebRTCManager";
import { StreamManager } from "./transports/StreamManager";
import { VideoEncoderManager } from "./managers/VideoEncoderManager";
import { AudioEncoderManager } from "./managers/AudioEncoderManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";
import {log} from "../../utils";

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
  private permissions: ParticipantPermissions ;

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
        await this.setupWebRTCConnection();
      } else {
        await this.setupWebTransportConnection();
      }

      await this.initializeProcessors();
      await this.startMediaProcessing();

      this.isPublishing = true;
      this.updateStatus("Publishing started");
      this.emit("streamStart");

      // Send initial state to server so other clients know the mic/camera status
      // This is important when user joins with mic/camera already disabled
      await this.sendInitialState();

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
        stream = await navigator.mediaDevices.getUserMedia(constraints);
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
    const channelNames: ChannelName[] = [
      ...this.subStreams.map(s => s.channelName as ChannelName),
    ];

    // if (this.hasAudio) {
    //   channelNames.push(ChannelName.MICROPHONE);
    // }

    await this.streamManager.initWebTransportStreams(webTransport, channelNames);

    this.updateStatus("WebTransport connected");
    this.emit("connected");
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

    // Get all channel names from subStreams (already includes MEETING_CONTROL, MIC_AUDIO, and video channels)
    const channelNames: ChannelName[] = this.subStreams.map(s => s.channelName as ChannelName);

    log("[Publisher] Setting up WebRTC for channels:", channelNames);

    // Connect all channels (WebRTCManager handles creating multiple peer connections)
    await this.webRtcManager.connectMultipleChannels(channelNames, this.streamManager);

    this.updateStatus("WebRTC connected");
    this.emit("connected");
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

    log("[Publisher] Video turned off");
  }

  async turnOnVideo(): Promise<void> {
    if (!this.hasVideo || !this.videoProcessor) return;

    this.videoProcessor.setCameraEnabled(true);
    this.videoEnabled = true;

    const eventType = this.options.streamType === "display" ? MEETING_EVENTS.START_SCREEN_SHARE : MEETING_EVENTS.CAMERA_ON;
    await this.sendMeetingEvent(eventType);

    log("[Publisher] Video turned on");
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

    log("[Publisher] Audio turned off");
  }

  async turnOnAudio(): Promise<void> {
    if (!this.hasAudio || !this.audioProcessor) return;

    this.audioProcessor.setMicEnabled(true);
    this.audioEnabled = true;
    await this.sendMeetingEvent(MEETING_EVENTS.MIC_ON);

    log("[Publisher] Audio turned on");
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
    log("[Publisher] Hand raised");
  }

  async lowerHand(): Promise<void> {
    if (!this.isHandRaised) return;

    this.isHandRaised = false;
    await this.sendMeetingEvent(MEETING_EVENTS.LOWER_HAND);
    log("[Publisher] Hand lowered");
  }

  // private async sendMeetingEvent(eventType: string, data?: any): Promise<void> {
  //   if (!this.streamManager) {
  //     console.warn("[Publisher] StreamManager not initialized");
  //     return;
  //   }

  //   try {
  //     const event = {
  //       type: eventType,
  //       sender_stream_id: this.options.streamId || "",
  //       timestamp: Date.now(),
  //       data: data || {},
  //     };

  //     await this.streamManager.sendData(
  //       ChannelName.MEETING_CONTROL,
  //       event
  //     );
  //   } catch (error: any) {
  //     console.error("[Publisher] Failed to send meeting event:", error);
  //   }
  // }

  private async sendMeetingEvent(eventType: string, data?: any): Promise<void> {
    if (!this.streamManager) {
      console.warn("[Publisher] StreamManager not initialized");
      return;
    }
    const event = {
      type: eventType,
      sender_stream_id: this.options.streamId || "",
      timestamp: Date.now(),
      data: data || {},
    };
    await this.streamManager.sendEvent(event);
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
    if (!this.isPublishing) return;

    try {
      this.updateStatus("Stopping publisher...");

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

      this.isPublishing = false;
      this.updateStatus("Publisher stopped");
      this.emit("streamStop");

      if (this.options.onStreamStop) {
        this.options.onStreamStop();
      }

      log("[Publisher] Stopped successfully");
    } catch (error: any) {
      console.error("[Publisher] Error during stop:", error);
      this.updateStatus("Error stopping publisher", true);
    }
  }

  async sendEvent(eventData: any): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }
    await this.streamManager.sendEvent(eventData);
  }

  // ========== Screen Sharing Methods ==========

  private screenStream: MediaStream | null = null;
  private screenVideoProcessor: VideoProcessor | null = null;
  private screenAudioProcessor: AudioProcessor | null = null;
  private screenVideoEncoderManager: VideoEncoderManager | null = null;
  private isScreenSharing = false;

  async startShareScreen(screenMediaStream: MediaStream): Promise<void> {
    log("[Publisher] Starting screen sharing with provided MediaStream:", screenMediaStream);

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


      log(`[Publisher] Creating screen share streams...`);
      await this.streamManager.addStream(ChannelName.SCREEN_SHARE_720P);
      
      if (hasAudio) {
        await this.streamManager.addStream(ChannelName.SCREEN_SHARE_AUDIO);
      }
      log(`[Publisher] Screen share streams created successfully`);

      await this.startScreenVideoCapture();

      // Start audio if available
      if (hasAudio) {
        await this.startScreenAudioStreaming();
      }

      await this.sendMeetingEvent(MEETING_EVENTS.START_SCREEN_SHARE);

      this.updateStatus(`Screen sharing started (Video: ${hasVideo}, Audio: ${hasAudio})`);

      // Create video-only stream for UI (similar to localStreamReady)
      const videoOnlyStream = new MediaStream();
      const videoTracks = this.screenStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      log("[Publisher] Emitting localScreenShareReady event");

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

      // Emit to global event bus
      globalEventBus.emit(GlobalEvents.LOCAL_SCREEN_SHARE_READY, screenShareData);
      log("[Publisher] localScreenShareReady event emitted");

      // Also emit screenShareStarted for backward compatibility
      this.emit("screenShareStarted", {
        stream: this.screenStream,
        hasVideo,
        hasAudio,
      });

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
}
