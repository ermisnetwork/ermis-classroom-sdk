/**
 * Publisher Types and Interfaces
 */

import { GopStreamSender } from "../../media/publisher/transports/GopStreamSender";

// Re-export ServerEvent from room.types to avoid duplication
export type { ServerEvent } from "../core/room.types";

// Stream type constants (for Publisher/Subscriber)
export const StreamTypes = {
  CAMERA: "camera",
  SCREEN_SHARE: "screen_share",
} as const;

export type StreamType = (typeof StreamTypes)[keyof typeof StreamTypes];

// Frame type constants
export enum FrameType {
  CAM_360P_KEY = 0,
  CAM_360P_DELTA = 1,
  CAM_720P_KEY = 2,
  CAM_720P_DELTA = 3,
  SCREEN_SHARE_KEY = 4,
  SCREEN_SHARE_DELTA = 5,
  AUDIO = 6,
  LIVESTREAM_KEY = 10,
  LIVESTREAM_DELTA = 11,
  CONFIG = 0xfd,
  EVENT = 0xfe,
  PUBLISHER_COMMAND = 0xff,
}

// Transport packet type constants
export enum TransportPacketType {
  VIDEO = 0x00,
  AUDIO = 0x01,
  CONFIG = 0xfd,
  EVENT = 0xfe,
  PUBLISHER_COMMAND = 0xff,
}

// Channel name constants
export enum ChannelName {
  MEETING_CONTROL = "meeting_control",
  MICROPHONE = "mic_48k",
  VIDEO_360P = "video_360p",
  VIDEO_720P = "video_720p",
  SCREEN_SHARE_720P = "screen_share_720p",
  SCREEN_SHARE_1080P = "screen_share_1080p",
  SCREEN_SHARE_AUDIO = "screen_share_audio",
  LIVESTREAM_720P = "livestream_720p",
  LIVESTREAM_AUDIO = "livestream_audio",
}

// Publisher configuration
export interface PublisherConfig {
  publishUrl: string;
  streamType?: "camera" | "display";
  streamId?: string;
  userId?: string | null;
  roomId?: string;
  useWebRTC?: boolean;
  mediaStream?: MediaStream | null;
  width?: number;
  height?: number;
  framerate?: number;
  bitrate?: number;
  hasCamera?: boolean;
  hasMic?: boolean;
  webRtcHost?: string;
  permissions: ParticipantPermissions;
  onStatusUpdate?: (message: string, isError?: boolean) => void;
  onStreamStart?: () => void;
  onStreamStop?: () => void;
}



export interface ParticipantPermissions {
  can_subscribe: boolean;
  can_publish: boolean;
  can_publish_data: boolean;
  can_publish_sources: Array<[ChannelName, boolean]>;
  hidden: boolean;
  can_update_metadata: boolean;
}


// Sub-stream configuration
export interface SubStream {
  name: string;
  channelName: ChannelName;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
}

// Stream data structure (supports both WebTransport and WebRTC)
export interface StreamData {
  // WebTransport fields
  writer?: WritableStreamDefaultWriter | null;
  reader?: ReadableStreamDefaultReader | null;

  // WebRTC fields (match JS Publisher)
  id?: number;
  dataChannel?: RTCDataChannel;
  dataChannelReady?: boolean;

  // Common fields
  configSent: boolean;
  config: VideoEncoderConfig | AudioEncoderConfig | null;

  // Video-specific fields (for encoders)
  metadataReady?: boolean;
  videoDecoderConfig?: VideoDecoderConfig | null;
}

// Encoder data structure
export interface EncoderData {
  encoder: VideoEncoder;
  config: VideoEncoderConfig;
  metadataReady: boolean;
  videoDecoderConfig: VideoDecoderConfig | null;
}

// Meeting event structure
export interface MeetingEvent {
  type: string;
  sender_stream_id: string;
  timestamp: number;
  data?: unknown;
}

// Media packet structure
export interface MediaPacket {
  frameType: FrameType;
  timestamp: number;
  data: Uint8Array;
  keyFrame?: boolean;
}

// Config packet structure
export interface ConfigPacket {
  type: "config";
  channelName: ChannelName;
  mediaType: "video" | "audio";
  config: VideoEncoderConfig | AudioEncoderConfig;
}

// Video encoder config
export interface VideoEncoderConfig {
  codec: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  latencyMode?: "quality" | "realtime";
  hardwareAcceleration?:
  | "no-preference"
  | "prefer-hardware"
  | "prefer-software";
}

// Audio encoder config
export interface AudioEncoderConfig {
  codec?: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: Uint8Array;
}

// Video encoder object
export interface VideoEncoderObject {
  encoder: VideoEncoder;
  channelName: ChannelName;
  config: VideoEncoderConfig;
  metadataReady: boolean;
  videoDecoderConfig?: VideoDecoderConfig | null;
}

// Audio recorder options
export interface AudioRecorderOptions {
  encoderApplication?: number;
  encoderComplexity?: number;
  encoderFrameSize?: number;
  timeSlice?: number;
}

// Stream info return type
export interface StreamInfo {
  streamType: string;
  config: VideoEncoderConfig;
  sequenceNumber: number;
  activeStreams: string[];
}

// Publisher state event
export interface PublisherStateEvent {
  type: "publisher_state";
  streamId: string;
  hasCamera: boolean;
  hasMic: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  streamType: string;
  timestamp: number;
}

// Camera switch result
export interface CameraSwitchResult {
  stream: MediaStream;
  videoOnlyStream: MediaStream;
}

// Media stream result
export interface MediaStreamResult {
  stream: MediaStream;
  videoOnlyStream: MediaStream | null;
  streamType: string;
  streamId: string;
  config: VideoEncoderConfig;
  hasAudio: boolean;
  hasVideo: boolean;
}

// FEC (Forward Error Correction) configuration
export interface FecConfig {
  transferLength: number;
  symbolSize: number;
  sourceBlocks: number;
  subBlocks: number;
  alignment: number;
}

// WASM Encoder interface
export interface WasmEncoder {
  encode: (data: Uint8Array, config: FecConfig) => Uint8Array[];
  new(): WasmEncoder;
}

// Audio recorder interface
export interface AudioRecorder {
  start: (options?: { timeSlice?: number }) => void;
  stop: () => void;
  ondataavailable: ((event: { data: Uint8Array }) => void) | null;
}

// Init audio recorder function type
export type InitAudioRecorder = (
  stream: MediaStream,
  options: AudioRecorderOptions,
) => Promise<AudioRecorder>;

export enum PinType {
  User = 1,
  ScreenShare = 2,
}

export type StreamDataGop = {
  gopId: number;
  gopSender: GopStreamSender;
  currentGopFrames: number;
}

/**
 * Result of recording permission request
 */
export interface RecordingPermissionResult {
  /** Whether permission was granted */
  granted: boolean;
  /** The captured MediaStream if granted */
  stream?: MediaStream;
  /** Error if permission was denied */
  error?: Error;
  
  // === User denial flags (granted = false) ===
  /** True if user chose not to share video */
  missingVideo?: boolean;
  /** True if user chose not to share audio (when audio was available) */
  missingAudio?: boolean;
  
  // === System unavailability flags (granted = true but limited) ===
  /** True if video is unavailable due to system limitations */
  videoUnavailable?: boolean;
  /** True if audio is unavailable due to sharing window/screen instead of tab */
  audioUnavailable?: boolean;
}
