/**
 * Publisher Utility Functions
 */

import {
  ChannelName,
  FrameType,
  TransportPacketType,
} from '../../../types/media/publisher.types';

/**
 * Get frame type based on channel name and chunk type
 */
export function getFrameType(channelName: ChannelName, chunkType: 'key' | 'delta'): FrameType {
  switch (channelName) {
    case ChannelName.CAMERA_360P:
      return chunkType === 'key' ? FrameType.CAM_360P_KEY : FrameType.CAM_360P_DELTA;
    case ChannelName.CAMERA_720P:
      return chunkType === 'key' ? FrameType.CAM_720P_KEY : FrameType.CAM_720P_DELTA;
    case ChannelName.SCREEN_SHARE_1080P:
      return chunkType === 'key' ? FrameType.SCREEN_SHARE_KEY : FrameType.SCREEN_SHARE_DELTA;
    default:
      return FrameType.CAM_720P_KEY;
  }
}

/**
 * Get transport packet type from frame type
 */
export function getTransportPacketType(frameType: FrameType): TransportPacketType {
  switch (frameType) {
    case FrameType.PING:
      return TransportPacketType.PING;
    case FrameType.EVENT:
      return TransportPacketType.EVENT;
    case FrameType.CONFIG:
      return TransportPacketType.CONFIG;
    case FrameType.AUDIO:
      return TransportPacketType.AUDIO;
    default:
      return TransportPacketType.VIDEO;
  }
}

/**
 * Get data channel ID from channel name (for WebRTC)
 */
export function getDataChannelId(channelName: ChannelName): number {
  switch (channelName) {
    case ChannelName.MEETING_CONTROL:
      return 0;
    case ChannelName.MICROPHONE:
      return 1;
    case ChannelName.CAMERA_360P:
      return 2;
    case ChannelName.CAMERA_720P:
      return 3;
    case ChannelName.SCREEN_SHARE_1080P:
      return 4;
    default:
      return 5;
  }
}

/**
 * Convert Uint8Array to Base64 string
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks for performance
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Load script dynamically
 */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src*="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Create packet header
 */
export function createPacketHeader(
  frameType: FrameType,
  timestamp: number,
  dataLength: number
): Uint8Array {
  const HEADER_SIZE = 13;
  const MAX_TS = 0xffffffffff; // 40 bits max
  const MIN_TS = 0;

  // Clamp timestamp to valid range
  let safeTimestamp = Math.max(MIN_TS, Math.min(MAX_TS, timestamp));

  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);

  // Byte 0: Frame type
  view.setUint8(0, frameType);

  // Bytes 1-5: Timestamp (40 bits)
  view.setUint8(1, (safeTimestamp >> 32) & 0xff);
  view.setUint32(2, safeTimestamp & 0xffffffff, false);

  // Bytes 6-12: Data length (64 bits)
  view.setUint32(6, 0, false); // High 32 bits (always 0 for our use case)
  view.setUint32(10, dataLength, false); // Low 32 bits

  return header;
}
