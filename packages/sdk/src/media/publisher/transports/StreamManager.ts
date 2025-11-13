import EventEmitter from "../../../events/EventEmitter";
import { ChannelName, FrameType } from "../../../types/media/publisher.types";
import type {
  StreamData,
} from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";

// Temporary type definitions
interface VideoConfig {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  codec?: string;
}

interface AudioConfig {
  sampleRate: number;
  numberOfChannels: number;
  codec?: string;
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
}> {
  private streams = new Map<ChannelName, StreamData>();
  private isWebRTC: boolean;
  private sequenceNumber = 0;
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

      // Send channel name as initialization
      const initData = new TextEncoder().encode(channelName);
      await writer.write(initData);

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

    const packet = PacketBuilder.createPacket(
      arrayBuffer,
      chunk.timestamp,
      frameType,
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
    const packet = PacketBuilder.createPacket(
      audioData,
      timestamp,
      FrameType.AUDIO,
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

    const configJson = JSON.stringify({
      type: "config",
      mediaType,
      codec: config.codec,
      width: (config as VideoConfig).width,
      height: (config as VideoConfig).height,
      framerate: (config as VideoConfig).framerate,
      bitrate: (config as VideoConfig).bitrate,
      sampleRate: (config as AudioConfig).sampleRate,
      numberOfChannels: (config as AudioConfig).numberOfChannels,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      description: (config as any).description
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.arrayBufferToBase64((config as any).description)
        : null,
    });

    const configData = new TextEncoder().encode(configJson);
    const packet = PacketBuilder.createPacket(
      configData,
      Date.now(),
      FrameType.CONFIG,
    );

    await this.sendPacket(channelName, packet, FrameType.CONFIG);

    streamData.configSent = true;
    streamData.config = config as any; // Type workaround

    console.log(`[StreamManager] Config sent for ${channelName}:`, config);
    this.emit("configSent", { channelName });
  }

  /**
   * Send event message
   */
  async sendEvent(channelName: ChannelName, eventData: object): Promise<void> {
    const eventJson = JSON.stringify(eventData);
    const eventBytes = new TextEncoder().encode(eventJson);

    const packet = PacketBuilder.createPacket(
      eventBytes,
      Date.now(),
      FrameType.EVENT,
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
    const packet = PacketBuilder.createPacket(
      dataBytes,
      Date.now(),
      FrameType.EVENT,
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
        await this.sendViaDataChannel(streamData, packet, frameType);
      } else {
        await this.sendViaWebTransport(streamData, packet);
      }

      this.sequenceNumber++;
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

    // Ensure the Uint8Array is backed by a regular ArrayBuffer (not SharedArrayBuffer)
    const dataToWrite = packet.slice();
    await streamData.writer.write(dataToWrite);
  }

  /**
   * Send via WebRTC data channel
   */
  private async sendViaDataChannel(
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    if (!streamData.dataChannel || !streamData.dataChannelReady) {
      throw new Error("Data channel not ready");
    }

    const transportPacketType =
      FrameTypeHelper.getTransportPacketType(frameType);
    const wrappedPacket = PacketBuilder.createRegularPacket(
      packet,
      this.sequenceNumber,
      transportPacketType,
    );

    streamData.dataChannel.send(wrappedPacket.slice());
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
    sequenceNumber: number;
    streams: Record<string, { ready: boolean; configSent: boolean }>;
  } {
    const stats: Record<string, { ready: boolean; configSent: boolean }> = {};

    for (const [channelName, streamData] of this.streams.entries()) {
      stats[channelName] = {
        ready: this.isStreamReady(channelName),
        configSent: streamData.configSent,
      };
    }

    return {
      totalStreams: this.streams.size,
      activeStreams: Array.from(this.streams.values()).filter((s) =>
        this.isWebRTC ? s.dataChannelReady : s.writer !== null,
      ).length,
      sequenceNumber: this.sequenceNumber,
      streams: stats,
    };
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
   * Reset sequence number
   */
  resetSequenceNumber(): void {
    this.sequenceNumber = 0;
  }

  /**
   * Get active channel names
   */
  getActiveChannels(): ChannelName[] {
    return Array.from(this.streams.keys());
  }
}
