/**
 * Shared Media Utilities
 *
 * These utilities are used by both Publisher and Subscriber
 */

// Utilities
export { FrameTypeHelper } from './utils/FrameTypeHelper';
export { PacketBuilder } from './utils/PacketBuilder';
export type { RaptorQConfig } from './utils/PacketBuilder';

// Re-export config types from StreamManager
export type { VideoConfig, AudioConfig } from '../publisher/transports/StreamManager';

// Re-export commonly used types
export type {
  StreamData,
  SubStream,
  ServerEvent,
  MeetingEvent,
  StreamInfo,
} from '../../types/media/publisher.types';

export {
  ChannelName,
  FrameType,
  TransportPacketType,
} from '../../types/media/publisher.types';
