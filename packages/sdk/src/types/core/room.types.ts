/**
 * Room Types
 * Type definitions for Room class
 */

import type { Participant } from '../../cores/Participant';

/**
 * Room type constants
 */
export const RoomTypes = {
  MAIN: "main",
  SUB: "sub",
  BREAKOUT: "breakout",
  PRIVATE: "private",
} as const;

/**
 * Room type identifier
 */
export type RoomType = (typeof RoomTypes)[keyof typeof RoomTypes];

/**
 * Configuration for creating a Room
 */
export interface RoomConfig {
  /** Unique room identifier */
  id: string;
  /** Room name */
  name: string;
  /** Room code for joining */
  code: string;
  /** Room type */
  type?: RoomType;
  /** Owner user ID */
  ownerId: string;
  /** API client instance */
  apiClient: any; // ApiClient type
  /** Media configuration */
  mediaConfig: MediaConfig;
  /** Parent room ID for sub-rooms */
  parentRoomId?: string;
}

/**
 * Media configuration
 */
export interface MediaConfig {
  /** Server host */
  host: string;
  /** Server host node (for compatibility) */
  hostNode: string;
  /** WebTransport URL */
  webtpUrl: string;
  /** Subscribe protocol */
  subscribeProtocol?: string;
  /** Publish protocol */
  publishProtocol?: string;
  /** User media worker URL */
  userMediaWorker?: string;
  /** Screen share worker URL */
  screenShareWorker?: string;
  /** Default video configuration */
  defaultVideoConfig?: VideoConfig;
  /** Default audio configuration */
  defaultAudioConfig?: AudioConfig;
}

/**
 * Video configuration
 */
export interface VideoConfig {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
}

/**
 * Audio configuration
 */
export interface AudioConfig {
  sampleRate: number;
  channels: number;
}

/**
 * Room information snapshot
 */
export interface RoomInfo {
  /** Room identifier */
  id: string;
  /** Room name */
  name: string;
  /** Room code */
  code: string;
  /** Room type */
  type: RoomType;
  /** Owner user ID */
  ownerId: string;
  /** Whether room is active */
  isActive: boolean;
  /** Number of participants */
  participantCount: number;
  /** Number of sub-rooms */
  subRoomCount: number;
  /** Pinned participant user ID */
  pinnedParticipant: string | null;
}

/**
 * Join room result
 */
export interface JoinRoomResult {
  /** Room instance */
  room: any; // Will be Room instance
  /** Local participant */
  localParticipant: Participant | null;
  /** All participants */
  participants: Participant[];
}

/**
 * Sub-room creation config
 */
export interface SubRoomCreationConfig {
  /** List of sub-rooms to create */
  rooms: SubRoomDefinition[];
}

/**
 * Sub-room definition
 */
export interface SubRoomDefinition {
  /** Room name */
  name: string;
  /** Participants to assign */
  participants: SubRoomParticipantAssignment[];
}

/**
 * Participant assignment for sub-room
 */
export interface SubRoomParticipantAssignment {
  /** User ID */
  userId: string;
  /** Optional role override */
  role?: string;
}

/**
 * Breakout room creation config
 */
export interface BreakoutRoomConfig {
  /** List of breakout rooms */
  rooms: BreakoutRoomDefinition[];
}

/**
 * Breakout room definition
 */
export interface BreakoutRoomDefinition {
  /** Room name */
  name: string;
  /** Participants to assign */
  participants: BreakoutParticipantAssignment[];
}

/**
 * Participant assignment for breakout room
 */
export interface BreakoutParticipantAssignment {
  /** User ID */
  userId: string;
}

/**
 * Chat message
 */
export interface ChatMessage {
  /** Message ID */
  id: string;
  /** Message text */
  text: string;
  /** Sender user ID */
  senderId: string;
  /** Sender display name */
  senderName: string;
  /** Room ID */
  roomId: string;
  /** Timestamp */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, any>;
  /** Updated timestamp if edited */
  updatedAt?: number;
}

/**
 * Message send metadata
 */
export interface MessageMetadata {
  /** Sender name override */
  senderName?: string;
  /** Custom data */
  customData?: Record<string, any>;
}

/**
 * Typing user info
 */
export interface TypingUser {
  /** User ID */
  userId: string;
  /** Timestamp when started typing */
  timestamp: number;
}

/**
 * Participant API data
 */
export interface ParticipantApiData {
  /** User ID */
  user_id: string;
  /** Stream ID */
  stream_id: string;
  /** Membership ID */
  id: string;
  /** Role */
  role: string;
  /** Name */
  name?: string;
  /** Screen sharing status */
  is_screen_sharing?: boolean;
}

/**
 * Room API data
 */
export interface RoomApiData {
  /** Room ID */
  id?: string;
  /** Room name */
  room_name?: string;
  /** Room code */
  room_code?: string;
  /** Room type */
  room_type?: string;
  /** Owner user ID */
  user_id?: string;
  /** Active status */
  is_active?: boolean;
}

/**
 * Server event types
 */
export type ServerEventType =
  | 'join'
  | 'leave'
  | 'join_sub_room'
  | 'leave_sub_room'
  | 'message'
  | 'messageDelete'
  | 'messageUpdate'
  | 'typingStart'
  | 'typingStop'
  | 'start_share_screen'
  | 'stop_share_screen'
  | 'mic_on'
  | 'mic_off'
  | 'camera_on'
  | 'camera_off'
  | 'pin_for_everyone'
  | 'unpin_for_everyone'
  | 'raise_hand'
  | 'lower_hand';

/**
 * Server event base
 */
export interface ServerEventBase {
  /** Event type */
  type: ServerEventType;
  /** Timestamp */
  timestamp?: number;
}

/**
 * Join event
 */
export interface JoinEvent extends ServerEventBase {
  type: 'join';
  participant: {
    user_id: string;
    stream_id: string;
    membership_id: string;
    role: string;
    name?: string;
  };
}

/**
 * Leave event
 */
export interface LeaveEvent extends ServerEventBase {
  type: 'leave';
  participant: {
    user_id: string;
  };
}

/**
 * Message event
 */
export interface MessageEvent extends ServerEventBase {
  type: 'message';
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  roomId: string;
  metadata?: Record<string, any>;
}

/**
 * Server event union type
 */
export type ServerEvent = JoinEvent | LeaveEvent | MessageEvent | ServerEventBase;

/**
 * Room event payloads
 */
export interface RoomEventMap {
  /** Room joining */
  joining: {
    room: any;
  };

  /** Room joined */
  joined: {
    room: any;
    participants: Map<string, Participant>;
  };

  /** Room leaving */
  leaving: {
    room: any;
  };

  /** Room left */
  left: {
    room: any;
  };

  /** Sub-room creating */
  creatingSubRoom: {
    room: any;
    config: SubRoomCreationConfig;
  };

  /** Sub-room created */
  subRoomCreated: {
    room: any;
    subRoom?: any;
  };

  /** Sub-room joined */
  subRoomJoined: {
    room: any;
  };

  /** Sub-room left */
  subRoomLeft: {
    room: any;
  };

  /** Participant added */
  participantAdded: {
    room: any;
    participant: Participant;
  };

  /** Participant removed */
  participantRemoved: {
    room: any;
    participant: Participant;
  };

  /** Participant pinned */
  participantPinned: {
    room: any;
    participant: Participant;
  };

  /** Participant unpinned */
  participantUnpinned: {
    room: any;
    participant: Participant;
  };

  /** Participant pinned for everyone */
  participantPinnedForEveryone: {
    room: any;
    participant: Participant;
  };

  /** Participant unpinned for everyone */
  participantUnpinnedForEveryone: {
    room: any;
    participant: Participant;
  };

  /** Local stream ready */
  localStreamReady: {
    stream: MediaStream;
    participant: any;
    roomId: string;
  };

  /** Remote stream ready */
  remoteStreamReady: {
    stream: MediaStream;
    participant: any;
    roomId: string;
  };

  /** Screen share starting */
  screenShareStarting: {
    room: any;
  };

  /** Screen share started */
  screenShareStarted: {
    room: any;
    stream: MediaStream;
    participant: any;
  };

  /** Screen share stopping */
  screenShareStopping: {
    room: any;
  };

  /** Screen share stopped */
  screenShareStopped: {
    room: any;
    participant?: any;
  };

  /** Remote screen share started */
  remoteScreenShareStarted: {
    room: any;
    participant: Participant;
  };

  /** Remote screen share stopped */
  remoteScreenShareStopped: {
    room: any;
    participant: Participant;
  };

  /** Remote screen share stream ready */
  remoteScreenShareStreamReady: {
    stream: MediaStream;
    participant: any;
    roomId: string;
  };

  /** Message sent */
  messageSent: {
    room: any;
    message: ChatMessage;
  };

  /** Message received */
  messageReceived: {
    room: any;
    message: ChatMessage;
    sender: any;
  };

  /** Message deleted */
  messageDeleted: {
    room: any;
    messageId: string;
    senderId?: string;
  };

  /** Message updated */
  messageUpdated: {
    room: any;
    messageId: string;
    text: string;
    senderId?: string;
  };

  /** Typing started */
  typingStarted: {
    room: any;
    userId: string;
    user: any;
  };

  /** Typing stopped */
  typingStopped: {
    room: any;
    userId: string;
    user?: any;
  };

  /** Remote audio status changed */
  remoteAudioStatusChanged: {
    room: any;
    participant: Participant;
    enabled: boolean;
  };

  /** Remote video status changed */
  remoteVideoStatusChanged: {
    room: any;
    participant: Participant;
    enabled: boolean;
  };

  /** Remote hand raising status changed */
  remoteHandRaisingStatusChanged: {
    room: any;
    participant: Participant;
    raised: boolean;
  };

  /** Audio toggled */
  audioToggled: {
    room: any;
    participant: Participant;
    enabled: boolean;
  };

  /** Video toggled */
  videoToggled: {
    room: any;
    participant: Participant;
    enabled: boolean;
  };

  /** Hand raise toggled */
  handRaiseToggled: {
    room: any;
    participant: Participant;
    enabled: boolean;
  };

  /** Participant error */
  participantError: {
    room: any;
    participant: Participant;
    error: Error;
    action: string;
  };

  /** Room error */
  error: {
    room: any;
    error: Error;
    action: string;
    err?: Error;
  };
}
