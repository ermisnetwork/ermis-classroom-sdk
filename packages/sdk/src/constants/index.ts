/**
 * SDK Constants
 */

export const SDK_VERSION = '1.0.0';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const CONNECTION_TIMEOUT = 30000;
export const RECONNECT_TIMEOUT = 5000;
export const MAX_RECONNECT_ATTEMPTS = 5;

export const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// Export all publisher constants
export * from './publisherConstants';

export const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export const EVENT_TYPES = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
  CONNECTION_FAILED: 'connection_failed',
  ROOM_JOINED: 'room_joined',
  ROOM_LEFT: 'room_left',
  ROOM_STATE_CHANGED: 'room_state_changed',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
  PARTICIPANT_UPDATED: 'participant_updated',
  TRACK_ADDED: 'track_added',
  TRACK_REMOVED: 'track_removed',
  TRACK_MUTED: 'track_muted',
  TRACK_UNMUTED: 'track_unmuted',
  ERROR: 'error',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
