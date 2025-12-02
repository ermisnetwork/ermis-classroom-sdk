/**
 * ErmisClient - Main SDK client for Ermis Meeting
 * Handles authentication, room management, and event coordination
 */

import {EventEmitter} from '../events/EventEmitter';
import {globalEventBus, GlobalEvents} from '../events/GlobalEventBus';
import {Room} from './Room';
import {ApiClient} from '../api/ApiClient';
import {
  ClientState,
  ClientStateSnapshot,
  ConnectionStatus,
  CreateRoomConfig,
  ErmisClientConfig,
  GetRoomsOptions,
  MediaConfig,
  RoomType,
  RoomTypes,
  TokenResponse,
  User
} from '../types';
import {MediaDeviceManager} from '../media/devices/MediaDeviceManager';
import {ConnectionStatus as ConnectionStatusConst} from '../constants/connectionStatus';
import {ParticipantRoles, VERSION} from '../constants';
import {BrowserDetection} from '../utils';

export class ErmisClient extends EventEmitter {
  // Configuration
  private config: Required<ErmisClientConfig>;

  // API client (will be typed when ApiClient is converted)
  private apiClient: any;

  // State management
  private state: ClientState = {
    user: null,
    isAuthenticated: false,
    currentRoom: null,
    rooms: new Map(),
    connectionStatus: 'disconnected',
  };

  // Media configuration
  private mediaConfig: MediaConfig;

  // Global event subscriptions cleanup
  private globalEventCleanups: Array<() => void> = [];

  /**
   * Static factory method for backward compatibility
   */
  static create(config?: ErmisClientConfig): ErmisClient {
    return new ErmisClient(config);
  }

  /**
   * Event constants for backward compatibility
   */
  static events = {
    AUTHENTICATED: 'authenticated',
    ROOM_JOINED: 'roomJoined',
    ROOM_LEFT: 'roomLeft',
    PARTICIPANT_JOINED: 'participantJoined',
    PARTICIPANT_LEFT: 'participantLeft',
    PARTICIPANT_ADDED: 'participantAdded',
    PARTICIPANT_REMOVED: 'participantRemoved',
    LOCAL_STREAM_READY: 'localStreamReady',
    LOCAL_SCREEN_SHARE_READY: 'localScreenShareReady',
    REMOTE_STREAM_READY: 'remoteStreamReady',
    REMOTE_AUDIO_STATUS_CHANGED: 'remoteAudioStatusChanged',
    REMOTE_VIDEO_STATUS_CHANGED: 'remoteVideoStatusChanged',
    SCREEN_SHARE_STARTED: 'screenShareStarted',
    SCREEN_SHARE_STOPPED: 'screenShareStopped',
    REMOTE_SCREEN_SHARE_STARTED: 'remoteScreenShareStarted',
    REMOTE_SCREEN_SHARE_STOPPED: 'remoteScreenShareStopped',
    REMOTE_SCREEN_SHARE_STREAM_READY: 'remoteScreenShareStreamReady',
    PARTICIPANT_PINNED_FOR_EVERYONE: 'participantPinnedForEveryone',
    PARTICIPANT_UNPINNED_FOR_EVERYONE: 'participantUnpinnedForEveryone',
    REMOTE_HAND_RAISING_STATUS_CHANGED: 'remoteHandRaisingStatusChanged',
    CUSTOM: 'custom',
    ERROR: 'error',
  };

  /**
   * Room type constants
   */
  static RoomTypes = RoomTypes;

  /**
   * Connection status constants
   */
  static ConnectionStatus = ConnectionStatusConst;

  /**
   * Participant role constants
   */
  static ParticipantRoles = ParticipantRoles;

  /**
   * Browser detection utilities
   */
  static BrowserDetection = BrowserDetection;

  /**
   * SDK Version
   */
  static VERSION = VERSION;

  /**
   * Create a new MediaDeviceManager instance
   */
  static createMediaDeviceManager(): MediaDeviceManager {
    return new MediaDeviceManager();
  }

  /**
   * MediaDevices utilities - static access to device methods
   */
  static MediaDevices = {
    /**
     * Get available media devices
     */
    async getDevices() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        cameras: devices.filter(d => d.kind === 'videoinput'),
        microphones: devices.filter(d => d.kind === 'audioinput'),
        speakers: devices.filter(d => d.kind === 'audiooutput'),
      };
    },

    /**
     * Get user media with constraints
     */
    async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
      return await navigator.mediaDevices.getUserMedia(constraints);
    },

    /**
     * Check media permissions
     */
    async checkPermissions(): Promise<{ camera: PermissionState; microphone: PermissionState }> {
      const cameraPermission = await navigator.permissions.query({name: 'camera' as PermissionName});
      const microphonePermission = await navigator.permissions.query({name: 'microphone' as PermissionName});
      return {
        camera: cameraPermission.state,
        microphone: microphonePermission.state,
      };
    },
  };

  constructor(config: ErmisClientConfig = {}) {
    super();

    // Set default configuration
    this.config = {
      host: config.host || 'daibo.ermis.network:9993',
      hostNode: config.hostNode || config.host || 'daibo.ermis.network:9993',
      apiUrl: config.apiUrl || `https://${config.host || 'daibo.ermis.network:9993'}/meeting`,
      webtpUrl: config.webtpUrl || 'https://daibo.ermis.network:9993/meeting/wt',
      reconnectAttempts: config.reconnectAttempts ?? 3,
      reconnectDelay: config.reconnectDelay ?? 2000,
      debug: config.debug ?? false,
      userMediaWorker: config.userMediaWorker || 'sfu-adaptive-trung.ermis-network.workers.dev',
      screenShareWorker: config.screenShareWorker || 'sfu-screen-share.ermis-network.workers.dev',
    };

    // Initialize API client
    this.apiClient = new ApiClient({
      host: this.config.host,
      apiUrl: this.config.apiUrl,
    });

    // Media configuration
    this.mediaConfig = {
      host: this.config.hostNode || this.config.host,
      hostNode: this.config.hostNode || this.config.host,
      webtpUrl: this.config.webtpUrl,
      userMediaWorker: this.config.userMediaWorker,
      screenShareWorker: this.config.screenShareWorker,
      defaultVideoConfig: {
        width: 1280,
        height: 720,
        framerate: 30,
        bitrate: 1_500_000,
      },
      defaultAudioConfig: {
        sampleRate: 48000,
        channels: 2,
      },
    };

    this._setupEventHandlers();
    this._setupGlobalEventListeners();
  }

  /**
   * Authenticate user
   */
  async authenticate(userId: string): Promise<User> {
    if (this.state.isAuthenticated && this.state.user?.id === userId) {
      return this.state.user;
    }

    try {
      this.emit('authenticating', {userId});
      this._setConnectionStatus('connecting');

      // Validate email format if it looks like email
      if (userId.includes('@')) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userId)) {
          throw new Error('Invalid email format');
        }
      }

      // Get authentication token
      const tokenResponse: TokenResponse = await this.apiClient.getDummyToken(userId);
      // Set authentication in API client
      this.apiClient.setAuth(tokenResponse.access_token, userId);


      // Update state
      this.state.user = {
        id: userId,
        token: tokenResponse.access_token,
        authenticatedAt: Date.now(),
      };
      this.state.isAuthenticated = true;

      this._setConnectionStatus('connected');
      this.emit('authenticated', {user: this.state.user});

      this._debug('User authenticated successfully:', userId);

      return this.state.user;
    } catch (error) {
      this._setConnectionStatus('failed');
      this.emit('authenticationFailed', {
        userId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this._debug('Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Set authentication directly without calling API
   */
  manualAuthenticate(userId: string, token: string): void {
    if (!userId || !token) {
      throw new Error('userId and token are required');
    }

    // Set auth to API client
    this.apiClient.setAuth(token, userId);

    // Update state
    this.state.user = {
      id: userId,
      token,
      authenticatedAt: Date.now(),
    };
    this.state.isAuthenticated = true;

    // Update connection status
    this._setConnectionStatus('connected');

    // Emit event
    this.emit('authenticated', {user: this.state.user});

    this._debug('Auth set directly:', this.state.user);
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    if (!this.state.isAuthenticated) {
      return;
    }

    try {
      this.emit('loggingOut', {user: this.state.user!});

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Reset state
      this.state.user = null;
      this.state.isAuthenticated = false;
      this.state.currentRoom = null;
      this.state.rooms.clear();

      this._setConnectionStatus('disconnected');
      this.emit('loggedOut', {});

      this._debug('User logged out successfully');
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'logout',
      });
      throw error;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(config: CreateRoomConfig): Promise<Room> {
    this._ensureAuthenticated();

    try {
      this.emit('creatingRoom', {config});

      const roomData = await this.apiClient.createRoom(config.name, config.type);

      const room = new Room({
        id: roomData.id,
        name: roomData.room_name,
        code: roomData.room_code,
        type: (config.type || 'main') as RoomType,
        ownerId: roomData.user_id,
        apiClient: this.apiClient,
        mediaConfig: this.mediaConfig,
      });

      this._setupRoomEvents(room);
      this.state.rooms.set(room.id, room);

      this.emit('roomCreated', {room});
      this._debug('Room created:', room.getInfo());

      // Auto-join if specified
      if (config.autoJoin !== false) {
        await this.joinRoom(room.code);
      }

      return room;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'createRoom',
      });
      throw error;
    }
  }

  /**
   * Create breakout rooms
   */
  async createBreakoutRooms(config: any): Promise<Room[]> {
    if (!this.state.currentRoom) {
      throw new Error('Must be in a main room to create breakout rooms');
    }

    if (this.state.currentRoom.type !== 'main') {
      throw new Error('Can only create breakout rooms from main rooms');
    }

    try {
      this.emit('creatingBreakoutRooms', {
        config,
        parentRoom: this.state.currentRoom,
      });

      const breakoutRooms = await this.state.currentRoom.createBreakoutRoom(config);

      for (const room of breakoutRooms) {
        this.state.currentRoom.subRooms.set(room.id, room as any);
        this._setupRoomEvents(room);
      }

      this.emit('breakoutRoomsCreated', {
        breakoutRooms,
        parentRoom: this.state.currentRoom,
      });

      this._debug(
        'Breakout rooms created:',
        breakoutRooms.map((room) => room.getInfo()),
      );
      return breakoutRooms;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'createBreakoutRooms',
      });
      throw error;
    }
  }

  /**
   * Join breakout room
   */
  async joinBreakoutRoom(): Promise<any> {
    if (!this.state.currentRoom) {
      throw new Error('Must be in a main room to join breakout rooms');
    }

    if (this.state.currentRoom.type !== 'main') {
      throw new Error('Can only join breakout rooms from main rooms');
    }

    try {
      this.emit('joiningBreakoutRoom', {
        parentRoom: this.state.currentRoom,
      });

      const result = await this.state.currentRoom.joinBreakoutRoom();

      if (result && result.room) {
        this.state.currentRoom = result.room;
        this.state.rooms.set(result.room.id, result.room);
      }

      this.emit('breakoutRoomJoined', {
        breakoutRoom: result?.room,
        result,
      });

      return result;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'joinBreakoutRoom',
      });
      throw error;
    }
  }

  /**
   * Join a room by code
   */
  async joinRoom(roomCode: string, mediaStream: MediaStream | null = null): Promise<any> {
    this._ensureAuthenticated();

    try {
      this.emit('joiningRoom', {roomCode});

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Try to find existing room instance first
      let room = Array.from(this.state.rooms.values()).find((r) => r.code === roomCode);

      if (!room) {
        // Create new room instance
        room = new Room({
          id: '', // Will be set by join
          name: '',
          code: roomCode,
          type: 'main',
          ownerId: '',
          apiClient: this.apiClient,
          mediaConfig: this.mediaConfig,
        });

        this._setupRoomEvents(room);
      }

      // Set currentRoom BEFORE join so event handlers can access it
      this.state.currentRoom = room;

      // Join the room with optional custom media stream
      const joinResult = await room.join(this.state.user!.id, mediaStream);

      // Update state after join completes
      console.log("Room joined successfully:", room.getInfo());
      this.state.rooms.set(room.id, room);

      this.emit('roomJoined', {room, joinResult});
      this._debug('Joined room:', room.getInfo());

      return joinResult;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'joinRoom',
      });
      throw error;
    }
  }

  /**
   * Leave current room
   */
  async leaveRoom(): Promise<void> {
    if (!this.state.currentRoom) {
      return;
    }

    try {
      const room = this.state.currentRoom;
      this.emit('leavingRoom', {room});

      await room.leave();

      this.state.currentRoom = null;

      this.emit('roomLeft', {room});
      this._debug('Left room:', room.getInfo());
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'leaveRoom',
      });
      throw error;
    }
  }

  /**
   * Get available rooms
   */
  async getRooms(options: GetRoomsOptions = {}): Promise<any[]> {
    this._ensureAuthenticated();

    try {
      const response = await this.apiClient.listRooms(options.page || 1, options.perPage || 20);

      this.emit('roomsLoaded', {rooms: response.data || []});

      return response.data || [];
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'getRooms',
      });
      throw error;
    }
  }

  /**
   * Get current room
   */
  getCurrentRoom(): Room | null {
    return this.state.currentRoom;
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.state.rooms.get(roomId);
  }

  /**
   * Create sub room in current room
   */
  async createSubRoom(config: any): Promise<any> {
    if (!this.state.currentRoom) {
      throw new Error('Must be in a main room to create sub rooms');
    }

    if (this.state.currentRoom.type !== 'main') {
      throw new Error('Can only create sub rooms from main rooms');
    }

    try {
      this.emit('creatingSubRoom', {
        config,
        parentRoom: this.state.currentRoom,
      });

      const subRoomsData = await this.state.currentRoom.createSubRoom(config);

      this.emit('subRoomCreated', {
        subRoomsData,
        parentRoom: this.state.currentRoom,
      });
      this._debug('Sub rooms created:', subRoomsData);

      return subRoomsData;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'createSubRoom',
      });
      throw error;
    }
  }

  /**
   * Join a sub room
   */
  async joinSubRoom(subRoomCode: string): Promise<any> {
    if (!this.state.currentRoom) {
      throw new Error('Must be in a main room to join sub rooms');
    }

    try {
      this.emit('joiningSubRoom', {
        subRoomCode,
        parentRoom: this.state.currentRoom,
      });

      // Find sub room
      const subRooms = await this.state.currentRoom.getSubRooms();
      const subRoom = subRooms.find((sr: any) => sr.code === subRoomCode);

      if (!subRoom) {
        throw new Error(`Sub room with code ${subRoomCode} not found`);
      }

      // Join sub room
      const joinResult = await subRoom.joinFromMain(this.state.user!.id);

      this.emit('subRoomJoined', {
        subRoom,
        parentRoom: this.state.currentRoom,
      });
      this._debug('Joined sub room:', subRoom.getInfo());

      return joinResult;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'joinSubRoom',
      });
      throw error;
    }
  }

  /**
   * Return to main room from sub room
   */
  async returnToMainRoom(): Promise<Room> {
    if (!this.state.currentRoom || this.state.currentRoom.type !== 'breakout') {
      throw new Error('Must be in a sub room to return to main room');
    }

    try {
      this.emit('returningToMainRoom', {subRoom: this.state.currentRoom});

      const subRoom = this.state.currentRoom;
      const mainRoom = await (subRoom as any).returnToMainRoom();

      this.state.currentRoom = mainRoom;

      this.emit('returnedToMainRoom', {mainRoom, previousSubRoom: subRoom});
      this._debug('Returned to main room from sub room');

      return mainRoom;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'returnToMainRoom',
      });
      throw error;
    }
  }

  /**
   * Switch between sub rooms
   */
  async switchSubRoom(targetSubRoomCode: string): Promise<any> {
    if (!this.state.currentRoom || this.state.currentRoom.type !== 'breakout') {
      throw new Error('Must be in a sub room to switch to another sub room');
    }

    try {
      this.emit('switchingSubRoom', {
        fromSubRoom: this.state.currentRoom,
        targetSubRoomCode,
      });

      const currentSubRoom = this.state.currentRoom;
      const parentRoom = (currentSubRoom as any).parentRoom;

      // Find target sub room
      const subRooms = await parentRoom.getSubRooms();
      const targetSubRoom = subRooms.find((sr: any) => sr.code === targetSubRoomCode);

      if (!targetSubRoom) {
        throw new Error(`Sub room with code ${targetSubRoomCode} not found`);
      }

      // Switch to target sub room
      const joinResult = await (currentSubRoom as any).switchToSubRoom(targetSubRoom);

      this.state.currentRoom = targetSubRoom;

      this.emit('subRoomSwitched', {
        fromSubRoom: currentSubRoom,
        toSubRoom: targetSubRoom,
      });
      this._debug('Switched sub rooms:', {
        from: currentSubRoom.getInfo(),
        to: targetSubRoom.getInfo(),
      });

      return joinResult;
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        action: 'switchSubRoom',
      });
      throw error;
    }
  }

  /**
   * Get client state
   */
  getState(): ClientStateSnapshot {
    return {
      user: this.state.user,
      isAuthenticated: this.state.isAuthenticated,
      currentRoom: this.state.currentRoom?.getInfo() || null,
      connectionStatus: this.state.connectionStatus,
      roomCount: this.state.rooms.size,
    };
  }

  /**
   * Get client configuration
   */
  getConfig(): ErmisClientConfig {
    return {...this.config};
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ErmisClientConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    } as Required<ErmisClientConfig>;

    // Update API client if needed
    if (newConfig.host || newConfig.apiUrl) {
      this.apiClient = new ApiClient({
        host: this.config.host,
        apiUrl: this.config.apiUrl,
      });

      if (this.state.isAuthenticated && this.state.user) {
        this.apiClient.setAuth(this.state.user.token, this.state.user.id);
      }
    }

    this.emit('configUpdated', {config: this.config});
  }

  /**
   * Enable debug mode
   */
  enableDebug(): void {
    this.config.debug = true;
    this._debug('Debug mode enabled');
  }

  /**
   * Disable debug mode
   */
  disableDebug(): void {
    this.config.debug = false;
  }

  /**
   * Send a message to current room
   */
  async sendMessage(text: string, metadata: any = {}): Promise<any> {
    if (!this.state.currentRoom) {
      throw new Error('No active room. Join a room first.');
    }
    return await this.state.currentRoom.sendMessage(text, metadata);
  }

  /**
   * Delete a message from current room
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    if (!this.state.currentRoom) {
      throw new Error('No active room. Join a room first.');
    }
    return await this.state.currentRoom.deleteMessage(messageId);
  }

  /**
   * Update a message in current room
   */
  async updateMessage(messageId: string, newText: string, metadata: any = {}): Promise<boolean> {
    if (!this.state.currentRoom) {
      throw new Error('No active room. Join a room first.');
    }
    return await this.state.currentRoom.updateMessage(messageId, newText, metadata);
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(isTyping = true): Promise<void> {
    if (!this.state.currentRoom) {
      return;
    }
    return await this.state.currentRoom.sendTypingIndicator(isTyping);
  }

  /**
   * Get messages from current room
   */
  getMessages(limit = 100): any[] {
    if (!this.state.currentRoom) {
      return [];
    }
    return this.state.currentRoom.getMessages(limit);
  }

  /**
   * Get typing users in current room
   */
  getTypingUsers(): any[] {
    if (!this.state.currentRoom) {
      return [];
    }
    return this.state.currentRoom.getTypingUsers();
  }

  /**
   * Clear messages in current room
   */
  clearMessages(): void {
    if (!this.state.currentRoom) {
      return;
    }
    this.state.currentRoom.clearMessages();
  }

  /**
   * Cleanup client resources
   */
  async cleanup(): Promise<void> {
    try {
      console.log('[MeetingClient] Starting cleanup...');

      // Cleanup global event listeners
      this._cleanupGlobalEventListeners();

      // Leave current room
      if (this.state.currentRoom) {
        console.log('[MeetingClient] Leaving current room...');
        await this.state.currentRoom.leave();
      }

      // Cleanup all rooms
      for (const room of this.state.rooms.values()) {
        await room.cleanup();
      }

      // Clear state
      this.state.rooms.clear();
      this.state.currentRoom = null;

      // Remove all listeners
      this.removeAllListeners();

      this._debug('Client cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Soft cleanup - only remove listeners without leaving room
   * Use this when React component unmounts but user is still in meeting
   */
  cleanupListeners(): void {
    console.log('[MeetingClient] Cleaning up listeners only (soft cleanup)...');

    // Cleanup global event listeners
    this._cleanupGlobalEventListeners();

    // Remove all local listeners
    this.removeAllListeners();

    console.log('[MeetingClient] Listener cleanup completed');
  }

  /**
   * Alias for cleanup() - for backward compatibility
   */
  async destroy(): Promise<void> {
    return this.cleanup();
  }

  /**
   * Setup global event listeners - Listen directly from globalEventBus
   * This bypasses Room layer for better performance and cleaner architecture
   */
  private _setupGlobalEventListeners(): void {
    // Handle server events
    const handleServerEvent = async (event: any) => {
      console.log('[MeetingClient] Received SERVER_EVENT from globalEventBus:', event);
      // Server events are already handled by Room, just log for debugging
    };

    // Handle local stream ready
    const handleLocalStreamReady = (data: any) => {
      console.log('[MeetingClient] Received LOCAL_STREAM_READY from globalEventBus', {
        hasCurrentRoom: !!this.state.currentRoom,
        dataStreamId: data.streamId,
      });

      if (!this.state.currentRoom) {
        console.warn('[MeetingClient] No currentRoom when LOCAL_STREAM_READY received');
        return;
      }

      console.log('[MeetingClient] ✅ Emitting localStreamReady to UI');

      // Enrich with room context and emit
      this.emit('localStreamReady', {
        ...data,
        participant: this.state.currentRoom.localParticipant?.getInfo(),
        roomId: this.state.currentRoom.id,
      });
    };

    // Handle local screen share ready
    const handleLocalScreenShareReady = (data: any) => {
      console.log('[MeetingClient] Received LOCAL_SCREEN_SHARE_READY from globalEventBus');

      if (!this.state.currentRoom) return;

      this.emit('localScreenShareReady', {
        ...data,
        participant: this.state.currentRoom.localParticipant?.getInfo(),
        roomId: this.state.currentRoom.id,
      });
    };

    // Handle remote stream ready
    const handleRemoteStreamReady = (data: any) => {
      console.log('[MeetingClient] Received REMOTE_STREAM_READY from globalEventBus', {
        streamId: data.streamId,
        subscribeType: data.subscribeType,
        hasCurrentRoom: !!this.state.currentRoom,
      });

      if (!this.state.currentRoom) {
        console.warn('[MeetingClient] No currentRoom, cannot process REMOTE_STREAM_READY');
        return;
      }

      // Find participant by streamId
      const participant = Array.from(this.state.currentRoom.participants.values()).find(
        p => p.streamId === data.streamId
      );

      if (participant) {
        console.log('[MeetingClient] ✅ Found participant for stream:', participant.userId);
        this.emit('remoteStreamReady', {
          ...data,
          participant: participant.getInfo(),
          roomId: this.state.currentRoom.id,
        });
      } else {
        console.warn('[MeetingClient] ❌ Participant not found for streamId:', data.streamId, {
          participantsCount: this.state.currentRoom.participants.size,
          participantIds: Array.from(this.state.currentRoom.participants.keys()),
        });
      }
    };

    // Subscribe to global events
    globalEventBus.on(GlobalEvents.SERVER_EVENT, handleServerEvent);
    globalEventBus.on(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady);
    globalEventBus.on(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady);
    globalEventBus.on(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady);

    // Store cleanup functions
    this.globalEventCleanups.push(
      () => globalEventBus.off(GlobalEvents.SERVER_EVENT, handleServerEvent),
      () => globalEventBus.off(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady),
      () => globalEventBus.off(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady),
      () => globalEventBus.off(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady),
    );

    console.log('[MeetingClient] ✅ Global event listeners setup complete');
  }

  /**
   * Cleanup global event listeners
   */
  private _cleanupGlobalEventListeners(): void {
    this.globalEventCleanups.forEach(cleanup => cleanup());
    this.globalEventCleanups = [];
    console.log('[MeetingClient] ✅ Global event listeners cleaned up');
  }

  /**
   * Setup event handlers for rooms
   * Keep only non-media events that are still emitted by Room directly
   */
  private _setupRoomEvents(room: Room): void {
    // Forward room-specific events (not media events)
    const eventsToForward = [
      'participantAdded',
      'participantRemoved',
      'participantPinned',
      'participantUnpinned',
      'participantPinnedForEveryone',
      'participantUnpinnedForEveryone',
      'subRoomCreated',
      'streamRemoved',
      'audioToggled',
      'videoToggled',
      'handRaiseToggled',
      'remoteAudioStatusChanged',
      'remoteVideoStatusChanged',
      'remoteHandRaisingStatusChanged',
      'screenShareStarted',
      'screenShareStopped',
      'remoteScreenShareStarted',
      'remoteScreenShareStopped',
      'remoteScreenShareStreamReady',
      'messageSent',
      'messageReceived',
      'messageDeleted',
      'messageUpdated',
      'typingStarted',
      'typingStopped',
      'creatingBreakoutRoom',
      'joiningBreakoutRoom',
      'error',
    ];

    eventsToForward.forEach((event) => {
      room.on(event, (data: any) => {
        console.log(`[MeetingClient] Forwarding room event: ${event}`, data);
        this.emit(event, data);
      });
    });
  }


  async sendCustomEvent(eventData: object): Promise<void> {
    console.log("[MeetingClient] Sending custom event:", eventData);
    console.log("Current room:", this.state.currentRoom?.getInfo());
    if (!this.state.currentRoom) {
      return;
    }
    return await this.state.currentRoom.sendCustomEvent(eventData);
  }

  /**
   * Setup initial event handlers
   */
  private _setupEventHandlers(): void {
    // Handle authentication token refresh
    this.on('authenticated', () => {
      // Could implement token refresh logic here
    });

    // Handle connection status changes
    this.on('connectionStatusChanged', ({status}: any) => {
      if (status === 'failed' && this.config.reconnectAttempts > 0) {
        this._attemptReconnect();
      }
    });
  }

  /**
   * Attempt to reconnect
   */
  private async _attemptReconnect(): Promise<void> {
    let attempts = 0;

    while (attempts < this.config.reconnectAttempts) {
      try {
        attempts++;
        this._debug(`Reconnection attempt ${attempts}/${this.config.reconnectAttempts}`);

        await new Promise((resolve) => setTimeout(resolve, this.config.reconnectDelay));

        if (this.state.user) {
          await this.authenticate(this.state.user.id);
          this._debug('Reconnection successful');
          return;
        }
      } catch (error) {
        this._debug(
          `Reconnection attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    this.emit('reconnectionFailed', {});
    this._debug('All reconnection attempts failed');
  }

  /**
   * Set connection status
   */
  private _setConnectionStatus(status: ConnectionStatus): void {
    if (this.state.connectionStatus !== status) {
      this.state.connectionStatus = status;
      this.emit('connectionStatusChanged', {status});
      this._debug('Connection status changed:', status);
    }
  }

  /**
   * Ensure user is authenticated
   */
  private _ensureAuthenticated(): void {
    if (!this.state.isAuthenticated) {
      throw new Error('User must be authenticated first');
    }
  }

  /**
   * Debug logging
   */
  private _debug(...args: any[]): void {
    if (this.config.debug) {
      console.log('[ErmisClient]', ...args);
    }
  }
}

export default ErmisClient;

// Keep MeetingClient as alias for backwards compatibility
export {ErmisClient as MeetingClient};
