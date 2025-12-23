/**
 * Room - Represents a meeting room
 * Handles participant management, media connections, sub-rooms, and chat
 */

import { EventEmitter } from "../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../events/GlobalEventBus";
import { Participant } from "./Participant";
import { SubRoom } from "./SubRoom";
import { Publisher } from "../media/publisher/Publisher";
import { Subscriber } from "../media/subscriber/Subscriber";
import { AudioMixer } from "../media/audioMixer/AudioMixer";
import { StreamTypes } from "../types/media/publisher.types";
import type {
  RoomConfig,
  RoomType,
  RoomInfo,
  JoinRoomResult,
  SubRoomCreationConfig,
  BreakoutRoomConfig,
  ChatMessage,
  MessageMetadata,
  TypingUser,
  ParticipantApiData,
  RoomApiData,
  ServerEvent,
  MediaConfig,
  CustomEventData,
} from "../types/core/room.types";
import { log } from "../utils";

export class Room extends EventEmitter {
  // Basic room properties
  id: string;
  name: string;
  code: string;
  readonly type: RoomType;
  ownerId: string;
  isActive = false;
  localUserId: string | null = null;

  // Configuration
  private apiClient: any; // TODO: Type this properly when ApiClient is converted
  private mediaConfig: MediaConfig;

  // Participants management
  participants = new Map<string, Participant>();
  localParticipant: Participant | null = null;

  // Sub rooms (for main rooms only)
  subRooms = new Map<string, SubRoom>();
  currentSubRoom: SubRoom | null = null;

  // Media management
  audioMixer: AudioMixer | null = null;
  pinnedParticipant: Participant | null = null;

  // Connection info
  membershipId: string | null = null;
  streamId: string | null = null;

  // Chat management
  messages: ChatMessage[] = [];
  typingUsers = new Map<string, TypingUser>();

  // Custom event listeners
  private customEventListeners: Array<(event: CustomEventData) => void> = [];

  // Global event subscriptions cleanup
  private globalEventCleanups: Array<() => void> = [];

  constructor(config: RoomConfig) {
    super();

    this.id = config.id;
    this.name = config.name;
    this.code = config.code;
    this.type = config.type || "main";
    this.ownerId = config.ownerId;
    this.apiClient = config.apiClient;
    this.mediaConfig = config.mediaConfig;
  }

  /**
   * Join this room
   */
  async join(
    userId: string,
    mediaStream: MediaStream | null = null,
  ): Promise<JoinRoomResult> {
    if (this.isActive) {
      throw new Error("Already joined this room");
    }

    try {
      this.emit("joining", { room: this });
      log("Joining room with code", this.code);

      // Join via API
      const joinResponse = await this.apiClient.joinRoom(this.code);

      // Store connection info
      this.id = joinResponse.room_id;
      this.membershipId = joinResponse.id;
      this.streamId = joinResponse.stream_id;
      this.localUserId = userId;

      // Get room details and members
      const roomDetails = await this.apiClient.getRoomById(
        joinResponse.room_id,
      );
      log("Joined room, details:", roomDetails);

      // Update room info
      this._updateFromApiData(roomDetails.room);

      // Setup participants
      await this._setupParticipants(roomDetails.participants, userId);

      // Setup sub rooms if they exist
      if (roomDetails.sub_rooms?.length) {
        for (const subRoomData of roomDetails.sub_rooms) {
          this._setupSubRoom(subRoomData);
        }
      }

      // Setup media connections with optional custom stream
      await this._setupMediaConnections(mediaStream);

      // Setup global event listeners (subscribe directly from globalEventBus)
      this._setupGlobalEventListeners();

      this.isActive = true;
      this.emit("joined", { room: this, participants: this.participants });

      return {
        room: this,
        localParticipant: this.localParticipant,
        participants: Array.from(this.participants.values()),
      };
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "join",
      });
      throw error;
    }
  }

  /**
   * Leave this room
   */
  async leave(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      this.emit("leaving", { room: this });

      // Cleanup media connections
      await this._cleanupMediaConnections();

      // Cleanup global event listeners
      this._cleanupGlobalEventListeners();

      // Cleanup participants
      this._cleanupParticipants();

      // Leave via API
      if (this.membershipId) {
        await this.apiClient.leaveRoom(this.id, this.membershipId);
      }

      this.isActive = false;
      this.emit("left", { room: this });
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "leave",
      });
      throw error;
    }
  }

  /**
   * Create sub rooms (breakout rooms) - main room only
   */
  async createSubRoom(config: SubRoomCreationConfig): Promise<any> {
    if (this.type !== "main") {
      throw new Error("Only main rooms can create sub rooms");
    }

    try {
      this.emit("creatingSubRoom", { room: this, config });

      // Create sub rooms via API with the expected format
      const subRoomsData = await this.apiClient.createSubRoom({
        main_room_id: this.id,
        rooms: config.rooms,
      });

      // Filter participants - keep only members NOT assigned to sub rooms
      const assignedUserIds = new Set<string>();
      subRoomsData.rooms?.forEach((subRoom: any) => {
        this._setupSubRoom(subRoom);
        if (subRoom.participants?.length) {
          subRoom.participants.forEach((p: any) => {
            assignedUserIds.add(p.user_id || p.userId);
          });
        }
      });

      // Remove assigned participants from current room
      for (const [userId, participant] of this.participants) {
        if (assignedUserIds.has(userId) && !participant.isLocal) {
          this.removeParticipant(userId);
        }
      }

      this.emit("subRoomCreated", {
        room: this,
      });

      return subRoomsData;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "createSubRoom",
      });
      throw error;
    }
  }

  /**
   * Create breakout room
   */
  async createBreakoutRoom(config: BreakoutRoomConfig): Promise<Room[]> {
    if (this.type !== "main") {
      throw new Error("Only main rooms can create breakout rooms");
    }

    try {
      this.emit("creatingBreakoutRoom", { room: this, config });

      const roomsData = config.rooms.map((roomConfig) => {
        const formattedParticipants = (roomConfig.participants || []).map(
          (p) => {
            const participantObj = this.participants.get(p.userId);

            if (!participantObj) {
              throw new Error(`Participant ${p.userId} not found in main room`);
            }

            return {
              user_id: participantObj.userId,
              stream_id: participantObj.streamId,
            };
          },
        );

        return {
          room_name: roomConfig.name,
          participants: formattedParticipants,
        };
      });

      const apiResponse = await this.apiClient.createBreakoutRoom(
        this.id,
        roomsData,
      );

      const createdRooms: Room[] = [];
      for (const roomData of apiResponse?.rooms || []) {
        const subRoom = new Room({
          id: roomData.room_id,
          name: roomData.room_name,
          code: roomData.room_code,
          type: "breakout",
          ownerId: roomData.user_id,
          apiClient: this.apiClient,
          mediaConfig: this.mediaConfig,
        });
        (subRoom as any).participants = roomData.participants || [];
        this.subRooms.set(subRoom.id, subRoom as any);
        createdRooms.push(subRoom);

        this.emit("subRoomCreated", { room: this, subRoom });
      }

      return createdRooms;
    } catch (err) {
      this.emit("error", {
        room: this,
        error: err instanceof Error ? err : new Error(String(err)),
        action: "createBreakoutRooms",
        err: err as Error,
      });
      throw err;
    }
  }

  /**
   * Join Breakout room
   */
  async joinBreakoutRoom(): Promise<any> {
    try {
      if (!this.apiClient) {
        throw new Error("Client not initialized or missing ApiClient");
      }
      if (!this.localParticipant) throw new Error("No local participant found");

      const localUserId = this.localParticipant.userId;
      let targetSubRoom: SubRoom | null = null;

      if (!this.subRooms || this.subRooms.size === 0) {
        console.warn(
          "⚠️ No breakout rooms found. Maybe they haven't been created yet?",
        );
        return;
      }

      for (const sub of this.subRooms.values()) {
        const participants = (sub as any).participants || [];
        const match = participants.find((p: any) => p.user_id === localUserId);
        if (match) {
          targetSubRoom = sub;
          break;
        }
      }

      if (!targetSubRoom) {
        console.warn(`⚠️ No assigned subroom found for user ${localUserId}`);
        return;
      }

      const subRoomId = targetSubRoom.id || (targetSubRoom as any).sub_room_id;

      this.emit("joiningBreakoutRoom", {
        userId: localUserId,
        roomCode: this.code,
        subRoomId,
      });

      const response = await this.apiClient.joinBreakoutRoom({
        subRoomId,
        parentRoomId: this.id,
      });

      this.emit("joinedBreakoutRoom", {
        userId: localUserId,
        subRoom: targetSubRoom,
        response,
      });

      log(`✅ User ${localUserId} joined breakout room: ${this.code}`);
      return response;
    } catch (error) {
      this.emit("error", {
        error: error instanceof Error ? error : new Error(String(error)),
        action: "joinBreakoutRoom",
        room: this,
      });
      console.error("❌ joinBreakoutRoom failed:", error);
      throw error;
    }
  }

  /**
   * Get all sub rooms
   */
  async getSubRooms(): Promise<any[]> {
    if (this.type !== "main") {
      return [];
    }

    try {
      const subRoomsData = await this.apiClient.getSubRooms(this.id);
      return subRoomsData || [];
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "getSubRooms",
      });
      throw error;
    }
  }

  /**
   * Join a sub room
   */
  async joinSubRoom(subRoomId: string): Promise<any> {
    try {
      this.emit("joiningSubRoom", { room: this, subRoomId });

      // Join via API
      const joinResponse = await this.apiClient.joinSubRoom({
        parent_room_id: this.id,
        sub_room_id: subRoomId,
        room_code: this.code,
      });

      this.emit("joinedSubRoom", {
        room: this,
        subRoomId,
        response: joinResponse,
      });

      return joinResponse;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "joinSubRoom",
      });
      throw error;
    }
  }

  /**
   * Leave sub room and return to main room
   */
  async leaveSubRoom(subRoomId: string): Promise<any> {
    try {
      this.emit("leavingSubRoom", { room: this, subRoomId });

      // Leave via API
      const leaveResponse = await this.apiClient.leaveSubRoom({
        parent_room_id: this.id,
        sub_room_id: subRoomId,
      });

      this.emit("leftSubRoom", {
        room: this,
        subRoomId,
        response: leaveResponse,
      });

      return leaveResponse;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "leaveSubRoom",
      });
      throw error;
    }
  }

  /**
   * Close all sub rooms - main room only
   */
  async closeSubRoom(): Promise<any> {
    if (this.type !== "main") {
      throw new Error("Only main rooms can close sub rooms");
    }

    try {
      this.emit("closingSubRoom", { room: this });

      // Close all sub rooms via API
      const closeResponse = await this.apiClient.closeSubRoom(this.id);

      this.emit("closedSubRoom", {
        room: this,
        response: closeResponse,
      });

      return closeResponse;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "closeSubRoom",
      });
      throw error;
    }
  }

  /**
   * Send a chat message
   */
  async sendMessage(
    text: string,
    metadata: MessageMetadata = {},
  ): Promise<ChatMessage> {
    if (!this.isActive) {
      throw new Error("Cannot send message: room is not active");
    }

    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot send message: publisher not available");
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      throw new Error(
        "Message text is required and must be a non-empty string",
      );
    }

    try {
      const messageId = this._generateMessageId();
      const message: ChatMessage = {
        id: messageId,
        text: text.trim(),
        senderId: this.localParticipant.userId,
        senderName: metadata.senderName || this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
        metadata: metadata.customData || {},
      };

      const messageEvent = {
        type: "message",
        ...message,
      };

      await this.localParticipant.publisher.sendEvent(messageEvent);

      this.messages.push(message);

      this.emit("messageSent", {
        room: this,
        message,
      });

      return message;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "sendMessage",
      });
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    if (!this.isActive) {
      throw new Error("Cannot delete message: room is not active");
    }

    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot delete message: publisher not available");
    }

    try {
      const deleteEvent = {
        type: "messageDelete",
        messageId,
        senderId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
      };

      await this.localParticipant.publisher.sendEvent(deleteEvent);

      this.messages = this.messages.filter((m) => m.id !== messageId);

      this.emit("messageDeleted", {
        room: this,
        messageId,
      });

      return true;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "deleteMessage",
      });
      throw error;
    }
  }

  /**
   * Update a message
   */
  async updateMessage(
    messageId: string,
    newText: string,
    metadata: MessageMetadata = {},
  ): Promise<boolean> {
    if (!this.isActive) {
      throw new Error("Cannot update message: room is not active");
    }

    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot update message: publisher not available");
    }

    if (
      !newText ||
      typeof newText !== "string" ||
      newText.trim().length === 0
    ) {
      throw new Error(
        "New message text is required and must be a non-empty string",
      );
    }

    try {
      const updateEvent = {
        type: "messageUpdate",
        messageId,
        text: newText.trim(),
        senderId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
        metadata: metadata.customData || {},
      };

      await this.localParticipant.publisher.sendEvent(updateEvent);

      const messageIndex = this.messages.findIndex((m) => m.id === messageId);
      if (messageIndex !== -1) {
        this.messages[messageIndex].text = newText.trim();
        this.messages[messageIndex].updatedAt = Date.now();
        this.messages[messageIndex].metadata = {
          ...this.messages[messageIndex].metadata,
          ...updateEvent.metadata,
        };
      }

      this.emit("messageUpdated", {
        room: this,
        messageId,
        text: newText.trim(),
      });

      return true;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "updateMessage",
      });
      throw error;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(isTyping = true): Promise<void> {
    if (!this.isActive) {
      return;
    }

    if (!this.localParticipant?.publisher) {
      return;
    }

    try {
      const typingEvent = {
        type: isTyping ? "typingStart" : "typingStop",
        userId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
      };

      await this.localParticipant.publisher.sendEvent(typingEvent);
    } catch (error) {
      console.error("Failed to send typing indicator:", error);
    }
  }

  async sendCustomEvent(targets: string[], eventData: object): Promise<void> {
    if (!this.isActive) {
      return;
    }

    if (!this.localParticipant?.publisher) {
      return;
    }

    try {
      await this.localParticipant.publisher.sendCustomEvent(targets, eventData);
    } catch (error) {
      console.error("Failed to send custom event:", error);
    }
  }

  /**
   * Register a listener for custom events
   * @param listener - Callback function to handle custom events
   * @returns Unsubscribe function to remove the listener
   */
  onCustomEvent(listener: (event: CustomEventData) => void): () => void {
    this.customEventListeners.push(listener);
    return () => {
      const index = this.customEventListeners.indexOf(listener);
      if (index !== -1) {
        this.customEventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Remove a custom event listener
   * @param listener - The listener to remove
   */
  offCustomEvent(listener: (event: CustomEventData) => void): void {
    const index = this.customEventListeners.indexOf(listener);
    if (index !== -1) {
      this.customEventListeners.splice(index, 1);
    }
  }

  /**
   * Get recent messages
   */
  getMessages(limit = 100): ChatMessage[] {
    return this.messages.slice(-limit);
  }

  /**
   * Get users currently typing
   */
  getTypingUsers(): TypingUser[] {
    return Array.from(this.typingUsers.values());
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Add a participant to the room
   */
  addParticipant(memberData: ParticipantApiData, userId: string): Participant {
    const isLocal = memberData.user_id === userId;

    log("[Room] Creating participant:", {
      userId: memberData.user_id,
      streamId: memberData.stream_id,
      isLocal,
      isMicOn: memberData.is_mic_on,
      isCameraOn: memberData.is_camera_on,
    });

    const participant = new Participant({
      userId: memberData.user_id,
      streamId: memberData.stream_id,
      membershipId: memberData.id,
      role: memberData.role as any,
      roomId: this.id,
      name: memberData.name,
      isLocal,
      isScreenSharing: memberData.is_screen_sharing || false,
      permissions: memberData.permissions,
      // Pass initial audio/video enabled state from server
      isAudioEnabled: memberData.is_mic_on,
      isVideoEnabled: memberData.is_camera_on,
      // Pass screen share audio/video state from server (for participants already sharing screen)
      hasScreenShareAudio: memberData.has_screen_sharing_audio ?? false,
      hasScreenShareVideo: memberData.has_screen_sharing_video ?? true,
    });

    // Setup participant events
    this._setupParticipantEvents(participant);

    this.participants.set(participant.userId, participant);

    if (isLocal) {
      this.localParticipant = participant;
    }

    log("[Room] 📢 Emitting participantAdded event for:", participant.userId);
    this.emit("participantAdded", { room: this, participant });

    return participant;
  }

  /**
   * Remove a participant from the room
   */
  removeParticipant(userId: string): Participant | null {
    const participant = this.participants.get(userId);
    if (!participant) return null;

    // Cleanup participant
    participant.cleanup();

    // Remove from maps
    this.participants.delete(userId);

    if (this.localParticipant?.userId === userId) {
      this.localParticipant = null;
    }

    if (this.pinnedParticipant?.userId === userId) {
      this.pinnedParticipant = null;
    }

    this.emit("participantRemoved", { room: this, participant });

    return participant;
  }

  /**
   * Get a participant by user ID
   */
  getParticipant(userId: string): Participant | undefined {
    return this.participants.get(userId);
  }

  /**
   * Get all participants
   */
  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Pin a participant's video
   */
  pinParticipant(userId: string): boolean {
    const participant = this.participants.get(userId);
    if (!participant) return false;

    // Unpin current participant
    if (this.pinnedParticipant && this.pinnedParticipant !== participant) {
      this.pinnedParticipant.isPinned = false;
    }

    // Pin new participant
    participant.isPinned = true;
    this.pinnedParticipant = participant;

    this.emit("participantPinned", { room: this, participant });

    return true;
  }
  /**
   * Unpin currently pinned participant
   */
  unpinParticipant(): boolean {
    if (!this.pinnedParticipant) return false;

    this.pinnedParticipant.isPinned = false;
    const unpinnedParticipant = this.pinnedParticipant;

    this.pinnedParticipant = null;

    // Note: Removed auto-pin local participant behavior
    // It caused issues with "unpin for everyone" where receiver would
    // immediately pin themselves instead of staying unpinned

    this.emit("participantUnpinned", {
      room: this,
      participant: unpinnedParticipant,
    });

    return true;
  }

  /**
   * Get room info snapshot
   */
  getInfo(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      code: this.code,
      type: this.type,
      ownerId: this.ownerId,
      isActive: this.isActive,
      participantCount: this.participants.size,
      subRoomCount: this.subRooms.size,
      pinnedParticipant: this.pinnedParticipant?.userId || null,
    };
  }

  /**
   * Start screen sharing for local participant
   */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.localParticipant || !this.localParticipant.publisher) {
      throw new Error("Local participant or publisher not available");
    }

    try {
      this.emit("screenShareStarting", { room: this });

      // Get display media
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080 } as any,
        audio: true,
      });

      // Start screen share through publisher first
      await this.localParticipant.publisher.startShareScreen(screenStream);

      this.localParticipant.isScreenSharing = true;

      // Emit with original stream for UI
      this.emit("screenShareStarted", {
        room: this,
        stream: screenStream,
        participant: this.localParticipant.getInfo(),
      });
      log("[Room] screenStream: ", screenStream);

      return screenStream;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "startScreenShare",
      });
      throw error;
    }
  }

  /**
   * Stop screen sharing for local participant
   */
  async stopScreenShare(): Promise<void> {
    if (!this.localParticipant || !this.localParticipant.publisher) {
      throw new Error("Local participant or publisher not available");
    }

    try {
      this.emit("screenShareStopping", { room: this });

      await this.localParticipant.publisher.stopShareScreen();

      this.localParticipant.isScreenSharing = false;
      this.emit("screenShareStopped", { room: this });
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "stopScreenShare",
      });
      throw error;
    }
  }

  /**
   * Handle remote screen share
   * @param participantId - The participant's user ID
   * @param _screenStreamId - The screen stream ID
   * @param isStarting - Whether the screen share is starting or stopping
   * @param hasAudio - Whether the screen share has audio (from start_share_screen event)
   */
  async handleRemoteScreenShare(
    participantId: string,
    _screenStreamId: string,
    isStarting: boolean,
    hasAudio?: boolean,
  ): Promise<void> {
    const participant = this.participants.get(participantId);
    if (!participant) return;

    if (isStarting && this.localParticipant?.streamId) {
      // Update participant's screen share audio state if provided
      if (hasAudio !== undefined) {
        participant.hasScreenShareAudio = hasAudio;
      }

      log(`[Room] Subscribing to screen share from ${participantId}, hasAudio: ${participant.hasScreenShareAudio}`);

      const screenSubscriber = new Subscriber({
        subcribeUrl: `${this.mediaConfig.webtpUrl}/subscribe/${this.id}/${participant.streamId}`,
        localStreamId: this.localParticipant?.streamId,
        streamId: participant.streamId,
        roomId: this.id,
        host: this.mediaConfig.hostNode,
        protocol: this.mediaConfig.subscribeProtocol as any,
        subscribeType: StreamTypes.SCREEN_SHARE,
        streamOutputEnabled: true,
        // Pass audioEnabled based on whether publisher has screen share audio
        audioEnabled: participant.hasScreenShareAudio,
        onStatus: (_msg, isError) => {
          participant.setConnectionStatus(isError ? "failed" : "connected");
        },
        audioWorkletUrl: "/workers/audio-worklet.js",
        mstgPolyfillUrl: "/polyfills/MSTG_polyfill.js",
      });

      // Add to audio mixer if has audio
      if (this.audioMixer && participant.hasScreenShareAudio) {
        screenSubscriber.setAudioMixer(this.audioMixer);
      }

      await screenSubscriber.start();

      (participant as any).screenSubscriber = screenSubscriber;
      participant.isScreenSharing = true;

      this.emit("remoteScreenShareStarted", { room: this, participant });
    } else {
      if ((participant as any).screenSubscriber) {
        (participant as any).screenSubscriber.stop();
        (participant as any).screenSubscriber = null;
      }

      participant.isScreenSharing = false;
      // Reset screen share audio state when stopping
      participant.hasScreenShareAudio = false;

      this.emit("remoteScreenShareStopped", { room: this, participant });
    }
  }

  /**
   * Setup participants from API data
   */
  private async _setupParticipants(
    participantsData: ParticipantApiData[],
    userId: string,
  ): Promise<void> {
    for (const participantData of participantsData) {
      this.addParticipant(participantData, userId);
    }
  }

  /**
   * Setup media connections for all participants
   */
  private async _setupMediaConnections(
    mediaStream: MediaStream | null = null,
  ): Promise<void> {
    // Initialize audio mixer
    if (!this.audioMixer) {
      this.audioMixer = new AudioMixer();
      await this.audioMixer.initialize();
    }

    // Setup publisher for local participant
    if (this.localParticipant) {
      await this._setupLocalPublisher(mediaStream);
    }

    // Setup subscribers for remote participants
    for (const participant of this.participants.values()) {
      if (!participant.isLocal) {
        await this._setupRemoteSubscriber(participant);
      }
    }

    // Note: Stream events are now handled via globalEventBus
    // No need for local event forwarding
  }

  /**
   * Setup publisher for local participant
   */
  private async _setupLocalPublisher(
    mediaStream: MediaStream | null = null,
  ): Promise<void> {
    if (!this.localParticipant || !this.streamId) return;

    // Detect browser and determine transport
    const { logTransportInfo } = await import("../utils/browserDetection");
    const transportInfo = logTransportInfo();
    const useWebRTC = transportInfo.recommendedTransport.useWebRTC;

    log(
      `🚀 Setting up publisher with ${useWebRTC ? "WebRTC" : "WebTransport"}`,
    );

    const publishUrl = `${this.mediaConfig.webtpUrl}/publish/${this.id}/${this.streamId}`;
    log("trying to connect webtransport to", publishUrl);

    const publisher = new Publisher({
      publishUrl,
      streamType: "camera",
      streamId: this.streamId,
      userId: this.localParticipant.userId,
      mediaStream: mediaStream,
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 1_500_000,
      roomId: this.id,
      useWebRTC: useWebRTC,
      webRtcHost: this.mediaConfig.hostNode,
      permissions: this.localParticipant.permissions,
      onStatusUpdate: (_message: string, isError?: boolean) => {
        this.localParticipant?.setConnectionStatus(
          isError ? "failed" : "connected",
        );
      },
    });

    // No need to listen to publisher events - Room subscribes directly from globalEventBus
    // This eliminates event re-emission chain: StreamManager -> Publisher -> Room

    await publisher.startPublishing();
    this.localParticipant.setPublisher(publisher);

    // Sync participant's enabled state with publisher's initial state
    // This handles the case when user joins with mic/camera disabled in preview
    this.localParticipant.isAudioEnabled = publisher.isAudioOn();
    this.localParticipant.isVideoEnabled = publisher.isVideoOn();

    log("[Room] Local participant initial state synced:", {
      audioEnabled: this.localParticipant.isAudioEnabled,
      videoEnabled: this.localParticipant.isVideoEnabled,
    });
  }

  /**
   * Setup subscriber for remote participant
   */
  private async _setupRemoteSubscriber(
    participant: Participant,
  ): Promise<void> {
    // Skip if subscriber already exists (prevent duplicate subscriptions from multiple join events)
    if (participant.subscriber) {
      log("[Room] Subscriber already exists for:", participant.userId, "- skipping setup");
      return;
    }

    log("[Room] Setting up remote subscriber for:", {
      userId: participant.userId,
      streamId: participant.streamId,
      roomId: this.id,
    });
    log("[Room] Media config protocol:", this.mediaConfig.subscribeProtocol);
    if (!this.localParticipant?.streamId) throw new Error('Local stream must be defined');
    const subscriber = new Subscriber({
      localStreamId: this.localParticipant?.streamId,
      subcribeUrl: `${this.mediaConfig.webtpUrl}/subscribe/${this.id}/${participant.streamId}`,
      streamId: participant.streamId,
      roomId: this.id,
      streamOutputEnabled: true,
      host: this.mediaConfig.hostNode,
      protocol: this.mediaConfig.subscribeProtocol as any,
      subscribeType: StreamTypes.CAMERA,
      // protocol: "webtransport",

      onStatus: (_msg, isError) => {
        log("[Room] Subscriber status for", participant.userId, ":", isError ? "FAILED" : "CONNECTED");
        participant.setConnectionStatus(isError ? "failed" : "connected");
      },
      audioWorkletUrl: "/workers/audio-worklet.js",
      mstgPolyfillUrl: "/polyfills/MSTG_polyfill.js",
    });

    // Add to audio mixer
    if (this.audioMixer) {
      subscriber.setAudioMixer(this.audioMixer);
    }

    // No need to listen to subscriber events - Room subscribes directly from globalEventBus
    // This eliminates event re-emission: Subscriber -> Room

    log("[Room] Starting subscriber for:", participant.userId);
    await subscriber.start();
    participant.setSubscriber(subscriber);
    log("[Room] Subscriber started successfully for:", participant.userId);

    if (participant.isScreenSharing) {
      // Participant is already screen sharing when joining, use their stored hasScreenShareAudio value
      await this.handleRemoteScreenShare(
        participant.userId,
        participant.streamId,
        true,
        participant.hasScreenShareAudio,
      );
    }
  }

  /**
   * Handle server events from publisher
   */

  // todo: handle changes in participant info (name, role, permissions) events
  private async _handleServerEvent(event: ServerEvent): Promise<void> {
    if (event.type === "join") {
      const joinEvent = event as any;
      const joinedParticipant = joinEvent.participant;
      log("[Room] Processing join event for:", joinedParticipant.user_id);

      if (joinedParticipant.user_id === this.localParticipant?.userId) {
        log("[Room] Skipping join event for local participant");
        return;
      }

      log("[Room] Adding new participant:", joinedParticipant.user_id);
      const participant = this.addParticipant(
        {
          user_id: joinedParticipant.user_id,
          stream_id: joinedParticipant.stream_id,
          id: joinedParticipant.membership_id,
          role: joinedParticipant.role,
          name: joinedParticipant.name,
          permissions: joinedParticipant.permissions,
          // Pass initial mic/camera state from join event
          is_mic_on: joinedParticipant.is_mic_on,
          is_camera_on: joinedParticipant.is_camera_on,
        },
        this.localParticipant?.userId || "",
      );

      log("[Room] Setting up remote subscriber for:", participant.userId);
      await this._setupRemoteSubscriber(participant);
      log("[Room] Remote subscriber setup complete for:", participant.userId);
    }

    if (event.type === "leave") {
      const leaveEvent = event as any;
      const participant = this.participants.get(leaveEvent.participant.user_id);
      if (participant) {
        this.removeParticipant(leaveEvent.participant.user_id);
      }
    }

    if (event.type === "join_sub_room") {
      const subRoomEvent = event as any;
      const { room, participants } = subRoomEvent;
      this._setupSubRoom({ room, participants });
      this.emit("subRoomJoined", { room: this });
    }

    if (event.type === "leave_sub_room") {
      this.currentSubRoom = null;
      this.emit("subRoomLeft", { room: this });
    }

    if (event.type === "start_share_screen") {
      const screenEvent = event as any;
      const participant = this.participants.get(
        screenEvent.participant.user_id,
      );
      // Extract hasAudio from event (server forwards has_audio at top level)
      console.warn(`[Room] 📥 Received start_share_screen event FULL:`, JSON.stringify(screenEvent, null, 2));
      const hasAudio = screenEvent.has_audio ?? false;
      console.warn(`[Room] Received start_share_screen event, hasAudio: ${hasAudio}`);

      if (participant && participant.userId !== this.localParticipant?.userId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          screenEvent.participant.stream_id,
          true,
          hasAudio, // Pass hasAudio to subscriber
        );
      } else if (
        participant &&
        participant.userId === this.localParticipant?.userId
      ) {
        participant.isScreenSharing = true;
        participant.hasScreenShareAudio = hasAudio;
      }
    }

    if (event.type === "stop_share_screen") {
      const screenEvent = event as any;
      const participant = this.participants.get(
        screenEvent.participant.user_id,
      );
      if (participant && participant.userId !== this.localParticipant?.userId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          screenEvent.participant.stream_id,
          false,
        );
      } else if (
        participant &&
        participant.userId === this.localParticipant?.userId
      ) {
        participant.isScreenSharing = false;
      }
    }

    if (event.type === "mic_on") {
      const micEvent = event as any;
      const participant = this.participants.get(micEvent.participant.user_id);
      if (participant) {
        participant.updateMicStatus(true);
        this.emit("remoteAudioStatusChanged", {
          room: this,
          participant,
          enabled: true,
        });
      }
    }

    if (event.type === "mic_off") {
      const micEvent = event as any;
      const participant = this.participants.get(micEvent.participant.user_id);
      if (participant) {
        participant.updateMicStatus(false);
        this.emit("remoteAudioStatusChanged", {
          room: this,
          participant,
          enabled: false,
        });
      }
    }

    if (event.type === "camera_on") {
      const cameraEvent = event as any;
      const participant = this.participants.get(
        cameraEvent.participant.user_id,
      );
      if (participant) {
        participant.updateCameraStatus(true);
        this.emit("remoteVideoStatusChanged", {
          room: this,
          participant,
          enabled: true,
        });
      }
    }

    if (event.type === "camera_off") {
      const cameraEvent = event as any;
      const participant = this.participants.get(
        cameraEvent.participant.user_id,
      );
      if (participant) {
        participant.updateCameraStatus(false);
        this.emit("remoteVideoStatusChanged", {
          room: this,
          participant,
          enabled: false,
        });
      }
    }

    if (event.type === "pin_for_everyone") {
      const pinEvent = event as any;
      log(`Pin for everyone event received:`, pinEvent.participant);
      const participant = this.participants.get(pinEvent.participant.user_id);
      if (participant) {
        this.pinParticipant(participant.userId);
        this.emit("participantPinnedForEveryone", { room: this, participant });
      }
    }

    if (event.type === "unpin_for_everyone") {
      log(`Unpin for everyone event received`);
      if (this.pinnedParticipant) {
        const participant = this.pinnedParticipant;
        this.unpinParticipant();
        this.emit("participantUnpinnedForEveryone", {
          room: this,
          participant,
        });
      }
    }

    if (event.type === "raise_hand") {
      const handEvent = event as any;
      const participant = this.participants.get(handEvent.participant.user_id);
      if (participant) {
        participant.updateHandRaiseStatus(true);
        this.emit("remoteHandRaisingStatusChanged", {
          room: this,
          participant,
          raised: true,
        });
      }
    }

    if (event.type === "lower_hand") {
      const handEvent = event as any;
      const participant = this.participants.get(handEvent.participant.user_id);
      if (participant) {
        participant.updateHandRaiseStatus(false);
        this.emit("remoteHandRaisingStatusChanged", {
          room: this,
          participant,
          raised: false,
        });
      }
    }

    if (event.type === "request_share_screen") {
      const requestEvent = event as any;
      const participant = this.participants.get(requestEvent.participant.user_id);
      this.emit("screenShareRequested", {
        room: this,
        participant,
      });
    }

    if (event.type === "break_out_room") {
      const breakoutEvent = event as any;
      this.emit("breakoutRoomCreated", {
        room: this,
        mainRoomId: breakoutEvent.main_room_id,
        subRoomMap: breakoutEvent.sub_room_map,
        participantMap: breakoutEvent.participant_map,
      });
    }

    if (event.type === "close_breakout_room") {
      const closeEvent = event as any;
      this.emit("breakoutRoomClosed", {
        room: this,
        mainRoomId: closeEvent.main_room_id,
        participantMap: closeEvent.participant_map,
      });
    }

    if (event.type === "disconnected") {
      const disconnectEvent = event as any;
      const participant = this.participants.get(disconnectEvent.participant.user_id);
      if (participant) {
        this.emit("participantDisconnected", {
          room: this,
          participant,
        });
      }
    }

    if (event.type === "reconnected") {
      const reconnectEvent = event as any;
      const participant = this.participants.get(reconnectEvent.participant.user_id);
      if (participant) {
        this.emit("participantReconnected", {
          room: this,
          participant,
        });
      }
    }

    // Handle custom events
    if ((event as any).type === "custom") {
      const customEvent = event as any;
      const customEventData: CustomEventData = {
        senderStreamId: customEvent.sender_stream_id || "",
        value: customEvent.value || {},
        raw: customEvent,
      };

      // Notify all registered custom event listeners
      for (const listener of this.customEventListeners) {
        try {
          listener(customEventData);
        } catch (error) {
          console.error("[Room] Error in custom event listener:", error);
        }
      }

      // Also emit as a regular event for flexibility
      this.emit("customEvent", {
        room: this,
        event: customEventData,
      });
    }
  }

  /**
   * Setup participant event handlers
   */
  private _setupParticipantEvents(participant: Participant): void {
    participant.on("pinToggled", ({ participant: p, pinned }: any) => {
      if (pinned) {
        this.pinParticipant(p.userId);
      } else if (this.pinnedParticipant === p) {
        this.unpinParticipant();
      }
    });

    participant.on("audioToggled", ({ participant: p, enabled }: any) => {
      this.emit("audioToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("videoToggled", ({ participant: p, enabled }: any) => {
      this.emit("videoToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("handRaiseToggled", ({ participant: p, enabled }: any) => {
      this.emit("handRaiseToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("error", ({ participant: p, error, action }: any) => {
      this.emit("participantError", {
        room: this,
        participant: p,
        error,
        action,
      });
    });
  }

  /**
   * Update room data from API response
   */
  private _updateFromApiData(roomData: RoomApiData): void {
    this.name = roomData.room_name || this.name;
    this.ownerId = roomData.user_id || this.ownerId;
  }

  /**
   * Setup global event listeners - Subscribe directly from globalEventBus
   * This eliminates event chain: StreamManager -> Publisher -> Room
   */
  private _setupGlobalEventListeners(): void {
    // Bind handlers to preserve 'this' context
    const handleServerEvent = async (event: ServerEvent) => {
      log("[Room] Received serverEvent from GlobalEventBus:", event);
      await this._handleServerEvent(event);
    };

    const handleLocalStreamReady = (data: any) => {
      this.emit("localStreamReady", {
        ...data,
        participant: this.localParticipant?.getInfo(),
        roomId: this.id,
      });
    };

    const handleLocalScreenShareReady = (data: any) => {
      log("[Room] Received localScreenShareReady from globalEventBus:", data);
      this.emit("localScreenShareReady", {
        ...data,
        participant: this.localParticipant?.getInfo(),
        roomId: this.id,
      });
    };

    const handleScreenShareStopped = () => {
      if (this.localParticipant) {
        this.localParticipant.isScreenSharing = false;
      }
      this.emit("screenShareStopped", {
        participant: this.localParticipant?.getInfo(),
        roomId: this.id,
      });
    };

    const handleRemoteStreamReady = (data: any) => {
      // Find participant by streamId
      const participant = Array.from(this.participants.values()).find(
        p => p.streamId === data.streamId
      );

      if (participant) {
        const isScreenShare = data.subscribeType === "screen_share";

        if (isScreenShare) {
          log("[Room] 📢 Emitting remoteScreenShareStreamReady for:", participant.userId);
          this.emit("remoteScreenShareStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id,
          });
        } else {
          log("[Room] 📢 Emitting remoteStreamReady for:", participant.userId);
          this.emit("remoteStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id,
          });
        }
      }
    };

    // Subscribe to global events
    globalEventBus.on(GlobalEvents.SERVER_EVENT, handleServerEvent);
    globalEventBus.on(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady);
    globalEventBus.on(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady);
    globalEventBus.on(GlobalEvents.SCREEN_SHARE_STOPPED, handleScreenShareStopped);
    globalEventBus.on(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady);

    // Store cleanup functions
    this.globalEventCleanups.push(
      () => globalEventBus.off(GlobalEvents.SERVER_EVENT, handleServerEvent),
      () => globalEventBus.off(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady),
      () => globalEventBus.off(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady),
      () => globalEventBus.off(GlobalEvents.SCREEN_SHARE_STOPPED, handleScreenShareStopped),
      () => globalEventBus.off(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady),
    );

    log("[Room] ✅ Global event listeners setup complete");
  }

  /**
   * Cleanup global event listeners
   */
  private _cleanupGlobalEventListeners(): void {
    this.globalEventCleanups.forEach(cleanup => cleanup());
    this.globalEventCleanups = [];
    log("[Room] ✅ Global event listeners cleaned up");
  }

  /**
   * Cleanup media connections
   */
  private async _cleanupMediaConnections(): Promise<void> {
    // Cleanup audio mixer
    if (this.audioMixer) {
      await this.audioMixer.cleanup();
      this.audioMixer = null;
    }

    // Cleanup all participants' media
    for (const participant of this.participants.values()) {
      if (participant.publisher) {
        participant.publisher.stop();
        participant.publisher = null;
      }
      if (participant.subscriber) {
        participant.subscriber.stop();
        participant.subscriber = null;
      }
    }
  }

  /**
   * Cleanup all participants
   */
  private _cleanupParticipants(): void {
    for (const participant of this.participants.values()) {
      participant.cleanup();
    }

    this.participants.clear();
    this.localParticipant = null;
    this.pinnedParticipant = null;
    this.typingUsers.clear();
  }

  /**
   * Generate unique message ID
   */
  private _generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Note: Stream event forwarding is now handled via globalEventBus
   * Publisher and Subscriber emit directly to globalEventBus
   * Room and MeetingClient subscribe from globalEventBus
   * This eliminates the need for local event forwarding methods
   */

  /**
   * Setup sub room from API data
   */
  private _setupSubRoom(subRoomData: any): void {
    const subRoom = new SubRoom({
      id: subRoomData.room.id,
      name: subRoomData.room.room_name,
      type: subRoomData.room.room_type,
      parentRoomId: this.id,
      isActive: subRoomData.room.is_active,
    });

    // Setup sub room participants if they exist
    if (subRoomData.participants?.length) {
      for (const participantData of subRoomData.participants) {
        subRoom.addParticipant(participantData, this.localUserId || "");
      }
    }

    // Add to sub rooms map
    this.subRooms.set(subRoom.id, subRoom);

    if (
      subRoomData.participants?.some((p: any) => p.user_id === this.localUserId)
    ) {
      this.currentSubRoom = subRoom;
    }
  }

  /**
   * Cleanup room resources
   */
  async cleanup(): Promise<void> {
    if (this.isActive) {
      await this.leave();
    }

    // Cleanup sub rooms
    for (const subRoom of this.subRooms.values()) {
      await subRoom.cleanup();
    }
    this.subRooms.clear();

    this.removeAllListeners();
  }
}

export default Room;
