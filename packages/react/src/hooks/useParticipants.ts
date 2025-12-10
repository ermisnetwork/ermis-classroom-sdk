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
  const { participants, userId } = useErmisClassroom();
  
  return useMemo(() => {
    if (!userId) return null;
    return participants.get(userId) || null;
  }, [participants, userId]);
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
 * Hook to access a specific participant by user ID
 * 
 * @param participantId - The user ID of the participant
 * @returns The participant or null if not found
 * 
 * @example
 * ```tsx
 * function ParticipantInfo({ participantId }: { participantId: string }) {
 *   const participant = useParticipant(participantId);
 *   if (!participant) return <div>Participant not found</div>;
 *   return <div>{participant.name}</div>;
 * }
 * ```
 */
export function useParticipant(participantId: string): Participant | null {
  const { participants } = useErmisClassroom();
  
  return useMemo(() => {
    return participants.get(participantId) || null;
  }, [participants, participantId]);
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

