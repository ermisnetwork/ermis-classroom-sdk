/**
 * ErmisClassroomContext - React Context for Ermis Classroom SDK
 */

import { createContext } from 'react';
import type { ErmisClassroomContextValue } from '../types';

/**
 * Context for Ermis Classroom SDK
 * Provides access to the SDK client and state throughout the component tree
 */
export const ErmisClassroomContext = createContext<ErmisClassroomContextValue | null>(null);

ErmisClassroomContext.displayName = 'ErmisClassroomContext';

