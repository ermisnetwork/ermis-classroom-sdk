import EventEmitter from "../events/EventEmitter.js";
import Participant from "./Participant.js";

/**
 * SubRoom extends EventEmitter with functionality for breakout rooms
 */
class SubRoom extends EventEmitter {
  constructor(config) {
    super();

    // Basic room properties
    this.id = config.id;
    this.name = config.name;
    this.type = config.type || "sub";
    this.parentRoomId = config.parentRoomId || null;
    this.isActive = config.isActive || false;

    // Participants management
    this.participants = new Map(); // userId -> Participant

    this._setupSubRoomEvents();
  }

 /**
   * Add a participant to the sub room
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

    this.participants.set(participant.userId, participant);

    // this.emit("participantAdded", { room: this, participant });

    return participant;
  }

  /**
   * Get sub room info
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      parentRoomId: this.parentRoomId,
      isActive: this.isActive,
      participantCount: this.participants.size,
    };
  }

  /**
   * Setup sub room specific events
   */
  _setupSubRoomEvents() {
    
  }

  /**
   * Override cleanup to clear timers
   */
  async cleanup() {
    // Cleanup participants
    for (const participant of this.participants.values()) {
      if (participant.cleanup) {
        participant.cleanup();
      }
    }

    this.participants.clear();

    // Remove all event listeners
    this.removeAllListeners();

  }
}

export default SubRoom;
