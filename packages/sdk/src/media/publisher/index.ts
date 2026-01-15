/**
 * Publisher Module Exports
 */

export { Publisher } from "./Publisher";
export { StreamManager } from "./transports/StreamManager";
export type { VideoConfig, AudioConfig } from "./transports/StreamManager";
export { WebTransportManager } from "./transports/WebTransportManager";
export { WebRTCManager } from "./transports/WebRTCManager";
export { VideoEncoderManager } from "./managers/VideoEncoderManager";
export { AudioEncoderManager } from "./managers/AudioEncoderManager";
export { AACEncoderManager } from "./managers/AACEncoderManager";
export { LivestreamAudioMixer } from "../audioMixer/LivestreamAudioMixer";
export type { LivestreamAudioMixerConfig } from "../audioMixer/LivestreamAudioMixer";
export { VideoProcessor } from "./processors/VideoProcessor";
export { AudioProcessor } from "./processors/AudioProcessor";

// Re-export shared utilities for convenience
export { FrameTypeHelper } from "../shared/utils/FrameTypeHelper";
export { PacketBuilder } from "../shared/utils/PacketBuilder";

// Re-export transport types
export type {
  WebTransportConfig,
  WebRTCConfig,
  TransportManagerEvents,
  WebRTCManagerEvents,
  ConnectionState,
  TransportType,
  TransportStats,
} from "../../types/media/transport.types";

// Re-export types
export type {
  PublisherConfig,
  AudioEncoderConfig,
  SubStream,
  StreamData,
  ServerEvent,
  MeetingEvent,
  StreamInfo,
  PublisherStateEvent,
  CameraSwitchResult,
  MediaStreamResult,
  VideoEncoderConfig,
  VideoEncoderObject,
  AudioRecorder,
  InitAudioRecorder,
} from "../../types/media/publisher.types";

export {
  ChannelName,
  FrameType,
  TransportPacketType,
} from "../../types/media/publisher.types";
