import { ChannelName, FrameType, getStreamPriority } from "../../../types/media/publisher.types";
import type { StreamDataGop } from "../transports/GopStreamSender";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";
import { CHANNEL_NUMBERS, CHUNK_TYPE } from "../../../constants/mediaConstants";
import type { ChunkType } from "../../../constants/mediaConstants";
import type { SendGate } from "../controllers/SendGate";

/**
 * VideoSendStrategy — encapsulates all video publish logic.
 *
 * Responsibilities:
 * - Extract raw bytes from EncodedVideoChunk / WASM chunk
 * - Build the on-wire packet
 * - SendGate: proactively drop frames when congested (before touching QUIC)
 * - WebTransport path: manage GOP lifecycle (startGop on keyframe → sendFrame)
 * - WebRTC / fallback path: delegate to sendPacket
 */
export class VideoSendStrategy {
  private readonly gopSizeMap: Map<ChannelName, number>;
  private readonly defaultGopSize: number;

  constructor(
    private gopSenders: Map<ChannelName, StreamDataGop>,
    private sendPacketFallback: (ch: ChannelName, pkt: Uint8Array, ft: FrameType) => Promise<void>,
    private getAndIncrementSequence: (ch: ChannelName) => number,
    private isWebRTC: boolean,
    gopSizeMap: Map<ChannelName, number>,
    defaultGopSize: number,
    private sendGate?: SendGate,
  ) {
    this.gopSizeMap = gopSizeMap;
    this.defaultGopSize = defaultGopSize;
  }

  /**
   * Send a single video chunk over the appropriate transport.
   */
  async send(
    channelName: ChannelName,
    chunk: EncodedVideoChunk | any,
    _metadata?: EncodedVideoChunkMetadata,
  ): Promise<void> {
    const isKeyframe = chunk.type === CHUNK_TYPE.KEY;

    const chunkType: ChunkType = isKeyframe ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    const frameType = FrameTypeHelper.getFrameType(channelName, chunkType);

    const channel = CHANNEL_NUMBERS[channelName];
    const gopData = this.gopSenders.get(channelName);
    const gopSender = gopData?.gopSender;

    // WebTransport path: use GOP sender with GOP-level gating
    if (!this.isWebRTC && gopSender) {
      if (isKeyframe) {
        // ★ GOP-level gating: decide whether the ENTIRE GOP passes or drops.
        // This prevents mid-GOP frame drops which cause H.264 decoder artifacts.
        if (this.sendGate) {
          const gopAllowed = this.sendGate.startNewGop();
          if (!gopAllowed) {
            return; // Drop entire GOP including keyframe
          }
        }

        const gopSize = this.gopSizeMap.get(channelName) ?? this.defaultGopSize;
        await gopSender.startGop(channel, gopSize, getStreamPriority(channelName));
        gopData.currentGopFrames = 0;
      }

      // ★ Per-frame gate: handles SEVERE (keyframe only) and CRITICAL (drop all).
      // For NORMAL/MILD/MODERATE, this follows the GOP-level decision from startNewGop().
      if (this.sendGate && !this.sendGate.shouldSendVideo(isKeyframe)) {
        return;
      }

      const arrayBuffer = this.extractArrayBuffer(chunk);
      if (!arrayBuffer) return;

      const sequenceNumber = this.getAndIncrementSequence(channelName);
      const packet = PacketBuilder.createPacket(
        arrayBuffer,
        chunk.timestamp,
        frameType,
        sequenceNumber,
      );

      await gopSender.sendFrame(packet, chunk.timestamp, frameType);
      gopData.currentGopFrames++;
    } else {
      // WebRTC or fallback to BIDI stream — use frame-level gate only
      if (this.sendGate && !this.sendGate.shouldSendVideo(isKeyframe)) {
        return;
      }

      const arrayBuffer = this.extractArrayBuffer(chunk);
      if (!arrayBuffer) return;

      const sequenceNumber = this.getAndIncrementSequence(channelName);
      const packet = PacketBuilder.createPacket(
        arrayBuffer,
        chunk.timestamp,
        frameType,
        sequenceNumber,
      );

      console.warn(
        `[VideoSendStrategy] ⚠️ Video fallback to BIDI stream: channel=${channelName} isWebRTC=${this.isWebRTC} gopSender=${!!gopSender} gopData=${!!gopData}`,
      );
      await this.sendPacketFallback(channelName, packet, frameType);
    }
  }

  /**
   * Extract raw ArrayBuffer from an EncodedVideoChunk or WASM encoder chunk.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractArrayBuffer(chunk: EncodedVideoChunk | any): ArrayBuffer | null {
    // Handle both native EncodedVideoChunk and WASM encoder chunks
    // Prioritize chunk.data (WASM) as it is direct access and avoids potential copyTo issues
    if (chunk.data) {
      if (chunk.data instanceof ArrayBuffer) {
        return chunk.data;
      } else if (chunk.data instanceof Uint8Array) {
        return chunk.data.buffer.slice(
          chunk.data.byteOffset,
          chunk.data.byteOffset + chunk.data.byteLength,
        );
      } else {
        console.error('[VideoSendStrategy] Unknown chunk data type:', typeof chunk.data);
        return null;
      }
    } else if (typeof chunk.copyTo === 'function') {
      // Native EncodedVideoChunk — use copyTo method
      try {
        const arrayBuffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(arrayBuffer);
        return arrayBuffer;
      } catch (err) {
        console.error('[VideoSendStrategy] chunk.copyTo failed:', err);
        return null;
      }
    } else {
      console.error('[VideoSendStrategy] Unknown chunk format — no copyTo or data property');
      return null;
    }
  }
}
