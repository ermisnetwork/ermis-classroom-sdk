/**
 * useErmisClassroom - Hook to access the Ermis Classroom context
 */

import { useContext } from 'react';
import { ErmisClassroomContext } from '../context/ErmisClassroomContext';
import type { ErmisClassroomContextValue } from '../types';

/**
 * Hook to access the Ermis Classroom context
 * Must be used within an ErmisClassroomProvider
 * 
 * @returns The Ermis Classroom context value
 * @throws Error if used outside of ErmisClassroomProvider
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { participants, joinRoom, leaveRoom } = useErmisClassroom();
 *   // ...
 * }
 * ```
 */
export function useErmisClassroom(): ErmisClassroomContextValue {
  const context = useContext(ErmisClassroomContext);
  
  if (!context) {
    throw new Error(
      'useErmisClassroom must be used within an ErmisClassroomProvider. ' +
      'Make sure to wrap your component tree with <ErmisClassroomProvider>.'
    );
  }
  
  return context;
}

