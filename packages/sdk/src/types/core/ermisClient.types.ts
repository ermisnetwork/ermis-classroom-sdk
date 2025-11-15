/**
 * ErmisClient Types
 * Type definitions for ErmisClient class
 */

import type { Room } from '../../cores/Room';
import type { RoomType } from './room.types';

/**
 * Connection status
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

/**
 * Configuration for ErmisClient
 */
export interface ErmisClientConfig {
  /** Server host */
  host?: string;
  /** Media node host (for WebSocket subscriber connections) */
  hostNode?: string;
  /** API URL */
  apiUrl?: string;
  /** WebTransport URL */
  webtpUrl?: string;
  /** Number of reconnection attempts */
  reconnectAttempts?: number;
  /** Delay between reconnection attempts (ms) */
  reconnectDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** User media worker URL */
  userMediaWorker?: string;
  /** Screen share worker URL */
  screenShareWorker?: string;
}

/**
 * User information
 */
export interface User {
  /** User ID */
  id: string;
  /** Authentication token */
  token: string;
  /** Authentication timestamp */
  authenticatedAt: number;
}

/**
 * Client state
 */
export interface ClientState {
  /** Current user */
  user: User | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Current active room */
  currentRoom: Room | null;
  /** All rooms (roomId -> Room) */
  rooms: Map<string, Room>;
  /** Connection status */
  connectionStatus: ConnectionStatus;
}

/**
 * Client state snapshot (for getState)
 */
export interface ClientStateSnapshot {
  /** User info */
  user: User | null;
  /** Whether authenticated */
  isAuthenticated: boolean;
  /** Current room info */
  currentRoom: any | null;
  /** Connection status */
  connectionStatus: ConnectionStatus;
  /** Number of rooms */
  roomCount: number;
}

/**
 * Room creation configuration
 */
export interface CreateRoomConfig {
  /** Room name */
  name: string;
  /** Room type */
  type?: RoomType;
  /** Auto-join after creation */
  autoJoin?: boolean;
}

/**
 * Get rooms options
 */
export interface GetRoomsOptions {
  /** Page number */
  page?: number;
  /** Items per page */
  perPage?: number;
}

/**
 * Token response from API
 */
export interface TokenResponse {
  /** Access token */
  access_token: string;
  /** Token type */
  token_type?: string;
  /** Expiration time */
  expires_in?: number;
}

/**
 * ErmisClient event payloads
 */
export interface ErmisClientEventMap {
  /** Authenticating */
  authenticating: {
    userId: string;
  };

  /** Authenticated */
  authenticated: {
    user: User;
  };

  /** Authentication failed */
  authenticationFailed: {
    userId: string;
    error: Error;
  };

  /** Logging out */
  loggingOut: {
    user: User;
  };

  /** Logged out */
  loggedOut: {};

  /** Creating room */
  creatingRoom: {
    config: CreateRoomConfig;
  };

  /** Room created */
  roomCreated: {
    room: Room;
  };

  /** Creating breakout rooms */
  creatingBreakoutRooms: {
    config: any;
    parentRoom: Room;
  };

  /** Breakout rooms created */
  breakoutRoomsCreated: {
    breakoutRooms: Room[];
    parentRoom: Room;
  };

  /** Joining breakout room */
  joiningBreakoutRoom: {
    parentRoom: Room;
  };

  /** Breakout room joined */
  breakoutRoomJoined: {
    breakoutRoom?: Room;
    result: any;
  };

  /** Joining room */
  joiningRoom: {
    roomCode: string;
  };

  /** Room joined */
  roomJoined: {
    room: Room;
    joinResult: any;
  };

  /** Leaving room */
  leavingRoom: {
    room: Room;
  };

  /** Room left */
  roomLeft: {
    room: Room;
  };

  /** Rooms loaded */
  roomsLoaded: {
    rooms: any[];
  };

  /** Creating sub room */
  creatingSubRoom: {
    config: any;
    parentRoom: Room;
  };

  /** Sub room created */
  subRoomCreated: {
    subRoomsData: any;
    parentRoom: Room;
  };

  /** Joining sub room */
  joiningSubRoom: {
    subRoomCode: string;
    parentRoom: Room;
  };

  /** Sub room joined */
  subRoomJoined: {
    subRoom: any;
    parentRoom: Room;
  };

  /** Returning to main room */
  returningToMainRoom: {
    subRoom: Room;
  };

  /** Returned to main room */
  returnedToMainRoom: {
    mainRoom: Room;
    previousSubRoom: Room;
  };

  /** Switching sub room */
  switchingSubRoom: {
    fromSubRoom: Room;
    targetSubRoomCode: string;
  };

  /** Sub room switched */
  subRoomSwitched: {
    fromSubRoom: Room;
    toSubRoom: Room;
  };

  /** Configuration updated */
  configUpdated: {
    config: ErmisClientConfig;
  };

  /** Connection status changed */
  connectionStatusChanged: {
    status: ConnectionStatus;
  };

  /** Reconnection failed */
  reconnectionFailed: {};

  /** Error event */
  error: {
    error: Error;
    action: string;
  };

  // Forward room events
  participantAdded: any;
  participantRemoved: any;
  participantPinned: any;
  participantUnpinned: any;
  participantPinnedForEveryone: any;
  participantUnpinnedForEveryone: any;
  localStreamReady: any;
  remoteStreamReady: any;
  streamRemoved: any;
  audioToggled: any;
  videoToggled: any;
  handRaiseToggled: any;
  remoteAudioStatusChanged: any;
  remoteVideoStatusChanged: any;
  remoteHandRaisingStatusChanged: any;
  screenShareStarted: any;
  screenShareStopped: any;
  remoteScreenShareStarted: any;
  remoteScreenShareStopped: any;
  remoteScreenShareStreamReady: any;
  messageSent: any;
  messageReceived: any;
  messageDeleted: any;
  messageUpdated: any;
  typingStarted: any;
  typingStopped: any;
  creatingBreakoutRoom: any;
  participantError: any;
}
