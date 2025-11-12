/**
 * Publisher Types and Interfaces
 */

// Frame type constants
export enum FrameType {
  CAM_360P_KEY = 0,
  CAM_360P_DELTA = 1,
  CAM_720P_KEY = 2,
  CAM_720P_DELTA = 3,
  SCREEN_SHARE_KEY = 4,
  SCREEN_SHARE_DELTA = 5,
  AUDIO = 6,
  CONFIG = 0xfd,
  EVENT = 0xfe,
  PING = 0xff,
}

// Transport packet type constants
export enum TransportPacketType {
  VIDEO = 0x00,
  AUDIO = 0x01,
  CONFIG = 0xfd,
  EVENT = 0xfe,
  PING = 0xff,
}

// Channel name constants
export enum ChannelName {
  MEETING_CONTROL = "meeting_control",
  MICROPHONE = "mic_48k",
  CAMERA_360P = "cam_360p",
  CAMERA_720P = "cam_720p",
  SCREEN_SHARE_1080P = "screen_share_1080p",
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
  webRtcServerUrl?: string;
  onStatusUpdate?: (message: string, isError?: boolean) => void;
  onStreamStart?: () => void;
  onStreamStop?: () => void;
  onServerEvent?: (event: ServerEvent) => void;
}

// Sub-stream configuration
export interface SubStreamConfig {
  name: string;
  channelName: ChannelName;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
}

// Stream data structure
export interface StreamData {
  writer: WritableStreamDefaultWriter | null;
  reader: ReadableStreamDefaultReader | null;
  configSent: boolean;
  config: VideoEncoderConfig | null;
  metadataReady: boolean;
  videoDecoderConfig: VideoDecoderConfig | null;
  dataChannel?: RTCDataChannel;
  dataChannelReady?: boolean;
}

// Encoder data structure
export interface EncoderData {
  encoder: VideoEncoder;
  config: VideoEncoderConfig;
  metadataReady: boolean;
  videoDecoderConfig: VideoDecoderConfig | null;
}

// Server event structure
export interface ServerEvent {
  type: string;
  data?: unknown;
  timestamp?: number;
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
  start: () => void;
  stop: () => void;
  ondataavailable: ((event: { data: Uint8Array }) => void) | null;
}

// Init audio recorder function type
export type InitAudioRecorder = (
  stream: MediaStream,
  options: AudioRecorderOptions,
) => Promise<AudioRecorder>;
