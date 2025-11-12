/**
 * Participant Types
 * Type definitions for Participant class
 */

import type { Publisher } from '../../media/publisher/Publisher';
import type { Subscriber } from '../../media/subscriber/Subscriber';

/**
 * Participant role in the room
 */
export type ParticipantRole = 'owner' | 'participant' | 'moderator';

/**
 * Participant connection status
 */
export type ParticipantConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

/**
 * Configuration for creating a Participant
 */
export interface ParticipantConfig {
  /** Unique user identifier */
  userId: string;
  /** Stream identifier */
  streamId: string;
  /** Membership identifier */
  membershipId: string;
  /** Participant role in the room */
  role?: ParticipantRole;
  /** Room identifier */
  roomId: string;
  /** Whether this is the local participant */
  isLocal?: boolean;
  /** Display name */
  name?: string;
  /** Whether participant is screen sharing */
  isScreenSharing?: boolean;
  /** Sub-room identifier if in a sub-room */
  subRoomId?: string | null;
}

/**
 * Participant information snapshot
 */
export interface ParticipantInfo {
  /** User identifier */
  userId: string;
  /** Stream identifier */
  streamId: string;
  /** Membership identifier */
  membershipId: string;
  /** Participant role */
  role: ParticipantRole;
  /** Whether this is the local participant */
  isLocal: boolean;
  /** Whether audio is enabled */
  isAudioEnabled: boolean;
  /** Whether video is enabled */
  isVideoEnabled: boolean;
  /** Whether hand is raised */
  isHandRaised: boolean;
  /** Whether participant is pinned */
  isPinned: boolean;
  /** Whether screen sharing is active */
  isScreenSharing: boolean;
  /** Connection status */
  connectionStatus: ParticipantConnectionStatus;
  /** Display name */
  name?: string;
}

/**
 * Media stream replacement result
 */
export interface MediaStreamReplaceResult {
  /** The new media stream */
  stream: MediaStream;
  /** Video-only stream (without audio) */
  videoOnlyStream: MediaStream;
  /** Whether the stream has audio */
  hasAudio: boolean;
  /** Whether the stream has video */
  hasVideo: boolean;
}

/**
 * Participant event payloads
 */
export interface ParticipantEventMap {
  /** Audio toggled event */
  audioToggled: {
    participant: any; // Will be Participant instance
    enabled: boolean;
  };

  /** Video toggled event */
  videoToggled: {
    participant: any;
    enabled: boolean;
  };

  /** Remote audio toggled event */
  remoteAudioToggled: {
    participant: any;
    enabled: boolean;
  };

  /** Pin status toggled event */
  pinToggled: {
    participant: any;
    pinned: boolean;
  };

  /** Hand raise toggled event */
  handRaiseToggled: {
    participant: any;
    enabled: boolean;
  };

  /** Connection status changed event */
  statusChanged: {
    participant: any;
    status: ParticipantConnectionStatus;
  };

  /** Remote audio status changed event */
  remoteAudioStatusChanged: {
    participant: any;
    enabled: boolean;
  };

  /** Remote video status changed event */
  remoteVideoStatusChanged: {
    participant: any;
    enabled: boolean;
  };

  /** Remote hand raising status changed event */
  remoteHandRaisingStatusChanged: {
    participant: any;
    enabled: boolean;
  };

  /** Media stream updated event */
  mediaStreamUpdated: {
    participant: any;
    stream: MediaStream;
    hasAudio: boolean;
    hasVideo: boolean;
  };

  /** Media stream replaced event */
  mediaStreamReplaced: {
    participant: any;
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    hasAudio: boolean;
    hasVideo: boolean;
  };

  /** Error event */
  error: {
    participant: any;
    error: Error;
    action: string;
  };

  /** Cleanup event */
  cleanup: {
    participant: any;
  };
}
