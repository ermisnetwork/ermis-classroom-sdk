/**
 * API Client for handling HTTP requests to Ermis Meeting API
 */
class ApiClient {
  constructor(config) {
    this.host = config.host || "daibo.ermis.network:9999";
    this.apiBaseUrl = config.apiUrl || `https://${this.host}/meeting`;
    this.jwtToken = null;
    this.userId = null;
  }

  /**
   * Set authentication token and user ID
   */
  setAuth(token, userId) {
    this.jwtToken = token;
    this.userId = userId;
  }

  /**
   * Generic API call method
   */
  async apiCall(endpoint, method = "GET", body = null) {
    if (!this.userId) {
      throw new Error("Please authenticate first");
    }

    if (!this.jwtToken) {
      throw new Error("JWT token not found");
    }

    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.jwtToken}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("API call failed:", error);
      throw error;
    }
  }

  /**
   * Get dummy token for authentication
   */
  async getDummyToken(userId) {
    const endpoint = "/get-token";
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sub: userId }),
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Token request failed:", error);
      throw error;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(roomName, roomType = "main") {
    return await this.apiCall("/rooms", "POST", {
      room_name: roomName,
      room_type: roomType,
    });
  }

  /**
   * List available rooms
   */
  async listRooms(page = 1, perPage = 20) {
    return await this.apiCall("/rooms/list", "POST", {
      list_query: {
        page,
        per_page: perPage,
        sort_by: "created_at",
        sort_order: "desc",
      },
      conditions: {
        is_active: true,
      },
    });
  }

  /**
   * Get room details by ID
   */
  async getRoomById(roomId) {
    return await this.apiCall(`/rooms/${roomId}`);
  }

  /**
   * Join a room by room code
   */
  async joinRoom(roomCode, appName = "Ermis-Meeting") {
    return await this.apiCall("/rooms/join", "POST", {
      room_code: roomCode,
      app_name: appName,
    });
  }

  /**
   * Create a sub room
   */
  async createSubRoom(parentRoomId, subRoomName, subRoomType = "breakout") {
    return await this.apiCall("/rooms", "POST", {
      room_name: subRoomName,
      room_type: subRoomType,
      parent_room_id: parentRoomId,
    });
  }

  /**
   * Get sub rooms of a parent room
   */
  async getSubRooms(parentRoomId) {
    return await this.apiCall(`/rooms/${parentRoomId}/sub-rooms`);
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId, membershipId) {
    return await this.apiCall(
      `/rooms/${roomId}/members/${membershipId}`,
      "DELETE"
    );
  }

  /**
   * Switch to sub room
   */
  async switchToSubRoom(roomId, subRoomCode) {
    return await this.apiCall("/rooms/switch", "POST", {
      room_id: roomId,
      sub_room_code: subRoomCode,
    });
  }

  /**
   * Get room members
   */
  async getRoomMembers(roomId) {
    return await this.apiCall(`/rooms/${roomId}/members`);
  }

  /**
   * Update room settings
   */
  async updateRoom(roomId, updates) {
    return await this.apiCall(`/rooms/${roomId}`, "PATCH", updates);
  }

  /**
   * Delete/Close room
   */
  async deleteRoom(roomId) {
    return await this.apiCall(`/rooms/${roomId}`, "DELETE");
  }
}

export default ApiClient;
