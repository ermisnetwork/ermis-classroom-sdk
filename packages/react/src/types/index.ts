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
  /** User name of the screen sharer */
  userName: string;
  /** Screen share stream */
  stream: MediaStream | null;
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
  client: any;

  // Connection state
  isAuthenticated: boolean;
  inRoom: boolean;

  // Room state
  currentRoom: Room | null;
  roomCode: string | undefined;
  userId: string | undefined;

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
  joinRoom: (code: string, customStream?: MediaStream) => Promise<void>;
  leaveRoom: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleRaiseHand: () => Promise<void>;
  togglePin: (participantId: string, pinFor: 'local' | 'everyone') => Promise<void>;
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
}

