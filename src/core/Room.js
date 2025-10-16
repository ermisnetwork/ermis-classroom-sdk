import EventEmitter from "../events/EventEmitter.js";
import Participant from "./Participant.js";

import Publisher from "../media/Publisher.js";
import Subscriber from "../media/Subscriber.js";
import AudioMixer from "../media/AudioMixer.js";
import { determineTransport, logTransportInfo } from "../utils/browserDetection.js";

/**
 * Represents a meeting room
 */
class Room extends EventEmitter {
  constructor(config) {
    super();

    this.id = config.id;
    this.name = config.name;
    this.code = config.code;
    this.type = config.type || "main"; // 'main', 'breakout'
    this.parentRoomId = config.parentRoomId || null;
    this.ownerId = config.ownerId;
    this.isActive = false;

    // Configuration
    this.apiClient = config.apiClient;
    this.mediaConfig = config.mediaConfig;

    // Participants management
    this.participants = new Map(); // userId -> Participant
    this.localParticipant = null;

    // Sub rooms (for main rooms only)
    this.subRooms = new Map(); // subRoomId -> Room

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

      // Get room details and members
      const roomDetails = await this.apiClient.getRoomById(joinResponse.room_id);
      console.log("Joined room, details:", roomDetails);

      // Update room info
      this._updateFromApiData(roomDetails.room);

      // Setup participants
      await this._setupParticipants(roomDetails.participants, userId);

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

      this.emit("subRoomsCreated", { room: this, subRoomsData, assignments: config.rooms });

      return subRoomsData;
    } catch (error) {
      this.emit("error", { room: this, error, action: "createSubRoom" });
      throw error;
    }
  }

  /**
   * Create breakout room
   */
  async createBreakoutRoom(config) {
    if (this.type !== "main") {
      throw new Error('Only main rooms can create breakout rooms');
    }

    try {
      this.emit('creatingBreakoutRoom', { room: this, config });

      const roomsData = config.rooms.map(roomConfig => {
        const formattedParticipants = (roomConfig.participants || []).map(p => {
          const participantObj =
            this.participants instanceof Map
              ? this.participants.get(p.userId)
              : p;

          if (!participantObj) {
            throw new Error(`Participant ${p.userId} not found in main room`);
          }

          return {
            user_id: participantObj.userId,
            stream_id: participantObj.streamId,
          };
        });

        return {
          room_name: roomConfig.name,
          participants: formattedParticipants,
        };
      });

      const apiResponse = await this.apiClient.createBreakoutRoom(this.id, roomsData);

      const createdRooms = [];
      for (const roomData of apiResponse?.rooms || []) {
        const subRoom = new Room({
          id: roomData.room_id,
          name: roomData.room_name,
          code: roomData.room_code,
          type: "breakout",
          parentRoomId: this.id,
          ownerId: roomData.user_id,
          apiClient: this.apiClient,
          mediaConfig: this.mediaConfig,
        })
        subRoom.participants = roomData.participants || [];
        this.subRooms.set(subRoom.id, subRoom);
        createdRooms.push(subRoom)

        this.emit('subRoomCreated', { room: this, subRoom });
      }

      return createdRooms;
    } catch (err) {
      this.emit('error', { room: this, err, action: 'createBreakoutRooms' });
      throw err;
    }
  }

  /**
   * Join Breakout room
   */
  async joinBreakoutRoom() {
    try {
      if (!this.client || !this.client.apiClient) {
        throw new Error("Client not initialized or missing ApiClient");
      }
      if (!this.localParticipant) throw new Error("No local participant found");

      const localUserId = this.localParticipant.userId;
      let targetSubRoom = null;

      if (!this.subRooms || this.subRooms.size === 0) {
        console.warn("⚠️ No breakout rooms found. Maybe they haven't been created yet?");
        return;
      }

      for (const sub of this.subRooms.values()) {
        const participants = sub.participants || [];
        const match = participants.find(p => p.user_id === localUserId);
        if (match) {
          targetSubRoom = sub;
          break;
        }
      }

      if (!targetSubRoom) {
        console.warn(`⚠️ No assigned subroom found for user ${localUserId}`);
        return;
      }

      const subRoomId = targetSubRoom.id || targetSubRoom.sub_room_id;

      this.emit("joiningBreakoutRoom", {
        userId: localUserId,
        roomCode,
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

      console.log(`✅ User ${localUserId} joined breakout room: ${roomCode}`);
      return response;

    } catch (error) {
      this.emit("error", {
        error,
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
   * Join a breakout room
   */
  async joinBreakoutRoom(subRoomId) {
    try {
      this.emit("joiningBreakoutRoom", { room: this, subRoomId });

      // Join via API
      const joinResponse = await this.apiClient.joinBreakoutRoom({
        parent_room_id: this.id,
        sub_room_id: subRoomId,
      });

      this.emit("joinedBreakoutRoom", {
        room: this,
        subRoomId,
        response: joinResponse,
      });

      return joinResponse;
    } catch (error) {
      this.emit("error", { room: this, error, action: "joinBreakoutRoom" });
      throw error;
    }
  }

  /**
   * Leave breakout room and return to main room
   */
  async leaveBreakoutRoom(subRoomId) {
    try {
      this.emit("leavingBreakoutRoom", { room: this, subRoomId });

      // Leave via API
      const leaveResponse = await this.apiClient.leaveBreakoutRoom({
        parent_room_id: this.id,
        sub_room_id: subRoomId,
      });

      this.emit("leftBreakoutRoom", {
        room: this,
        subRoomId,
        response: leaveResponse,
      });

      return leaveResponse;
    } catch (error) {
      this.emit("error", { room: this, error, action: "leaveBreakoutRoom" });
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
      isScreenSharing: memberData.is_screen_sharing || false,
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
      parentRoomId: this.parentRoomId,
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

    // Detect browser and determine transport
    const transportInfo = logTransportInfo();
    const useWebRTC = transportInfo.recommendedTransport.useWebRTC;

    console.log(`🚀 Setting up publisher with ${useWebRTC ? 'WebRTC' : 'WebTransport'}`);

    // Video rendering handled by app through stream events

    const publishUrl = `${this.mediaConfig.webtpUrl}/${this.id}/${this.streamId}`;
    console.log("trying to connect to", publishUrl);

    const publisher = new Publisher({
      publishUrl,
      streamType: "camera",
      streamId: this.streamId,
      userId: this.localParticipant.userId, // Pass userId for screen share tile mapping
      mediaStream: mediaStream,
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 1_500_000,
      roomId: this.id,
      // Auto-detect: use WebRTC for Safari, WebTransport for others
      useWebRTC: useWebRTC,
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

    // Listen for screen share stopped event from publisher
    publisher.on("screenShareStopped", (data) => {
      this.localParticipant.isScreenSharing = false;
      this.emit("screenShareStopped", {
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
      streamId: participant.streamId,
      roomId: this.id,
      host: this.mediaConfig.host,
      streamOutputEnabled: true,
      // DO for adaptive camera url
      userMediaWorker: "sfu-adaptive-trung.ermis-network.workers.dev",
      // DO for screen share url
      screenShareWorker: "sfu-screen-share.ermis-network.workers.dev",
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

    if (participant.isScreenSharing) {
      await this.handleRemoteScreenShare(
        participant.userId,
        participant.streamId,
        true
      );
    }
  }

  /**
   * Start screen sharing for local participant
   */
  async startScreenShare() {
    if (!this.localParticipant || !this.localParticipant.publisher) {
      throw new Error("Local participant or publisher not available");
    }

    try {
      this.emit("screenShareStarting", { room: this });

      // Get display media
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080 },
        audio: true,
      });

      // Start screen share through publisher first
      await this.localParticipant.publisher.startShareScreen(screenStream);

      this.localParticipant.isScreenSharing = true;

      // Emit with original stream for UI (both can share the same stream)
      this.emit("screenShareStarted", {
        room: this,
        stream: screenStream,
        participant: this.localParticipant.getInfo()
      });
      return screenStream;
    } catch (error) {
      this.emit("error", { room: this, error, action: "startScreenShare" });
      throw error;
    }
  }

  /**
   * Stop screen sharing for local participant
   */
  async stopScreenShare() {
    if (!this.localParticipant || !this.localParticipant.publisher) {
      throw new Error("Local participant or publisher not available");
    }

    try {
      this.emit("screenShareStopping", { room: this });

      await this.localParticipant.publisher.stopShareScreen();

      this.localParticipant.isScreenSharing = false;
      this.emit("screenShareStopped", { room: this });
    } catch (error) {
      this.emit("error", { room: this, error, action: "stopScreenShare" });
      throw error;
    }
  }

  /**
   * Handle remote screen share
   */
  async handleRemoteScreenShare(participantId, screenStreamId, isStarting) {
    const participant = this.participants.get(participantId);
    if (!participant) return;

    if (isStarting) {
      // Create subscriber for screen share
      const screenSubscriber = new Subscriber({
        streamId: screenStreamId,
        roomId: this.id,
        host: this.mediaConfig.host,
        isScreenSharing: true,
        streamOutputEnabled: true,
        onStatus: (msg, isError) => {
          console.log(`Screen share status: ${msg}`);
        },
        audioWorkletUrl: "/workers/audio-worklet1.js",
        mstgPolyfillUrl: "/polyfills/MSTG_polyfill.js",
      });

      // Add to audio mixer if has audio
      if (this.audioMixer) {
        screenSubscriber.setAudioMixer(this.audioMixer);
      }

      // Setup stream event forwarding
      screenSubscriber.on("remoteStreamReady", (data) => {
        this.emit("remoteScreenShareStreamReady", {
          ...data,
          participant: participant.getInfo(),
          roomId: this.id,
        });
      });

      await screenSubscriber.start();

      // Store reference
      participant.screenSubscriber = screenSubscriber;
      participant.isScreenSharing = true;

      this.emit("remoteScreenShareStarted", { room: this, participant });
    } else {
      // Stop screen share
      if (participant.screenSubscriber) {
        participant.screenSubscriber.stop();
        participant.screenSubscriber = null;
      }

      participant.isScreenSharing = false;

      this.emit("remoteScreenShareStopped", { room: this, participant });
    }
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
      console.log("------------Received join_sub_room event------------", event);
      let participants = [];
      for (const participantData of event.participants) { 
        const participant = this.participants.get(participantData.user_id);
        if (participant) {
          participants.push(participant.getInfo());
        }
      }

      const subRoom = {
        room: event.room,
        participants,
      };
      this.emit("subRoomJoined", {
        subRoom,
        parentRoom: this,
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
      } else if (participant && participant.userId === this.localParticipant?.userId) {
        // Local screen share confirmed by server
        participant.isScreenSharing = true;
      }
    }

    if (event.type === "stop_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        participant.isScreenSharing = false;
        this.emit("remoteScreenShareStopped", { room: this, participant });
      } else if (participant && participant.userId === this.localParticipant?.userId) {
        // Local screen share stopped confirmed by server
        participant.isScreenSharing = false;
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

    if (event.type === "start_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          event.participant.stream_id,
          true
        );
      }
    }

    if (event.type === "stop_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        await this.handleRemoteScreenShare(
          participant.userId,
          event.participant.stream_id,
          false
        );
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
