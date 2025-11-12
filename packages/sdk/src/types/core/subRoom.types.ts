/**
 * SubRoom Types
 * Type definitions for SubRoom class
 */

import type { Participant } from '../../cores/Participant';

/**
 * SubRoom type identifier
 */
export type SubRoomType = 'sub' | 'breakout';

/**
 * Configuration for creating a SubRoom
 */
export interface SubRoomConfig {
  /** Unique room identifier */
  id: string;
  /** Room name */
  name: string;
  /** Room type */
  type?: SubRoomType;
  /** Parent room ID */
  parentRoomId?: string | null;
  /** Whether the room is currently active */
  isActive?: boolean;
}

/**
 * SubRoom information snapshot
 */
export interface SubRoomInfo {
  /** Room identifier */
  id: string;
  /** Room name */
  name: string;
  /** Room type */
  type: SubRoomType;
  /** Parent room identifier */
  parentRoomId: string | null;
  /** Whether room is active */
  isActive: boolean;
  /** Number of participants */
  participantCount: number;
}

/**
 * Member data from API
 */
export interface SubRoomMemberData {
  /** User identifier */
  user_id: string;
  /** Stream identifier */
  stream_id: string;
  /** Membership identifier */
  id: string;
  /** Member role */
  role: string;
  /** Member name */
  name?: string;
}

/**
 * SubRoom event payloads
 */
export interface SubRoomEventMap {
  /** Participant added event */
  participantAdded: {
    room: any; // Will be SubRoom instance
    participant: Participant;
  };

  /** Participant removed event */
  participantRemoved: {
    room: any;
    participant: Participant;
  };

  /** SubRoom activated event */
  activated: {
    room: any;
  };

  /** SubRoom deactivated event */
  deactivated: {
    room: any;
  };

  /** Error event */
  error: {
    room: any;
    error: Error;
    action: string;
  };
}
