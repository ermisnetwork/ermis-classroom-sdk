import EventEmitter from "../../../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../../../events/GlobalEventBus";
import { ChannelName, FrameType } from "../../../types/media/publisher.types";
import type {
  StreamData,
  ServerEvent,
} from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import type { RaptorQConfig } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";
import { LengthDelimitedReader } from "../../shared/utils/LengthDelimitedReader";
import CommandSender, { PublisherState } from "../ClientCommand";
import { log } from "../../../utils";
import type { WebRTCManager } from "./WebRTCManager";

// Default publisher state - will be updated by Publisher
const DEFAULT_PUBLISHER_STATE: PublisherState = {
  hasMic: false,
  hasCamera: false,
  isMicOn: false,
  isCameraOn: false,
};

// WasmEncoder type from RaptorQ
interface WasmEncoderType {
  new(data: Uint8Array, blockSize: number): WasmEncoderInstance;
}

interface WasmEncoderInstance {
  encode(redundancy: number): Uint8Array[];
  getConfigBuffer(): Uint8Array;
  free(): void;
}

// StreamManager-specific config types
export interface VideoConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  frameRate: number;
  quality?: number;
  description?: AllowSharedBufferSource;
}

export interface AudioConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: AllowSharedBufferSource;
}

/**
 * StreamManager - Manages media streams for both WebTransport and WebRTC
 *
 * Responsibilities:
 * - Create and manage bidirectional streams (WebTransport)
 * - Create and manage data channels (WebRTC)
 * - Send video/audio chunks over appropriate transport
 * - Handle stream/channel lifecycle
 */
export class StreamManager extends EventEmitter<{
  sendError: { channelName: ChannelName; error: unknown };
  streamReady: { channelName: ChannelName };
  configSent: { channelName: ChannelName };
  serverEvent: ServerEvent; // Events received from server
}> {
  private streams = new Map<ChannelName, StreamData>();
  private isWebRTC: boolean;
  private sequenceNumbers = new Map<ChannelName, number>(); // Per-channel sequence numbers
  private dcMsgQueues = new Map<ChannelName, Uint8Array[]>(); // Per-channel message queues
  private dcPacketSendTime = new Map<ChannelName, number>(); // Per-channel send timing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private webTransport: any | null = null;
  // WebRTC manager reference for creating screen share data channels
  private webRtcManager: WebRTCManager | null = null;
  // private peerConnection: RTCPeerConnection | null = null;

  // FEC/RaptorQ WASM encoder (same as JS)
  private WasmEncoder: WasmEncoderType | null = null;
  private wasmInitialized = false;
  private wasmInitializing = false;
  private wasmInitPromise: Promise<void> | null = null;
  private commandSender: CommandSender | null;
  public streamId: string;
  private publisherState: PublisherState = { ...DEFAULT_PUBLISHER_STATE };

  constructor(isWebRTC: boolean = false, streamID?: string) {
    super();
    this.isWebRTC = isWebRTC;
    this.streamId = streamID || "default_stream";


    if (isWebRTC) {
      (async () => {
        await this.initWasmEncoder();
      })();
    };

    this.commandSender = isWebRTC ? new CommandSender({
      protocol: "webrtc",
      sendDataFn: this.sendViaDataChannel.bind(this),
    }) : new CommandSender({
      protocol: "webtransport",
      sendDataFn: this.sendViaWebTransport.bind(this),
    });
  }

  /**
   * Set the publisher state (mic/camera availability and on/off status)
   * This should be called by Publisher before streams are initialized
   */
  setPublisherState(state: Partial<PublisherState>): void {
    this.publisherState = { ...this.publisherState, ...state };
    log("[StreamManager] Publisher state updated:", this.publisherState);
  }

  /**
   * Get the current publisher state
   */
  getPublisherState(): PublisherState {
    return { ...this.publisherState };
  }

  /**
   * Set WebRTC manager reference for creating screen share data channels
   * This should be called by Publisher after WebRTCManager is initialized
   */
  setWebRTCManager(manager: WebRTCManager): void {
    this.webRtcManager = manager;
    log("[StreamManager] WebRTC manager reference set");
  }

  /**
   * Stop heartbeat interval
   * Should be called during cleanup to prevent errors after connection closes
   */
  stopHeartbeat(): void {
    if (this.commandSender) {
      this.commandSender.stopHeartbeat();
      log("[StreamManager] Heartbeat stopped");
    }
  }

  /**
   * Initialize WASM encoder for FEC (same as JS Publisher)
   */
  private async initWasmEncoder(): Promise<void> {
    if (this.wasmInitialized) {
      return;
    }

    if (this.wasmInitializing && this.wasmInitPromise) {
      await this.wasmInitPromise;
      return;
    }

    this.wasmInitializing = true;

    try {
      // Dynamic import RaptorQ WASM module
      const { default: init, WasmEncoder } = await import(
        /* @vite-ignore */
        `/raptorQ/raptorq_wasm.js?t=${Date.now()}`
      );

      this.WasmEncoder = WasmEncoder as WasmEncoderType;

      this.wasmInitPromise = init(`/raptorQ/raptorq_wasm_bg.wasm?t=${Date.now()}`)
        .then(() => {
          this.wasmInitialized = true;
          this.wasmInitializing = false;
          log("[StreamManager] WASM encoder module loaded successfully");
        })
        .catch((err: unknown) => {
          this.wasmInitializing = false;
          console.error("[StreamManager] Failed to load WASM encoder module:", err);
          throw new Error("Failed to load WASM encoder module");
        });

      await this.wasmInitPromise;
    } catch (error) {
      this.wasmInitializing = false;
      console.error("[StreamManager] Error initializing WASM:", error);
      throw error;
    }
  }

  /**
   * Initialize WebTransport streams
   */
  async initWebTransportStreams(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webTransport: any,
    channelNames: ChannelName[],
  ): Promise<void> {
    this.webTransport = webTransport;

    for (const channelName of channelNames) {
      await this.createBidirectionalStream(channelName);
    }

    log(
      `[StreamManager] Initialized ${channelNames.length} WebTransport streams`,
    );
  }



  /**
   * Add additional stream (e.g., for screen sharing)
   * Public method to create streams dynamically
   */
  async addStream(channelName: ChannelName): Promise<void> {
    if (this.streams.has(channelName)) {
      log(`[StreamManager] Stream ${channelName} already exists`);
      return;
    }

    if (this.isWebRTC) {
      // Create WebRTC data channel for screen share
      await this.createDataChannelForScreenShare(channelName);
    } else {
      // Create WebTransport bidirectional stream
      await this.createBidirectionalStream(channelName);
    }
  }

  /**
   * Create WebRTC data channel for screen share streams
   * Creates a new peer connection specifically for screen share
   */
  private async createDataChannelForScreenShare(channelName: ChannelName): Promise<void> {
    if (!this.webRtcManager) {
      throw new Error("WebRTC manager not set. Call setWebRTCManager() first.");
    }

    try {
      log(`[StreamManager] Creating WebRTC data channel for screen share: ${channelName}`);

      // Use WebRTCManager to create new connection for screen share channel
      await this.webRtcManager.connectMultipleChannels([channelName], this);

      log(`[StreamManager] Created WebRTC data channel for screen share: ${channelName}`);
    } catch (error) {
      console.error(`[StreamManager] Failed to create data channel for ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Create WebTransport bidirectional stream
   */
  private async createBidirectionalStream(
    channelName: ChannelName,
  ): Promise<void> {
    if (!this.webTransport) {
      throw new Error("WebTransport not initialized");
    }

    try {
      const stream = await this.webTransport.createBidirectionalStream();
      const readable = stream.readable;
      const writable = stream.writable;

      const writer = writable.getWriter();
      const reader = readable.getReader();

      this.streams.set(channelName, {
        writer,
        reader,
        configSent: false,
        config: null,
        metadataReady: false,
        videoDecoderConfig: null,
      });

      // Initialize channel stream with server
      await this.sendInitChannelStream(channelName);

      // Setup event reader for MEETING_CONTROL channel
      if (channelName === ChannelName.MEETING_CONTROL) {
        const streamData = this.streams.get(channelName);
        // Use the publisher state set by Publisher
        if (streamData) {

          this.commandSender?.sendPublisherState(streamData, this.publisherState);
          log("[StreamManager] Sent initial publisher state (WebTransport):", this.publisherState);
          this.commandSender?.startHeartbeat(streamData);
        }
        this.setupEventStreamReader(reader);
      }

      log(
        `[StreamManager] Created bidirectional stream for ${channelName}`,
      );
      this.emit("streamReady", { channelName });
    } catch (error) {
      console.error(
        `[StreamManager] Failed to create stream for ${channelName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Send init channel stream command to server
   */
  private async sendInitChannelStream(channelName: ChannelName): Promise<void> {
    const command = {
      type: "init_channel_stream",
      data: {
        channel: channelName,
      },
    };

    const commandJson = JSON.stringify(command);
    const commandBytes = new TextEncoder().encode(commandJson);

    const streamData = this.streams.get(channelName);
    if (!streamData || !streamData.writer) {
      throw new Error(`Stream ${channelName} not ready for init`);
    }

    // Send with length-delimited format
    const len = commandBytes.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(commandBytes, 4);

    await streamData.writer.write(out.slice());
    log(`[StreamManager] Sent init_channel_stream for ${channelName}`);
  }

  /**
   * Setup event stream reader for receiving server events (WebTransport)
   * Only for MEETING_CONTROL channel
   */
  private setupEventStreamReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): void {
    const delimitedReader = new LengthDelimitedReader(reader);

    // Start reading loop in background
    (async () => {
      try {
        log(`[StreamManager] Starting event reader`);

        while (true) {
          const message = await delimitedReader.readMessage();

          if (message === null) {
            log(`[StreamManager] Event stream ended`);
            break;
          }

          // Decode and parse message
          const messageStr = new TextDecoder().decode(message);

          try {
            const event = JSON.parse(messageStr);
            log(`[StreamManager] Received server event:`, event);

            // Emit to global event bus
            globalEventBus.emit(GlobalEvents.SERVER_EVENT, event);
          } catch (e) {
            log(
              `[StreamManager] Non-JSON event message:`,
              messageStr,
            );
          }
        }
      } catch (err) {
        console.error(
          `[StreamManager] Error reading event stream:`,
          err,
        );
      }
    })();
  }

  /**
   * Setup event data channel listener for receiving server events (WebRTC)
   * Only for MEETING_CONTROL channel
   * Uses StreamManager's streams map to get data channel by channel name
   */
  private setupEventDataChannelListener(channelName: ChannelName): void {
    const streamData = this.streams.get(channelName);
    if (!streamData || !streamData.dataChannel) {
      console.error(`[StreamManager] Cannot setup event listener: data channel not found for ${channelName}`);
      return;
    }

    const dataChannel = streamData.dataChannel;

    dataChannel.onmessage = (event) => {
      const data = event.data;
      try {
        const messageStr = new TextDecoder().decode(data);
        const serverEvent = JSON.parse(messageStr);
        log(`[StreamManager] Received server event via data channel (${channelName}):`, serverEvent);

        // Emit to global event bus
        globalEventBus.emit(GlobalEvents.SERVER_EVENT, serverEvent);
      } catch (e) {
        log(`[StreamManager] Error parsing server event from ${channelName}:`, e);
      }
    };

    log(`[StreamManager] Setup event listener for data channel ${channelName}`);
  }

  /**
   * Create WebRTC data channel (public method for direct use, same as JS)
   */
  async createDataChannelDirect(channelName: ChannelName, peerConnection: RTCPeerConnection): Promise<void> {
    log(`[StreamManager] Creating data channel: ${channelName}`);

    let ordered = false;
    if (channelName === ChannelName.MEETING_CONTROL) {
      ordered = true;
    }

    // Use id: 0 like JS - each channel has separate peer connection
    const dataChannel = peerConnection.createDataChannel(channelName, {
      ordered,
      id: 0,
      negotiated: true,
    });

    log(`[StreamManager] Data channel created for ${channelName}, readyState: ${dataChannel.readyState}`);

    const bufferAmounts = {
      SMALL: 8192,
      LOW: 16384,
      MEDIUM: 32768,
      HIGH: 65536,
    };

    if (channelName.includes("1080p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.HIGH;
    } else if (channelName.includes("720p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    } else if (channelName.includes("360p") || channelName === ChannelName.MICROPHONE) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.LOW;
    } else {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    }

    dataChannel.onbufferedamountlow = () => {
      const queue = this.getQueue(channelName);

      while (
        queue.length > 0 &&
        dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold
      ) {
        const packet = queue.shift();
        if (packet) {
          dataChannel.send(packet.slice());
          this.dcPacketSendTime.set(channelName, performance.now());
        }
      }
    };

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onerror = (error) => {
      console.error(`[StreamManager] Data channel ${channelName} error:`, error);
    };

    dataChannel.onclose = () => {
      log(`[StreamManager] Data channel ${channelName} closed`);
    };

    dataChannel.onopen = async () => {
      log(`[StreamManager] Data channel ${channelName} OPENED! readyState: ${dataChannel.readyState}`);

      // Match JS Publisher exactly
      this.streams.set(channelName, {
        id: 0,
        dataChannel,
        dataChannelReady: true,
        configSent: false,
        config: null,
      } as any);

      // Emit streamReady event for this channel
      this.emit("streamReady", { channelName });

      if (channelName === ChannelName.MEETING_CONTROL) {
        // Use the publisher state set by Publisher
        const streamData = this.streams.get(channelName);
        if (streamData) {
          await this.commandSender?.sendPublisherState(streamData, this.publisherState);
          log("[StreamManager] Sent initial publisher state (WebRTC):", this.publisherState);

          //       {
          //   "type": "event",
          //   "data": {
          //     "type": "custom",
          //     "target": {
          //       "group": { "ids": ["u1", "u2"] }
          //     },
          //     "value": {
          //       "action": "play_sound",
          //       "volume": 0.7
          //     }
          //   }
          // }

          const dummyEvent = {
            type: "custom",
            sender_stream_id: this.streamId,
            // target is one of types: room or group, with group having array of user's streamId
            target: {
              type: "room"
              // type: "group",
              // ids: ["u1", "u2"]
            },
            value: {
              action: "play_sound",
              volume: 0.7
            }
          };

          // console.warn(`[StreamManager] Sending dummy event after data channel open:`, dummyEvent);
          await this.commandSender?.sendEvent(streamData, dummyEvent);
          //send dummy custome event
        }

        // Setup event listener using channel name from streams map
        this.setupEventDataChannelListener(channelName);
      }

      log(`WebRTC data channel (${channelName}) established`);
    };



    // Monitor ICE connection state for debugging
    peerConnection.oniceconnectionstatechange = () => {
      log(`[StreamManager] ${channelName} ICE connection state: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'failed') {
        console.error(`[StreamManager] ${channelName} ICE connection FAILED!`);
      }
    };
  }



  async sendCustomEvent(targets: string[], value: any,): Promise<void> {
    let target: any;
    if (targets.length === 0) {
      target = { type: "room" }
    } else {
      target = { type: "group", ids: targets };
    };

    let streamData = this.streams.get(ChannelName.MEETING_CONTROL);

    if (!streamData) {
      log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} not ready yet for custom event, waiting...`);
      try {
        streamData = await this.waitForStream(ChannelName.MEETING_CONTROL);
        log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} is now ready for custom event`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${ChannelName.MEETING_CONTROL}:`, error);
        return;
      }
    }

    const event = {
      type: "custom",
      sender_stream_id: this.streamId,
      target,
      value
    };
    await this.commandSender?.sendEvent(streamData, event);
  }


  /**
   * Send video chunk (EXACT copy from JS handleVideoChunk logic)
   */
  async sendVideoChunk(
    channelName: ChannelName,
    chunk: EncodedVideoChunk,
    _metadata?: EncodedVideoChunkMetadata,
  ): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      return;
    }

    // Skip if config not sent yet
    if (!streamData.configSent) {
      return;
    }

    const chunkType: "key" | "delta" = chunk.type === "key" ? "key" : "delta";
    const frameType = FrameTypeHelper.getFrameType(channelName, chunkType);

    const arrayBuffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(arrayBuffer);

    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      arrayBuffer,
      chunk.timestamp,
      frameType,
      sequenceNumber,
    );

    await this.sendPacket(channelName, packet, frameType);
  }

  /**
   * Send audio chunk (EXACT copy from JS handleAudioChunk logic)
   */
  async sendAudioChunk(
    channelName: ChannelName,
    audioData: Uint8Array,
    timestamp: number,
  ): Promise<void> {
    let streamData = this.streams.get(channelName);

    // Wait for stream to be ready if not yet available (fixes Safari timing issue)
    if (!streamData) {
      // log(`[StreamManager] ⚠️ sendAudioChunk: No stream data for ${channelName}, waiting...`);
      try {
        streamData = await this.waitForStream(channelName, 5000); // 5 second timeout
        log(`[StreamManager] ✅ Stream ${channelName} is now ready for audio`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${channelName} for audio:`, error);
        return;
      }
    }

    // Additional check for WebRTC DataChannel readiness (Safari fix)
    if (this.isWebRTC && streamData.dataChannel) {
      if (streamData.dataChannel.readyState !== "open") {
        log(`[StreamManager] ⏭️ sendAudioChunk: DataChannel ${channelName} not open yet, state: ${streamData.dataChannel.readyState}`);
        return;
      }
      // log(`[StreamManager] 🔍 sendAudioChunk: DataChannel ${channelName} state: ${streamData.dataChannel.readyState}, bufferedAmount: ${streamData.dataChannel.bufferedAmount}`);
    }

    // Skip if config not sent yet
    if (!streamData.configSent) {
      log(`[StreamManager] ⏭️ sendAudioChunk: Config not sent yet for ${channelName}`);
      return;
    }

    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      audioData,
      timestamp,
      FrameType.AUDIO,
      sequenceNumber,
    );

    // log(`[StreamManager] 📤 sendAudioChunk: Sending packet for ${channelName}, seq: ${sequenceNumber}, size: ${packet.length}`);
    await this.sendPacket(channelName, packet, FrameType.AUDIO);
    // log(`[StreamManager] ✅ sendAudioChunk: Packet sent for ${channelName}`);
  }

  /**
   * Send configuration data (EXACT copy from JS handleVideoChunk logic)
   */
  async sendConfig(
    channelName: ChannelName,
    config: VideoConfig | AudioConfig,
    mediaType: "video" | "audio",
  ): Promise<void> {
    let streamData = this.streams.get(channelName);

    if (!streamData) {
      log(`[StreamManager] Stream ${channelName} not ready yet for config, waiting...`);
      try {
        streamData = await this.waitForStream(channelName);
        log(`[StreamManager] Stream ${channelName} is now ready for config`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${channelName} for config:`, error);
        return;
      }
    }

    let configPacket: any;

    if (mediaType === "video") {
      const vConfig = config as VideoConfig;
      configPacket = {
        type: "StreamConfig",
        channelName: channelName,
        mediaType: "video",
        config: {
          codec: vConfig.codec,
          codedWidth: vConfig.codedWidth,
          codedHeight: vConfig.codedHeight,
          frameRate: vConfig.frameRate,
          quality: vConfig.quality,
          description: (vConfig as any).description
            ? this.arrayBufferToBase64((vConfig as any).description)
            : null,
        },
      };
    } else {
      const aConfig = config as AudioConfig;

      // Convert Uint8Array description to base64 string
      let descriptionBase64 = null;
      if ((aConfig as any).description) {
        const desc = (aConfig as any).description;
        // Handle both Uint8Array and ArrayBuffer
        const uint8Array = desc instanceof Uint8Array
          ? desc
          : new Uint8Array(desc);
        descriptionBase64 = this.arrayBufferToBase64(uint8Array.buffer);
      }

      configPacket = {
        type: "StreamConfig",
        channelName: channelName,
        mediaType: "audio",
        config: {
          codec: aConfig.codec,
          sampleRate: aConfig.sampleRate,
          numberOfChannels: aConfig.numberOfChannels,
          description: descriptionBase64,
        },
      };
    }

    this.commandSender?.sendMediaConfig(channelName, streamData, JSON.stringify(configPacket));


    streamData.configSent = true;
    streamData.config = config as any;

    log(`[StreamManager] Config sent for ${channelName}`);
    log(`[StreamManager] Config packet:`, configPacket);
    this.emit("configSent", { channelName });
  }

  /**
   * Wait for a stream to be ready
   */
  private waitForStream(channelName: ChannelName, timeout = 10000): Promise<StreamData> {
    return new Promise((resolve, reject) => {
      // Check if already ready
      const existingStream = this.streams.get(channelName);
      if (existingStream) {
        resolve(existingStream);
        return;
      }

      const timeoutId = setTimeout(() => {
        this.off("streamReady", handleStreamReady);
        reject(new Error(`Timeout waiting for stream ${channelName} to be ready`));
      }, timeout);

      const handleStreamReady = (event: { channelName: ChannelName }) => {
        if (event.channelName === channelName) {
          clearTimeout(timeoutId);
          this.off("streamReady", handleStreamReady);
          const streamData = this.streams.get(channelName);
          if (streamData) {
            resolve(streamData);
          } else {
            reject(new Error(`Stream ${channelName} not found after ready event`));
          }
        }
      };

      this.on("streamReady", handleStreamReady);
    });
  }

  /**
   * Send event message
   */
  async sendEvent(eventData: object): Promise<void> {
    let streamData = this.streams.get(ChannelName.MEETING_CONTROL);

    if (!streamData) {
      log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} not ready yet, waiting...`);
      try {
        streamData = await this.waitForStream(ChannelName.MEETING_CONTROL);
        log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} is now ready`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${ChannelName.MEETING_CONTROL}:`, error);
        return;
      }
    }

    this.commandSender?.sendEvent(streamData, eventData);
  }

  /**
   * Send raw data over a specific channel
   * Generic method for sending arbitrary data
   *
   * @param channelName - Channel to send data on
   * @param data - Data to send (will be JSON stringified if object)
   */
  async sendData(channelName: ChannelName, data: unknown): Promise<void> {
    let dataBytes: Uint8Array;

    // Convert data to bytes
    if (data instanceof Uint8Array) {
      dataBytes = data;
    } else if (data instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(data);
    } else if (typeof data === "string") {
      dataBytes = new TextEncoder().encode(data);
    } else {
      // Assume it's an object, stringify it
      const jsonString = JSON.stringify(data);
      dataBytes = new TextEncoder().encode(jsonString);
    }

    // Create packet with EVENT frame type for generic data
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      dataBytes,
      Date.now(),
      FrameType.EVENT,
      sequenceNumber,
    );

    await this.sendPacket(channelName, packet, FrameType.EVENT);
  }

  /**
   * Send packet over transport
   */
  private async sendPacket(
    channelName: ChannelName,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      log(`[StreamManager] Stream ${channelName} not found`);
      throw new Error(`Stream ${channelName} not found`);
    }

    try {
      if (this.isWebRTC) {
        await this.sendViaDataChannel(channelName, streamData, packet, frameType);
      } else {
        await this.sendViaWebTransport(streamData, packet);
      }
    } catch (error) {
      console.error(
        `[StreamManager] Error sending packet on ${channelName}:`,
        error,
      );
      this.emit("sendError", { channelName, error });
      throw error;
    }
  }

  /**
   * Send via WebTransport stream
   */
  private async sendViaWebTransport(
    streamData: StreamData,
    packet: Uint8Array,
  ): Promise<void> {
    if (!streamData.writer) {
      throw new Error("Stream writer not available");
    }

    // Wrap packet with length-delimited format (4 bytes length prefix)
    const len = packet.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false); // 4 bytes length prefix
    out.set(packet, 4); // Copy packet after length prefix

    // Ensure the Uint8Array is backed by a regular ArrayBuffer (not SharedArrayBuffer)
    const dataToWrite = out.slice();
    await streamData.writer.write(dataToWrite);
  }

  /**
   * Send via WebRTC data channel with FEC encoding (EXACT copy from JS Publisher.sendOverDataChannel)
   */
  private async sendViaDataChannel(
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    const dataChannel = streamData.dataChannel;
    const dataChannelReady = streamData.dataChannelReady;

    if (!dataChannelReady || !dataChannel || dataChannel.readyState !== "open") {
      console.warn("DataChannel not ready");
      return;
    }

    try {
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const sequenceNumber = view.getUint32(0, false);

      const needFecEncode = frameType !== FrameType.EVENT && frameType !== FrameType.AUDIO;

      const transportPacketType = FrameTypeHelper.getTransportPacketType(frameType);

      if (needFecEncode) {
        if (!this.wasmInitialized) {
          await this.initWasmEncoder();
        }

        if (!this.WasmEncoder) {
          throw new Error("WASM encoder not initialized");
        }

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

        if (frameType === FrameType.CONFIG) {
          redundancy = 3;
        }

        const HEADER_SIZE = 20;
        const chunkSize = MTU - HEADER_SIZE;

        const encoder = new this.WasmEncoder(packet, chunkSize);

        const configBuf = encoder.getConfigBuffer();
        const configView = new DataView(configBuf.buffer, configBuf.byteOffset, configBuf.byteLength);

        const transferLength = configView.getBigUint64(0, false);
        const symbolSize = configView.getUint16(8, false);
        const sourceBlocks = configView.getUint8(10);
        const subBlocks = configView.getUint16(11, false);
        const alignment = configView.getUint8(13);

        const fecPackets = encoder.encode(redundancy);

        const raptorQConfig: RaptorQConfig = {
          transferLength,
          symbolSize,
          sourceBlocks,
          subBlocks,
          alignment,
        };

        for (let i = 0; i < fecPackets.length; i++) {
          const fecPacket = fecPackets[i];
          const wrapper = PacketBuilder.createFECPacket(
            fecPacket,
            sequenceNumber,
            transportPacketType,
            raptorQConfig,
          );
          this.sendOrQueue(channelName, dataChannel, wrapper);
        }

        encoder.free();
        return;
      }

      const wrapper = PacketBuilder.createRegularPacket(
        packet,
        sequenceNumber,
        transportPacketType,
      );
      this.sendOrQueue(channelName, dataChannel, wrapper);
    } catch (error) {
      console.error("Failed to send over DataChannel:", error);
    }
  }

  /**
   * Send packet or add to queue if buffer is full (EXACT copy from JS)
   */
  private sendOrQueue(
    channelName: ChannelName,
    dataChannel: RTCDataChannel,
    packet: Uint8Array,
  ): void {
    const queue = this.getQueue(channelName);

    if (
      dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold &&
      queue.length === 0
    ) {
      // JS sends packet directly - TypeScript requires slice() for type safety
      dataChannel.send(packet.slice());
    } else {
      queue.push(packet);
    }
  }

  /**
   * Get message queue for a channel (EXACT copy from JS)
   */
  private getQueue(channelName: ChannelName): Uint8Array[] {
    if (!this.dcMsgQueues.has(channelName)) {
      this.dcMsgQueues.set(channelName, []);
    }
    return this.dcMsgQueues.get(channelName)!;
  }

  /**
   * Check if stream is ready
   */
  isStreamReady(channelName: ChannelName): boolean {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      return false;
    }

    if (this.isWebRTC) {
      return streamData.dataChannelReady === true;
    }

    return streamData.writer !== null;
  }

  /**
   * Wait for a stream to be ready (data channel open for WebRTC)
   * @param channelName - Channel to wait for
   * @param timeout - Timeout in milliseconds (default 10000ms)
   */
  async waitForStreamReady(channelName: ChannelName, timeout = 10000): Promise<void> {
    const streamData = this.streams.get(channelName);

    // For WebTransport, stream is ready when writer is available (already sync)
    if (!this.isWebRTC) {
      if (streamData?.writer) {
        return;
      }
      // Wait for stream to be created
      await this.waitForStream(channelName, timeout);
      return;
    }

    // For WebRTC, need to wait for data channel to be open
    if (streamData?.dataChannel?.readyState === "open") {
      log(`[StreamManager] Stream ${channelName} already ready`);
      return;
    }

    log(`[StreamManager] Waiting for stream ${channelName} to be ready...`);

    // Wait for streamReady event which fires on dataChannel.onopen
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off("streamReady", handleStreamReady);
        reject(new Error(`Timeout waiting for stream ${channelName} to be ready`));
      }, timeout);

      const handleStreamReady = (event: { channelName: ChannelName }) => {
        if (event.channelName === channelName) {
          clearTimeout(timeoutId);
          this.off("streamReady", handleStreamReady);
          log(`[StreamManager] Stream ${channelName} is now ready`);
          resolve();
        }
      };

      // Check if already ready (race condition check)
      const existingStream = this.streams.get(channelName);
      if (existingStream?.dataChannel?.readyState === "open") {
        clearTimeout(timeoutId);
        log(`[StreamManager] Stream ${channelName} was already ready`);
        resolve();
        return;
      }

      this.on("streamReady", handleStreamReady);
    });
  }

  /**
   * Check if config has been sent
   */
  isConfigSent(channelName: ChannelName): boolean {
    const streamData = this.streams.get(channelName);
    return streamData?.configSent === true;
  }

  /**
   * Get stream data
   */
  getStream(channelName: ChannelName): StreamData | undefined {
    return this.streams.get(channelName);
  }

  /**
   * Close specific stream
   */
  async closeStream(channelName: ChannelName): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      return;
    }

    try {
      if (this.isWebRTC && streamData.dataChannel) {
        streamData.dataChannel.close();
      } else if (streamData.writer) {
        await streamData.writer.close();
      }

      this.streams.delete(channelName);
      log(`[StreamManager] Closed stream ${channelName}`);
    } catch (error) {
      console.error(
        `[StreamManager] Error closing stream ${channelName}:`,
        error,
      );
    }
  }

  /**
   * Close all streams
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const channelName of this.streams.keys()) {
      closePromises.push(this.closeStream(channelName));
    }

    await Promise.all(closePromises);
    this.streams.clear();
    log("[StreamManager] All streams closed");
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalStreams: number;
    activeStreams: number;
    sequenceNumbers: Record<string, number>;
    streams: Record<string, { ready: boolean; configSent: boolean }>;
  } {
    const stats: Record<string, { ready: boolean; configSent: boolean }> = {};
    const sequences: Record<string, number> = {};

    for (const [channelName, streamData] of this.streams.entries()) {
      stats[channelName] = {
        ready: this.isStreamReady(channelName),
        configSent: streamData.configSent,
      };
      sequences[channelName] = this.sequenceNumbers.get(channelName) || 0;
    }

    return {
      totalStreams: this.streams.size,
      activeStreams: Array.from(this.streams.values()).filter((s) =>
        this.isWebRTC ? s.dataChannelReady : s.writer !== null,
      ).length,
      sequenceNumbers: sequences,
      streams: stats,
    };
  }

  /**
   * Create packet with header for audio config description
   */
  public createAudioConfigPacket(
    channelName: ChannelName,
    data: Uint8Array,
  ): Uint8Array {
    const timestamp = performance.now() * 1000;
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    return PacketBuilder.createPacket(
      data,
      timestamp,
      FrameType.AUDIO,
      sequenceNumber,
    );
  }

  /**
   * Get and increment sequence number for a channel
   * @param channelName - Channel name
   * @returns Current sequence number
   */
  private getAndIncrementSequence(channelName: ChannelName): number {
    if (!this.sequenceNumbers.has(channelName)) {
      this.sequenceNumbers.set(channelName, 0);
    }
    const current = this.sequenceNumbers.get(channelName)!;
    this.sequenceNumbers.set(channelName, current + 1);
    return current;
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Reset sequence numbers for all channels
   */
  resetSequenceNumbers(): void {
    this.sequenceNumbers.clear();
  }

  /**
   * Get active channel names
   */
  getActiveChannels(): ChannelName[] {
    return Array.from(this.streams.keys());
  }
}
