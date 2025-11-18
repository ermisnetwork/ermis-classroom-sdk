import type {
  FrameType,
  TransportPacketType,
} from "../../../types/media/publisher.types";
import { PACKET_HEADER } from "../../../constants/mediaConstants";

/**
 * RaptorQ FEC Configuration
 */
export interface RaptorQConfig {
  transferLength: bigint;
  symbolSize: number;
  sourceBlocks: number;
  subBlocks: number;
  alignment: number;
}

/**
 * PacketBuilder - Utility class for creating network packets with headers
 *
 * Responsibilities:
 * - Create regular packets with standard headers (5 bytes)
 * - Create FEC packets with RaptorQ headers (20 bytes)
 * - Manage timestamp normalization
 * - Handle packet type encoding
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PacketBuilder {
  private static videoBaseTimestamp: number | undefined;

  /**
   * Create a standard packet with 9-byte header
   * Header structure:
   * - 4 bytes: sequence number (uint32, big-endian)
   * - 4 bytes: timestamp (uint32, big-endian)
   * - 1 byte: frame type
   *
   * @param data - Raw data to be packetized
   * @param timestamp - Frame timestamp in microseconds
   * @param frameType - Type of frame (video/audio/control)
   * @param sequenceNumber - Packet sequence number
   * @returns Complete packet with header
   */
  static createPacket(
    data: ArrayBuffer | Uint8Array,
    timestamp: number,
    frameType: FrameType,
    sequenceNumber: number,
  ): Uint8Array {
    const adjustedTimestamp = PacketBuilder.normalizeTimestamp(timestamp);
    const safeTimestamp = PacketBuilder.validateTimestamp(adjustedTimestamp);

    const dataArray = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const packet = new Uint8Array(
      PACKET_HEADER.STANDARD_SIZE + dataArray.length,
    );

    // Write sequence number (4 bytes, big-endian)
    const view = new DataView(packet.buffer, 0, 8);
    view.setUint32(0, sequenceNumber, false);

    // Write timestamp (4 bytes, big-endian)
    view.setUint32(4, safeTimestamp, false);

    // Write frame type (1 byte)
    packet[8] = frameType;

    // Copy payload
    packet.set(dataArray, PACKET_HEADER.STANDARD_SIZE);

    return packet;
  }

  /**
   * Create FEC-encoded packet with 20-byte header
   * Header structure:
   * - 4 bytes: sequence number (uint32)
   * - 1 byte: FEC marker (0xFF)
   * - 1 byte: packet type
   * - 14 bytes: RaptorQ configuration
   *
   * @param data - Raw data to be packetized
   * @param sequenceNumber - Packet sequence number
   * @param packetType - Transport packet type
   * @param raptorQConfig - FEC configuration
   * @returns Complete FEC packet with header
   */
  static createFECPacket(
    data: Uint8Array,
    sequenceNumber: number,
    packetType: TransportPacketType,
    raptorQConfig: RaptorQConfig,
  ): Uint8Array {
    const header = new ArrayBuffer(PACKET_HEADER.FEC_SIZE);
    const view = new DataView(header);

    // Sequence number (4 bytes)
    view.setUint32(0, sequenceNumber, false);

    // FEC marker (1 byte)
    view.setUint8(4, 0xff);

    // Packet type (1 byte)
    view.setUint8(5, packetType);

    // RaptorQ configuration (14 bytes)
    view.setBigUint64(6, raptorQConfig.transferLength, false);
    view.setUint16(14, raptorQConfig.symbolSize, false);
    view.setUint8(16, raptorQConfig.sourceBlocks);
    view.setUint16(17, raptorQConfig.subBlocks, false);
    view.setUint8(19, raptorQConfig.alignment);

    // Combine header and payload
    const packet = new Uint8Array(header.byteLength + data.length);
    packet.set(new Uint8Array(header), 0);
    packet.set(data, header.byteLength);

    return packet;
  }

  /**
   * Create regular packet with standard header (non-FEC)
   * Header structure:
   * - 4 bytes: sequence number
   * - 1 byte: FEC flag (0x00 = not FEC)
   * - 1 byte: packet type
   *
   * @param data - Raw packet data
   * @param sequenceNumber - Sequence number for ordering
   * @param packetType - Transport packet type
   * @returns Wrapped packet with standard header
   */
  static createRegularPacket(
    data: Uint8Array,
    sequenceNumber: number,
    packetType: TransportPacketType,
  ): Uint8Array {
    const packet = new Uint8Array(6 + data.length);
    const view = new DataView(packet.buffer);

    // Sequence number (4 bytes)
    view.setUint32(0, sequenceNumber, false);

    // FEC flag (1 byte) - 0x00 means not FEC
    view.setUint8(4, 0x00);

    // Packet type (1 byte)
    view.setUint8(5, packetType);

    // Copy payload
    packet.set(data, 6);

    return packet;
  }

  /**
   * Normalize timestamp relative to base timestamp
   * @param timestamp - Raw timestamp in microseconds
   * @returns Normalized timestamp
   */
  private static normalizeTimestamp(timestamp: number): number {
    if (PacketBuilder.videoBaseTimestamp === undefined) {
      PacketBuilder.videoBaseTimestamp = timestamp;
      return 0;
    }
    return timestamp - PacketBuilder.videoBaseTimestamp;
  }

  /**
   * Validate and clamp timestamp to safe range
   * @param timestamp - Timestamp to validate
   * @returns Safe timestamp value
   */
  private static validateTimestamp(timestamp: number): number {
    const MAX_TIMESTAMP = 0xffffffff; // 32-bit max
    const MIN_TIMESTAMP = 0;

    // Convert to milliseconds and floor
    let safeTimestamp = Math.floor(timestamp / 1000);

    // Clamp to valid range
    if (safeTimestamp < MIN_TIMESTAMP) {
      safeTimestamp = MIN_TIMESTAMP;
    } else if (safeTimestamp > MAX_TIMESTAMP) {
      safeTimestamp = MAX_TIMESTAMP;
    }

    return safeTimestamp;
  }

  /**
   * Reset base timestamp (useful for stream restart)
   */
  static resetBaseTimestamp(): void {
    PacketBuilder.videoBaseTimestamp = undefined;
  }

  /**
   * Get current base timestamp
   */
  static getBaseTimestamp(): number | undefined {
    return PacketBuilder.videoBaseTimestamp;
  }
}
