import Room from "./Room.js";

/**
 * SubRoom extends Room with additional functionality for breakout rooms
 */
class SubRoom extends Room {
  constructor(config) {
    super({
      ...config,
      type: config.type || "breakout",
    });

    this.parentRoom = config.parentRoom; // Reference to parent Room instance
    this.maxParticipants = config.maxParticipants || 10;
    this.autoReturn = config.autoReturn || false; // Auto return to main room when empty
    this.duration = config.duration || null; // Duration in minutes, null = unlimited
    this.startTime = null;

    // Sub room specific state
    this.isTemporary = config.isTemporary || true;
    this.allowSelfAssign = config.allowSelfAssign || true;

    this._setupSubRoomEvents();
  }

  /**
   * Join the sub room from main room
   */
  async joinFromMain(userId) {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }

    try {
      this.emit("joiningFromMain", { subRoom: this, userId });

      // Pause main room media without leaving
      await this.parentRoom._pauseMediaConnections();

      // Join this sub room
      const joinResult = await this.join(userId);

      // Start duration timer if set
      if (this.duration && !this.startTime) {
        this.startTime = Date.now();
        this._startDurationTimer();
      }

      this.emit("joinedFromMain", { subRoom: this, userId, joinResult });

      return joinResult;
    } catch (error) {
      // Resume main room media on error
      if (this.parentRoom) {
        await this.parentRoom._resumeMediaConnections();
      }

      this.emit("error", { subRoom: this, error, action: "joinFromMain" });
      throw error;
    }
  }

  /**
   * Return to main room
   */
  async returnToMainRoom() {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }

    try {
      this.emit("returningToMain", { subRoom: this });

      // Leave sub room
      await this.leave();

      // Resume main room media
      await this.parentRoom._resumeMediaConnections();

      this.emit("returnedToMain", { subRoom: this });

      // Check if should cleanup empty room
      if (this.participants.size === 0 && this.autoReturn) {
        await this.cleanup();
      }

      return this.parentRoom;
    } catch (error) {
      this.emit("error", { subRoom: this, error, action: "returnToMainRoom" });
      throw error;
    }
  }

  /**
   * Switch to another sub room directly
   */
  async switchToSubRoom(targetSubRoom) {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }

    try {
      this.emit("switchingToSubRoom", {
        fromSubRoom: this,
        toSubRoom: targetSubRoom,
      });

      // Leave current sub room
      await this.leave();

      // Join target sub room
      const joinResult = await targetSubRoom.joinFromMain(
        this.localParticipant?.userId
      );

      this.emit("switchedToSubRoom", {
        fromSubRoom: this,
        toSubRoom: targetSubRoom,
      });

      return joinResult;
    } catch (error) {
      this.emit("error", { subRoom: this, error, action: "switchToSubRoom" });
      throw error;
    }
  }

  /**
   * Invite participant to this sub room
   */
  async inviteParticipant(userId) {
    try {
      // Send invitation via API (implementation depends on API support)
      const result = await this.apiClient.inviteToSubRoom(this.id, userId);

      this.emit("participantInvited", { subRoom: this, userId, result });

      return result;
    } catch (error) {
      this.emit("error", { subRoom: this, error, action: "inviteParticipant" });
      throw error;
    }
  }

  /**
   * Assign participant to this sub room (host action)
   */
  async assignParticipant(userId) {
    try {
      // Force assignment via API
      const result = await this.apiClient.assignToSubRoom(this.id, userId);

      this.emit("participantAssigned", { subRoom: this, userId, result });

      return result;
    } catch (error) {
      this.emit("error", { subRoom: this, error, action: "assignParticipant" });
      throw error;
    }
  }

  /**
   * Broadcast message to all participants
   */
  async broadcastMessage(message, type = "info") {
    try {
      const result = await this.apiClient.broadcastToSubRoom(
        this.id,
        message,
        type
      );

      this.emit("messageBroadcast", { subRoom: this, message, type, result });

      return result;
    } catch (error) {
      this.emit("error", { subRoom: this, error, action: "broadcastMessage" });
      throw error;
    }
  }

  /**
   * Get remaining time in minutes
   */
  getRemainingTime() {
    if (!this.duration || !this.startTime) {
      return null;
    }

    const elapsed = (Date.now() - this.startTime) / (1000 * 60); // in minutes
    const remaining = Math.max(0, this.duration - elapsed);

    return Math.ceil(remaining);
  }

  /**
   * Extend sub room duration
   */
  extendDuration(additionalMinutes) {
    if (!this.duration) {
      this.duration = additionalMinutes;
      this.startTime = Date.now();
    } else {
      this.duration += additionalMinutes;
    }

    this.emit("durationExtended", {
      subRoom: this,
      additionalMinutes,
      newDuration: this.duration,
    });

    // Restart timer if needed
    if (this.startTime) {
      this._startDurationTimer();
    }
  }

  /**
   * Set participant limit
   */
  setMaxParticipants(limit) {
    this.maxParticipants = limit;

    this.emit("maxParticipantsChanged", {
      subRoom: this,
      maxParticipants: limit,
    });

    // If over limit, may need to handle overflow
    if (this.participants.size > limit) {
      this.emit("participantLimitExceeded", {
        subRoom: this,
        current: this.participants.size,
        limit,
      });
    }
  }

  /**
   * Check if sub room is full
   */
  isFull() {
    return this.participants.size >= this.maxParticipants;
  }

  /**
   * Check if sub room is empty
   */
  isEmpty() {
    return this.participants.size === 0;
  }

  /**
   * Check if sub room has expired
   */
  hasExpired() {
    if (!this.duration || !this.startTime) {
      return false;
    }

    const elapsed = (Date.now() - this.startTime) / (1000 * 60);
    return elapsed >= this.duration;
  }

  /**
   * Get sub room statistics
   */
  getStats() {
    return {
      ...this.getInfo(),
      maxParticipants: this.maxParticipants,
      duration: this.duration,
      remainingTime: this.getRemainingTime(),
      startTime: this.startTime,
      isFull: this.isFull(),
      isEmpty: this.isEmpty(),
      hasExpired: this.hasExpired(),
      isTemporary: this.isTemporary,
      allowSelfAssign: this.allowSelfAssign,
      autoReturn: this.autoReturn,
    };
  }

  /**
   * Setup sub room specific events
   */
  _setupSubRoomEvents() {
    // Handle participant left
    this.on("participantRemoved", ({ room, participant }) => {
      // Auto return to main room if empty and configured to do so
      if (this.isEmpty() && this.autoReturn && this.parentRoom) {
        setTimeout(() => {
          if (this.isEmpty()) {
            // Double check after delay
            this.cleanup();
          }
        }, 5000); // 5 second delay
      }
    });

    // Handle room expiry warnings
    if (this.duration) {
      // Warn 5 minutes before expiry
      const warningTime = Math.max(1, this.duration - 5);
      setTimeout(() => {
        if (this.isActive && !this.hasExpired()) {
          this.emit("expiryWarning", { subRoom: this, remainingMinutes: 5 });
        }
      }, warningTime * 60 * 1000);
    }
  }

  /**
   * Start duration timer for automatic closure
   */
  _startDurationTimer() {
    if (this._durationTimer) {
      clearTimeout(this._durationTimer);
    }

    if (!this.duration) return;

    const remainingMs = this.getRemainingTime() * 60 * 1000;

    if (remainingMs <= 0) {
      this._handleExpiry();
      return;
    }

    this._durationTimer = setTimeout(() => {
      this._handleExpiry();
    }, remainingMs);
  }

  /**
   * Handle sub room expiry
   */
  async _handleExpiry() {
    this.emit("expired", { subRoom: this });

    // Notify all participants
    await this.broadcastMessage(
      "Sub room session has expired. Returning to main room.",
      "warning"
    );

    // Return all participants to main room
    const participants = Array.from(this.participants.values());
    for (const participant of participants) {
      if (participant.isLocal) {
        await this.returnToMainRoom();
      }
    }

    // Cleanup sub room
    await this.cleanup();
  }

  /**
   * Override cleanup to clear timers
   */
  async cleanup() {
    // Clear duration timer
    if (this._durationTimer) {
      clearTimeout(this._durationTimer);
      this._durationTimer = null;
    }

    // Remove from parent room's sub rooms map
    if (this.parentRoom) {
      this.parentRoom.subRooms.delete(this.id);
    }

    // Call parent cleanup
    await super.cleanup();

    this.emit("cleanedUp", { subRoom: this });
  }

  /**
   * Serialize sub room state for persistence or transfer
   */
  serialize() {
    return {
      ...this.getStats(),
      participantIds: Array.from(this.participants.keys()),
      parentRoomId: this.parentRoom?.id || this.parentRoomId,
      createdAt: this.startTime || Date.now(),
    };
  }

  /**
   * Create sub room from serialized data
   */
  static fromSerializedData(data, parentRoom, apiClient, mediaConfig) {
    return new SubRoom({
      id: data.id,
      name: data.name,
      code: data.code,
      type: data.type,
      parentRoom,
      parentRoomId: data.parentRoomId,
      ownerId: data.ownerId,
      maxParticipants: data.maxParticipants,
      duration: data.duration,
      autoReturn: data.autoReturn,
      isTemporary: data.isTemporary,
      allowSelfAssign: data.allowSelfAssign,
      apiClient,
      mediaConfig,
    });
  }
}

export default SubRoom;
