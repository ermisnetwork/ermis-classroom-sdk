/**
 * Room Types
 * Type definitions for Room class
 */

import type { Participant } from '../../cores/Participant';
import { ParticipantPermissions, PinType, ChannelName } from '../media/publisher.types';
import type { QualityLevel } from '../media/subscriber.types';

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
  /**
   * Video resolutions to publish.
   * If not specified, publishes 360p and 720p by default.
   * To enable 1080p: [ChannelName.VIDEO_1080P]
   */
  videoResolutions?: ChannelName[];
  /**
   * Initial video quality for subscribers.
   * If not specified, defaults to '360p'.
   * To subscribe 1080p from start: '1080p'
   */
  subscriberInitQuality?: QualityLevel;
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
  /** Pin type (User or ScreenShare) */
  pinnedPinType: PinType | null;
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
  /** permissions */
  permissions: ParticipantPermissions;
  /** Mic on status */
  is_mic_on?: boolean;
  /** Camera on status */
  is_camera_on?: boolean;
  /** Screen share has audio */
  has_screen_sharing_audio?: boolean;
  /** Screen share has video */
  has_screen_sharing_video?: boolean;
  /** Is this participant pinned for everyone */
  is_pinned_for_everyone?: boolean;
  /** Pin type (1=User, 2=ScreenShare) */
  pin_type?: number;
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
 * Must match ServerMeetingEvent enum from Rust server
 */
export type ServerEventType =
  | 'join'
  | 'leave'
  | 'mic_on'
  | 'mic_off'
  | 'camera_on'
  | 'camera_off'
  | 'pin_for_everyone'
  | 'unpin_for_everyone'
  | 'raise_hand'
  | 'lower_hand'
  | 'request_share_screen'
  | 'start_share_screen'
  | 'stop_share_screen'
  | 'start_livestream'
  | 'stop_livestream'
  | 'start_record'
  | 'stop_record'
  | 'break_out_room'
  | 'close_breakout_room'
  | 'join_sub_room'
  | 'leave_sub_room'
  | 'disconnected'
  | 'reconnected'
  | 'room_ended'
  | 'update_permission'
  | 'removed'
  | 'replaced';

/**
 * Media channel types (matching server MediaChannel enum)
 */
export type MediaChannel =
  | 'meeting_control'
  | 'video_360p'
  | 'video_720p'
  | 'video_1080p'
  | 'screen_share_720p'
  | 'screen_share_1080p'
  | 'mic_48k'
  | 'screen_share_audio';

/**
 * Permission changed data from server
 */
export interface PermissionChangedData {
  can_subscribe?: boolean;
  can_publish?: boolean;
  can_publish_data?: boolean;
  can_publish_sources?: Array<[MediaChannel, boolean]>;
  hidden?: boolean;
  can_update_metadata?: boolean;
  can_subscribe_metrics?: boolean;
}

/**
 * Server event base
 */
export interface ServerEventBase {
  /** Event type */
  type: ServerEventType;
  data?: unknown;
  /** Timestamp */
  timestamp?: number | string;
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
    stream_id?: string; // Added for multi-stream per user support
  };
}

/**
 * Update permission event
 */
export interface UpdatePermissionEvent extends ServerEventBase {
  type: 'update_permission';
  participant: {
    user_id: string;
    stream_id?: string;
  };
  permission_changed: PermissionChangedData;
}

/**
 * Removed (kicked) event
 */
export interface RemovedEvent extends ServerEventBase {
  type: 'removed';
  participant: {
    user_id: string;
    stream_id?: string;
  };
  reason?: string;
}

/**
 * Replaced event
 */
export interface ReplacedEvent extends ServerEventBase {
  type: 'replaced';
  participant: {
    user_id: string;
    stream_id?: string;
  };
  timestamp: string; // User said "timestamp: DateTime<Utc>" which is string in JSON
}

/**
 * Server event union type
 * Only includes events from ServerMeetingEvent (Rust server)
 * Note: Chat/message events are handled separately via API/WebSocket
 */
export type ServerEvent = JoinEvent | LeaveEvent | UpdatePermissionEvent | RemovedEvent | ReplacedEvent | ServerEventBase;

/**
 * Chat message event (handled separately, not part of ServerMeetingEvent)
 */
export interface MessageEvent {
  type: 'message';
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  roomId: string;
  metadata?: Record<string, any>;
}

/**
 * Custom event data received from server
 */
export interface CustomEventData {
  /** Sender's stream ID */
  senderStreamId: string;
  /** Event value/payload */
  value: Record<string, unknown>;
  /** Raw event data */
  raw?: unknown;
}

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
    pinType: PinType;
  };

  /** Participant unpinned for everyone */
  participantUnpinnedForEveryone: {
    room: any;
    participant: Participant;
    pinType: PinType;
  };

  /** Participant disconnected */
  participantDisconnected: {
    room: any;
    participant: Participant;
  };

  /** Participant reconnected */
  participantReconnected: {
    room: any;
    participant: Participant;
  };

  /** Participant removed by host */
  participantRemovedByHost: {
    room: any;
    participant: Participant;
    reason: string;
    isLocal: boolean;
  };

  /** Participant replaced */
  replaced: {
    room: any;
    participant: Participant;
    timestamp: string;
    isLocal: boolean;
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

  /** Screen share requested */
  screenShareRequested: {
    room: any;
    participant?: Participant;
  };

  /** Breakout room created */
  breakoutRoomCreated: {
    room: any;
    mainRoomId?: string;
    subRoomMap?: any;
    participantMap?: any;
  };

  /** Breakout room closed */
  breakoutRoomClosed: {
    room: any;
    mainRoomId?: string;
    participantMap?: any;
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

  /** Room ended by host */
  roomEnded: {
    room: any;
    reason: string;
  };

  /** Participant permission updated */
  permissionUpdated: {
    room: any;
    participant: Participant;
    permissionChanged: PermissionChangedData;
  };
}
