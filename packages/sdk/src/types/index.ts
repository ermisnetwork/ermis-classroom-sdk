/**
 * Core types and interfaces for Ermis Meeting SDK
 */

// Re-export all types from specific modules
export * from "./core/participant.types";
export * from "./core/subRoom.types";
export * from "./core/room.types";
export * from "./core/ermisClient.types";
export * from "./media/publisher.types";
export * from "./media/subscriber.types";
export * from "./media/audioMixer.types";
export * from "./api/apiClient.types";
export * from "./utils/browserDetection.types";
export * from "./utils/mediaUtils.types";

export interface MeetingConfig {
  apiKey: string;
  serverUrl: string;
  debug?: boolean;
  autoConnect?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  screenShareEnabled?: boolean;
}

export interface RoomOptions {
  roomId: string;
  userId: string;
  userName?: string;
  metadata?: Record<string, unknown>;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  role: ParticipantRole;
  isLocal: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
  metadata?: Record<string, unknown>;
}

export enum ParticipantRole {
  HOST = "host",
  MODERATOR = "moderator",
  PARTICIPANT = "participant",
  VIEWER = "viewer",
}

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed",
}

export enum MediaType {
  AUDIO = "audio",
  VIDEO = "video",
  SCREEN = "screen",
}

export interface MediaTrackInfo {
  type: MediaType;
  enabled: boolean;
  muted: boolean;
  track?: MediaStreamTrack;
}

export interface RoomEvent {
  type: string;
  timestamp: number;
  data?: unknown;
}

// WebRTC related types
export interface RTCConfiguration {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  bundlePolicy?: RTCBundlePolicy;
}

// Audio/Video constraints
export interface MediaConstraints {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
}

// Error types
export class MeetingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "MeetingError";
  }
}

export enum ErrorCode {
  INITIALIZATION_FAILED = "initialization_failed",
  CONNECTION_FAILED = "connection_failed",
  MEDIA_FAILED = "media_failed",
  PERMISSION_DENIED = "permission_denied",
  INVALID_CONFIG = "invalid_config",
  NETWORK_ERROR = "network_error",
  UNKNOWN_ERROR = "unknown_error",
}
