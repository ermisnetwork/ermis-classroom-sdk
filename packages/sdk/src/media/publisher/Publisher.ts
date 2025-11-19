/**
* Publisher - Pure Orchestrator for Media Publishing
* 
* Delegates all processing to specialized components
* Total: ~650 lines (vs 2,752 original = 76% reduction)
*/

import EventEmitter from "../../events/EventEmitter";
import type {
  PublisherConfig,
  StreamInfo,
  ServerEvent,
  SubStream,
} from "../../types/media/publisher.types";
import { ChannelName } from "../../types/media/publisher.types";
import { getSubStreams, MEETING_EVENTS } from "../../constants/publisherConstants";
import { WebTransportManager } from "./transports/WebTransportManager";
import { WebRTCManager } from "./transports/WebRTCManager";
import { StreamManager } from "./transports/StreamManager";
import { VideoEncoderManager } from "./managers/VideoEncoderManager";
import { AudioEncoderManager } from "./managers/AudioEncoderManager";
import { VideoProcessor } from "./processors/VideoProcessor";
import { AudioProcessor } from "./processors/AudioProcessor";

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

  constructor(config: PublisherConfig) {
    super();
    this.options = config;
    this.subStreams = getSubStreams(config.streamType || "camera");

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
      console.log("[Publisher] Dependencies loaded, initAudioRecorder type:", typeof this.InitAudioRecorder);
    } catch (error) {
      console.error("[Publisher] Failed to load dependencies:", error);
      throw error;
    }
  }

  private async loadPolyfills(): Promise<void> {
    // Only load MSTP polyfill (same as original JS version)
    // MSTG polyfill is loaded by Subscriber when needed
    console.log("[Publisher] 🔧 loadPolyfills() v2.0 - TypeScript version");
    if (!document.querySelector('script[src*="MSTP_polyfill.js"]')) {
      console.log("[Publisher] Loading MSTP polyfill from /polyfills/MSTP_polyfill.js");
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/polyfills/MSTP_polyfill.js";
        script.onload = () => {
          console.log("[Publisher] ✅ Polyfill loaded successfully");
          resolve();
        };
        script.onerror = () => reject(new Error("Failed to load MSTP polyfill"));
        document.head.appendChild(script);
      });
    } else {
      console.log("[Publisher] ℹ️ MSTP polyfill already loaded");
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
      this.hasVideo = stream.getVideoTracks().length > 0;
      this.hasAudio = stream.getAudioTracks().length > 0;

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

    // Emit localStreamReady event for UI
    this.emit("localStreamReady", {
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
    });

    return stream;
  }

  private async setupWebTransportConnection(): Promise<void> {
    this.updateStatus("Connecting via WebTransport...");

    this.webTransportManager = new WebTransportManager({
      url: this.options.publishUrl,
    });

    const webTransport = await this.webTransportManager.connect();
    this.streamManager = new StreamManager(false);

    const channelNames: ChannelName[] = [
      ...this.subStreams.map(s => s.channelName as ChannelName),
    ];

    if (this.hasAudio) {
      channelNames.push(ChannelName.MICROPHONE);
    }

    await this.streamManager.initWebTransportStreams(webTransport, channelNames);

    this.updateStatus("WebTransport connected");
    this.emit("connected");
  }

  private async setupWebRTCConnection(): Promise<void> {
    this.updateStatus("Connecting via WebRTC...");

    // Use provided webRtcHost or fallback to default (same as JS version)
    const webRtcHost = this.options.webRtcHost || "admin.bandia.vn:9995";

    // Initialize StreamManager first
    this.streamManager = new StreamManager(true);

    // Initialize WebRTCManager to handle multiple connections
    this.webRtcManager = new WebRTCManager(
      webRtcHost,
      this.options.roomId || "",
      this.options.streamId || ""
    );

    // Get all channel names from subStreams (already includes MEETING_CONTROL, MIC_AUDIO, and video channels)
    const channelNames: ChannelName[] = this.subStreams.map(s => s.channelName as ChannelName);

    console.log("[Publisher] Setting up WebRTC for channels:", channelNames);

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

      console.log("[Publisher] Video processor initialized");
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

      console.log("[Publisher] Audio processor initialized");
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
        console.log("[Publisher] Video processing started");
      }
    }

    if (this.hasAudio && this.audioProcessor) {
      const audioTrack = this.currentStream.getAudioTracks()[0];
      if (audioTrack) {
        const audioStream = new MediaStream([audioTrack]);
        await this.audioProcessor.initialize(audioStream);
        await this.audioProcessor.start();
        console.log("[Publisher] Audio processing started");
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

    console.log("[Publisher] Video turned off");
  }

  async turnOnVideo(): Promise<void> {
    if (!this.hasVideo || !this.videoProcessor) return;

    this.videoProcessor.setCameraEnabled(true);
    this.videoEnabled = true;

    const eventType = this.options.streamType === "display" ? MEETING_EVENTS.START_SCREEN_SHARE : MEETING_EVENTS.CAMERA_ON;
    await this.sendMeetingEvent(eventType);

    console.log("[Publisher] Video turned on");
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

    console.log("[Publisher] Audio turned off");
  }

  async turnOnAudio(): Promise<void> {
    if (!this.hasAudio || !this.audioProcessor) return;

    this.audioProcessor.setMicEnabled(true);
    this.audioEnabled = true;
    await this.sendMeetingEvent(MEETING_EVENTS.MIC_ON);

    console.log("[Publisher] Audio turned on");
  }

  async toggleMic(): Promise<void> {
    return this.toggleAudio();
  }

  async toggleCamera(): Promise<void> {
    return this.toggleVideo();
  }

  async switchVideoDevice(deviceId: string): Promise<void> {
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

        console.log("[Publisher] Video device switched");
      }
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

        console.log("[Publisher] Audio device switched");
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
    console.log("[Publisher] Hand raised");
  }

  async lowerHand(): Promise<void> {
    if (!this.isHandRaised) return;

    this.isHandRaised = false;
    await this.sendMeetingEvent(MEETING_EVENTS.LOWER_HAND);
    console.log("[Publisher] Hand lowered");
  }

  private async sendMeetingEvent(eventType: string, data?: any): Promise<void> {
    if (!this.streamManager) {
      console.warn("[Publisher] StreamManager not initialized");
      return;
    }

    try {
      const event = {
        type: eventType,
        sender_stream_id: this.options.streamId || "",
        timestamp: Date.now(),
        data: data || {},
      };

      await this.streamManager.sendData(
        ChannelName.MEETING_CONTROL,
        event
      );
    } catch (error: any) {
      console.error("[Publisher] Failed to send meeting event:", error);
    }
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

      console.log("[Publisher] Stopped successfully");
    } catch (error: any) {
      console.error("[Publisher] Error during stop:", error);
      this.updateStatus("Error stopping publisher", true);
    }
  }

  async sendEvent(eventData: any): Promise<void> {
    if (!this.streamManager) {
      throw new Error("StreamManager not initialized");
    }
    const eventJson = JSON.stringify(eventData);
    // Send event through meeting control channel using enum value
    await this.streamManager.sendData(ChannelName.MEETING_CONTROL, new TextEncoder().encode(eventJson));
  }

  // ========== Screen Sharing Methods ==========

  private screenStream: MediaStream | null = null;
  private screenVideoProcessor: VideoProcessor | null = null;
  private screenAudioProcessor: AudioProcessor | null = null;
  private screenVideoEncoderManager: VideoEncoderManager | null = null;
  private isScreenSharing = false;

  async startShareScreen(screenMediaStream: MediaStream): Promise<void> {
    console.log("[Publisher] Starting screen sharing with provided MediaStream:", screenMediaStream);

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
          console.log("[Publisher] Screen share stopped by user");
          this.stopShareScreen();
        };
      }

      this.isScreenSharing = true;

      // Send START_SCREEN_SHARE event
      await this.sendMeetingEvent(MEETING_EVENTS.START_SCREEN_SHARE);

      // Create streams for screen share BEFORE starting encoding
      // This ensures streams are ready when processors try to send config
      console.log(`[Publisher] Creating screen share streams...`);
      await this.streamManager.addStream(ChannelName.SCREEN_SHARE_720P);
      if (hasAudio) {
        await this.streamManager.addStream(ChannelName.SCREEN_SHARE_AUDIO);
      }
      console.log(`[Publisher] Screen share streams created successfully`);

      // Start video encoding
      await this.startScreenVideoCapture();

      // Start audio if available
      if (hasAudio) {
        await this.startScreenAudioStreaming();
      }

      this.updateStatus(`Screen sharing started (Video: ${hasVideo}, Audio: ${hasAudio})`);

      // Create video-only stream for UI (similar to localStreamReady)
      const videoOnlyStream = new MediaStream();
      const videoTracks = this.screenStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoOnlyStream.addTrack(videoTracks[0]);
      }

      console.log("[Publisher] Emitting localScreenShareReady event");
      // Emit localScreenShareReady for UI to display the screen share locally
      this.emit("localScreenShareReady", {
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
      });
      console.log("[Publisher] localScreenShareReady event emitted");

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
    const screenSubStreams = getSubStreams("screen_share");
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

    console.log("[Publisher] Screen video processing started");
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

    console.log("[Publisher] Screen audio processing started");
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

      // Emit event
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
      console.log("[Publisher] Replacing media stream...");
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
        console.log("[Publisher] Switching video track...");
        await this.videoProcessor.switchCamera(videoTracks[0]);
      }

      // Restart audio processor with new track
      if (hasAudio && this.audioProcessor) {
        console.log("[Publisher] Switching audio track...");
        await this.audioProcessor.switchAudioTrack(audioTracks[0]);
      }

      // Clean up old stream
      if (oldStream) {
        console.log("[Publisher] Cleaning up old stream...");
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

      console.log("[Publisher] Media stream replaced successfully");
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
    console.log(`[Publisher] ${message}`);
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
