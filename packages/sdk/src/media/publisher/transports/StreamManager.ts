import EventEmitter from "../../../events/EventEmitter";
import { ChannelName, FrameType } from "../../../types/media/publisher.types";
import type {
  StreamData,
  ServerEvent,
} from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";
import { LengthDelimitedReader } from "../../shared/utils/LengthDelimitedReader";

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
  private peerConnection: RTCPeerConnection | null = null;

  constructor(isWebRTC: boolean = false) {
    super();
    this.isWebRTC = isWebRTC;
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

    console.log(
      `[StreamManager] Initialized ${channelNames.length} WebTransport streams`,
    );
  }

  /**
   * Initialize WebRTC data channels
   */
  async initWebRTCChannels(
    peerConnection: RTCPeerConnection,
    channelNames: ChannelName[],
  ): Promise<void> {
    this.peerConnection = peerConnection;

    for (const channelName of channelNames) {
      await this.createDataChannel(channelName);
    }

    console.log(
      `[StreamManager] Initialized ${channelNames.length} WebRTC data channels`,
    );
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
        this.setupEventStreamReader(reader, channelName);
      }

      console.log(
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
    console.log(`[StreamManager] Sent init_channel_stream for ${channelName}`);
  }

  /**
   * Setup event stream reader for receiving server events
   * Only for MEETING_CONTROL channel
   */
  private setupEventStreamReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    channelName: ChannelName,
  ): void {
    const delimitedReader = new LengthDelimitedReader(reader);

    // Start reading loop in background
    (async () => {
      try {
        console.log(`[StreamManager] Starting event reader for ${channelName}`);

        while (true) {
          const message = await delimitedReader.readMessage();
          console.log("[StreamManager] Message from server event stream:", message);

          if (message === null) {
            console.log(`[StreamManager] Event stream ${channelName} ended`);
            break;
          }

          // Decode and parse message
          const messageStr = new TextDecoder().decode(message);

          try {
            const event = JSON.parse(messageStr);
            console.log(`[StreamManager] Received server event:`, event);

            // Emit event to Publisher
            this.emit("serverEvent", event);
          } catch (e) {
            console.log(
              `[StreamManager] Non-JSON event message:`,
              messageStr,
            );
          }
        }
      } catch (err) {
        console.error(
          `[StreamManager] Error reading event stream ${channelName}:`,
          err,
        );
      }
    })();
  }

  /**
   * Create WebRTC data channel
   */
  private async createDataChannel(channelName: ChannelName): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("PeerConnection not initialized");
    }

    const channelId = FrameTypeHelper.getDataChannelId(channelName);

    const dataChannel = this.peerConnection.createDataChannel(channelName, {
      ordered: false,
      id: channelId,
      negotiated: true,
    });

    dataChannel.binaryType = "arraybuffer";

    // Set buffer threshold based on channel type
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

    // Setup queue drain handler
    dataChannel.onbufferedamountlow = () => {
      const queue = this.getQueue(channelName);

      while (
        queue.length > 0 &&
        dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold
      ) {
        const packet = queue.shift();
        if (packet) {
          dataChannel.send(packet.slice()); // Use slice() to avoid SharedArrayBuffer issues
          this.dcPacketSendTime.set(channelName, performance.now());
        }
      }
    };

    // Initialize queue and timing for this channel
    this.dcMsgQueues.set(channelName, []);
    this.dcPacketSendTime.set(channelName, performance.now());

    // Wait for channel to open
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Data channel ${channelName} open timeout`));
      }, 5000);

      dataChannel.onopen = () => {
        clearTimeout(timeout);
        console.log(
          `[StreamManager] Data channel ${channelName} opened (ID: ${channelId})`,
        );
        resolve();
      };

      dataChannel.onerror = (error) => {
        clearTimeout(timeout);
        console.error(
          `[StreamManager] Data channel ${channelName} error:`,
          error,
        );
        reject(error);
      };
    });

    this.streams.set(channelName, {
      writer: null as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      reader: null as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      configSent: false,
      config: null,
      metadataReady: false,
      videoDecoderConfig: null,
      dataChannel,
      dataChannelReady: true,
    });

    this.emit("streamReady", { channelName });
  }

  /**
   * Send video chunk
   */
  async sendVideoChunk(
    channelName: ChannelName,
    chunk: EncodedVideoChunk,
    _metadata?: EncodedVideoChunkMetadata,
  ): Promise<void> {
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
   * Send audio chunk
   */
  async sendAudioChunk(
    channelName: ChannelName,
    audioData: Uint8Array,
    timestamp: number,
  ): Promise<void> {
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      audioData,
      timestamp,
      FrameType.AUDIO,
      sequenceNumber,
    );

    await this.sendPacket(channelName, packet, FrameType.AUDIO);
  }

  /**
   * Send configuration data
   */
  async sendConfig(
    channelName: ChannelName,
    config: VideoConfig | AudioConfig,
    mediaType: "video" | "audio",
  ): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      throw new Error(`Stream ${channelName} not found`);
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

    // Send config wrapped in command format
    //  JSON.stringify(configPacket) before sending to sendMediaConfig
    // Then sendMediaConfig wraps it: { type: "media_config", data: stringifiedConfig }
    const command = {
      type: "media_config",
      data: JSON.stringify(configPacket),
    };

    const configJson = JSON.stringify(command);
    const configData = new TextEncoder().encode(configJson);

    // ⚠️ CRITICAL: Send directly without PacketBuilder header!
    //  sends config via commandSender which does NOT use packet headers
    // Config is sent as raw command bytes, not as a media packet
    if (this.isWebRTC) {
      // For WebRTC, send with CONFIG frame type
      await this.sendViaDataChannel(channelName, streamData, configData, FrameType.CONFIG);
    } else {
      // For WebTransport, send directly to stream
      await this.sendViaWebTransport(streamData, configData);
    }

    streamData.configSent = true;
    streamData.config = config as any;

    console.log(`[StreamManager] ✅ Config sent for ${channelName}`);
    console.log(`[StreamManager] Config packet:`, configPacket);
    console.log(`[StreamManager] Command wrapper:`, command);
    console.log(`[StreamManager] Final JSON:`, configJson);
    this.emit("configSent", { channelName });
  }

  /**
   * Send event message
   */
  async sendEvent(channelName: ChannelName, eventData: object): Promise<void> {
    const eventJson = JSON.stringify(eventData);
    const eventBytes = new TextEncoder().encode(eventJson);

    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      eventBytes,
      Date.now(),
      FrameType.EVENT,
      sequenceNumber,
    );

    await this.sendPacket(channelName, packet, FrameType.EVENT);
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
   * Send via WebRTC data channel
   */
  private async sendViaDataChannel(
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    if (!streamData.dataChannel || !streamData.dataChannelReady) {
      throw new Error("Data channel not ready");
    }

    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const transportPacketType =
      FrameTypeHelper.getTransportPacketType(frameType);
    const wrappedPacket = PacketBuilder.createRegularPacket(
      packet,
      sequenceNumber,
      transportPacketType,
    );

    // Use queue management instead of sending directly
    this.sendOrQueue(channelName, streamData.dataChannel, wrappedPacket);
  }

  /**
   * Send packet or add to queue if buffer is full
   */
  private sendOrQueue(
    channelName: ChannelName,
    dataChannel: RTCDataChannel,
    packet: Uint8Array,
  ): void {
    const queue = this.getQueue(channelName);

    // Send directly if buffer has space and queue is empty
    if (
      dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold &&
      queue.length === 0
    ) {
      dataChannel.send(packet.slice()); // Use slice() to avoid SharedArrayBuffer issues
      this.dcPacketSendTime.set(channelName, performance.now());
    } else {
      // Add to queue if buffer is full
      queue.push(packet);
    }
  }

  /**
   * Get message queue for a channel
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
      console.log(`[StreamManager] Closed stream ${channelName}`);
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
    console.log("[StreamManager] All streams closed");
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
