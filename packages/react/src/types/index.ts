/**
 * Types for Ermis Classroom React Components
 */

import type { ReactNode } from 'react';
import type {
  Participant,
  Room,
  ErmisClientConfig,
  MediaDevices,
  SelectedDevices,
  ErmisClient,
  ChannelName,
  QualityLevel,
} from '@ermisnetwork/ermis-classroom-sdk';

/**
 * Configuration for ErmisClassroomProvider
 */
export interface ErmisClassroomConfig extends ErmisClientConfig {
  /** Server host */
  host: string;
  /** WebTransport URL */
  webtpUrl: string;
  /** Publish protocol (webrtc or webtransport) */
  publishProtocol?: string;
  /** Subscribe protocol (websocket or webtransport) */
  subscribeProtocol?: string;
  /**
   * Video resolutions to publish. Default: 360p + 720p.
   * To enable 1080p: [ChannelName.VIDEO_1080P]
   * To publish only one: [ChannelName.VIDEO_720P]
   */
  videoResolutions?: ChannelName[];
  /**
   * Initial video quality for subscribers. Default: '360p'.
   * To subscribe 1080p from start: '1080p'
   */
  subscriberInitQuality?: QualityLevel;
}

/**
 * Props for ErmisClassroomProvider component
 */
export interface ErmisClassroomProviderProps {
  /** SDK configuration */
  config: ErmisClassroomConfig;
  /** Child components */
  children: ReactNode;
}

/**
 * Screen share data
 */
export interface ScreenShareData {
  /** Unique identifier for the screen share */
  id: string;
  /** User name of the screen sharer */
  userName: string;
  /** Screen share stream */
  stream: MediaStream;
}

/**
 * Connection status type
 */
export type ConnectionStatusType = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * Connection state for the SDK
 */
export interface ConnectionState {
  /** Current connection status */
  status: ConnectionStatusType;
  /** Whether the client is authenticated */
  isAuthenticated: boolean;
  /** Whether the client is in a room */
  inRoom: boolean;
}

/**
 * Local media state
 */
export interface LocalMediaState {
  /** Local media stream */
  localStream: MediaStream | null;
  /** Preview stream (before joining room) */
  previewStream: MediaStream | null;
  /** Whether microphone is enabled */
  micEnabled: boolean;
  /** Whether camera is enabled */
  videoEnabled: boolean;
  /** Whether screen sharing is active */
  isScreenSharing: boolean;
}

/**
 * Room state
 */
export interface RoomState {
  /** Current room instance */
  room: Room | null;
  /** Room code */
  roomCode: string | undefined;
  /** Whether in a room */
  inRoom: boolean;
  /** Current user ID */
  userId: string | undefined;
}

/**
 * Participant state
 */
export interface ParticipantsState {
  /** All participants (userId -> Participant) */
  participants: Map<string, Participant>;
  /** Remote streams (userId -> MediaStream) */
  remoteStreams: Map<string, MediaStream>;
  /** Screen share streams (userId -> ScreenShareData) */
  screenShareStreams: Map<string, ScreenShareData>;
}

/**
 * Media device state
 */
export interface MediaDeviceState {
  /** Available devices */
  devices: MediaDevices | null;
  /** Currently selected devices */
  selectedDevices: SelectedDevices | null;
}

/**
 * Pin state
 */
export interface PinState {
  /** Pin type */
  pinType: 'local' | 'everyone' | null;
  /** Whether hand is raised */
  handRaised: boolean;
}

/**
 * Context value for ErmisClassroomContext
 */
export interface ErmisClassroomContextValue {
  // Client
  client: ErmisClient | null;

  // Connection state
  isAuthenticated: boolean;
  inRoom: boolean;

  // Room state
  currentRoom: Room | null;
  roomCode: string | undefined;
  userId: string | undefined;
  /** Whether the current user is the room owner (host) */
  isRoomOwner: boolean;

  // Participants
  participants: Map<string, Participant>;
  remoteStreams: Map<string, MediaStream>;

  // Local media
  localStream: MediaStream | null;
  previewStream: MediaStream | null;
  micEnabled: boolean;
  videoEnabled: boolean;

  // Screen sharing
  screenShareStreams: Map<string, ScreenShareData>;
  isScreenSharing: boolean;

  // Pin/Hand state
  pinType: 'local' | 'everyone' | null;
  handRaised: boolean;

  // Devices
  devices: MediaDevices | null;
  selectedDevices: SelectedDevices | null;

  // Actions
  authenticate: (userId: string) => Promise<void>;
  joinRoom: (code: string, customStream?: MediaStream, replace?: boolean) => Promise<void>;
  connectRoom: (roomCode: string) => Promise<{ is_in_room: boolean }>;
  leaveRoom: () => Promise<void>;
  /** End the meeting room (only available for room owner) */
  endRoom: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleRaiseHand: () => Promise<void>;
  togglePin: (participantId: string, pinFor: 'local' | 'everyone', action?: 'pin' | 'unpin') => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  switchCamera: (deviceId: string) => Promise<void>;
  switchMicrophone: (deviceId: string) => Promise<void>;
  getPreviewStream: (cameraId?: string, micId?: string) => Promise<MediaStream>;
  stopPreviewStream: () => void;
  replaceMediaStream: (newStream: MediaStream) => Promise<void>;
  sendCustomEvent: (eventType: string, data: any) => Promise<void>;

  // Sub-room actions
  createSubRoom: (config: any) => Promise<any>;
  closeSubRoom: () => Promise<void>;

  /** Register callback for when room is ended by host */
  onRoomEnded: (callback: () => void) => () => void;

  // Host-only actions
  /** Mute a participant's microphone (HOST ONLY) */
  muteParticipant: (participantUserId: string) => Promise<void>;
  /** Unmute a participant's microphone (HOST ONLY) */
  unmuteParticipant: (participantUserId: string) => Promise<void>;
  /** Disable a participant's camera (HOST ONLY) */
  disableParticipantCamera: (participantUserId: string) => Promise<void>;
  /** Enable a participant's camera (HOST ONLY) */
  enableParticipantCamera: (participantUserId: string) => Promise<void>;
  /** Remove a participant from the room (HOST ONLY) */
  removeParticipant: (participantUserId: string, reason?: string) => Promise<void>;
  /** Fetch participants list from server (HOST ONLY) */
  fetchParticipants: () => Promise<any[]>;
  /** Enable a participant's screen share permission (HOST ONLY) */
  enableParticipantScreenShare: (participantUserId: string) => Promise<void>;
  /** Disable a participant's screen share permission (HOST ONLY) */
  disableParticipantScreenShare: (participantUserId: string) => Promise<void>;

  // Livestream actions
  /** Start livestreaming - captures current tab and mixes audio */
  startLivestream: () => Promise<void>;
  /** Stop livestreaming */
  stopLivestream: () => Promise<void>;
  /** Whether currently livestreaming */
  isLivestreamActive: boolean;

  /** Register callback for when a participant is removed by host (including self) */
  onParticipantRemoved: (callback: (data: { participant: Participant; reason: string; isLocal: boolean }) => void) => () => void;
  onReplaced: (callback: (data: { room: any, timestamp: string }) => void) => () => void;
  // Recording actions
  /** Start recording - captures current tab and sends to server */
  startRecording: () => Promise<void>;
  /** Stop recording */
  stopRecording: () => Promise<void>;
  /** Whether currently recording */
  isRecordingActive: boolean;

  // Recording permission actions (can be called before joining room)
  /**
   * Request recording permissions (screen sharing with audio) before joining a meeting.
   * This allows teachers to grant permission in the waiting room.
   * Returns result with flags indicating what's missing if not granted.
   */
  requestRecordingPermissions: () => Promise<{
    granted: boolean;
    stream?: MediaStream;
    error?: Error;
    missingVideo?: boolean;
    missingAudio?: boolean;
    videoUnavailable?: boolean;
    audioUnavailable?: boolean;
  }>;
  /** Check if recording permission has been pre-granted */
  isRecordingPermissionGranted: () => boolean;
  /** Release pre-granted recording permissions (stop the stream) */
  releaseRecordingPermissions: () => void;
}

