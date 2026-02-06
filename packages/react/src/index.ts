export { ErmisClassroomContext, ErmisClassroomProvider } from './context';

// Re-export ChannelName from SDK for convenience
export { ChannelName } from '@ermisnetwork/ermis-classroom-sdk';

// All hooks
export {
  // Core hook
  useErmisClassroom,
  // Participant hooks
  useParticipants,
  useLocalParticipant,
  useRemoteParticipants,
  useParticipant,
  useParticipantCount,
  // Media device hooks
  useMediaDevices,
  useMediaPermissions,
  // Local media hooks
  useLocalMedia,
  useLocalVideo,
  usePreviewStream,
  useScreenShare,
  // Connection hooks
  useConnectionState,
  useAuth,
  // Room hooks
  useRoom,
  useRemoteStreams,
  useRemoteStream,
  usePinState,
  useCustomEvents,
  // Layout hooks
  useSize,
  useGridLayout,
  usePagination,
  useParticipantPagination,
} from './hooks';

// Layout components
export {
  GridLayout,
  useGridLayoutContext,
  CarouselLayout,
  useCarouselLayoutContext,
  FocusLayout,
  FocusLayoutContainer,
  useFocusLayoutContext,
} from './components/layouts';

// Tile components
export {
  ParticipantTile,
  ScreenShareTile,
} from './components/tiles';

// Types
export type {
  ErmisClassroomConfig,
  ErmisClassroomProviderProps,
  ErmisClassroomContextValue,
  ScreenShareData,
  ConnectionState,
  ConnectionStatusType,
  LocalMediaState,
  RoomState,
  ParticipantsState,
  MediaDeviceState,
  PinState,
} from './types';

// Layout types
export type {
  ParticipantData,
  ScreenShareData as LayoutScreenShareData,
  TileData,
  GridLayoutInfo,
  GridLayoutProps,
  CarouselLayoutProps,
  FocusLayoutProps,
  FocusLayoutContainerProps,
  ParticipantTileProps,
  ScreenShareTileProps,
  PaginationState,
  PaginationActions,
} from './components/layouts';

// Re-export hook types
export type {
  MediaDeviceInfo,
  AvailableDevices,
} from './hooks/useMediaDevices';

export type {
  LocalMediaControls,
} from './hooks/useLocalMedia';

export type {
  RoomActions,
} from './hooks/useRoom';

export type {
  Size,
} from './hooks/useSize';

export type {
  UsePaginationResult,
} from './hooks/usePagination';

