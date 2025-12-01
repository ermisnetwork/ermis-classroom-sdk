/**
 * SubRoom - Represents a breakout/sub room within a main room
 * Extends EventEmitter to handle sub-room specific events
 */

import { EventEmitter } from '../events/EventEmitter';
import { Participant } from './Participant';
import type {
  SubRoomConfig,
  SubRoomInfo,
  SubRoomType,
  SubRoomMemberData,
} from '../types/core/subRoom.types';

export class SubRoom extends EventEmitter {
  // Basic room properties
  readonly id: string;
  readonly name: string;
  readonly type: SubRoomType;
  readonly parentRoomId: string | null;
  isActive: boolean;

  // Participants management
  participants = new Map<string, Participant>();

  constructor(config: SubRoomConfig) {
    super();

    this.id = config.id;
    this.name = config.name;
    this.type = config.type || 'sub';
    this.parentRoomId = config.parentRoomId || null;
    this.isActive = config.isActive || false;

    this._setupSubRoomEvents();
  }

  /**
   * Add a participant to the sub room
   */
  addParticipant(memberData: SubRoomMemberData, userId: string): Participant {
    const isLocal = memberData.user_id === userId;

    const participant = new Participant({
      userId: memberData.user_id,
      streamId: memberData.stream_id,
      membershipId: memberData.id,
      role: memberData.role as any, // Will be validated by Participant
      roomId: this.id,
      name: memberData.name,
      isLocal,
      permissions: memberData.permissions,
    });

    this.participants.set(participant.userId, participant);

    // this.emit("participantAdded", { room: this, participant });

    return participant;
  }

  /**
   * Remove a participant from the sub room
   */
  removeParticipant(userId: string): boolean {
    const participant = this.participants.get(userId);
    if (!participant) {
      return false;
    }

    this.participants.delete(userId);
    this.emit('participantRemoved', { room: this, participant });
    return true;
  }

  /**
   * Get participant by user ID
   */
  getParticipant(userId: string): Participant | undefined {
    return this.participants.get(userId);
  }

  /**
   * Get all participants
   */
  getAllParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Get participant count
   */
  getParticipantCount(): number {
    return this.participants.size;
  }

  /**
   * Activate the sub room
   */
  activate(): void {
    this.isActive = true;
    this.emit('activated', { room: this });
  }

  /**
   * Deactivate the sub room
   */
  deactivate(): void {
    this.isActive = false;
    this.emit('deactivated', { room: this });
  }

  /**
   * Get sub room info snapshot
   */
  getInfo(): SubRoomInfo {
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
  private _setupSubRoomEvents(): void {
    // Sub room specific event handlers can be added here
  }

  /**
   * Cleanup sub room resources
   */
  async cleanup(): Promise<void> {
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
