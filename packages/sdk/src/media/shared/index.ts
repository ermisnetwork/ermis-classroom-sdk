/**
 * Shared Media Utilities
 *
 * These utilities are used by both Publisher and Subscriber
 */

// Utilities
export { FrameTypeHelper } from './utils/FrameTypeHelper';
export { PacketBuilder } from './utils/PacketBuilder';
export type { RaptorQConfig } from './utils/PacketBuilder';

// Re-export commonly used types
export type {
  VideoConfig,
  AudioConfig,
  StreamData,
  SubStreamConfig,
  ServerEvent,
  MeetingEvent,
  StreamInfo,
} from '../../types/media/publisher.types';

export {
  ChannelName,
  FrameType,
  TransportPacketType,
} from '../../types/media/publisher.types';

// Re-export constants
export {
  PACKET_HEADER,
  DATA_CHANNEL_IDS,
  MEDIA_CONSTRAINTS,
  TIMEOUTS,
  AUDIO_ENCODER,
  VIDEO_ENCODER,
} from '../../types/media/constants';
