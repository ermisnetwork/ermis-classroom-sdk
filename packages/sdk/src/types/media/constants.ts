/**
 * Constants for media streaming
 */

import { ChannelName } from "./publisher.types";

/**
 * Packet header sizes
 */
export const PACKET_HEADER = {
  STANDARD_SIZE: 9, // 4 bytes sequenceNumber + 4 bytes timestamp + 1 byte frame type
  FEC_SIZE: 20, // 4 bytes seq + 1 byte FEC marker + 1 byte type + 14 bytes RaptorQ config
  REGULAR_SIZE: 6, // 4 bytes seq + 1 byte FEC flag + 1 byte type
} as const;

/**
 * WebRTC Data Channel IDs
 * Each channel has a predefined ID for negotiated data channels
 */
export const DATA_CHANNEL_IDS: Record<ChannelName, number> = {
  [ChannelName.MEETING_CONTROL]: 0,
  [ChannelName.MICROPHONE]: 1,
  [ChannelName.VIDEO_360P]: 2,
  [ChannelName.VIDEO_720P]: 3,
  [ChannelName.SCREEN_SHARE_720P]: 4,
  [ChannelName.SCREEN_SHARE_1080P]: 5,
  [ChannelName.SCREEN_SHARE_AUDIO]: 6,
} as const;

/**
 * Media constraints defaults
 */
export const MEDIA_CONSTRAINTS = {
  AUDIO: {
    SAMPLE_RATE: 48000,
    CHANNEL_COUNT: 1,
    ECHO_CANCELLATION: true,
    NOISE_SUPPRESSION: true,
  },
  VIDEO: {
    DEFAULT_WIDTH: 1280,
    DEFAULT_HEIGHT: 720,
    DEFAULT_FRAMERATE: 30,
    DEFAULT_BITRATE: 1_500_000,
  },
} as const;

/**
 * Stream timeouts and intervals
 */
export const TIMEOUTS = {
  DATA_CHANNEL_OPEN: 5000,
  CONNECTION_TIMEOUT: 10000,
  RECONNECT_INTERVAL: 3000,
} as const;

/**
 * Audio encoder settings
 */
export const AUDIO_ENCODER = {
  SAMPLES_PER_CHUNK: 960, // 20ms at 48kHz
  SAMPLE_RATE: 48000,
} as const;

/**
 * Video encoder settings
 */
export const VIDEO_ENCODER = {
  LATENCY_MODE: "realtime" as const,
  HARDWARE_ACCELERATION: "prefer-hardware" as const,
} as const;

/**
 * Video configuration defaults
 */
export const VIDEO_CONFIG = {
  KEYFRAME_INTERVAL: 30, // Keyframe every 30 frames (1 second at 30fps)
  MAX_QUEUE_SIZE: 2, // Max encoder queue size before dropping frames
} as const;

/**
 * Audio configuration defaults
 */
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 48000,
  CHANNEL_COUNT: 1,
  OPUS_SAMPLES_PER_CHUNK: 960, // 20ms at 48kHz
} as const;
