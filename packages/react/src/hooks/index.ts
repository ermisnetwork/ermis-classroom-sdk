/**
 * Hooks exports
 */

// Core hook
export { useErmisClassroom } from './useErmisClassroom';

// Participant hooks
export {
  useParticipants,
  useLocalParticipant,
  useRemoteParticipants,
  useParticipant,
  useParticipantCount,
  useParticipantsByUserId,
} from './useParticipants';

// Media device hooks
export {
  useMediaDevices,
  useMediaPermissions,
  type MediaDeviceInfo,
  type AvailableDevices,
} from './useMediaDevices';

// Local media hooks
export {
  useLocalMedia,
  useLocalVideo,
  usePreviewStream,
  useScreenShare,
  type LocalMediaState,
  type LocalMediaControls,
} from './useLocalMedia';

// Connection hooks
export {
  useConnectionState,
  useAuth,
  type ConnectionState,
} from './useConnectionState';

// Room hooks
export {
  useRoom,
  useRemoteStreams,
  useRemoteStream,
  usePinState,
  useCustomEvents,
  type RoomState,
  type RoomActions,
} from './useRoom';

// Layout hooks
export { useSize, type Size } from './useSize';
export { useGridLayout } from './useGridLayout';
export { usePagination, useParticipantPagination, type UsePaginationResult } from './usePagination';

