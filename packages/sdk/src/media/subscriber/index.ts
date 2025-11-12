/**
 * Subscriber Module Exports
 */

export { default as Subscriber } from "./Subscriber";

// Export managers
export { WebTransportManager } from "./transports/WebTransportManager";
export { WorkerManager } from "./managers/WorkerManager";
export { PolyfillManager } from "./managers/PolyfillManager";

// Export processors
export { VideoProcessor } from "./processors/VideoProcessor";
export { AudioProcessor } from "./processors/AudioProcessor";

// Re-export shared utilities
export { FrameTypeHelper } from "../shared/utils/FrameTypeHelper";
export { PacketBuilder } from "../shared/utils/PacketBuilder";

// Re-export publisher types
export type {
  VideoConfig,
  AudioConfig,
  StreamData,
  ServerEvent,
  StreamInfo,
} from "../../types/media/publisher.types";

export {
  ChannelName,
  FrameType,
  TransportPacketType,
} from "../../types/media/publisher.types";

// Subscriber types
export type {
  SubscriberConfig,
  SubscriberInfo,
  ConnectionStatus,
  QualityLevel,
  SubscriberAction,
  WorkerMessageData,
  WorkerMessageType,
  RemoteStreamReadyEvent,
  StreamRemovedEvent,
  AudioStatusEvent,
  StatusEvent,
  ConnectionStatusChangedEvent,
  SubscriberErrorEvent,
  AudioMixer,
  AudioWorkletNodeWithPort,
} from "../../types/media/subscriber.types";

// Transport types
export type {
  StreamChannelType,
  WebTransportStreamInfo,
} from "./transports/WebTransportManager";
