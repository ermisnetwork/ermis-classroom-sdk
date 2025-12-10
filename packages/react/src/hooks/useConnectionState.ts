/**
 * useConnectionState - Hook to access connection state
 */

import { useMemo } from 'react';
import { useErmisClassroom } from './useErmisClassroom';

/**
 * Connection state
 */
export interface ConnectionState {
  /** Whether the client is authenticated */
  isAuthenticated: boolean;
  /** Whether the client is in a room */
  inRoom: boolean;
  /** Current user ID */
  userId: string | undefined;
}

/**
 * Hook to access connection state
 * 
 * @returns Object with connection state
 * 
 * @example
 * ```tsx
 * function ConnectionStatus() {
 *   const { isAuthenticated, inRoom } = useConnectionState();
 *   
 *   if (!isAuthenticated) return <div>Not authenticated</div>;
 *   if (!inRoom) return <div>Not in a room</div>;
 *   return <div>Connected to room</div>;
 * }
 * ```
 */
export function useConnectionState(): ConnectionState {
  const { isAuthenticated, inRoom, userId } = useErmisClassroom();

  return useMemo(
    () => ({
      isAuthenticated,
      inRoom,
      userId,
    }),
    [isAuthenticated, inRoom, userId]
  );
}

/**
 * Hook to access authentication state and actions
 * 
 * @returns Object with auth state and authenticate function
 */
export function useAuth() {
  const { isAuthenticated, userId, authenticate } = useErmisClassroom();

  return useMemo(
    () => ({
      isAuthenticated,
      userId,
      authenticate,
    }),
    [isAuthenticated, userId, authenticate]
  );
}

