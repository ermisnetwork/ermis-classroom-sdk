/**
 * useParticipants - Hook to access participants in the classroom
 */

import { useMemo } from 'react';
import type { Participant } from '@ermisnetwork/ermis-classroom-sdk';
import { useErmisClassroom } from './useErmisClassroom';

/**
 * Hook to access all participants in the classroom
 * Automatically updates when participants join/leave or their state changes
 * 
 * @returns Array of all participants
 * 
 * @example
 * ```tsx
 * function ParticipantList() {
 *   const participants = useParticipants();
 *   return (
 *     <ul>
 *       {participants.map(p => (
 *         <li key={p.userId}>{p.name || p.userId}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useParticipants(): Participant[] {
  const { participants } = useErmisClassroom();
  
  return useMemo(() => {
    return Array.from(participants.values());
  }, [participants]);
}

/**
 * Hook to access the local participant
 * Finds the participant with isLocal = true from all streams
 * 
 * @returns The local participant or null if not in a room
 * 
 * @example
 * ```tsx
 * function LocalParticipantInfo() {
 *   const localParticipant = useLocalParticipant();
 *   if (!localParticipant) return null;
 *   return <div>You: {localParticipant.name}</div>;
 * }
 * ```
 */
export function useLocalParticipant(): Participant | null {
  const { participants } = useErmisClassroom();
  
  return useMemo(() => {
    // Find by isLocal flag since Map is keyed by streamId
    return Array.from(participants.values()).find(p => p.isLocal) || null;
  }, [participants]);
}

/**
 * Hook to access remote participants (all participants except local)
 * 
 * @returns Array of remote participants
 * 
 * @example
 * ```tsx
 * function RemoteParticipants() {
 *   const remoteParticipants = useRemoteParticipants();
 *   return (
 *     <div>
 *       {remoteParticipants.map(p => (
 *         <VideoTile key={p.userId} participant={p} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useRemoteParticipants(): Participant[] {
  const { participants, userId } = useErmisClassroom();
  
  return useMemo(() => {
    return Array.from(participants.values()).filter(p => p.userId !== userId);
  }, [participants, userId]);
}

/**
 * Hook to access a specific participant by stream ID
 * Note: Map is keyed by streamId to support multi-stream per user
 * 
 * @param streamId - The stream ID of the participant
 * @returns The participant or null if not found
 * 
 * @example
 * ```tsx
 * function ParticipantInfo({ streamId }: { streamId: string }) {
 *   const participant = useParticipant(streamId);
 *   if (!participant) return <div>Participant not found</div>;
 *   return <div>{participant.name}</div>;
 * }
 * ```
 */
export function useParticipant(streamId: string): Participant | null {
  const { participants } = useErmisClassroom();
  
  return useMemo(() => {
    return participants.get(streamId) || null;
  }, [participants, streamId]);
}

/**
 * Hook to access all participants with the same user ID (all streams of a user)
 * Use this to get all streams/tabs/devices of a single user
 * 
 * @param userId - The user ID to find all streams for
 * @returns Array of participants with matching userId
 * 
 * @example
 * ```tsx
 * function UserStreams({ userId }: { userId: string }) {
 *   const streams = useParticipantsByUserId(userId);
 *   return (
 *     <div>
 *       {streams.map(p => (
 *         <VideoTile key={p.streamId} participant={p} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useParticipantsByUserId(userId: string): Participant[] {
  const { participants } = useErmisClassroom();
  
  return useMemo(() => {
    return Array.from(participants.values()).filter(p => p.userId === userId);
  }, [participants, userId]);
}

/**
 * Hook to get participant count
 * 
 * @returns Object with total, local, and remote participant counts
 */
export function useParticipantCount(): { total: number; remote: number } {
  const { participants, userId } = useErmisClassroom();
  
  return useMemo(() => {
    const total = participants.size;
    const remote = userId ? total - 1 : total;
    return { total, remote: Math.max(0, remote) };
  }, [participants, userId]);
}

