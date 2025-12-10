/**
 * useRoom - Hook to access room state and actions
 */

import { useMemo } from 'react';
import type { Room } from '@ermisnetwork/ermis-classroom-sdk';
import { useErmisClassroom } from './useErmisClassroom';

/**
 * Room state
 */
export interface RoomState {
  /** Current room instance */
  room: Room | null;
  /** Room code */
  roomCode: string | undefined;
  /** Whether in a room */
  inRoom: boolean;
}

/**
 * Room actions
 */
export interface RoomActions {
  /** Join a room by code */
  joinRoom: (code: string, customStream?: MediaStream) => Promise<void>;
  /** Leave the current room */
  leaveRoom: () => Promise<void>;
}

/**
 * Hook to access room state and actions
 * 
 * @returns Object with room state and actions
 * 
 * @example
 * ```tsx
 * function RoomControls() {
 *   const { room, inRoom, joinRoom, leaveRoom } = useRoom();
 *   
 *   if (!inRoom) {
 *     return <button onClick={() => joinRoom('room-code')}>Join Room</button>;
 *   }
 *   
 *   return (
 *     <div>
 *       <p>In room: {room?.name}</p>
 *       <button onClick={leaveRoom}>Leave Room</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRoom(): RoomState & RoomActions {
  const { currentRoom, roomCode, inRoom, joinRoom, leaveRoom } = useErmisClassroom();

  return useMemo(
    () => ({
      room: currentRoom,
      roomCode,
      inRoom,
      joinRoom,
      leaveRoom,
    }),
    [currentRoom, roomCode, inRoom, joinRoom, leaveRoom]
  );
}

/**
 * Hook to access remote streams
 * 
 * @returns Map of remote streams (userId -> MediaStream)
 */
export function useRemoteStreams(): Map<string, MediaStream> {
  const { remoteStreams } = useErmisClassroom();
  return remoteStreams;
}

/**
 * Hook to get a specific remote stream by user ID
 * 
 * @param userId - The user ID to get the stream for
 * @returns The remote stream or null
 */
export function useRemoteStream(userId: string): MediaStream | null {
  const { remoteStreams } = useErmisClassroom();
  return useMemo(() => remoteStreams.get(userId) || null, [remoteStreams, userId]);
}

/**
 * Hook to access pin state and actions
 * 
 * @returns Object with pin state and toggle function
 */
export function usePinState() {
  const { pinType, handRaised, togglePin, toggleRaiseHand, currentRoom } = useErmisClassroom();

  return useMemo(
    () => ({
      pinType,
      handRaised,
      pinnedParticipant: currentRoom?.pinnedParticipant || null,
      togglePin,
      toggleRaiseHand,
    }),
    [pinType, handRaised, currentRoom, togglePin, toggleRaiseHand]
  );
}

/**
 * Hook to send custom events
 * 
 * @returns Function to send custom events
 */
export function useCustomEvents() {
  const { sendCustomEvent, inRoom } = useErmisClassroom();

  return useMemo(
    () => ({
      sendCustomEvent,
      canSendEvents: inRoom,
    }),
    [sendCustomEvent, inRoom]
  );
}

