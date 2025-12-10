/**
 * @ermisnetwork/ermis-classroom-react
 * 
 * React hooks and components for Ermis Classroom SDK
 * 
 * @example
 * ```tsx
 * import { 
 *   ErmisClassroomProvider, 
 *   useParticipants, 
 *   useLocalMedia,
 *   useRoom 
 * } from '@ermisnetwork/ermis-classroom-react';
 * 
 * function App() {
 *   return (
 *     <ErmisClassroomProvider config={{ host: 'your-host', webtpUrl: 'wss://...' }}>
 *       <VideoMeeting />
 *     </ErmisClassroomProvider>
 *   );
 * }
 * 
 * function VideoMeeting() {
 *   const { joinRoom, leaveRoom, inRoom } = useRoom();
 *   const participants = useParticipants();
 *   const { toggleMicrophone, toggleCamera } = useLocalMedia();
 *   
 *   // ...
 * }
 * ```
 */

// Context and Provider
export { ErmisClassroomContext, ErmisClassroomProvider } from './context';

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
} from './hooks';

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

