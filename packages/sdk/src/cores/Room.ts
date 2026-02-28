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
import { StreamTypes, PinType, ChannelName } from "../types/media/publisher.types";
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
  private videoResolutions?: ChannelName[];
  private subscriberInitQuality?: "video_360p" | "video_720p" | "video_1080p" | "video_1440p";

  // Participants management
  participants = new Map<string, Participant>(); // streamId -> Participant
  localParticipant: Participant | null = null;

  // Sub rooms (for main rooms only)
  subRooms = new Map<string, SubRoom>();
  currentSubRoom: SubRoom | null = null;

  // Media management
  audioMixer: AudioMixer | null = null;
  pinnedParticipant: Participant | null = null;
  pinnedPinType: PinType | null = null; // Track the type of pin (User or ScreenShare)

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
    this.videoResolutions = config.videoResolutions;
    this.subscriberInitQuality = config.subscriberInitQuality;
  }

  /**
   * Join this room
   */
  async join(
    userId: string,
    mediaStream: MediaStream | null = null,
    replace?: boolean,
  ): Promise<JoinRoomResult> {
    if (this.isActive) {
      throw new Error("Already joined this room");
    }

    try {
      this.emit("joining", { room: this });

      // Join via API
      const joinResponse = await this.apiClient.joinRoom(this.code, undefined, replace);

      // Store connection info
      this.id = joinResponse.room_id;
      this.membershipId = joinResponse.id;
      this.streamId = joinResponse.stream_id;
      this.localUserId = userId;

      // Get room details and members
      const roomDetails = await this.apiClient.getRoomById(
        joinResponse.room_id,
      );

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

      this._setupGlobalEventListeners();

      await this._setupMediaConnections(mediaStream);

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
      for (const userId of assignedUserIds) {
        const userStreams = this.getParticipantsByUserId(userId);
        for (const participant of userStreams) {
          if (!participant.isLocal) {
            this.removeParticipantByStreamId(participant.streamId);
          }
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
        const formattedParticipants = (roomConfig.participants || []).flatMap(
          (p) => {
            const userStreams = this.getParticipantsByUserId(p.userId);

            if (userStreams.length === 0) {
              throw new Error(`Participant ${p.userId} not found in main room`);
            }

            return userStreams.map(participantObj => ({
              user_id: participantObj.userId,
              stream_id: participantObj.streamId,
            }));
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

  // ============================================
  // HOST-ONLY METHODS
  // ============================================

  /**
   * Check if current user is the room owner (host)
   */
  isHost(): boolean {
    return this.localUserId === this.ownerId;
  }

  /**
   * Update participant permissions (HOST ONLY)
   * Used to mute mic, disable camera, etc.
   * 
   * @example
   * // Mute mic
   * room.updateParticipantPermission(streamId, { can_publish_sources: [["mic_48k", false]] })
   * 
   * // Disable camera
   * room.updateParticipantPermission(streamId, { can_publish_sources: [["video_360p", false], ["video_720p", false]] })
   * 
   * // Mute mic + disable camera
   * room.updateParticipantPermission(streamId, { 
   *   can_publish_sources: [["mic_48k", false], ["video_360p", false], ["video_720p", false]] 
   * })
   * 
   * // Re-enable mic + camera
   * room.updateParticipantPermission(streamId, { 
   *   can_publish_sources: [["mic_48k", true], ["video_360p", true], ["video_720p", true]] 
   * })
   */
  async updateParticipantPermission(
    streamId: string,
    permissionChanged: {
      can_subscribe?: boolean | null;
      can_publish?: boolean | null;
      can_publish_data?: boolean | null;
      can_publish_sources?: Array<[string, boolean]> | null;
      hidden?: boolean | null;
      can_update_metadata?: boolean | null;
    }
  ): Promise<any> {
    if (!this.isHost()) {
      throw new Error("Only the room host can update participant permissions");
    }

    if (!this.isActive) {
      throw new Error("Room is not active");
    }

    try {
      log("[Room] Updating participant permission:", streamId, permissionChanged);

      const response = await this.apiClient.updateParticipant({
        room_id: this.id,
        stream_id: streamId,
        permission_changed: permissionChanged,
      });

      log("[Room] Participant permission updated successfully");

      // Also update local state immediately for host's UI
      // Find participant by streamId and update their permissions
      for (const participant of this.participants.values()) {
        if (participant.streamId === streamId) {
          // Convert null values to proper format for updatePermissions
          const cleanPermission: {
            can_subscribe?: boolean;
            can_publish?: boolean;
            can_publish_data?: boolean;
            can_publish_sources?: Array<[string, boolean]>;
            hidden?: boolean;
            can_update_metadata?: boolean;
          } = {};

          if (permissionChanged.can_subscribe !== undefined && permissionChanged.can_subscribe !== null) {
            cleanPermission.can_subscribe = permissionChanged.can_subscribe;
          }
          if (permissionChanged.can_publish !== undefined && permissionChanged.can_publish !== null) {
            cleanPermission.can_publish = permissionChanged.can_publish;
          }
          if (permissionChanged.can_publish_data !== undefined && permissionChanged.can_publish_data !== null) {
            cleanPermission.can_publish_data = permissionChanged.can_publish_data;
          }
          if (permissionChanged.can_publish_sources !== undefined && permissionChanged.can_publish_sources !== null) {
            cleanPermission.can_publish_sources = permissionChanged.can_publish_sources;
          }
          if (permissionChanged.hidden !== undefined && permissionChanged.hidden !== null) {
            cleanPermission.hidden = permissionChanged.hidden;
          }
          if (permissionChanged.can_update_metadata !== undefined && permissionChanged.can_update_metadata !== null) {
            cleanPermission.can_update_metadata = permissionChanged.can_update_metadata;
          }

          participant.updatePermissions(cleanPermission);

          // Emit event so React components can update
          this.emit("permissionUpdated", {
            room: this,
            participant,
            permissionChanged: cleanPermission,
            isMicBanned: participant.isMicBanned,
            isCameraBanned: participant.isCameraBanned,
          });
          break;
        }
      }

      return response;
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "updateParticipantPermission",
      });
      throw error;
    }
  }

  /**
   * Fetch list of participants from server (HOST ONLY)
   * Returns fresh participant data from API
   */
  async fetchParticipants(): Promise<any[]> {
    if (!this.isHost()) {
      throw new Error("Only the room host can fetch participants list");
    }

    if (!this.isActive) {
      throw new Error("Room is not active");
    }

    try {
      log("[Room] Fetching participants list for room:", this.id);

      const response = await this.apiClient.listParticipants({
        room_id: this.id,
      });

      log("[Room] Fetched participants:", response);
      return response.data || response || [];
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "fetchParticipants",
      });
      throw error;
    }
  }

  /**
   * Remove a participant from the room (HOST ONLY)
   * 
   * @param participantUserId - User ID of the participant to remove
   * @param reason - Optional reason for removing the participant
   */
  async removeParticipantByHost(targetId: string, reason?: string): Promise<void> {
    if (!this.isHost()) {
      throw new Error("Only the room host can remove participants");
    }

    if (!this.isActive) {
      throw new Error("Room is not active");
    }

    // Try finding by streamId first (precise removal)
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this._removeParticipantStream(participantByStream, reason);
    }

    // Fallback: Find all streams for this userId (broad removal)
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      log("[Room] Removing all streams for user:", targetId);
      await Promise.all(participants.map(p => this._removeParticipantStream(p, reason)));
      return;
    }

    throw new Error(`Participant ${targetId} not found in room`);
  }

  private async _removeParticipantStream(participant: Participant, reason?: string): Promise<void> {
    try {
      log("[Room] Removing participant stream:", participant.streamId, "user:", participant.userId);

      const request: { room_id: string; stream_id: string; reason?: string } = {
        room_id: this.id,
        stream_id: participant.streamId,
      };

      if (reason) {
        request.reason = reason;
      }

      await this.apiClient.removeParticipant(request);

      log("[Room] Participant stream removed successfully");

      // Emit participantRemovedByHost event immediately for host UI
      this.emit("participantRemovedByHost", {
        room: this,
        participant,
        reason: reason || "Removed by host",
      });
    } catch (error) {
      this.emit("error", {
        room: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "removeParticipantByHost",
      });
      throw error;
    }
  }

  /**
   * Mute a participant's microphone (HOST ONLY)
   * Convenience method for updateParticipantPermission
   */
  async muteParticipant(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["mic_48k", false]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["mic_48k", false]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
  }

  /**
   * Unmute a participant's microphone (HOST ONLY)
   * Convenience method for updateParticipantPermission
   */
  async unmuteParticipant(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["mic_48k", true]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["mic_48k", true]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
  }

  /**
   * Disable a participant's camera (HOST ONLY)
   * Convenience method for updateParticipantPermission
   */
  async disableParticipantCamera(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["video_360p", false], ["video_720p", false], ["video_1080p", false]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["video_360p", false], ["video_720p", false], ["video_1080p", false]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
  }

  /**
   * Enable a participant's camera (HOST ONLY)
   * Convenience method for updateParticipantPermission
   */
  async enableParticipantCamera(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["video_360p", true], ["video_720p", true], ["video_1080p", true]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["video_360p", true], ["video_720p", true], ["video_1080p", true]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
  }

  /**
   * enableParticipantScreenShare
   */
  async enableParticipantScreenShare(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["screen_share_720p", true], ["screen_share_1080p", true], ["screen_share_audio", true]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["screen_share_720p", true], ["screen_share_1080p", true], ["screen_share_audio", true]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
  }

  /**
   * disableParticipantScreenShare
   */
  async disableParticipantScreenShare(targetId: string): Promise<any> {
    // Try precise targeting via streamId
    const participantByStream = this.getParticipantByStreamId(targetId);
    if (participantByStream) {
      return this.updateParticipantPermission(participantByStream.streamId, {
        can_publish_sources: [["screen_share_720p", false], ["screen_share_1080p", false], ["screen_share_audio", false]],
      });
    }

    // Fallback: Apply to all streams for userId
    const participants = this.getParticipantsByUserId(targetId);
    if (participants.length > 0) {
      return Promise.all(participants.map(p =>
        this.updateParticipantPermission(p.streamId, {
          can_publish_sources: [["screen_share_720p", false], ["screen_share_1080p", false], ["screen_share_audio", false]],
        })
      ));
    }

    throw new Error(`Participant ${targetId} not found`);
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
    const isLocal = memberData.stream_id === this.streamId;

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

    // Use streamId as key to support multi-stream per user
    this.participants.set(participant.streamId, participant);

    if (isLocal) {
      this.localParticipant = participant;
    }

    // Handle initial pin state from API data (for late-joining users)
    if (memberData.is_pinned_for_everyone) {
      const pinType: PinType = (memberData.pin_type as PinType) ?? PinType.User;
      participant.isPinned = true;
      participant.pinType = pinType;
      this.pinnedParticipant = participant;
      this.pinnedPinType = pinType;
      log("[Room] Participant is pinned for everyone:", {
        userId: participant.userId,
        pinType,
      });
    }

    this.emit("participantAdded", { room: this, participant });

    return participant;
  }

  /**
   * Remove a participant from the room by streamId
   * @param streamId - The stream ID of the participant to remove
   */
  removeParticipantByStreamId(streamId: string): Participant | null {
    const participant = this.participants.get(streamId);
    if (!participant) return null;

    // Cleanup participant
    participant.cleanup();

    // Remove from maps
    this.participants.delete(streamId);

    if (this.localParticipant?.streamId === streamId) {
      this.localParticipant = null;
    }

    if (this.pinnedParticipant?.streamId === streamId) {
      this.pinnedParticipant = null;
      this.pinnedPinType = null;
    }

    this.emit("participantRemoved", { room: this, participant });

    return participant;
  }

  /**
   * @deprecated Use getParticipantByStreamId (precise) or getParticipantsByUserId (all streams) instead.
   * This method returns the FIRST stream found for a user, which may be ambiguous in multi-stream scenarios.
   */
  getParticipant(userId: string): Participant | undefined {
    return Array.from(this.participants.values()).find(p => p.userId === userId);
  }

  /**
   * Get a participant by stream ID
   */
  getParticipantByStreamId(streamId: string): Participant | undefined {
    return this.participants.get(streamId);
  }

  /**
   * Get all participants with the same userId (all streams of a user)
   */
  getParticipantsByUserId(userId: string): Participant[] {
    return Array.from(this.participants.values()).filter(p => p.userId === userId);
  }

  /**
   * Check if user has any active streams in the room
   */
  hasUserActiveStream(userId: string): boolean {
    return this.getParticipantsByUserId(userId).length > 0;
  }

  /**
   * Get all participants
   */
  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Pin a participant's video
   * @param id - streamId (preferred) or userId
   */
  pinParticipant(id: string): boolean {
    // Try streamId first (precise), fallback to userId
    const participant = this.getParticipantByStreamId(id)
      || Array.from(this.participants.values()).find(p => p.userId === id);
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
      pinnedPinType: this.pinnedPinType,
    };
  }

  /**
   * Start screen sharing for local participant
   */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.localParticipant) {
      throw new Error("Local participant not available");
    }

    try {
      this.emit("screenShareStarting", { room: this });

      // Start screen share through participant
      const screenStream = await this.localParticipant.startScreenShare();

      // Emit with original stream for UI (Room-level event)
      this.emit("screenShareStarted", {
        room: this,
        stream: screenStream,
        participant: this.localParticipant.getInfo(),
      });

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
    if (!this.localParticipant) {
      throw new Error("Local participant not available");
    }

    try {
      this.emit("screenShareStopping", { room: this });

      // Stop screen share through participant
      await this.localParticipant.stopScreenShare();

      // Room-level event
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

  // ========== Stream Reconnection Methods ==========

  /**
   * Reconnect local participant's stream (Publisher)
   * Call this when you want to manually trigger a reconnection for the local user's audio/video
   * 
   * @example
   * ```typescript
   * try {
   *   await room.reconnectLocalStream();
   *   console.log("Reconnected successfully");
   * } catch (error) {
   *   console.error("Reconnection failed:", error);
   * }
   * ```
   */
  async reconnectLocalStream(): Promise<void> {
    if (!this.localParticipant) {
      throw new Error("Local participant not available");
    }

    if (!this.localParticipant.publisher) {
      throw new Error("Publisher not initialized");
    }

    log("[Room] Manual reconnection requested for local stream");
    await this.localParticipant.publisher.reconnect();
  }

  /**
   * Reconnect a remote participant's stream (Subscriber)
   * Call this when you want to manually trigger a reconnection for receiving a specific participant's audio/video
   * 
   * @param id - streamId (preferred) or userId of the remote participant
   * 
   * @example
   * ```typescript
   * try {
   *   await room.reconnectRemoteStream("stream-123"); // or "user-123"
   *   console.log("Reconnected to remote participant");
   * } catch (error) {
   *   console.error("Reconnection failed:", error);
   * }
   * ```
   */
  async reconnectRemoteStream(id: string): Promise<void> {
    // Try streamId first (precise), fallback to userId
    const participant = this.getParticipantByStreamId(id)
      || Array.from(this.participants.values()).find(p => p.userId === id);

    if (!participant) {
      throw new Error(`Participant not found: ${id}`);
    }

    if (!participant.subscriber) {
      throw new Error(`Subscriber not initialized for participant: ${id}`);
    }

    log("[Room] Manual reconnection requested for remote stream:", id);
    await participant.subscriber.reconnect();
  }

  /**
   * Reconnect all streams (local publisher + all remote subscribers)
   * Use with caution - this will reconnect everything
   * 
   * @example
   * ```typescript
   * await room.reconnectAllStreams();
   * ```
   */
  async reconnectAllStreams(): Promise<void> {
    log("[Room] Manual reconnection requested for ALL streams");

    const reconnectPromises: Promise<void>[] = [];

    // Reconnect local publisher
    if (this.localParticipant?.publisher) {
      reconnectPromises.push(
        this.localParticipant.publisher.reconnect().catch(err => {
          console.error("[Room] Failed to reconnect local stream:", err);
        })
      );
    }

    // Reconnect all remote subscribers
    for (const [userId, participant] of this.participants) {
      if (!participant.isLocal && participant.subscriber) {
        reconnectPromises.push(
          participant.subscriber.reconnect().catch(err => {
            console.error(`[Room] Failed to reconnect remote stream for ${userId}:`, err);
          })
        );
      }
    }

    await Promise.all(reconnectPromises);
    log("[Room] All stream reconnections completed");
  }

  /**
   * Handle remote screen share
   * @param participantUserId - The participant's user ID (for logging purposes)
   * @param streamId - The stream ID of the participant sharing screen
   * @param isStarting - Whether the screen share is starting or stopping
   * @param hasAudio - Whether the screen share has audio (from start_share_screen event)
   */
  async handleRemoteScreenShare(
    participantUserId: string,
    streamId: string,
    isStarting: boolean,
    hasAudio?: boolean,
  ): Promise<void> {
    // Use streamId to lookup participant (Map is keyed by streamId)
    const participant = this.participants.get(streamId);
    if (!participant) {
      console.warn(`[Room] handleRemoteScreenShare: participant not found for streamId ${streamId}`);
      return;
    }

    log(`[Room] Processing remote screen share:`, isStarting ? "START" : "STOP", "for", participantUserId, "stream:", streamId);

    if (isStarting && this.localParticipant?.streamId) {
      // Skip if screen subscriber already exists (prevent duplicate subscriptions)
      if ((participant as any).screenSubscriber) {
        log(`[Room] Screen subscriber already exists for ${participantUserId}, skipping duplicate subscription`);
        return;
      }

      console.warn(`[Room] 🔊 handleRemoteScreenShare: participantUserId=${participantUserId}, hasAudio param=${hasAudio}, participant.hasScreenShareAudio BEFORE=${participant.hasScreenShareAudio}`);

      // Update participant's screen share audio state if provided
      if (hasAudio !== undefined) {
        participant.hasScreenShareAudio = hasAudio;
      }

      console.warn(`[Room] 🔊 participant.hasScreenShareAudio AFTER=${participant.hasScreenShareAudio}`);

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

      log(`[Room] After stop - camera subscriber still exists: ${!!participant.subscriber}`);
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

    const publishUrl = `${this.mediaConfig.webtpUrl}/publish/${this.id}/${this.streamId}`;

    // Determine hasCamera and hasMic based on the provided mediaStream
    // If no stream provided, both are false (permission denied or no devices)
    const hasCamera = mediaStream ? mediaStream.getVideoTracks().length > 0 : false;
    const hasMic = mediaStream ? mediaStream.getAudioTracks().length > 0 : false;

    log("[Room] Setting up local publisher with hasCamera:", hasCamera, "hasMic:", hasMic);

    const publisher = new Publisher({
      publishUrl,
      streamType: "camera",
      streamId: this.streamId,
      userId: this.localParticipant.userId,
      mediaStream: mediaStream,
      hasCamera,  // Pass to Publisher so it knows device availability
      hasMic,     // Pass to Publisher so it knows device availability
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 1_500_000,
      roomId: this.id,
      useWebRTC: useWebRTC,
      webRtcHost: this.mediaConfig.hostNode,
      permissions: this.localParticipant.permissions,
      videoResolutions: this.videoResolutions,
      onStatusUpdate: (_message: string, isError?: boolean) => {
        this.localParticipant?.setConnectionStatus(
          isError ? "failed" : "connected",
        );
      },
    });

    // Reconnection events are now handled via GlobalEventBus in _setupGlobalEventListeners()

    await publisher.startPublishing();
    this.localParticipant.setPublisher(publisher);

    // Sync participant's enabled state with publisher's initial state
    // This handles the case when user joins with mic/camera disabled in preview
    this.localParticipant.isAudioEnabled = publisher.isAudioOn();
    this.localParticipant.isVideoEnabled = publisher.isVideoOn();
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
      initialQuality: this.subscriberInitQuality,
    });

    // Add to audio mixer
    if (this.audioMixer) {
      subscriber.setAudioMixer(this.audioMixer);
    }

    // Reconnection events are now handled via GlobalEventBus in _setupGlobalEventListeners()

    try {
      await subscriber.start();
    } catch (startError) {
      console.warn("[Room] Subscriber start failed, retrying in 2s:", startError);
      // Cleanup failed subscriber
      try { subscriber.stop(); } catch (_) { /* ignore */ }
      // Wait for resources to release
      await new Promise(r => setTimeout(r, 2000));
      // Create fresh subscriber and retry once
      const retrySubscriber = new Subscriber({
        localStreamId: this.localParticipant?.streamId!,
        subcribeUrl: `${this.mediaConfig.webtpUrl}/subscribe/${this.id}/${participant.streamId}`,
        streamId: participant.streamId,
        roomId: this.id,
        streamOutputEnabled: true,
        host: this.mediaConfig.hostNode,
        protocol: this.mediaConfig.subscribeProtocol as any,
        subscribeType: StreamTypes.CAMERA,
        onStatus: (_msg: string, isError: boolean) => {
          log("[Room] Subscriber status for", participant.userId, ":", isError ? "FAILED" : "CONNECTED");
          participant.setConnectionStatus(isError ? "failed" : "connected");
        },
        audioWorkletUrl: "/workers/audio-worklet.js",
        mstgPolyfillUrl: "/polyfills/MSTG_polyfill.js",
        initialQuality: this.subscriberInitQuality,
      });
      if (this.audioMixer) {
        retrySubscriber.setAudioMixer(this.audioMixer);
      }
      await retrySubscriber.start();
      participant.setSubscriber(retrySubscriber);
      return;
    }
    participant.setSubscriber(subscriber);

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
      log("[Room] Processing join event for:", joinedParticipant.user_id, "stream:", joinedParticipant.stream_id);

      // Skip join event for local participant's own stream (check stream_id, not user_id for multi-stream support)
      if (joinedParticipant.stream_id === this.localParticipant?.streamId) {
        console.log("[Room] Skipping join event for local participant's stream", "joined participant stream id", joinedParticipant.stream_id, "this local participant stream id", this.localParticipant?.streamId);
        return;
      }

      // Check if participant already exists by stream_id - if so, skip creating new one
      // This prevents duplicate join events (e.g. during screen share) from 
      // destroying existing subscriber connections
      const existingParticipant = this.participants.get(joinedParticipant.stream_id);
      if (existingParticipant) {
        log("[Room] Participant stream already exists, skipping duplicate join:", joinedParticipant.stream_id);
        // Update participant info if needed (mic/camera state may have changed)
        existingParticipant.updateMicStatus(joinedParticipant.is_mic_on);
        existingParticipant.updateCameraStatus(joinedParticipant.is_camera_on);
        return;
      }

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
          is_screen_sharing: joinedParticipant.is_screen_sharing,
          has_screen_sharing_audio: joinedParticipant.has_screen_sharing_audio,
        },
        this.localParticipant?.userId || "",
      );

      await this._setupRemoteSubscriber(participant);
    }

    if (event.type === "leave") {
      const leaveEvent = event as any;
      // Use stream_id for lookup to support multi-stream per user
      const streamId = leaveEvent.participant.stream_id;
      const participant = this.participants.get(streamId);
      if (participant) {
        this.removeParticipantByStreamId(streamId);
      } else {
        // Fallback: if stream_id not available, try to find by user_id (legacy support)
        const userId = leaveEvent.participant.user_id;
        log("[Room] Leave event: stream_id not found, falling back to user_id lookup:", userId);
        const fallbackParticipant = this.getParticipant(userId);
        if (fallbackParticipant) {
          this.removeParticipantByStreamId(fallbackParticipant.streamId);
        }
      }
    }

    // Handle participant removed/kicked event
    if (event.type === "removed") {
      const removedEvent = event as any;
      const removedUserId = removedEvent.participant?.user_id;
      const removedStreamId = removedEvent.participant?.stream_id;
      const reason = removedEvent.reason || "Removed by host";
      const timestamp = removedEvent.timestamp;

      log("[Room] Received 'removed' event:", { removedUserId, removedStreamId, reason, timestamp });

      // Check if this is the local participant being removed (check stream_id for multi-stream support)
      const isLocalRemoved = removedStreamId
        ? removedStreamId === this.localParticipant?.streamId
        : removedUserId === this.localParticipant?.userId; // fallback for legacy events

      if (isLocalRemoved) {
        log("[Room] Local participant was removed from the room");

        // Immediately stop media connections to prevent reconnect loop
        // The server will close the connection, and if isPublishing is still true,
        // the Publisher would try to reconnect indefinitely.
        this._cleanupMediaConnections().catch((err) => {
          console.warn("[Room] Error cleaning up media after kick:", err);
        });

        // Emit event after cleanup so UI can show appropriate message
        this.emit("participantRemovedByHost", {
          room: this,
          participant: this.localParticipant,
          reason,
          isLocal: true,
        });
      } else {
        // Remote participant was removed - use stream_id for lookup
        const streamId = removedEvent.participant?.stream_id;
        const participant = streamId
          ? this.participants.get(streamId)
          : this.getParticipant(removedUserId); // fallback to userId lookup
        if (participant) {
          log("[Room] Remote participant was removed:", removedUserId, "streamId:", participant.streamId);

          this.emit("participantRemovedByHost", {
            room: this,
            participant,
            reason,
            isLocal: false,
          });

          this.removeParticipantByStreamId(participant.streamId);
        }
      }
    }

    // Handle replaced event (new session took over)
    if (event.type === "replaced") {
      const replacedEvent = event as any;
      const replacedUserId = replacedEvent.participant?.user_id;
      const replacedStreamId = replacedEvent.participant?.stream_id;
      const timestamp = replacedEvent.timestamp;

      log("[Room] Received 'replaced' event:", { replacedUserId, replacedStreamId, timestamp });

      // Check if this is the local participant being replaced
      const isLocalReplaced = replacedStreamId
        ? replacedStreamId === this.localParticipant?.streamId
        : replacedUserId === this.localParticipant?.userId;

      if (isLocalReplaced) {
        log("[Room] Local participant was replaced by a new session");

        this.emit("replaced", {
          room: this,
          participant: this.localParticipant,
          timestamp,
          isLocal: true,
        });
      } else {
        // Remote participant was replaced - use stream_id for lookup
        const streamId = replacedStreamId;
        const participant = streamId
          ? this.participants.get(streamId)
          : this.getParticipant(replacedUserId); // fallback to userId lookup

        if (participant) {
          log("[Room] Remote participant was replaced:", replacedUserId, "streamId:", participant.streamId);

          // Emit remove event so UI can clean up immediately
          // We treat 'replaced' as a form of removal for other clients
          this.emit("participantRemoved", {
            room: this,
            participant: participant,
          });

          this.removeParticipantByStreamId(participant.streamId);
        }
      }
    }

    // Handle replaced event (new session took over)
    if (event.type === "replaced") {
      const replacedEvent = event as any;
      const replacedUserId = replacedEvent.participant?.user_id;
      const replacedStreamId = replacedEvent.participant?.stream_id;
      const timestamp = replacedEvent.timestamp;

      log("[Room] Received 'replaced' event:", { replacedUserId, replacedStreamId, timestamp });

      // Check if this is the local participant being replaced
      const isLocalReplaced = replacedStreamId
        ? replacedStreamId === this.localParticipant?.streamId
        : replacedUserId === this.localParticipant?.userId;

      if (isLocalReplaced) {
        log("[Room] Local participant was replaced by a new session");

        this.emit("replaced", {
          room: this,
          participant: this.localParticipant,
          timestamp,
          isLocal: true,
        });
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = screenEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(screenEvent.participant.user_id);
      // Extract hasAudio from event (server forwards has_audio at top level)
      console.warn(`[Room] 📥 Received start_share_screen event FULL:`, JSON.stringify(screenEvent, null, 2));
      const hasAudio = screenEvent.has_audio ?? false;
      console.warn(`[Room] Received start_share_screen event, hasAudio: ${hasAudio}`);

      // Check streamId (not userId) to support multi-stream per user
      if (participant && participant.streamId !== this.localParticipant?.streamId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          screenEvent.participant.stream_id,
          true,
          hasAudio, // Pass hasAudio to subscriber
        );
      } else {
        if (participant && participant.streamId === this.localParticipant?.streamId) {
          participant.isScreenSharing = true;
          participant.hasScreenShareAudio = hasAudio;
        }
      }
    }

    if (event.type === "stop_share_screen") {
      const screenEvent = event as any;
      // Prefer stream_id lookup, fallback to user_id
      const streamId = screenEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(screenEvent.participant.user_id);

      // Check streamId (not userId) to support multi-stream per user
      if (participant && participant.streamId !== this.localParticipant?.streamId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          screenEvent.participant.stream_id,
          false,
        );
      } else if (
        participant &&
        participant.streamId === this.localParticipant?.streamId
      ) {
        participant.isScreenSharing = false;
        this.emit("screenShareStopped", {
          participant: participant.getInfo(),
          roomId: this.id,
        });
      }
    }

    if (event.type === "mic_on") {
      const micEvent = event as any;
      // Prefer stream_id lookup, fallback to user_id
      const streamId = micEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(micEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = micEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(micEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = cameraEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(cameraEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = cameraEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(cameraEvent.participant.user_id);
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
      const eventParticipant = pinEvent.participant;
      // Read pinType from participant object in event
      const pinType: PinType = eventParticipant.pin_type ?? pinEvent.pin_type ?? PinType.User;
      // Prefer stream_id lookup, fallback to user_id
      const streamId = eventParticipant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(eventParticipant.stream_id)
        : this.getParticipant(eventParticipant.user_id);
      if (participant) {
        this.pinParticipant(participant.streamId);
        this.pinnedPinType = pinType;
        // Update participant's pinType from event
        participant.pinType = pinType;
        this.emit("participantPinnedForEveryone", {
          room: this,
          participant,
          pinType,
        });
      }
    }

    if (event.type === "unpin_for_everyone") {
      const unpinEvent = event as any;
      const eventParticipant = unpinEvent.participant;
      // Read pinType from participant object in event
      const pinType: PinType = eventParticipant.pin_type ?? unpinEvent.pin_type ?? PinType.User;
      if (this.pinnedParticipant) {
        const participant = this.pinnedParticipant;
        // Only unpin if the pinType matches
        if (this.pinnedPinType === pinType || this.pinnedPinType === null) {
          this.unpinParticipant();
          this.pinnedPinType = null;
          // Clear participant's pinType
          participant.pinType = null;
          this.emit("participantUnpinnedForEveryone", {
            room: this,
            participant,
            pinType,
          });
        }
      }
    }

    if (event.type === "raise_hand") {
      const handEvent = event as any;
      // Prefer stream_id lookup, fallback to user_id
      const streamId = handEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(handEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = handEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(handEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = requestEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(requestEvent.participant.user_id);
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
      // Prefer stream_id lookup, fallback to user_id
      const streamId = disconnectEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(disconnectEvent.participant.user_id);
      if (participant) {
        this.emit("participantDisconnected", {
          room: this,
          participant,
        });
      }
    }

    if (event.type === "reconnected") {
      const reconnectEvent = event as any;
      // Prefer stream_id lookup, fallback to user_id
      const streamId = reconnectEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(reconnectEvent.participant.user_id);
      if (participant) {
        this.emit("participantReconnected", {
          room: this,
          participant,
        });
      }
    }
    if (event.type === "room_ended") {
      log("[Room] Room ended by host, leaving room automatically");
      // Emit event first so listeners can handle cleanup
      this.emit("roomEnded", {
        room: this,
        reason: "host_ended",
      });
      // Auto leave the room
      try {
        await this.leave();
      } catch (error) {
        console.error("[Room] Error leaving room after room_ended:", error);
      }
    }

    if (event.type === "update_permission") {
      const permissionEvent = event as any;
      log("[Room] 📥 Received update_permission event:", JSON.stringify(permissionEvent, null, 2));
      log("[Room] Looking for participant with user_id:", permissionEvent.participant?.user_id);
      log("[Room] Current participants:", Array.from(this.participants.keys()));

      // Use getParticipant to find by userId (participants Map is keyed by streamId)
      // Prefer stream_id lookup, fallback to user_id
      // Note: permission_updated event structure may vary, checking logic
      const streamId = permissionEvent.participant.stream_id;
      const participant = streamId
        ? this.getParticipantByStreamId(streamId)
        : this.getParticipant(permissionEvent.participant.user_id);
      if (participant) {
        const permissionChanged = permissionEvent.permission_changed;
        log("[Room] ✅ Found participant, updating permissions:", permissionEvent.participant.user_id, permissionChanged);
        log("[Room] Participant permissions BEFORE:", JSON.stringify(participant.permissions, null, 2));

        // Update permissions on participant
        participant.updatePermissions(permissionChanged);

        log("[Room] Participant permissions AFTER:", JSON.stringify(participant.permissions, null, 2));
        log("[Room] isMicBanned:", participant.isMicBanned, "isCameraBanned:", participant.isCameraBanned);

        // Check if any channel was unbanned (allowed: true)
        const unbannedChannels: string[] = [];
        if (permissionChanged.can_publish_sources) {
          for (const [channel, allowed] of permissionChanged.can_publish_sources) {
            if (allowed === true) {
              unbannedChannels.push(channel);
            }
          }
        }

        // If this is the local participant and they were unbanned, reconnect publisher streams
        if (participant === this.localParticipant && participant.publisher) {
          log("[Room] 🔄 Local participant permission changed, checking if streams need reconnection...");
          try {
            // handlePermissionChange will check which channels were unbanned and reconnect them
            await participant.publisher.handlePermissionChange(permissionChanged);
          } catch (error) {
            console.error("[Room] Failed to handle permission change for local participant:", error);
          }
        }

        // If this is a remote participant and they were unbanned, reconnect their subscriber
        // if (participant !== this.localParticipant && unbannedChannels.length > 0 && participant.subscriber) {
        //   log("[Room] 🔄 Remote participant was unbanned, reconnecting subscriber...", participant.userId, unbannedChannels);
        //   try {
        //     // Stop old subscriber (this also calls cleanup internally)
        //     participant.subscriber.stop();
        //     participant.setSubscriber(null as any);

        //     // Wait a bit for cleanup
        //     await new Promise(resolve => setTimeout(resolve, 200));

        //     // Recreate subscriber
        //     await this._setupRemoteSubscriber(participant);
        //     log("[Room] ✅ Subscriber reconnected for remote participant:", participant.userId);
        //   } catch (error) {
        //     console.error("[Room] Failed to reconnect subscriber for remote participant:", error);
        //   }
        // }

        this.emit("permissionUpdated", {
          room: this,
          participant,
          permissionChanged,
          isMicBanned: participant.isMicBanned,
          isCameraBanned: participant.isCameraBanned,
        });
        log("[Room] ✅ Emitted permissionUpdated event");
      } else {
        log("[Room] ❌ Participant not found for update_permission event:", permissionEvent.participant?.user_id);
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
        this.pinParticipant(p.streamId);
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
          this.emit("remoteScreenShareStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id,
          });
        } else {
          this.emit("remoteStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id,
          });
        }
      }
    };

    // Publisher reconnection handlers
    const handlePublisherReconnecting = (data: any) => {
      log("[Room] Publisher reconnecting:", data);
      this.emit("localStreamReconnecting", {
        room: this,
        ...data,
      });
    };

    const handlePublisherReconnected = (data: any) => {
      log("[Room] Publisher reconnected:", data);
      this.emit("localStreamReconnected", { room: this });
    };

    const handlePublisherReconnectionFailed = (data: any) => {
      log("[Room] Publisher reconnection failed:", data);
      this.emit("localStreamReconnectionFailed", {
        room: this,
        ...data,
      });
    };

    const handlePublisherConnectionHealthChanged = (data: any) => {
      log("[Room] Publisher connection health changed:", data);
      this.emit("localConnectionHealthChanged", {
        room: this,
        ...data,
      });
    };

    // Subscriber reconnection handlers
    const handleSubscriberReconnecting = (data: any) => {
      const participant = Array.from(this.participants.values()).find(
        p => p.streamId === data.streamId
      );
      if (participant) {
        log("[Room] Subscriber reconnecting for:", participant.userId, data);
        this.emit("remoteStreamReconnecting", {
          room: this,
          participant,
          attempt: data.attempt,
          maxAttempts: data.maxAttempts,
          delay: data.delay,
        });
      }
    };

    const handleSubscriberReconnected = (data: any) => {
      const participant = Array.from(this.participants.values()).find(
        p => p.streamId === data.streamId
      );
      if (participant) {
        log("[Room] Subscriber reconnected for:", participant.userId);
        this.emit("remoteStreamReconnected", {
          room: this,
          participant,
        });
      }
    };

    const handleSubscriberReconnectionFailed = (data: any) => {
      const participant = Array.from(this.participants.values()).find(
        p => p.streamId === data.streamId
      );
      if (participant) {
        log("[Room] Subscriber reconnection failed for:", participant.userId, data);
        this.emit("remoteStreamReconnectionFailed", {
          room: this,
          participant,
          reason: data.reason,
        });
      }
    };

    // Subscribe to global events
    globalEventBus.on(GlobalEvents.SERVER_EVENT, handleServerEvent);
    globalEventBus.on(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady);
    globalEventBus.on(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady);
    globalEventBus.on(GlobalEvents.SCREEN_SHARE_STOPPED, handleScreenShareStopped);
    globalEventBus.on(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady);

    // Subscribe to Publisher reconnection events
    globalEventBus.on(GlobalEvents.PUBLISHER_RECONNECTING, handlePublisherReconnecting);
    globalEventBus.on(GlobalEvents.PUBLISHER_RECONNECTED, handlePublisherReconnected);
    globalEventBus.on(GlobalEvents.PUBLISHER_RECONNECTION_FAILED, handlePublisherReconnectionFailed);
    globalEventBus.on(GlobalEvents.PUBLISHER_CONNECTION_HEALTH_CHANGED, handlePublisherConnectionHealthChanged);

    // Subscribe to Subscriber reconnection events
    globalEventBus.on(GlobalEvents.SUBSCRIBER_RECONNECTING, handleSubscriberReconnecting);
    globalEventBus.on(GlobalEvents.SUBSCRIBER_RECONNECTED, handleSubscriberReconnected);
    globalEventBus.on(GlobalEvents.SUBSCRIBER_RECONNECTION_FAILED, handleSubscriberReconnectionFailed);

    // Store cleanup functions
    this.globalEventCleanups.push(
      () => globalEventBus.off(GlobalEvents.SERVER_EVENT, handleServerEvent),
      () => globalEventBus.off(GlobalEvents.LOCAL_STREAM_READY, handleLocalStreamReady),
      () => globalEventBus.off(GlobalEvents.LOCAL_SCREEN_SHARE_READY, handleLocalScreenShareReady),
      () => globalEventBus.off(GlobalEvents.SCREEN_SHARE_STOPPED, handleScreenShareStopped),
      () => globalEventBus.off(GlobalEvents.REMOTE_STREAM_READY, handleRemoteStreamReady),
      // Publisher reconnection cleanups
      () => globalEventBus.off(GlobalEvents.PUBLISHER_RECONNECTING, handlePublisherReconnecting),
      () => globalEventBus.off(GlobalEvents.PUBLISHER_RECONNECTED, handlePublisherReconnected),
      () => globalEventBus.off(GlobalEvents.PUBLISHER_RECONNECTION_FAILED, handlePublisherReconnectionFailed),
      () => globalEventBus.off(GlobalEvents.PUBLISHER_CONNECTION_HEALTH_CHANGED, handlePublisherConnectionHealthChanged),
      // Subscriber reconnection cleanups
      () => globalEventBus.off(GlobalEvents.SUBSCRIBER_RECONNECTING, handleSubscriberReconnecting),
      () => globalEventBus.off(GlobalEvents.SUBSCRIBER_RECONNECTED, handleSubscriberReconnected),
      () => globalEventBus.off(GlobalEvents.SUBSCRIBER_RECONNECTION_FAILED, handleSubscriberReconnectionFailed),
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

    // Explicitly cleanup local publisher
    if (this.localParticipant?.publisher) {
      await this.localParticipant.publisher.stop();
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
    this.pinnedPinType = null;
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
