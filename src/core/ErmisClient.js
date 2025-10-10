import EventEmitter from "../events/EventEmitter.js";
import ApiClient from "../api/ApiClient.js";
import Room from "./Room.js";
import SubRoom from "./SubRoom.js";

/**
 * Main Ermis Classroom client
 */
class ErmisClient extends EventEmitter {
  constructor(config = {}) {
    super();

    // Configuration
    this.config = {
      host: config.host || "daibo.ermis.network:9993",
      apiUrl:
        config.apiUrl ||
        `https://${config.host || "daibo.ermis.network:9993"}/meeting`,
      webtpUrl:
        config.webtpUrl || "https://daibo.ermis.network:4458/meeting/wt",
      reconnectAttempts: config.reconnectAttempts || 3,
      reconnectDelay: config.reconnectDelay || 2000,
      debug: config.debug || false,
    };

    // API client
    this.apiClient = new ApiClient({
      host: this.config.host,
      apiUrl: this.config.apiUrl,
    });

    // State management
    this.state = {
      user: null,
      isAuthenticated: false,
      currentRoom: null,
      rooms: new Map(), // roomId -> Room
      connectionStatus: "disconnected", // 'disconnected', 'connecting', 'connected', 'failed'
    };

    // Media configuration
    this.mediaConfig = {
      host: this.config.host,
      webtpUrl: this.config.webtpUrl,
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
  }

  /**
   * Authenticate user
   */
  async authenticate(userId) {
    if (this.state.isAuthenticated && this.state.user?.id === userId) {
      return this.state.user;
    }

    try {
      this.emit("authenticating", { userId });
      this._setConnectionStatus("connecting");

      // Validate email format if it looks like email
      if (userId.includes("@")) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userId)) {
          throw new Error("Invalid email format");
        }
      }

      // Get authentication token
      const tokenResponse = await this.apiClient.getDummyToken(userId);

      // Set authentication in API client
      this.apiClient.setAuth(tokenResponse.access_token, userId);

      // Update state
      this.state.user = {
        id: userId,
        token: tokenResponse.access_token,
        authenticatedAt: Date.now(),
      };
      this.state.isAuthenticated = true;

      this._setConnectionStatus("connected");
      this.emit("authenticated", { user: this.state.user });

      this._debug("User authenticated successfully:", userId);

      return this.state.user;
    } catch (error) {
      this._setConnectionStatus("failed");
      this.emit("authenticationFailed", { userId, error });
      this._debug("Authentication failed:", error);
      throw error;
    }
  }

  /**
 * Set authentication directly without calling API
 */
  manualAuthenticate(userId, token) {
    if (!userId || !token) {
      throw new Error("userId and token are required");
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
    this._setConnectionStatus("connected");

    // Emit event
    this.emit("authenticated", { user: this.state.user });

    this._debug("Auth set directly:", this.state.user);
  }

  /**
   * Logout user
   */
  async logout() {
    if (!this.state.isAuthenticated) {
      return;
    }

    try {
      this.emit("loggingOut", { user: this.state.user });

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Reset state
      this.state.user = null;
      this.state.isAuthenticated = false;
      this.state.currentRoom = null;
      this.state.rooms.clear();

      this._setConnectionStatus("disconnected");
      this.emit("loggedOut");

      this._debug("User logged out successfully");
    } catch (error) {
      this.emit("error", { error, action: "logout" });
      throw error;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(config) {
    this._ensureAuthenticated();

    try {
      this.emit("creatingRoom", { config });

      const roomData = await this.apiClient.createRoom(
        config.name,
        config.type
      );

      const room = new Room({
        id: roomData.id,
        name: roomData.room_name,
        code: roomData.room_code,
        type: config.type || "main",
        ownerId: roomData.user_id,
        apiClient: this.apiClient,
        mediaConfig: this.mediaConfig,
      });

      this._setupRoomEvents(room);
      this.state.rooms.set(room.id, room);

      this.emit("roomCreated", { room });
      this._debug("Room created:", room.getInfo());

      // Auto-join if specified
      if (config.autoJoin !== false) {
        await this.joinRoom(room.code);
      }

      return room;
    } catch (error) {
      this.emit("error", { error, action: "createRoom" });
      throw error;
    }
  }

  /** 
   * Create breakout rooms
  */
  async createBreakoutRooms(config) {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to create breakout rooms");
    }

    if (this.state.currentRoom.type !== 'main') {
      throw new Error("Can only create breakout rooms from main rooms");
    }

    try {
      this.emit('creatingBreakoutRooms', {
        config,
        parentRoom: this.state.currentRoom
      });

      const breakoutRooms = await this.state.currentRoom.createBreakoutRoom(config);

      for (const room of breakoutRooms) {
        this.state.currentRoom.subRooms.set(room.id, room);
        this._setupRoomEvents(room)
      }

      this.emit('breakoutRoomsCreated', {
        breakoutRooms,
        parentRoom: this.state.currentRoom
      });

      this._debug("Breakout rooms created:", breakoutRooms.map(room => room.getInfo()));
      return breakoutRooms;
    } catch (error) {
      this.emit("error", { error, action: "createBreakoutRooms" });
      throw error;
    }
  }

  /**
   * Join breakout room
   */
  async joinBreakoutRoom() {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to join breakout rooms");
    }

    if (this.state.currentRoom.type !== 'main') {
      throw new Error("Can only join breakout rooms from main rooms");
    }

    try {
      this.emit('joiningBreakoutRoom', {
        parentRoom: this.state.currentRoom
      });
      const result = await this.state.currentRoom.joinBreakoutRoom();

      if (result && result.room) {
        this.state.currentRoom = result.room;
        this.state.rooms.set(result.room.id, result.room);
      }

      this.emit('breakoutRoomJoined', {
        breakoutRoom: result?.room,
        result
      });
      return result;
    } catch (error) {
      this.emit("error", { error, action: "joinBreakoutRoom" });
      throw error;
    }
  }

  /**
   * Join a room by code
   */
  async joinRoom(roomCode) {
    this._ensureAuthenticated();

    try {
      this.emit("joiningRoom", { roomCode });

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Try to find existing room instance first
      let room = Array.from(this.state.rooms.values()).find(
        (r) => r.code === roomCode
      );

      if (!room) {
        // Create new room instance
        room = new Room({
          code: roomCode,
          apiClient: this.apiClient,
          mediaConfig: this.mediaConfig,
        });

        this._setupRoomEvents(room);
      }

      // Join the room
      const joinResult = await room.join(this.state.user.id);

      // Update state
      this.state.currentRoom = room;
      this.state.rooms.set(room.id, room);

      this.emit("roomJoined", { room, joinResult });
      this._debug("Joined room:", room.getInfo());

      return joinResult;
    } catch (error) {
      this.emit("error", { error, action: "joinRoom" });
      throw error;
    }
  }

  /**
   * Leave current room
   */
  async leaveRoom() {
    if (!this.state.currentRoom) {
      return;
    }

    try {
      const room = this.state.currentRoom;
      this.emit("leavingRoom", { room });

      await room.leave();

      this.state.currentRoom = null;

      this.emit("roomLeft", { room });
      this._debug("Left room:", room.getInfo());
    } catch (error) {
      this.emit("error", { error, action: "leaveRoom" });
      throw error;
    }
  }

  /**
   * Get available rooms
   */
  async getRooms(options = {}) {
    this._ensureAuthenticated();

    try {
      const response = await this.apiClient.listRooms(
        options.page || 1,
        options.perPage || 20
      );

      this.emit("roomsLoaded", { rooms: response.data || [] });

      return response.data || [];
    } catch (error) {
      this.emit("error", { error, action: "getRooms" });
      throw error;
    }
  }

  /**
   * Get current room
   */
  getCurrentRoom() {
    return this.state.currentRoom;
  }

  /**
   * Get room by ID
   */
  getRoom(roomId) {
    return this.state.rooms.get(roomId);
  }

  /**
   * Create sub room in current room
   */
  async createSubRoom(config) {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to create sub rooms");
    }

    if (this.state.currentRoom.type !== "main") {
      throw new Error("Can only create sub rooms from main rooms");
    }

    try {
      this.emit("creatingSubRoom", {
        config,
        parentRoom: this.state.currentRoom,
      });

      const subRoom = await this.state.currentRoom.createSubRoom(config);

      this.emit("subRoomCreated", {
        subRoom,
        parentRoom: this.state.currentRoom,
      });
      this._debug("Sub room created:", subRoom.getInfo());

      return subRoom;
    } catch (error) {
      this.emit("error", { error, action: "createSubRoom" });
      throw error;
    }
  }

  /**
   * Join a sub room
   */
  async joinSubRoom(subRoomCode) {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to join sub rooms");
    }

    try {
      this.emit("joiningSubRoom", {
        subRoomCode,
        parentRoom: this.state.currentRoom,
      });

      // Find sub room
      const subRooms = await this.state.currentRoom.getSubRooms();
      const subRoom = subRooms.find((sr) => sr.code === subRoomCode);

      if (!subRoom) {
        throw new Error(`Sub room with code ${subRoomCode} not found`);
      }

      // Join sub room
      const joinResult = await subRoom.joinFromMain(this.state.user.id);

      this.emit("subRoomJoined", {
        subRoom,
        parentRoom: this.state.currentRoom,
      });
      this._debug("Joined sub room:", subRoom.getInfo());

      return joinResult;
    } catch (error) {
      this.emit("error", { error, action: "joinSubRoom" });
      throw error;
    }
  }

  /**
   * Return to main room from sub room
   */
  async returnToMainRoom() {
    if (!this.state.currentRoom || this.state.currentRoom.type !== "breakout") {
      throw new Error("Must be in a sub room to return to main room");
    }

    try {
      this.emit("returningToMainRoom", { subRoom: this.state.currentRoom });

      const subRoom = this.state.currentRoom;
      const mainRoom = await subRoom.returnToMainRoom();

      this.state.currentRoom = mainRoom;

      this.emit("returnedToMainRoom", { mainRoom, previousSubRoom: subRoom });
      this._debug("Returned to main room from sub room");

      return mainRoom;
    } catch (error) {
      this.emit("error", { error, action: "returnToMainRoom" });
      throw error;
    }
  }

  /**
   * Switch between sub rooms
   */
  async switchSubRoom(targetSubRoomCode) {
    if (!this.state.currentRoom || this.state.currentRoom.type !== "breakout") {
      throw new Error("Must be in a sub room to switch to another sub room");
    }

    try {
      this.emit("switchingSubRoom", {
        fromSubRoom: this.state.currentRoom,
        targetSubRoomCode,
      });

      const currentSubRoom = this.state.currentRoom;
      const parentRoom = currentSubRoom.parentRoom;

      // Find target sub room
      const subRooms = await parentRoom.getSubRooms();
      const targetSubRoom = subRooms.find(
        (sr) => sr.code === targetSubRoomCode
      );

      if (!targetSubRoom) {
        throw new Error(`Sub room with code ${targetSubRoomCode} not found`);
      }

      // Switch to target sub room
      const joinResult = await currentSubRoom.switchToSubRoom(targetSubRoom);

      this.state.currentRoom = targetSubRoom;

      this.emit("subRoomSwitched", {
        fromSubRoom: currentSubRoom,
        toSubRoom: targetSubRoom,
      });
      this._debug("Switched sub rooms:", {
        from: currentSubRoom.getInfo(),
        to: targetSubRoom.getInfo(),
      });

      return joinResult;
    } catch (error) {
      this.emit("error", { error, action: "switchSubRoom" });
      throw error;
    }
  }

  /**
   * Get client state
   */
  getState() {
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
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // Update API client if needed
    if (newConfig.host || newConfig.apiUrl) {
      this.apiClient = new ApiClient({
        host: this.config.host,
        apiUrl: this.config.apiUrl,
      });

      if (this.state.isAuthenticated) {
        this.apiClient.setAuth(this.state.user.token, this.state.user.id);
      }
    }

    this.emit("configUpdated", { config: this.config });
  }

  /**
   * Enable debug mode
   */
  enableDebug() {
    this.config.debug = true;
    this._debug("Debug mode enabled");
  }

  /**
   * Disable debug mode
   */
  disableDebug() {
    this.config.debug = false;
  }

  async sendMessage(text, metadata = {}) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }

    return await this.state.currentRoom.sendMessage(text, metadata);
  }

  async deleteMessage(messageId) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }

    return await this.state.currentRoom.deleteMessage(messageId);
  }

  async updateMessage(messageId, newText, metadata = {}) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }

    return await this.state.currentRoom.updateMessage(messageId, newText, metadata);
  }

  async sendTypingIndicator(isTyping = true) {
    if (!this.state.currentRoom) {
      return;
    }

    return await this.state.currentRoom.sendTypingIndicator(isTyping);
  }

  getMessages(limit = 100) {
    if (!this.state.currentRoom) {
      return [];
    }

    return this.state.currentRoom.getMessages(limit);
  }

  getTypingUsers() {
    if (!this.state.currentRoom) {
      return [];
    }

    return this.state.currentRoom.getTypingUsers();
  }

  clearMessages() {
    if (!this.state.currentRoom) {
      return;
    }

    this.state.currentRoom.clearMessages();
  }

  /**
   * Cleanup client resources
   */
  async cleanup() {
    try {
      // Leave current room
      if (this.state.currentRoom) {
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

      this._debug("Client cleanup completed");
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }

  /**
   * Setup event handlers for rooms
   */
  _setupRoomEvents(room) {
    // Forward room events to client
    const eventsToForward = [
      "roomJoined",
      "roomLeft",
      "participantAdded",
      "participantRemoved",
      "participantPinned",
      "participantUnpinned",
      "participantPinnedForEveryone",
      "participantUnpinnedForEveryone",
      "subRoomCreated",
      "localStreamReady",
      "remoteStreamReady",
      "streamRemoved",
      "audioToggled",
      "videoToggled",
      "handRaiseToggled",
      "remoteAudioStatusChanged",
      "remoteVideoStatusChanged",
      "remoteHandRaisingStatusChanged",
      "remoteScreenShareStarted",
      "remoteScreenShareStopped",
      "messageSent",
      "messageReceived",
      "messageDeleted",
      "messageUpdated",
      "typingStarted",
      "typingStopped",
      "creatingBreakoutRoom",
      "joiningBreakoutRoom",
      "error",
    ];

    eventsToForward.forEach((event) => {
      room.on(event, (data) => {
        this.emit(
          event,
          data
        );
      });
    });
  }

  /**
   * Setup initial event handlers
   */
  _setupEventHandlers() {
    // Handle authentication token refresh
    this.on("authenticated", () => {
      // Could implement token refresh logic here
    });

    // Handle connection status changes
    this.on("connectionStatusChanged", ({ status }) => {
      if (status === "failed" && this.config.reconnectAttempts > 0) {
        this._attemptReconnect();
      }
    });
  }

  /**
   * Attempt to reconnect
   */
  async _attemptReconnect() {
    let attempts = 0;

    while (attempts < this.config.reconnectAttempts) {
      try {
        attempts++;
        this._debug(
          `Reconnection attempt ${attempts}/${this.config.reconnectAttempts}`
        );

        await new Promise((resolve) =>
          setTimeout(resolve, this.config.reconnectDelay)
        );

        if (this.state.user) {
          await this.authenticate(this.state.user.id);
          this._debug("Reconnection successful");
          return;
        }
      } catch (error) {
        this._debug(`Reconnection attempt ${attempts} failed:`, error.message);
      }
    }

    this.emit("reconnectionFailed");
    this._debug("All reconnection attempts failed");
  }

  /**
   * Set connection status
   */
  _setConnectionStatus(status) {
    if (this.state.connectionStatus !== status) {
      this.state.connectionStatus = status;
      this.emit("connectionStatusChanged", { status });
      this._debug("Connection status changed:", status);
    }
  }

  /**
   * Ensure user is authenticated
   */
  _ensureAuthenticated() {
    if (!this.state.isAuthenticated) {
      throw new Error("User must be authenticated first");
    }
  }

  /**
   * Debug logging
   */
  _debug(...args) {
    if (this.config.debug) {
      console.log("[ErmisClient]", ...args);
    }
  }
}

export default ErmisClient;
