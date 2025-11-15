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
import { CommandSender } from "./ClientCommand";
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
  private currentAudioConfig: AudioEncoderConfig; // Used in old processor flow, kept for compatibility
  private subStreams: SubStreamConfig[];

  // Managers
  private transportManager: WebTransportManager | WebRTCManager | null = null;
  private streamManager: StreamManager | null = null;
  private videoEncoderManager: VideoEncoderManager | null = null;
  private audioEncoderManager: AudioEncoderManager | null = null;

  // Processors
  private videoProcessor: VideoProcessor | null = null;
  private audioProcessor: AudioProcessor | null = null;

  // ✅ CRITICAL: Additional state from Publisher.js
  private publishStreams = new Map<string, any>();
  private videoEncoders = new Map<string, any>();
  // @ts-expect-error - Will be used in event handling
  private eventStream: any = null;
  // @ts-expect-error - Will be used in audio flow
  private currentAudioStream: any = null;
  private triggerWorker: Worker | null = null;
  // @ts-expect-error - Will be used in screen share trigger
  private screenShareTriggerWorker: Worker | null = null;
  // @ts-expect-error - Will be used in worker ping
  private workerPing: any = null;
  private webRtcConnections = new Map<string, RTCPeerConnection>();
  private webTransport: any = null;
  // @ts-expect-error - Will be used in WebRTC flow
  private webRtc: RTCPeerConnection | null = null;
  private isChannelOpen = false;
  private videoReader: any = null;
  // @ts-expect-error - Will be used in audio processing
  private micAudioProcessor: any = null;
  // @ts-expect-error - Will be used in screen video encoding
  private screenVideoEncoder: any = null;
  private WasmEncoder: any = null;

  // ✅ CRITICAL: Missing Publisher.js properties for WebRTC flow
  private hasVideo = false; // Actual camera availability
  private hasAudio = false; // Actual mic availability
  private videoEnabled = true; // Camera on/off toggle
  private audioEnabled = true; // Mic on/off toggle
  private webRtcHost = ''; // WebRTC server host
  private roomId = ''; // Room ID for WebRTC
  private streamId = ''; // Stream ID for WebRTC
  private userMediaSubChannels: any[] = []; // Camera subchannels
  private screenSubChannels: any[] = []; // Screen share subchannels
  private onStatusUpdate: (msg: string, isError?: boolean) => void = () => { };

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

  // ✅ CRITICAL: Sequence tracking & queues (MATCH Publisher.js)
  private sequenceNumbers: Record<string, number> = {};
  private dcMsgQueues: Record<string, any[]> = {};
  private dcPacketSendTime: Record<string, number> = {};
  private gopTracking: Record<string, { currentGopStart: number; lastKeyFrameIndex: number }> = {};
  private needKeyFrame: Record<string, boolean> = {};

  // ✅ CRITICAL: Command sender (MATCH Publisher.js)
  private commandSender: any = null;

  // ✅ CRITICAL: Audio timing (MATCH Publisher.js)
  private audioBaseTime = 0;
  private audioSamplesSent = 0;
  private readonly audioSamplesPerChunk = 960; // 20ms at 48kHz
  private readonly kSampleRate = 48000;

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

    // ✅ CRITICAL: Initialize WebRTC-specific properties
    this.hasVideo = this.options.hasCamera;
    this.hasAudio = this.options.hasMic;
    this.videoEnabled = true;
    this.audioEnabled = true;
    this.webRtcHost = this.options.webRtcServerUrl;
    this.roomId = this.options.roomId;
    this.streamId = this.options.streamId;
    this.onStatusUpdate = this.options.onStatusUpdate;

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

    // ✅ CRITICAL: Initialize subchannels (TODO: Use getSubStreams from constants)
    this.userMediaSubChannels = this.subStreams.map(s => ({
      channelName: s.channelName,
      width: s.width,
      height: s.height,
      bitrate: s.bitrate,
      framerate: s.framerate,
    }));
    this.screenSubChannels = []; // Will be populated when screen sharing starts

    this.hasCamera = this.options.hasCamera;
    this.hasMic = this.options.hasMic;

    // ✅ CRITICAL: Initialize commandSender in constructor (MATCH Publisher.js)
    const protocol = this.options.useWebRTC ? 'webrtc' : 'webtransport';
    if (protocol === 'webrtc') {
      this.commandSender = new CommandSender({
        sendDataFn: this.sendOverDataChannel.bind(this),
        protocol: 'webrtc',
        commandType: 'publisher_command',
      });
    } else {
      this.commandSender = new CommandSender({
        sendDataFn: this.sendOverStream.bind(this),
        protocol: 'webtransport',
        commandType: 'publisher_command',
      });
    }

    // ✅ CRITICAL: Initialize sequence tracking (MATCH Publisher.js)
    this.initializeSequenceTracking();
  }

  /**
   * Initialize sequence tracking for all channels
   * ✅ MATCH EXACT LOGIC FROM Publisher.js
   */
  private initializeSequenceTracking(): void {
    // Init for user media (camera) channels
    this.subStreams.forEach((stream) => {
      const key = stream.channelName;
      this.sequenceNumbers[key] = 0;
      this.dcMsgQueues[key] = [];
      this.dcPacketSendTime[key] = performance.now();
    });

    // Note: Screen share channels will be initialized when screen sharing starts
    console.log("[Publisher] Sequence tracking initialized");
  }

  /**
   * Initialize queues and tracking for GOP/keyframes
   * ✅ MATCH EXACT LOGIC FROM Publisher.js
   */
  private initializeQueues(): void {
    // Initialize message queues for non-control channels
    this.subStreams.forEach((stream) => {
      if (!stream.channelName.startsWith("meeting_control")) {
        this.dcMsgQueues[stream.channelName] = [];
      }
    });

    // Initialize GOP tracking for video streams
    this.gopTracking = {};
    this.needKeyFrame = {};

    this.subStreams.forEach((stream) => {
      if (stream.width) {
        // video streams have width
        this.gopTracking[stream.channelName] = {
          currentGopStart: 0,
          lastKeyFrameIndex: -1,
        };
        this.needKeyFrame[stream.channelName] = false;
      }
    });

    console.log("[Publisher] Queues and GOP tracking initialized");
  }

  /**
   * Check if frame is a keyframe
   * ✅ MATCH EXACT LOGIC FROM Publisher.js
   */
  // @ts-expect-error - Will be used in video encoding flow
  private isKeyFrame(frameType: number): boolean {
    return frameType === 0 || frameType === 7 || frameType === 2; // FRAME_TYPE.CONFIG = 2
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

      // ✅ CRITICAL: Initialize queues (MATCH Publisher.js init())
      this.initializeQueues();

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

              // ✅ CRITICAL: Store WasmEncoder class reference
              this.WasmEncoder = wasmModule.WasmEncoder;

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
  }  /**
   * Initialize video encoders for all sub-streams
   * ✅ PORT FROM Publisher.js:903-928
   */
  private initVideoEncoders(subStreams: SubStreamConfig[]): void {
    subStreams.forEach((subStream) => {
      if (subStream.width) {
        // Only video streams have width
        const encoder = new VideoEncoder({
          output: (chunk, metadata) =>
            this.handleVideoChunk(chunk, metadata || {}, subStream.name, subStream.channelName),
          error: (e) =>
            this.updateStatus(`Encoder ${subStream.name} error: ${e.message}`, true),
        });

        this.videoEncoders.set(subStream.name, {
          encoder,
          channelName: subStream.channelName,
          config: {
            codec: this.currentVideoConfig.codec,
            width: subStream.width,
            height: subStream.height,
            bitrate: subStream.bitrate,
            framerate: subStream.framerate || 30,
            latencyMode: "realtime" as LatencyMode,
            hardwareAcceleration: "prefer-hardware" as HardwareAcceleration,
          },
          metadataReady: false,
          videoDecoderConfig: null,
        });
      }
    });

    console.log(`[Publisher] Initialized ${this.videoEncoders.size} video encoders`);
  }

  /**
   * Handle video chunk from encoder
   * ✅ PORT FROM Publisher.js:1385-1412
   */
  private handleVideoChunk(
    chunk: EncodedVideoChunk,
    metadata: EncodedVideoChunkMetadata,
    quality: string,
    channelName: ChannelName
  ): void {
    const encoderObj = this.videoEncoders.get(quality);
    if (!encoderObj) return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    // Send decoder config if not sent yet
    if (metadata && metadata.decoderConfig && !encoderObj.metadataReady) {
      encoderObj.videoDecoderConfig = {
        codec: metadata.decoderConfig.codec,
        codedWidth: metadata.decoderConfig.codedWidth,
        codedHeight: metadata.decoderConfig.codedHeight,
        frameRate: this.currentVideoConfig.framerate,
        description: metadata.decoderConfig.description,
      };
      encoderObj.metadataReady = true;
      this.sendStreamConfig(channelName, encoderObj.videoDecoderConfig, "video");
    }

    if (!streamData.configSent) return;

    // Copy chunk data
    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);

    // Get frame type
    const frameType = this.getFrameType(channelName, chunk.type);

    // Create packet with header
    const packet = this.createPacketWithHeader(
      chunkData,
      chunk.timestamp,
      frameType,
      channelName
    );

    // Send packet
    if (this.options.useWebRTC) {
      this.sendOverDataChannel(channelName, packet, frameType);
    } else {
      this.sendOverStream(channelName, packet);
    }
  }

  /**
   * Get frame type from channel name and chunk type
   * ✅ PORT FROM publisherConstants.js:getFrameType
   */
  private getFrameType(_channelName: string, chunkType: string): number {
    // Frame types from constants
    const FRAME_TYPE = {
      KEY: 0,
      DELTA: 1,
      CONFIG: 2,
      MIC_AUDIO: 3,
    };

    if (chunkType === "key") return FRAME_TYPE.KEY;
    if (chunkType === "delta") return FRAME_TYPE.DELTA;
    return FRAME_TYPE.DELTA;
  }

  /**
   * Create packet with header (sequence number + timestamp + type)
   * ✅ PORT FROM Publisher.js:1529-1560
   */
  private createPacketWithHeader(
    data: ArrayBuffer | Uint8Array,
    timestamp: number,
    type: number,
    channelName: string
  ): Uint8Array {
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    let adjustedTimestamp = timestamp;

    // Adjust timestamp relative to base
    if ((window as any).videoBaseTimestamp) {
      adjustedTimestamp = timestamp - (window as any).videoBaseTimestamp;
    }

    let safeTimestamp = Math.floor(adjustedTimestamp / 1000);
    if (safeTimestamp < 0) safeTimestamp = 0;

    const HEADER_SIZE = 9;
    const MAX_TS = 0xffffffff;
    const MIN_TS = 0;

    if (safeTimestamp > MAX_TS) safeTimestamp = MAX_TS;
    if (safeTimestamp < MIN_TS) safeTimestamp = MIN_TS;

    const dataArray = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const packet = new Uint8Array(HEADER_SIZE + dataArray.length);

    // Set type at byte 8
    packet[8] = type;

    // Set sequence number and timestamp
    const view = new DataView(packet.buffer, 0, 8);
    view.setUint32(0, sequenceNumber, false);
    view.setUint32(4, safeTimestamp, false);

    // Copy data
    packet.set(dataArray, HEADER_SIZE);

    return packet;
  }

  /**
   * Get and increment sequence number for channel
   * ✅ PORT FROM Publisher.js:1562-1568
   */
  private getAndIncrementSequence(channelName: string): number {
    if (!(channelName in this.sequenceNumbers)) {
      this.sequenceNumbers[channelName] = 0;
    }
    const current = this.sequenceNumbers[channelName];
    this.sequenceNumbers[channelName]++;
    return current;
  }

  /**
   * Send stream configuration to server
   * ✅ PORT FROM Publisher.js:1459-1527
   */
  private async sendStreamConfig(
    channelName: string,
    config: any,
    mediaType: "video" | "audio"
  ): Promise<void> {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData || streamData.configSent) return;

    try {
      let configPacket: any;

      if (mediaType === "video") {
        const vConfigUint8 = new Uint8Array(config.description);
        const vConfigBase64 = this.uint8ArrayToBase64(vConfigUint8);

        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "video",
          config: {
            codec: config.codec,
            codedWidth: config.codedWidth,
            codedHeight: config.codedHeight,
            frameRate: config.frameRate,
            quality: (config as any).quality,
            description: vConfigBase64,
          },
        };
      } else if (mediaType === "audio") {
        const aConfigBase64 = this.uint8ArrayToBase64(
          new Uint8Array(config.description)
        );

        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "audio",
          config: {
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            description: aConfigBase64,
          },
        };
      }

      // Send via command sender (will implement when porting CommandSender)
      if (this.commandSender) {
        this.commandSender.sendMediaConfig(channelName, JSON.stringify(configPacket));
      }

      streamData.configSent = true;
      streamData.config = config;

      console.log(`[Stream Config] ✅ Config sent successfully for ${channelName}`);
      this.updateStatus(`Config sent for stream: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send config for ${channelName}:`, error);
    }
  }

  /**
   * Convert Uint8Array to base64
   * ✅ PORT FROM Publisher.js:1570-1578
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  /**
   * Send data over stream (WebTransport)
   * ✅ PORT FROM Publisher.js:991-1007
   */
  private async sendOverStream(channelName: string, frameBytes: Uint8Array): Promise<void> {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) {
      console.error(`Stream ${channelName} not found`);
      return;
    }

    try {
      const len = frameBytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(frameBytes, 4);
      await streamData.writer.write(out);
    } catch (error) {
      console.error(`Failed to send over stream ${channelName}:`, error);
    }
  }

  /**
   * Send data over data channel (WebRTC)
   * ✅ PORT FROM Publisher.js:1165-1249
   */
  private async sendOverDataChannel(channelName: string, packet: Uint8Array, frameType?: number): Promise<void> {
    if (frameType === undefined) {
      console.warn('sendOverDataChannel called without frameType');
      return;
    }

    const streamData = this.publishStreams.get(channelName);
    const dataChannel = streamData?.dataChannel;
    const dataChannelReady = streamData?.dataChannelReady;

    if (!dataChannelReady || !dataChannel || dataChannel.readyState !== "open") {
      console.warn("DataChannel not ready");
      return;
    }

    try {
      const view = new DataView(packet.buffer);
      const sequenceNumber = view.getUint32(0, false);

      // Frame types
      const FRAME_TYPE = {
        KEY: 0,
        DELTA: 1,
        CONFIG: 2,
        MIC_AUDIO: 3,
        EVENT: 4,
      };

      const needFecEncode = frameType !== FRAME_TYPE.EVENT && frameType !== FRAME_TYPE.MIC_AUDIO;
      const packetType = this.getTransportPacketType(frameType);

      // FEC encoding for video frames
      if (needFecEncode) {
        const MAX_MTU = 512;
        const MIN_MTU = 100;
        const MIN_CHUNKS = 5;
        const MAX_REDUNDANCY = 10;
        const MIN_REDUNDANCY = 1;
        const REDUNDANCY_RATIO = 0.1;

        let MTU = Math.ceil(packet.length / MIN_CHUNKS);

        if (MTU < MIN_MTU) {
          MTU = MIN_MTU;
        } else if (MTU > MAX_MTU) {
          MTU = MAX_MTU;
        }

        const totalPackets = Math.ceil(packet.length / (MTU - 20));
        let redundancy = Math.ceil(totalPackets * REDUNDANCY_RATIO);

        if (redundancy < MIN_REDUNDANCY) {
          redundancy = MIN_REDUNDANCY;
        } else if (redundancy > MAX_REDUNDANCY) {
          redundancy = MAX_REDUNDANCY;
        }

        if (frameType === FRAME_TYPE.CONFIG) {
          redundancy = 3;
        }

        const HEADER_SIZE = 20;
        const chunkSize = MTU - HEADER_SIZE;

        // Use WASM encoder
        if (!this.WasmEncoder) {
          console.error("WASM encoder not initialized");
          const wrapper = this.createRegularPacketWithHeader(packet, sequenceNumber, packetType);
          this.sendOrQueue(channelName, dataChannel, wrapper);
          return;
        }

        const encoder = new this.WasmEncoder(packet, chunkSize);
        const configBuf = encoder.getConfigBuffer();

        const configView = new DataView(configBuf.buffer);
        const transferLength = configView.getBigUint64(0, false);
        const symbolSize = configView.getUint16(8, false);
        const sourceBlocks = configView.getUint8(10);
        const subBlocks = configView.getUint16(11, false);
        const alignment = configView.getUint8(13);

        const packets = encoder.encode(redundancy);

        const raptorQConfig = {
          transferLength,
          symbolSize,
          sourceBlocks,
          subBlocks,
          alignment,
        };

        for (let i = 0; i < packets.length; i++) {
          const fecPacket = packets[i];
          const wrapper = this.createFecPacketWithHeader(
            fecPacket,
            sequenceNumber,
            packetType,
            raptorQConfig
          );
          this.sendOrQueue(channelName, dataChannel, wrapper);
        }
        return;
      }

      // Regular packet (no FEC)
      const wrapper = this.createRegularPacketWithHeader(packet, sequenceNumber, packetType);
      this.sendOrQueue(channelName, dataChannel, wrapper);
    } catch (error) {
      console.error("Failed to send over DataChannel:", error);
    }
  }

  /**
   * Get transport packet type from frame type
   * ✅ PORT FROM publisherConstants.js:getTransportPacketType
   */
  private getTransportPacketType(frameType: number): number {
    // Transport packet types
    const TRANSPORT_PACKET_TYPE = {
      VIDEO: 0,
      AUDIO: 1,
      CONFIG: 2,
      EVENT: 3,
    };

    const FRAME_TYPE = {
      KEY: 0,
      DELTA: 1,
      CONFIG: 2,
      MIC_AUDIO: 3,
      EVENT: 4,
    };

    if (frameType === FRAME_TYPE.KEY || frameType === FRAME_TYPE.DELTA) {
      return TRANSPORT_PACKET_TYPE.VIDEO;
    } else if (frameType === FRAME_TYPE.MIC_AUDIO) {
      return TRANSPORT_PACKET_TYPE.AUDIO;
    } else if (frameType === FRAME_TYPE.CONFIG) {
      return TRANSPORT_PACKET_TYPE.CONFIG;
    } else if (frameType === FRAME_TYPE.EVENT) {
      return TRANSPORT_PACKET_TYPE.EVENT;
    }
    return TRANSPORT_PACKET_TYPE.VIDEO;
  }

  /**
   * Send or queue packet based on buffer state
   * ✅ PORT FROM Publisher.js:1252-1260
   */
  private sendOrQueue(channelName: string, dataChannel: RTCDataChannel, packet: Uint8Array): void {
    const queue = this.getQueue(channelName);

    if (dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold && queue.length === 0) {
      (dataChannel as any).send(packet);
    } else {
      queue.push(packet);
    }
  }

  /**
   * Get message queue for channel
   * ✅ PORT FROM Publisher.js:1262-1264
   */
  private getQueue(channelName: string): Uint8Array[] {
    return this.dcMsgQueues[channelName] || [];
  }

  /**
   * Create FEC packet with header
   * ✅ PORT FROM Publisher.js:1266-1288
   */
  private createFecPacketWithHeader(
    packet: Uint8Array,
    sequenceNumber: number,
    packetType: number,
    raptorQConfig: {
      transferLength: bigint;
      symbolSize: number;
      sourceBlocks: number;
      subBlocks: number;
      alignment: number;
    }
  ): Uint8Array {
    const { transferLength, symbolSize, sourceBlocks, subBlocks, alignment } = raptorQConfig;

    const header = new ArrayBuffer(4 + 1 + 1 + 14);
    const view = new DataView(header);

    view.setUint32(0, sequenceNumber, false);
    view.setUint8(4, 0xff); // FEC marker
    view.setUint8(5, packetType);
    view.setBigUint64(6, transferLength, false);
    view.setUint16(14, symbolSize, false);
    view.setUint8(16, sourceBlocks);
    view.setUint16(17, subBlocks, false);
    view.setUint8(19, alignment);

    const wrapper = new Uint8Array(header.byteLength + packet.length);
    wrapper.set(new Uint8Array(header), 0);
    wrapper.set(packet, header.byteLength);

    return wrapper;
  }

  /**
   * Create regular packet with header (no FEC)
   * ✅ PORT FROM Publisher.js:1290-1298
   */
  private createRegularPacketWithHeader(
    packet: Uint8Array,
    sequenceNumber: number,
    packetType: number
  ): Uint8Array {
    const wrapper = new Uint8Array(6 + packet.length);
    const view = new DataView(wrapper.buffer);

    view.setUint32(0, sequenceNumber, false);
    view.setUint8(4, 0x00); // Regular packet marker
    view.setUint8(5, packetType);
    wrapper.set(packet, 6);

    return wrapper;
  }

  /**
   * Setup WebRTC connection for publishing
   * ✅ PORT FROM Publisher.js:1075-1113
   */
  private async setupWebRTCConnection(action = 'camera'): Promise<void> {
    const STREAM_TYPE = {
      CAMERA: 'camera',
      SCREEN_SHARE: 'screen-share',
    };

    const substreams = action === STREAM_TYPE.SCREEN_SHARE
      ? this.screenSubChannels
      : this.userMediaSubChannels;

    try {
      for (const subStream of substreams) {
        const webRtc = new RTCPeerConnection();
        this.webRtcConnections.set(subStream.channelName, webRtc);
        this.createDataChannel(subStream.channelName, webRtc);

        const offer = await webRtc.createOffer();
        await webRtc.setLocalDescription(offer);

        // ACTION = CHANNEL NAME (không phải stream type)
        const response = await fetch(`https://${this.webRtcHost}/meeting/sdp/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer,
            room_id: this.roomId,
            stream_id: this.streamId,
            action: subStream.channelName, // ✅ ACTION = CHANNEL NAME
          }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status} for ${subStream.channelName}`);
        }

        const answer = await response.json();
        await webRtc.setRemoteDescription(answer);

        console.log(`WebRTC connection established for channel: ${subStream.channelName}`);
      }

      this.isChannelOpen = true;
    } catch (error) {
      console.error('WebRTC setup error:', error);
    }
  }

  /**
   * Create WebRTC data channel with buffer management
   * ✅ PORT FROM Publisher.js:1115-1163
   */
  private createDataChannel(channelName: string, webRtc: RTCPeerConnection): void {
    // Set ordered delivery for control channel
    let ordered = false;
    if (channelName === 'meeting-control') {
      ordered = true;
    }

    const dataChannel = webRtc.createDataChannel(channelName, {
      ordered,
      id: 0,
      negotiated: true,
    });

    const bufferAmounts = {
      SMALL: 8192,
      LOW: 16384,
      MEDIUM: 32768,
      HIGH: 65536,
    };

    // Set buffer threshold based on channel type
    if (channelName.includes('1080p')) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.HIGH;
    } else if (channelName.includes('720p')) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    } else if (channelName.includes('360p') || channelName === 'mic-audio') {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.LOW;
    } else {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    }

    dataChannel.onbufferedamountlow = () => {
      const queue = this.getQueue(channelName);

      while (queue.length > 0 && dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold) {
        const packet = queue.shift();
        if (packet) {
          (dataChannel as any).send(packet);
          this.dcPacketSendTime[channelName] = performance.now();
        }
      }
    };

    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = async () => {
      this.publishStreams.set(channelName, {
        id: 0,
        dataChannel,
        dataChannelReady: true,
        configSent: false,
        config: null,
      });

      if (channelName === 'meeting-control') {
        this.sendPublisherState();
      }
      console.log(`WebRTC data channel (${channelName}) established`);
    };
  }

  /**
   * Send publisher state to server
   * ✅ PORT FROM Publisher.js:1065-1073
   */
  private sendPublisherState(): void {
    const stateEvent = {
      hasCamera: this.hasVideo,
      hasMic: this.hasAudio,
      isCameraOn: this.hasVideo ? this.videoEnabled : false,
      isMicOn: this.hasAudio ? this.audioEnabled : false,
    };

    console.warn('Sending publisher state to server:', stateEvent);

    if (this.commandSender) {
      this.commandSender.sendPublisherState('meeting-control', stateEvent);
    }

    this.onStatusUpdate('Publisher state sent to server');
  }

  /**
   * Start user media streaming (video + audio)
   * ✅ PORT FROM Publisher.js:1300-1313
   */
  private async startUserMediaStreaming(): Promise<void> {
    if (this.hasCamera && this.currentStream?.getVideoTracks().length) {
      await this.startVideoCapture();
    } else {
      console.log("Skipping video capture: no video available");
    }

    if (this.hasMic && this.currentStream?.getAudioTracks().length) {
      this.micAudioProcessor = await this.startAudioStreaming(this.currentStream);
    } else {
      console.log("Skipping audio streaming: no audio available");
    }
  }

  /**
   * Start video capture and encoding
   * ✅ PORT FROM Publisher.js:1315-1347
   */
  private async startVideoCapture(): Promise<void> {
    if (!this.currentStream) {
      console.warn("No media stream available for video");
      return;
    }

    const videoTracks = this.currentStream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.warn("No video track found in stream");
      return;
    }

    // Initialize video encoders
    this.initVideoEncoders(this.subStreams);

    // Configure all encoders
    this.videoEncoders.forEach((encoderObj: any) => {
      encoderObj.encoder.configure(encoderObj.config);
    });

    // Create trigger worker for frame processing
    this.triggerWorker = new Worker("/polyfills/triggerWorker.js");
    this.triggerWorker.postMessage({ frameRate: this.currentVideoConfig.framerate });

    // Create video processor (using native MediaStreamTrackProcessor)
    const track = this.currentStream.getVideoTracks()[0];
    const nativeProcessor = new (window as any).MediaStreamTrackProcessor(
      track,
      this.triggerWorker,
      true
    );

    this.videoReader = nativeProcessor.readable.getReader();

    let frameCounter = 0;
    const videoEncoders = Array.from(this.videoEncoders.entries());

    if (this.isPublishing) {
      this.startVideoFrameProcessing(frameCounter, videoEncoders);
    }
  }

  /**
   * Start video frame processing loop
   * ✅ PORT FROM Publisher.js:478-524
   */
  private startVideoFrameProcessing(initialFrameCounter = 0, videoEncoders: any[]): void {
    let frameCounter = initialFrameCounter;

    (async () => {
      try {
        while (this.isPublishing) {
          const result = await this.videoReader.read();

          if (result.done) break;

          const frame = result.value;

          // Set base timestamp
          if (!(window as any).videoBaseTimestamp) {
            (window as any).videoBaseTimestamp = frame.timestamp;
          }

          // Skip frame if video disabled
          if (!this.cameraEnabled) {
            frame.close();
            continue;
          }

          frameCounter++;
          const keyFrame = frameCounter % 30 === 0;

          // Encode frame for all quality levels
          for (let i = 0; i < videoEncoders.length; i++) {
            const [_quality, encoderObj] = videoEncoders[i];
            const isLastEncoder = i === videoEncoders.length - 1;

            if (encoderObj.encoder.encodeQueueSize <= 2) {
              const frameToEncode = isLastEncoder
                ? frame
                : new VideoFrame(frame);
              encoderObj.encoder.encode(frameToEncode, { keyFrame });
              if (!isLastEncoder) frameToEncode.close();
            }
          }

          frame.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        this.updateStatus(`Video processing error: ${message}`, true);
        console.error("Video capture error:", error);
      }
    })();
  }

  /**
   * Start audio streaming
   * ✅ PORT FROM Publisher.js:1349-1383
   */
  private async startAudioStreaming(
    stream: MediaStream,
    channelName: string = "mic_48k"
  ): Promise<any> {
    if (!stream) {
      console.warn("No media stream available for audio");
      return null;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn("No audio track found in stream");
      return null;
    }

    const audioRecorderOptions = {
      encoderApplication: 2051,
      encoderComplexity: 0,
      encoderFrameSize: 20,
      timeSlice: 100,
    };

    const newAudioStream = new MediaStream([audioTrack]);
    if (channelName === "mic_48k") {
      this.currentAudioStream = newAudioStream;
    }

    if (!this.initAudioRecorder) {
      console.error("Audio recorder not initialized");
      return null;
    }

    const audioRecorder = await this.initAudioRecorder(
      newAudioStream,
      audioRecorderOptions
    );
    audioRecorder.ondataavailable = (typedArray: any) =>
      this.handleAudioChunk(typedArray, channelName);

    await audioRecorder.start();

    return audioRecorder;
  }

  /**
   * Handle audio chunk from recorder
   * ✅ PORT FROM Publisher.js:1414-1457
   */
  private handleAudioChunk(typedArray: Uint8Array, channelName: string): void {
    if (!this.micEnabled) return;
    if (!this.isChannelOpen || !typedArray || typedArray.byteLength === 0) return;

    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    try {
      const dataArray = new Uint8Array(typedArray);

      // Check for Ogg header (79, 103, 103, 83 = "OggS")
      if (
        dataArray.length >= 4 &&
        dataArray[0] === 79 &&
        dataArray[1] === 103 &&
        dataArray[2] === 103 &&
        dataArray[3] === 83
      ) {
        // Send config if not sent yet
        if (!streamData.configSent && !streamData.config) {
          const FRAME_TYPE_MIC_AUDIO = 3;
          const description = this.createPacketWithHeader(
            dataArray,
            performance.now() * 1000,
            FRAME_TYPE_MIC_AUDIO,
            channelName
          );

          const audioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 1,
            description: description,
          };

          streamData.config = audioConfig;
          this.sendStreamConfig(channelName, audioConfig, "audio");
        }

        // Initialize audio timing
        if (this.audioBaseTime === 0 && (window as any).videoBaseTimestamp) {
          this.audioBaseTime = (window as any).videoBaseTimestamp;
          (window as any).audioStartPerfTime = performance.now();
          this.audioSamplesSent = 0;
        } else if (this.audioBaseTime === 0 && !(window as any).videoBaseTimestamp) {
          this.audioBaseTime = performance.now() * 1000;
          this.audioSamplesSent = 0;
        }

        // Calculate timestamp
        const timestamp =
          this.audioBaseTime +
          Math.floor((this.audioSamplesSent * 1000000) / this.kSampleRate);

        if (streamData.configSent) {
          const FRAME_TYPE_MIC_AUDIO = 3;
          const packet = this.createPacketWithHeader(
            dataArray,
            timestamp,
            FRAME_TYPE_MIC_AUDIO,
            channelName
          );

          if (this.options.useWebRTC) {
            this.sendOverDataChannel(channelName, packet, FRAME_TYPE_MIC_AUDIO);
          } else {
            this.sendOverStream(channelName, packet);
          }
        }

        this.audioSamplesSent += this.audioSamplesPerChunk;
      }
    } catch (error) {
      console.error("Failed to send audio data:", error);
    }
  }

  /**
   * Start publishing media stream
   * ✅ MATCH EXACT FLOW FROM Publisher.js:260-277
   */
  async startPublishing(): Promise<MediaStream | void> {
    if (this.isPublishing) {
      this.updateStatus("Already publishing", true);
      return;
    }

    if (!this.isInitialized) {
      await this.init();
    }

    try {
      this.updateStatus("Starting publishing...");

      // Setup connection (WebTransport or WebRTC)
      await this.setupConnection();

      // Get media stream
      const videoOnlyStream = await this.getMediaStream();

      // Set publishing flag BEFORE starting streaming
      this.isPublishing = true;

      // Start user media streaming (video + audio)
      await this.startUserMediaStreaming();

      // Emit events
      this.options.onStreamStart();
      this.emit("streamStart");
      this.updateStatus(`Publishing started successfully (${this.options.streamType})`);

      return videoOnlyStream;
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
   * ✅ PORT FROM Publisher.js:937-950
   */
  private async setupWebTransportConnection(): Promise<void> {
    this.webTransport = new WebTransport(this.options.publishUrl);
    await this.webTransport.ready;
    console.log('WebTransport connected to server');

    for (const subStream of this.userMediaSubChannels) {
      await this.createBidirectionalStream(subStream.channelName);
    }

    await this.sendPublisherState();
    this.isChannelOpen = true;
    this.onStatusUpdate('WebTransport connection established with event stream and media streams');
  }

  /**
   * Create bidirectional stream for WebTransport
   * ✅ PORT FROM Publisher.js:952-978
   */
  private async createBidirectionalStream(channelName: string): Promise<void> {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;

    const writer = writable.getWriter();
    const reader = readable.getReader();

    this.publishStreams.set(channelName, {
      writer,
      reader,
      configSent: false,
      config: null,
    });

    if (this.commandSender) {
      await this.commandSender.initChannelStream(channelName);
    }

    console.log(`WebTransport bidirectional stream (${channelName}) established`);

    const CHANNEL_NAME_MEETING_CONTROL = 'meeting-control';
    if (channelName === CHANNEL_NAME_MEETING_CONTROL) {
      this.setupEventStreamReader(reader);
    }
  }

  /**
   * Setup event stream reader
   * ✅ PORT FROM Publisher.js
   */
  private setupEventStreamReader(_reader: any): void {
    // Event stream reading logic will be implemented separately
    console.log('Event stream reader setup');
  }

  /**
   * @deprecated OLD APPROACH - Using TransportManager
   * Setup WebTransport connection
   */
  // @ts-expect-error - Kept for reference
  private async setupWebTransportConnection_OLD(): Promise<void> {
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

    // Setup server event listener from StreamManager
    this.streamManager!.on("serverEvent", (event: any) => {
      console.log("[Publisher] Received server event from StreamManager:", event);
      this.options.onServerEvent(event);
    });

    this.updateStatus("WebTransport streams initialized");

    // Send publisher state to server
    await this.sendPublisherState();
  }

  /**
   * @deprecated OLD APPROACH - Using TransportManager
   * Setup WebRTC connection
   */
  // @ts-expect-error - Kept for reference
  private async setupWebRTCConnection_OLD(): Promise<void> {
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
   * @deprecated - Replaced by startUserMediaStreaming() from Publisher.js
   */
  // @ts-expect-error - Old method kept for reference
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
   * @deprecated - Part of old processing flow
   */
  private setupVideoProcessorEvents(): void { // Old method kept for reference
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
   * @deprecated - Replaced by startUserMediaStreaming() from Publisher.js
   */
  // @ts-expect-error - Old method kept for reference
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
   * Toggle video on/off
   * ✅ PORT FROM Publisher.js:290-296
   */
  async toggleVideo(): Promise<void> {
    if (this.videoEnabled) {
      await this.turnOffVideo();
    } else {
      await this.turnOnVideo();
    }
  }

  /**
   * Toggle camera (alias for toggleVideo)
   * ✅ PUBLIC API METHOD
   */
  async toggleCamera(): Promise<void> {
    return this.toggleVideo();
  }

  /**
   * Toggle audio on/off
   * ✅ PORT FROM Publisher.js:298-304
   */
  async toggleAudio(): Promise<void> {
    if (this.audioEnabled) {
      await this.turnOffAudio();
    } else {
      await this.turnOnAudio();
    }
  }

  /**
   * Toggle mic (alias for toggleAudio)
   * ✅ PUBLIC API METHOD
   */
  async toggleMic(): Promise<void> {
    return this.toggleAudio();
  }

  /**
   * Turn off video
   * ✅ PORT FROM Publisher.js:320-333
   */
  private async turnOffVideo(): Promise<void> {
    if (!this.hasVideo) {
      console.warn('Cannot turn off video: no video available');
      return;
    }

    if (!this.videoEnabled) return;

    this.videoEnabled = false;
    this.onStatusUpdate(`Video turned off`);

    await this.sendMeetingEvent('camera_off');
  }

  /**
   * Turn on video
   * ✅ PORT FROM Publisher.js:335-348
   */
  private async turnOnVideo(): Promise<void> {
    if (!this.hasVideo) {
      console.warn('Cannot turn on video: no video available');
      return;
    }

    if (this.videoEnabled) return;

    this.videoEnabled = true;
    this.onStatusUpdate(`Video turned on`);

    await this.sendMeetingEvent('camera_on');
  }

  /**
   * Turn off audio
   * ✅ PORT FROM Publisher.js:350-363
   */
  private async turnOffAudio(): Promise<void> {
    if (!this.hasAudio) {
      console.warn('Cannot turn off audio: no audio available');
      return;
    }

    if (!this.audioEnabled) return;

    this.audioEnabled = false;
    this.onStatusUpdate(`Audio turned off`);
    console.log('Sending mic_off event to server');

    await this.sendMeetingEvent('mic_off');
  }

  /**
   * Turn on audio
   * ✅ PORT FROM Publisher.js:365-378
   */
  private async turnOnAudio(): Promise<void> {
    if (!this.hasAudio) {
      console.warn('Cannot turn on audio: no audio available');
      return;
    }

    if (this.audioEnabled) return;

    this.audioEnabled = true;
    this.onStatusUpdate(`Audio turned on`);
    console.log('Sending mic_on event to server');

    await this.sendMeetingEvent('mic_on');
  }

  /**
   * Send meeting event to server
   * ✅ PORT FROM Publisher.js (uses commandSender)
   */
  private async sendMeetingEvent(eventType: string, data?: any): Promise<void> {
    if (!this.commandSender) {
      console.warn('CommandSender not initialized');
      return;
    }

    const eventData = data ? { type: eventType, ...data } : { type: eventType };
    await this.commandSender.sendEvent(eventData);
  }

  /**
   * Toggle raise hand
   * ✅ PORT FROM Publisher.js:306-318
   */
  async toggleRaiseHand(): Promise<boolean> {
    const currentState = this.isHandRaised || false;

    if (currentState) {
      await this.lowerHand();
      this.isHandRaised = false;
    } else {
      await this.raiseHand();
      this.isHandRaised = true;
    }

    return this.isHandRaised;
  }

  /**
   * Raise hand
   * ✅ PUBLIC API METHOD
   */
  async raiseHand(): Promise<void> {
    await this.sendMeetingEvent('raise_hand');
    this.onStatusUpdate('Hand raised');
  }

  /**
   * Lower hand
   * ✅ PUBLIC API METHOD
   */
  async lowerHand(): Promise<void> {
    await this.sendMeetingEvent('lower_hand');
    this.onStatusUpdate('Hand lowered');
  }

  /**
   * @deprecated OLD APPROACH - Using old processor flow
   * Toggle camera on/off
   */
  async toggleCamera_OLD(): Promise<void> {
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
   * @deprecated OLD APPROACH - Alias method
   * Toggle video (alias for toggleCamera for backward compatibility)
   */
  async toggleVideo_OLD2(): Promise<void> {
    return this.toggleCamera_OLD();
  }

  /**
   * @deprecated OLD APPROACH - Using old processor flow
   * Toggle microphone on/off
   */
  async toggleMic_OLD(): Promise<void> {
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
   * @deprecated OLD APPROACH - Alias method
   * Toggle audio (alias for toggleMic for backward compatibility)
   */
  async toggleAudio_OLD2(): Promise<void> {
    return this.toggleMic_OLD();
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
   * @deprecated OLD APPROACH - Public API method
   * Raise hand
   */
  async raiseHand_OLD(): Promise<void> {
    if (this.isHandRaised) {
      return;
    }

    this.isHandRaised = true;
    await this.sendMeetingEvent_OLD("raise_hand");
    this.updateStatus("Hand raised");
  }

  /**
   * @deprecated OLD APPROACH - Public API method
   * Lower hand
   */
  async lowerHand_OLD(): Promise<void> {
    if (!this.isHandRaised) {
      return;
    }

    this.isHandRaised = false;
    await this.sendMeetingEvent_OLD("lower_hand");
    this.updateStatus("Hand lowered");
  }

  /**
   * @deprecated OLD APPROACH - Public API method
   * Toggle raise hand
   */
  async toggleRaiseHand_OLD(): Promise<boolean> {
    if (this.isHandRaised) {
      await this.lowerHand_OLD();
    } else {
      await this.raiseHand_OLD();
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
   * @deprecated OLD APPROACH - Using StreamManager
   * Send meeting control event to server
   */
  async sendMeetingEvent_OLD(
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
   * @deprecated OLD APPROACH - Public API method
   * Send publisher state to server
   */
  async sendPublisherState_OLD(): Promise<void> {
    const state = {
      type: "publisher_state",
      data: {
        has_camera: this.hasCamera,
        has_mic: this.hasMic,
        is_camera_on: this.hasCamera ? this.cameraEnabled : false,
        is_mic_on: this.hasMic ? this.micEnabled : false,
      },
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
