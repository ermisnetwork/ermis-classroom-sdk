import { ChannelName, FrameType, getStreamPriority } from "../../../types/media/publisher.types";
import type { StreamDataGop } from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";
import { CHANNEL_NUMBERS, CHUNK_TYPE } from "../../../constants/mediaConstants";
import type { ChunkType } from "../../../constants/mediaConstants";

/**
 * VideoSendStrategy — encapsulates all video publish logic.
 *
 * Responsibilities:
 * - Extract raw bytes from EncodedVideoChunk / WASM chunk
 * - Build the on-wire packet
 * - WebTransport path: manage GOP lifecycle (startGop on keyframe → sendFrame)
 * - WebRTC / fallback path: delegate to sendPacket
 */
export class VideoSendStrategy {
  private readonly VIDEO_GOP_SIZE: number;

  constructor(
    private gopSenders: Map<ChannelName, StreamDataGop>,
    private sendPacketFallback: (ch: ChannelName, pkt: Uint8Array, ft: FrameType) => Promise<void>,
    private getAndIncrementSequence: (ch: ChannelName) => number,
    private isWebRTC: boolean,
    gopSize: number,
  ) {
    this.VIDEO_GOP_SIZE = gopSize;
  }

  /**
   * Send a single video chunk over the appropriate transport.
   */
  async send(
    channelName: ChannelName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: EncodedVideoChunk | any,
    _metadata?: EncodedVideoChunkMetadata,
  ): Promise<void> {
    const chunkType: ChunkType = chunk.type === CHUNK_TYPE.KEY ? CHUNK_TYPE.KEY : CHUNK_TYPE.DELTA;
    const frameType = FrameTypeHelper.getFrameType(channelName, chunkType);

    const arrayBuffer = this.extractArrayBuffer(chunk);
    if (!arrayBuffer) return;

    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      arrayBuffer,
      chunk.timestamp,
      frameType,
      sequenceNumber,
    );

    const channel = CHANNEL_NUMBERS[channelName];
    const isKeyframe = chunk.type === CHUNK_TYPE.KEY;

    const gopData = this.gopSenders.get(channelName);
    const gopSender = gopData?.gopSender;

    // WebTransport path: use GOP sender
    if (!this.isWebRTC && gopSender) {
      if (isKeyframe) {
        await gopSender.startGop(channel, this.VIDEO_GOP_SIZE, getStreamPriority(channelName));
        gopData.currentGopFrames = 0;
      }

      await gopSender.sendFrame(packet, chunk.timestamp, frameType);
      gopData.currentGopFrames++;
    } else {
      // WebRTC or fallback to BIDI stream
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
