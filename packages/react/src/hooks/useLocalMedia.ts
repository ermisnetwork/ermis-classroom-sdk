/**
 * useLocalMedia - Hooks for local media track management
 */

import { useMemo } from 'react';
import { useErmisClassroom } from './useErmisClassroom';

/**
 * Local media state
 */
export interface LocalMediaState {
  /** Local media stream */
  localStream: MediaStream | null;
  /** Preview stream (before joining room) */
  previewStream: MediaStream | null;
  /** Whether microphone is enabled */
  isMicrophoneEnabled: boolean;
  /** Whether camera is enabled */
  isCameraEnabled: boolean;
  /** Whether screen sharing is active */
  isScreenSharing: boolean;
}

/**
 * Local media controls
 */
export interface LocalMediaControls {
  /** Toggle microphone on/off */
  toggleMicrophone: () => Promise<void>;
  /** Toggle camera on/off */
  toggleCamera: () => Promise<void>;
  /** Toggle screen sharing */
  toggleScreenShare: () => Promise<void>;
  /** Get preview stream before joining room */
  getPreviewStream: (cameraId?: string, micId?: string) => Promise<MediaStream>;
  /** Stop preview stream */
  stopPreviewStream: () => void;
  /** Replace the current media stream */
  replaceMediaStream: (newStream: MediaStream) => Promise<void>;
}

/**
 * Hook to access local media state and controls
 * 
 * @returns Object with local media state and control functions
 * 
 * @example
 * ```tsx
 * function LocalControls() {
 *   const { 
 *     isMicrophoneEnabled, 
 *     isCameraEnabled, 
 *     toggleMicrophone, 
 *     toggleCamera 
 *   } = useLocalMedia();
 *   
 *   return (
 *     <div>
 *       <button onClick={toggleMicrophone}>
 *         {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
 *       </button>
 *       <button onClick={toggleCamera}>
 *         {isCameraEnabled ? 'Stop Video' : 'Start Video'}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useLocalMedia(): LocalMediaState & LocalMediaControls {
  const {
    localStream,
    previewStream,
    micEnabled,
    videoEnabled,
    isScreenSharing,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
    getPreviewStream,
    stopPreviewStream,
    replaceMediaStream,
  } = useErmisClassroom();

  return useMemo(
    () => ({
      // State
      localStream,
      previewStream,
      isMicrophoneEnabled: micEnabled,
      isCameraEnabled: videoEnabled,
      isScreenSharing,
      // Controls
      toggleMicrophone,
      toggleCamera,
      toggleScreenShare,
      getPreviewStream,
      stopPreviewStream,
      replaceMediaStream,
    }),
    [
      localStream,
      previewStream,
      micEnabled,
      videoEnabled,
      isScreenSharing,
      toggleMicrophone,
      toggleCamera,
      toggleScreenShare,
      getPreviewStream,
      stopPreviewStream,
      replaceMediaStream,
    ]
  );
}

/**
 * Hook to access local video stream
 * 
 * @returns The local video stream or null
 */
export function useLocalVideo(): MediaStream | null {
  const { localStream } = useErmisClassroom();
  return localStream;
}

/**
 * Hook to access preview stream
 * 
 * @returns Object with preview stream and controls
 */
export function usePreviewStream() {
  const { previewStream, getPreviewStream, stopPreviewStream } = useErmisClassroom();
  
  return useMemo(
    () => ({
      previewStream,
      getPreviewStream,
      stopPreviewStream,
    }),
    [previewStream, getPreviewStream, stopPreviewStream]
  );
}

/**
 * Hook to access screen share state
 * 
 * @returns Object with screen share state and controls
 */
export function useScreenShare() {
  const { isScreenSharing, screenShareStreams, toggleScreenShare } = useErmisClassroom();
  
  return useMemo(
    () => ({
      isScreenSharing,
      screenShareStreams,
      toggleScreenShare,
      /** Get all screen share streams as array */
      screenShares: Array.from(screenShareStreams.entries()).map(([userId, data]) => ({
        userId,
        ...data,
      })),
    }),
    [isScreenSharing, screenShareStreams, toggleScreenShare]
  );
}

