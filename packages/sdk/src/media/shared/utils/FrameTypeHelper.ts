import {
  FrameType,
  TransportPacketType,
  ChannelName,
} from "../../types/media/publisher.types";
import { DATA_CHANNEL_IDS } from "../../types/media/constants";

/**
 * FrameTypeHelper - Utility class for frame type conversions and mappings
 *
 * Responsibilities:
 * - Map channel names to frame types
 * - Convert frame types to transport packet types
 * - Get WebRTC data channel IDs
 * - Validate frame types
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FrameTypeHelper {
  /**
   * Get frame type based on channel name and chunk type
   *
   * @param channelName - Channel name (cam_360p, cam_720p, etc.)
   * @param chunkType - Chunk type ("key" or "delta")
   * @returns Corresponding frame type constant
   *
   * @example
   * getFrameType('cam_360p', 'key') // Returns FrameType.CAM_360P_KEY
   * getFrameType('cam_720p', 'delta') // Returns FrameType.CAM_720P_DELTA
   */
  static getFrameType(
    channelName: ChannelName,
    chunkType: "key" | "delta",
  ): FrameType {
    const isKeyFrame = chunkType === "key";

    switch (channelName) {
      case ChannelName.CAMERA_360P:
        return isKeyFrame ? FrameType.CAM_360P_KEY : FrameType.CAM_360P_DELTA;

      case ChannelName.CAMERA_720P:
        return isKeyFrame ? FrameType.CAM_720P_KEY : FrameType.CAM_720P_DELTA;

      case ChannelName.SCREEN_SHARE_1080P:
        return isKeyFrame
          ? FrameType.SCREEN_SHARE_KEY
          : FrameType.SCREEN_SHARE_DELTA;

      default:
        // Fallback to 720p key frame
        console.warn(`Unknown channel name: ${channelName}, using default`);
        return FrameType.CAM_720P_KEY;
    }
  }

  /**
   * Convert frame type to transport packet type
   * Groups frame types into broader transport categories
   *
   * @param frameType - Frame type constant
   * @returns Transport packet type
   *
   * @example
   * getTransportPacketType(FrameType.CAM_720P_KEY) // Returns TransportPacketType.VIDEO
   * getTransportPacketType(FrameType.AUDIO) // Returns TransportPacketType.AUDIO
   */
  static getTransportPacketType(frameType: FrameType): TransportPacketType {
    switch (frameType) {
      case FrameType.PING:
        return TransportPacketType.PING;

      case FrameType.EVENT:
        return TransportPacketType.EVENT;

      case FrameType.CONFIG:
        return TransportPacketType.CONFIG;

      case FrameType.AUDIO:
        return TransportPacketType.AUDIO;

      // All video frame types map to VIDEO transport type
      case FrameType.CAM_360P_KEY:
      case FrameType.CAM_360P_DELTA:
      case FrameType.CAM_720P_KEY:
      case FrameType.CAM_720P_DELTA:
      case FrameType.SCREEN_SHARE_KEY:
      case FrameType.SCREEN_SHARE_DELTA:
        return TransportPacketType.VIDEO;

      default:
        return TransportPacketType.VIDEO;
    }
  }

  /**
   * Get WebRTC data channel ID for a given channel name
   * Each channel has a predefined ID for negotiated data channels
   *
   * @param channelName - Channel name
   * @returns Data channel ID
   *
   * @example
   * getDataChannelId('cam_360p') // Returns 2
   * getDataChannelId('mic_48k') // Returns 1
   */
  static getDataChannelId(channelName: ChannelName): number {
    const id = DATA_CHANNEL_IDS[channelName];

    if (id === undefined) {
      console.warn(`Unknown channel name: ${channelName}, using default ID 5`);
      return 5;
    }

    return id;
  }

  /**
   * Check if frame type is a keyframe
   * @param frameType - Frame type to check
   * @returns True if keyframe, false otherwise
   */
  static isKeyFrame(frameType: FrameType): boolean {
    return (
      frameType === FrameType.CAM_360P_KEY ||
      frameType === FrameType.CAM_720P_KEY ||
      frameType === FrameType.SCREEN_SHARE_KEY
    );
  }

  /**
   * Check if frame type is video
   * @param frameType - Frame type to check
   * @returns True if video frame, false otherwise
   */
  static isVideoFrame(frameType: FrameType): boolean {
    return (
      frameType >= FrameType.CAM_360P_KEY &&
      frameType <= FrameType.SCREEN_SHARE_DELTA
    );
  }

  /**
   * Check if frame type is audio
   * @param frameType - Frame type to check
   * @returns True if audio frame, false otherwise
   */
  static isAudioFrame(frameType: FrameType): boolean {
    return frameType === FrameType.AUDIO;
  }

  /**
   * Check if frame type is control message
   * @param frameType - Frame type to check
   * @returns True if control message, false otherwise
   */
  static isControlMessage(frameType: FrameType): boolean {
    return (
      frameType === FrameType.CONFIG ||
      frameType === FrameType.EVENT ||
      frameType === FrameType.PING
    );
  }

  /**
   * Get human-readable description of frame type
   * @param frameType - Frame type
   * @returns Description string
   */
  static getFrameTypeDescription(frameType: FrameType): string {
    switch (frameType) {
      case FrameType.CAM_360P_KEY:
        return "Camera 360p Keyframe";
      case FrameType.CAM_360P_DELTA:
        return "Camera 360p Delta frame";
      case FrameType.CAM_720P_KEY:
        return "Camera 720p Keyframe";
      case FrameType.CAM_720P_DELTA:
        return "Camera 720p Delta frame";
      case FrameType.SCREEN_SHARE_KEY:
        return "Screen Share Keyframe";
      case FrameType.SCREEN_SHARE_DELTA:
        return "Screen Share Delta frame";
      case FrameType.AUDIO:
        return "Audio frame";
      case FrameType.CONFIG:
        return "Configuration message";
      case FrameType.EVENT:
        return "Event message";
      case FrameType.PING:
        return "Ping message";
      default:
        return "Unknown frame type";
    }
  }
}
