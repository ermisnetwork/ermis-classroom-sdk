import EventEmitter from "../events/EventEmitter.js";
import Participant from "./Participant.js";
import SubRoom from "./SubRoom.js";

import Publisher from "../media/Publisher.js";
import Subscriber from "../media/Subscriber.js";
import AudioMixer from "../media/AudioMixer.js";

/**
 * Represents a meeting room
 */
class Room extends EventEmitter {
  constructor(config) {
    super();

    this.id = config.id;
    this.name = config.name;
    this.code = config.code;
    this.type = config.type || "main"; // 'main', 'sub'
    this.ownerId = config.ownerId;
    this.isActive = false;
    this.localUserId = null;

    // Configuration
    this.apiClient = config.apiClient;
    this.mediaConfig = config.mediaConfig;

    // Participants management
    this.participants = new Map(); // userId -> Participant
    this.localParticipant = null;

    // Sub rooms (for main rooms only)
    this.subRooms = new Map(); // subRoomId -> Room
    this.currentSubRoom = null;

    // Media management
    this.audioMixer = null;
    this.pinnedParticipant = null;

    // Connection info
    this.membershipId = null;
    this.streamId = null;

    // Chat management
    this.messages = [];
    this.typingUsers = new Map();
  }

  /**
   * Join this room
   */
  async join(userId, mediaStream = null) {
    if (this.isActive) {
      throw new Error("Already joined this room");
    }

    try {
      this.emit("joining", { room: this });
      console.log("Joining room with code", this.code);
      // Join via API
      const joinResponse = await this.apiClient.joinRoom(this.code);

      // Store connection info
      this.id = joinResponse.room_id;
      this.membershipId = joinResponse.id;
      this.streamId = joinResponse.stream_id;
      this.localUserId = userId;

      // Get room details and members
      const roomDetails = await this.apiClient.getRoomById(joinResponse.room_id);
      console.log("Joined room, details:", roomDetails);

      // Update room info
      this._updateFromApiData(roomDetails.room);

      // Setup participants
      await this._setupParticipants(roomDetails.participants, userId);

      // Setup sub rooms if they exist
      if (roomDetails.sub_rooms.length) {
        for (const subRoomData of roomDetails.sub_rooms) {
          this._setupSubRoom(subRoomData);
        }
      }

      // Setup media connections with optional custom stream
      await this._setupMediaConnections(mediaStream);

      this.isActive = true;
      this.emit("joined", { room: this, participants: this.participants });

      return {
        room: this,
        localParticipant: this.localParticipant,
        participants: Array.from(this.participants.values()),
      };
    } catch (error) {
      this.emit("error", { room: this, error, action: "join" });
      throw error;
    }
  }

  /**
   * Leave this room
   */
  async leave() {
    if (!this.isActive) {
      return;
    }

    try {
      this.emit("leaving", { room: this });

      // Cleanup media connections
      await this._cleanupMediaConnections();

      // Cleanup participants
      this._cleanupParticipants();

      // Leave via API
      if (this.membershipId) {
        await this.apiClient.leaveRoom(this.id, this.membershipId);
      }

      this.isActive = false;
      this.emit("left", { room: this });
    } catch (error) {
      this.emit("error", { room: this, error, action: "leave" });
      throw error;
    }
  }

  /**
   * Create sub rooms (breakout rooms) - main room only
   */
  async createSubRoom(config) {
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
      const assignedUserIds = new Set();
      subRoomsData.rooms.forEach(subRoom => {
        this._setupSubRoom(subRoom);
        if (subRoom.participants.length) {
          subRoom.participants.forEach(p => {
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
        room: this
      });

      return subRoomsData;
    } catch (error) {
      this.emit("error", { room: this, error, action: "createSubRoom" });
      throw error;
    }
  }

  /**
   * Get all sub rooms
   */
  async getSubRooms() {
    if (this.type !== "main") {
      return [];
    }

    try {
      const subRoomsData = await this.apiClient.getSubRooms(this.id);

      // Return raw sub rooms data for now
      // In a full implementation, you might want to create Room instances
      return subRoomsData || [];
    } catch (error) {
      this.emit("error", { room: this, error, action: "getSubRooms" });
      throw error;
    }
  }

  /**
   * Join a sub room
   */
  async joinSubRoom(subRoomId) {
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
      this.emit("error", { room: this, error, action: "joinSubRoom" });
      throw error;
    }
  }

  /**
   * Leave sub room and return to main room
   */
  async leaveSubRoom(subRoomId) {
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
      this.emit("error", { room: this, error, action: "leaveSubRoom" });
      throw error;
    }
  }

  /**
   * Close all sub rooms - main room only
   */
  async closeSubRoom() {
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
      this.emit("error", { room: this, error, action: "closeSubRoom" });
      throw error;
    }
  }

  async sendMessage(text, metadata = {}) {
    if (!this.isActive) {
      throw new Error("Cannot send message: room is not active");
    }

    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot send message: publisher not available");
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Message text is required and must be a non-empty string");
    }

    try {
      const messageId = this._generateMessageId();
      const message = {
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
      this.emit("error", { room: this, error, action: "sendMessage" });
      throw error;
    }
  }

  async deleteMessage(messageId) {
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
      this.emit("error", { room: this, error, action: "deleteMessage" });
      throw error;
    }
  }

  async updateMessage(messageId, newText, metadata = {}) {
    if (!this.isActive) {
      throw new Error("Cannot update message: room is not active");
    }

    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot update message: publisher not available");
    }

    if (!newText || typeof newText !== "string" || newText.trim().length === 0) {
      throw new Error("New message text is required and must be a non-empty string");
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
      this.emit("error", { room: this, error, action: "updateMessage" });
      throw error;
    }
  }

  async sendTypingIndicator(isTyping = true) {
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

  getMessages(limit = 100) {
    return this.messages.slice(-limit);
  }

  getTypingUsers() {
    return Array.from(this.typingUsers.values());
  }

  clearMessages() {
    this.messages = [];
  }

  /**
   * Add a participant to the room
   */
  addParticipant(memberData, userId) {
    const isLocal = memberData.user_id === userId;

    const participant = new Participant({
      userId: memberData.user_id,
      streamId: memberData.stream_id,
      membershipId: memberData.id,
      role: memberData.role,
      roomId: this.id,
      name: memberData.name,
      isLocal,
    });

    // Setup participant events
    this._setupParticipantEvents(participant);

    this.participants.set(participant.userId, participant);

    if (isLocal) {
      this.localParticipant = participant;
    }

    this.emit("participantAdded", { room: this, participant });

    return participant;
  }

  /**
   * Remove a participant from the room
   */
  removeParticipant(userId) {
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
  getParticipant(userId) {
    return this.participants.get(userId);
  }

  /**
   * Get all participants
   */
  getParticipants() {
    return Array.from(this.participants.values());
  }

  /**
   * Pin a participant's video
   */
  // pinParticipant(userId) {
  //   const participant = this.participants.get(userId);
  //   if (!participant) return false;

  //   // Unpin current participant
  //   if (this.pinnedParticipant) {
  //     this.pinnedParticipant.isPinned = false;
  //   }

  //   // Pin new participant
  //   participant.isPinned = true;
  //   this.pinnedParticipant = participant;

  //   this.emit("participantPinned", { room: this, participant });

  //   return true;
  // }

  pinParticipant(userId) {
    const participant = this.participants.get(userId);
    if (!participant) return false;

    // Unpin current participant và move về sidebar
    if (this.pinnedParticipant && this.pinnedParticipant !== participant) {
      this.pinnedParticipant.isPinned = false;
    }

    // Pin new participant và move lên main
    participant.isPinned = true;
    this.pinnedParticipant = participant;

    this.emit("participantPinned", { room: this, participant });

    return true;
  }

  /**
   * Unpin currently pinned participant
   */
  // unpinParticipant() {
  //   if (!this.pinnedParticipant) return false;

  //   this.pinnedParticipant.isPinned = false;
  //   const unpinnedParticipant = this.pinnedParticipant;
  //   this.pinnedParticipant = null;

  //   this.emit("participantUnpinned", {
  //     room: this,
  //     participant: unpinnedParticipant,
  //   });

  //   return true;
  // }

  unpinParticipant() {
    if (!this.pinnedParticipant) return false;

    this.pinnedParticipant.isPinned = false;
    const unpinnedParticipant = this.pinnedParticipant;

    this.pinnedParticipant = null;

    // Auto-pin local participant nếu có
    if (this.localParticipant) {
      this.pinParticipant(this.localParticipant.userId);
    }

    this.emit("participantUnpinned", {
      room: this,
      participant: unpinnedParticipant,
    });

    return true;
  }

  /**
   * Get room info
   */
  getInfo() {
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
   * Setup participants from API data
   */
  async _setupParticipants(participantsData, userId) {
    for (const participantData of participantsData) {
      this.addParticipant(participantData, userId);
    }
  }

  /**
   * Setup media connections for all participants
   */
  async _setupMediaConnections(mediaStream = null) {
    // Initialize audio mixer
    if (!this.audioMixer) {
      this.audioMixer = new AudioMixer();
      await this.audioMixer.initialize();
    }

    // Setup publisher for local participant with optional custom stream
    if (this.localParticipant) {
      await this._setupLocalPublisher(mediaStream);
    }

    // Setup subscribers for remote participants
    for (const participant of this.participants.values()) {
      if (!participant.isLocal) {
        await this._setupRemoteSubscriber(participant);
      }
    }

    // Setup stream event forwarding
    this._setupStreamEventForwarding();
  }

  /**
   * Setup publisher for local participant
   */
  async _setupLocalPublisher(mediaStream = null) {
    if (!this.localParticipant || !this.streamId) return;

    // Video rendering handled by app through stream events

    const publishUrl = `${this.mediaConfig.webtpUrl}/publish/${this.id}/${this.streamId}`;
    console.log("trying to connect webtransport to", publishUrl);

    const publisher = new Publisher({
      publishUrl,
      streamType: "camera",
      streamId: this.streamId,
      mediaStream: mediaStream,
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 1_500_000,
      onStatusUpdate: (msg, isError) => {
        this.localParticipant.setConnectionStatus(isError ? "failed" : "connected");
      },
      onServerEvent: async (event) => {
        await this._handleServerEvent(event);
      },
    });

    // Setup stream event forwarding
    publisher.on("localStreamReady", (data) => {
      this.emit("localStreamReady", {
        ...data,
        participant: this.localParticipant.getInfo(),
        roomId: this.id,
      });
    });

    await publisher.startPublishing();
    this.localParticipant.setPublisher(publisher);
  }

  /**
   * Setup subscriber for remote participant
   */
  async _setupRemoteSubscriber(participant) {
    const subscriber = new Subscriber({
      subcribeUrl: `${this.mediaConfig.webtpUrl}/subscribe/${this.id}/${participant.streamId}`,
      streamId: participant.streamId,
      roomId: this.id,
      host: this.mediaConfig.host,
      streamOutputEnabled: true,
      onStatus: (msg, isError) => {
        participant.setConnectionStatus(isError ? "failed" : "connected");
      },
      audioWorkletUrl: "/workers/audio-worklet1.js",
      mstgPolyfillUrl: "/polyfills/MSTG_polyfill.js",
    });
    // Add to audio mixer
    if (this.audioMixer) {
      subscriber.setAudioMixer(this.audioMixer);
    }

    // Setup stream event forwarding
    subscriber.on("remoteStreamReady", (data) => {
      this.emit("remoteStreamReady", {
        ...data,
        participant: participant.getInfo(),
        roomId: this.id,
      });
    });

    // subscriber.on("streamRemoved", (data) => {
    //   this.emit("streamRemoved", {
    //     ...data,
    //     participant: participant.getInfo(),
    //     roomId: this.id
    //   });
    // });

    await subscriber.start();
    participant.setSubscriber(subscriber);
  }

  /**
   * Handle server events from publisher
   */
  async _handleServerEvent(event) {
    console.log("-----Received server event----", event);
    if (event.type === "join") {
      const joinedParticipant = event.participant;
      if (joinedParticipant.user_id === this.localParticipant?.userId) return;

      const participant = this.addParticipant(
        {
          user_id: joinedParticipant.user_id,
          stream_id: joinedParticipant.stream_id,
          id: joinedParticipant.membership_id,
          role: joinedParticipant.role,
          name: joinedParticipant.name,
        },
        this.localParticipant?.userId
      );

      await this._setupRemoteSubscriber(participant);
    }

    if (event.type === "leave") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        this.removeParticipant(event.participant.user_id);

        if (!this.pinnedParticipant && this.localParticipant) {
          this.pinParticipant(this.localParticipant.userId);
        }
      }
    }

    if (event.type === "join_sub_room") {      
      const {room, participants} = event;

      this._setupSubRoom({ room, participants });
      
      this.emit("subRoomJoined", {
        room: this.currentSubRoom,
      });
    }

    if (event.type === "leave_sub_room") { 
      this.currentSubRoom = null;

      this.emit("subRoomLeft", {
        room: this,
      });
    }

    if (event.type === "message") {
      const message = {
        id: event.id,
        text: event.text,
        senderId: event.senderId,
        senderName: event.senderName,
        roomId: event.roomId,
        timestamp: event.timestamp,
        metadata: event.metadata || {},
      };

      this.messages.push(message);

      const sender = this.getParticipant(event.senderId);

      this.emit("messageReceived", {
        room: this,
        message,
        sender: sender ? sender.getInfo() : null,
      });
    }

    if (event.type === "messageDelete") {
      this.messages = this.messages.filter((m) => m.id !== event.messageId);

      this.emit("messageDeleted", {
        room: this,
        messageId: event.messageId,
        senderId: event.senderId,
      });
    }

    if (event.type === "messageUpdate") {
      const messageIndex = this.messages.findIndex((m) => m.id === event.messageId);
      if (messageIndex !== -1) {
        this.messages[messageIndex].text = event.text;
        this.messages[messageIndex].updatedAt = event.timestamp;
        this.messages[messageIndex].metadata = {
          ...this.messages[messageIndex].metadata,
          ...event.metadata,
        };
      }

      this.emit("messageUpdated", {
        room: this,
        messageId: event.messageId,
        text: event.text,
        senderId: event.senderId,
      });
    }

    if (event.type === "typingStart") {
      if (event.userId !== this.localParticipant?.userId) {
        this.typingUsers.set(event.userId, {
          userId: event.userId,
          timestamp: event.timestamp,
        });

        this.emit("typingStarted", {
          room: this,
          userId: event.userId,
          user: this.getParticipant(event.userId)?.getInfo(),
        });

        setTimeout(() => {
          this.typingUsers.delete(event.userId);
          this.emit("typingStopped", {
            room: this,
            userId: event.userId,
          });
        }, 5000);
      }
    }

    if (event.type === "typingStop") {
      if (event.userId !== this.localParticipant?.userId) {
        this.typingUsers.delete(event.userId);

        this.emit("typingStopped", {
          room: this,
          userId: event.userId,
          user: this.getParticipant(event.userId)?.getInfo(),
        });
      }
    }
    if (event.type === "start_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        participant.isScreenSharing = true;
        this.emit("remoteScreenShareStarted", { room: this, participant });
      }
    }

    if (event.type === "stop_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        participant.isScreenSharing = false;
        this.emit("remoteScreenShareStopped", { room: this, participant });
      }
    }

    if (event.type === "mic_on") {
      const participant = this.participants.get(event.participant.user_id);
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
      const participant = this.participants.get(event.participant.user_id);
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
      const participant = this.participants.get(event.participant.user_id);
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
      const participant = this.participants.get(event.participant.user_id);
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
      console.log(`Pin for everyone event received:`, event.participant);
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        this.pinParticipant(participant.userId);
        this.emit("participantPinnedForEveryone", { room: this, participant });
      }
    }

    if (event.type === "unpin_for_everyone") {
      console.log(`Unpin for everyone event received`);
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
      const participant = this.participants.get(event.participant.user_id);
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
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        participant.updateHandRaiseStatus(false);
        this.emit("remoteHandRaisingStatusChanged", {
          room: this,
          participant,
          raised: false,
        });
      }
    }
  }

  _setupParticipantEvents(participant) {
    participant.on("pinToggled", ({ participant: p, pinned }) => {
      if (pinned) {
        this.pinParticipant(p.userId);
      } else if (this.pinnedParticipant === p) {
        this.unpinParticipant();
      }
    });

    participant.on("audioToggled", ({ participant: p, enabled }) => {
      this.emit("audioToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("videoToggled", ({ participant: p, enabled }) => {
      this.emit("videoToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("handRaiseToggled", ({ participant: p, enabled }) => {
      this.emit("handRaiseToggled", {
        room: this,
        participant: p,
        enabled,
      });
    });

    participant.on("error", ({ participant: p, error, action }) => {
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
  _updateFromApiData(roomData) {
    this.name = roomData.room_name || this.name;
    this.ownerId = roomData.user_id || this.ownerId;
  }

  /**
   * Cleanup media connections
   */
  async _cleanupMediaConnections() {
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
  _cleanupParticipants() {
    for (const participant of this.participants.values()) {
      participant.cleanup();
    }

    this.participants.clear();
    this.localParticipant = null;
    this.pinnedParticipant = null;
    this.typingUsers.clear();
  }

  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Setup stream event forwarding for existing participants
   */
  _setupStreamEventForwarding() {
    // Setup for local participant if exists
    if (this.localParticipant && this.localParticipant.publisher) {
      this.localParticipant.publisher.on("localStreamReady", (data) => {
        this.emit("localStreamReady", {
          ...data,
          participant: this.localParticipant.getInfo(),
          roomId: this.id,
        });
      });
    }

    // Setup for remote participants
    for (const participant of this.participants.values()) {
      if (participant.subscriber && !participant.isLocal) {
        participant.subscriber.on("remoteStreamReady", (data) => {
          this.emit("remoteStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id,
          });
        });

        // participant.subscriber.on("streamRemoved", (data) => {
        //   this.emit("streamRemoved", {
        //     ...data,
        //     participant: participant.getInfo(),
        //     roomId: this.id
        //   });
        // });
      }
    }
  }

  /**
   * Remove stream event forwarding
   */
  _removeStreamEventForwarding() {
    // Remove local participant events
    if (this.localParticipant && this.localParticipant.publisher) {
      this.localParticipant.publisher.removeAllListeners("localStreamReady");
    }

    // Remove remote participants events
    for (const participant of this.participants.values()) {
      if (participant.subscriber && !participant.isLocal) {
        participant.subscriber.removeAllListeners("remoteStreamReady");
        participant.subscriber.removeAllListeners("streamRemoved");
      }
    }
  }

  /**
   * Setup sub rooms from API data
   */
  _setupSubRoom(subRoomData) {

    const subRoom = new SubRoom({
      id: subRoomData.room.id,
      name: subRoomData.room.room_name,
      type: subRoomData.room.room_type,
      parentRoomId: this.id,
      apiClient: this.apiClient,
      isActive: subRoomData.room.is_active,
    });

    // Setup sub room participants if they exist
    if (subRoomData.participants.length) {
      for (const participantData of subRoomData.participants) {
        subRoom.addParticipant(participantData, this.localUserId);
      }
    }

    // Add to sub rooms map
    this.subRooms.set(subRoom.id, subRoom);

    if (subRoomData.participants.some(p => p.user_id === this.localUserId)) {
      this.currentSubRoom = subRoom;
    }
  }

  /**
   * Cleanup room resources
   */
  async cleanup() {
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
