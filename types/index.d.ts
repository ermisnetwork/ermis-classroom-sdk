// Type definitions for ermis-classroom-sdk
// Project: https://github.com/tuannt591/ermis-classroom-sdk
// Definitions by: Ermis Team <https://github.com/tuannt591>

declare module 'ermis-classroom-sdk';

export interface ClientConfig {
  host: string;
  apiUrl?: string;
  webtpUrl?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  debug?: boolean;
  defaultVideoConfig?: {
    width?: number;
    height?: number;
    framerate?: number;
    bitrate?: number;
  };
  defaultAudioConfig?: {
    sampleRate?: number;
    channels?: number;
  };
}

export interface ConnectionOptions {
  autoSaveCredentials?: boolean;
  [key: string]: any;
}

export interface RoomConfig {
  name: string;
  type?: string;
  autoJoin?: boolean;
  maxParticipants?: number;
  mediaStream?: MediaStream; // Required if autoJoin is true (default)
}

export interface SubRoomConfig {
  name: string;
  type?: string;
  maxParticipants?: number;
  duration?: number;
  autoReturn?: boolean;
}

export interface LocalStreamReadyEvent {
  stream: MediaStream;
  videoOnlyStream: MediaStream;
  streamType: string;
  streamId: string;
  config: any;
  participant: ParticipantInfo;
  roomId: string;
}

export interface RemoteStreamReadyEvent {
  stream: MediaStream;
  streamId: string;
  subscriberId: string;
  roomId: string;
  isOwnStream: boolean;
  participant: ParticipantInfo;
}

export interface StreamRemovedEvent {
  streamId: string;
  subscriberId?: string;
  roomId: string;
  participant: ParticipantInfo;
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  roomId: string;
  timestamp: number;
  updatedAt?: number;
  metadata: Record<string, any>;
}

export interface MessageSentEvent {
  room: Room;
  message: ChatMessage;
}

export interface MessageReceivedEvent {
  room: Room;
  message: ChatMessage;
  sender: ParticipantInfo | null;
}

export interface MessageDeletedEvent {
  room: Room;
  messageId: string;
  senderId: string;
}

export interface MessageUpdatedEvent {
  room: Room;
  messageId: string;
  text: string;
  senderId: string;
}

export interface TypingEvent {
  room: Room;
  userId: string;
  user?: ParticipantInfo;
}

export interface SendMessageOptions {
  senderName?: string;
  customData?: Record<string, any>;
}

export interface User {
  id: string;
  token: string;
  authenticatedAt: number;
}

export interface ParticipantInfo {
  userId: string;
  streamId: string;
  membershipId: string;
  role: string;
  isLocal: boolean;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isPinned: boolean;
  isHandRaised: boolean;
  isScreenSharing: boolean;
  connectionStatus: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  code: string;
  type: string;
  isActive: boolean;
  participantCount: number;
}

export interface JoinResult {
  room: Room;
  localParticipant: Participant;
  participants: Participant[];
}

export interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

export interface MediaDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface MediaPermissions {
  camera?: PermissionStatus;
  microphone?: PermissionStatus;
}

// Event Emitter interface
export declare abstract class EventEmitter {
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  once(event: string, listener: (...args: any[]) => void): this;
  addListener(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
  listeners(event: string): ((...args: any[]) => void)[];
  listenerCount(event: string): number;
}

// Participant class
export declare class Participant extends EventEmitter {
  userId: string;
  streamId: string;
  membershipId: string;
  role: string;
  isLocal: boolean;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isPinned: boolean;
  isHandRaised: boolean;
  isScreenSharing: boolean;
  connectionStatus: string;
  screenSubscriber: any;
  publisher: any;
  subscriber: any;

  constructor(config: any);

  toggleMicrophone(): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleRemoteAudio(): Promise<void>;
  togglePin(): void;
  toggleRaiseHand(): Promise<void>;
  updateMicStatus(enabled: boolean): void;
  updateCameraStatus(enabled: boolean): void;
  setConnectionStatus(status: string): void;
  setPublisher(publisher: any): void;
  setSubscriber(subscriber: any): void;
  updateMediaStream(newStream: MediaStream): void;
  cleanup(): void;
  getDisplayName(): string;
  getInfo(): ParticipantInfo;
}

// Room class
export declare class Room extends EventEmitter {
  id: string;
  name: string;
  code: string;
  type: string;
  isActive: boolean;
  participants: Map<string, Participant>;
  localParticipant: Participant | null;
  pinnedParticipant: Participant | null;
  messages: ChatMessage[];
  typingUsers: Map<string, any>;

  constructor(config: any);

  join(userId: string, mediaStream: MediaStream): Promise<JoinResult>;
  leave(): Promise<void>;
  switchToSubRoom(subRoomCode: string, mediaStream: MediaStream): Promise<any>;
  createSubRoom(config: SubRoomConfig): Promise<SubRoom>;
  getSubRooms(): Promise<SubRoom[]>;
  addParticipant(memberData: any, userId: string): Participant;
  removeParticipant(userId: string): Participant | null;
  getParticipant(userId: string): Participant | null;
  getParticipants(): Participant[];
  pinParticipant(userId: string): boolean;
  unpinParticipant(): boolean;
  setUIContainers(mainVideoArea: HTMLElement, sidebarArea: HTMLElement): void;
  renderParticipantTiles(): void;
  getInfo(): RoomInfo;

  sendMessage(text: string, metadata?: SendMessageOptions): Promise<ChatMessage>;
  deleteMessage(messageId: string): Promise<boolean>;
  updateMessage(messageId: string, newText: string, metadata?: SendMessageOptions): Promise<boolean>;
  sendTypingIndicator(isTyping?: boolean): Promise<void>;
  getMessages(limit?: number): ChatMessage[];
  getTypingUsers(): any[];
  clearMessages(): void;
}

// SubRoom class
export declare class SubRoom extends Room {
  parentRoom: Room;
  maxParticipants: number;
  duration: number | null;
  startTime: number | null;
  autoReturn: boolean;
  isTemporary: boolean;

  constructor(config: any);

  joinFromMain(userId: string, mediaStream: MediaStream): Promise<JoinResult>;
  returnToMainRoom(): Promise<Room>;
  switchToSubRoom(targetSubRoomCode: string, mediaStream: MediaStream): Promise<any>;
  inviteParticipant(userId: string): Promise<any>;
  assignParticipant(userId: string): Promise<any>;
  broadcastMessage(message: string, type?: string): Promise<any>;
  getRemainingTime(): number | null;
  extendDuration(additionalMinutes: number): void;
  setMaxParticipants(limit: number): void;
  isFull(): boolean;
  isEmpty(): boolean;
  hasExpired(): boolean;
  getStats(): any;
}

// API Client
export declare class ApiClient {
  constructor(config: any);

  authenticate(userId: string): Promise<User>;
  createRoom(name: string, type?: string): Promise<any>;
  joinRoom(roomCode: string): Promise<any>;
  leaveRoom(roomId: string, membershipId: string): Promise<void>;
  listRooms(page?: number, perPage?: number): Promise<any>;
  createSubRoom(parentRoomId: string, config: SubRoomConfig): Promise<any>;
  joinSubRoom(subRoomCode: string): Promise<any>;
}

// Ermis Client
export declare class ErmisClient extends EventEmitter {
  constructor(config: ClientConfig);

  authenticate(userId: string): Promise<User>;
  manualAuthenticate(userId: string, token: string): void;
  logout(): Promise<void>;
  createRoom(config: RoomConfig): Promise<Room>;
  joinRoom(roomCode: string, mediaStream: MediaStream): Promise<JoinResult>;
  leaveRoom(): Promise<void>;
  getRooms(options?: any): Promise<RoomInfo[]>;
  createSubRoom(config: SubRoomConfig): Promise<SubRoom>;
  joinSubRoom(subRoomCode: string): Promise<JoinResult>;
  returnToMainRoom(): Promise<Room>;
  switchSubRoom(targetSubRoomCode: string): Promise<JoinResult>;
  setUIContainers(mainVideoArea: HTMLElement, sidebarArea: HTMLElement): void;
  getCurrentRoom(): Room | null;
  getRoom(roomId: string): Room | null;
  getState(): any;
  getConfig(): ClientConfig;
  cleanup(): Promise<void>;

  sendMessage(text: string, metadata?: SendMessageOptions): Promise<ChatMessage>;
  deleteMessage(messageId: string): Promise<boolean>;
  updateMessage(messageId: string, newText: string, metadata?: SendMessageOptions): Promise<boolean>;
  sendTypingIndicator(isTyping?: boolean): Promise<void>;
  getMessages(limit?: number): ChatMessage[];
  getTypingUsers(): any[];
  clearMessages(): void;
}

// Main SDK class
export declare class ErmisClassroom {
  static readonly version: string;

  static readonly events: {
    readonly CLIENT_AUTHENTICATED: "authenticated";
    readonly CLIENT_AUTHENTICATION_FAILED: "authenticationFailed";
    readonly CLIENT_LOGGED_OUT: "loggedOut";
    readonly CLIENT_CONNECTION_STATUS_CHANGED: "connectionStatusChanged";
    readonly ROOM_CREATED: "roomCreated";
    readonly ROOM_JOINED: "roomJoined";
    readonly ROOM_LEFT: "roomLeft";
    readonly PARTICIPANT_ADDED: "participantAdded";
    readonly PARTICIPANT_REMOVED: "participantRemoved";
    readonly PARTICIPANT_PINNED: "participantPinned";
    readonly PARTICIPANT_UNPINNED: "participantUnpinned";
    readonly AUDIO_TOGGLED: "audioToggled";
    readonly VIDEO_TOGGLED: "videoToggled";
    readonly HAND_RAISE_TOGGLED: "handRaiseToggled";
    readonly REMOTE_AUDIO_STATUS_CHANGED: "remoteAudioStatusChanged";
    readonly REMOTE_VIDEO_STATUS_CHANGED: "remoteVideoStatusChanged";
    readonly SCREEN_SHARE_STARTED: "screenShareStarted";
    readonly SCREEN_SHARE_STOPPED: "screenShareStopped";
    readonly REMOTE_SCREEN_SHARE_STARTED: "remoteScreenShareStarted";
    readonly REMOTE_SCREEN_SHARE_STOPPED: "remoteScreenShareStopped";
    readonly PARTICIPANT_PINNED_FOR_EVERYONE: "participantPinnedForEveryone";
    readonly PARTICIPANT_UNPINNED_FOR_EVERYONE: "participantUnpinnedForEveryone";
    readonly REMOTE_HAND_RAISING_STATUS_CHANGED: "remoteHandRaisingStatusChanged";
    readonly SUB_ROOM_CREATED: "subRoomCreated";
    readonly SUB_ROOM_JOINED: "subRoomJoined";
    readonly SUB_ROOM_LEFT: "subRoomLeft";
    readonly SUB_ROOM_SWITCHED: "subRoomSwitched";
    readonly LOCAL_STREAM_READY: "localStreamReady";
    readonly REMOTE_STREAM_READY: "remoteStreamReady";
    readonly STREAM_REMOVED: "streamRemoved";
    readonly MESSAGE_SENT: 'messageSent';
    readonly MESSAGE_RECEIVED: 'messageReceived';
    readonly MESSAGE_DELETED: 'messageDeleted';
    readonly MESSAGE_UPDATED: 'messageUpdated';
    readonly TYPING_STARTED: 'typingStarted';
    readonly TYPING_STOPPED: 'typingStopped';
    readonly CHAT_HISTORY_LOADED: 'chatHistoryLoaded';
    readonly ERROR: "error";
  };

  static readonly MediaDevices: {
    getDevices(): Promise<MediaDevices>;
    getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    checkPermissions(): Promise<MediaPermissions>;
  };

  static readonly RoomTypes: {
    readonly MAIN: "main";
    readonly BREAKOUT: "breakout";
    readonly PRESENTATION: "presentation";
    readonly DISCUSSION: "discussion";
  };

  static readonly ConnectionStatus: {
    readonly DISCONNECTED: "disconnected";
    readonly CONNECTING: "connecting";
    readonly CONNECTED: "connected";
    readonly FAILED: "failed";
  };

  static readonly ParticipantRoles: {
    readonly OWNER: "owner";
    readonly MODERATOR: "moderator";
    readonly PARTICIPANT: "participant";
    readonly OBSERVER: "observer";
  };

  static create(config: ClientConfig): ErmisClient;
  static connect(
    serverUrl: string,
    userId: string,
    options?: ConnectionOptions
  ): Promise<ErmisClient>;
}

// Default export
export default ErmisClassroom;

// Version export
export declare const VERSION: string;
