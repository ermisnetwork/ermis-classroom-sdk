/**
 * Media Utils Types
 * Type definitions for media utilities
 */

/**
 * Media options for getUserMedia
 */
export interface GetUserMediaOptions {
  /** Enable audio */
  audio?: boolean;
  /** Enable video */
  video?: boolean;
  /** Video width */
  width?: number;
  /** Video height */
  height?: number;
  /** Video frame rate */
  frameRate?: number;
}

/**
 * Audio constraints
 */
export interface AudioConstraints {
  /** Sample rate */
  sampleRate?: number;
  /** Channel count */
  channelCount?: number;
  /** Echo cancellation */
  echoCancellation?: boolean;
  /** Noise suppression */
  noiseSuppression?: boolean;
  /** Auto gain control */
  autoGainControl?: boolean;
}

/**
 * Video constraints
 */
export interface VideoConstraints {
  /** Video width */
  width?: MediaTrackConstraintSet['width'];
  /** Video height */
  height?: MediaTrackConstraintSet['height'];
  /** Frame rate */
  frameRate?: MediaTrackConstraintSet['frameRate'];
}

/**
 * Media device check result
 */
export interface MediaDeviceCheck {
  /** Has camera */
  hasCamera: boolean;
  /** Has microphone */
  hasMicrophone: boolean;
}

/**
 * Media permissions result
 */
export interface MediaPermissions {
  /** Camera permission granted */
  camera: boolean;
  /** Microphone permission granted */
  microphone: boolean;
}

/**
 * Stream information
 */
export interface StreamInfo {
  /** Has video tracks */
  hasVideo: boolean;
  /** Has audio tracks */
  hasAudio: boolean;
  /** Number of video tracks */
  videoTrackCount: number;
  /** Number of audio tracks */
  audioTrackCount: number;
  /** First video track (if available) */
  videoTrack?: MediaStreamTrack;
  /** First audio track (if available) */
  audioTrack?: MediaStreamTrack;
}
