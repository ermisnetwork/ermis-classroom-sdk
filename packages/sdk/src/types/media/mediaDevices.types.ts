/**
 * Media Device Types
 */

export interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

export interface MediaDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface SelectedDevices {
  camera: string | null;
  microphone: string | null;
  speaker: string | null;
}

export interface MediaPermissions {
  camera: PermissionState;
  microphone: PermissionState;
}

export interface DeviceSelectedEvent {
  type: "camera" | "microphone" | "speaker";
  deviceId: string;
  device: MediaDeviceInfo;
}

export interface PermissionChangedEvent {
  type: "camera" | "microphone";
  state: PermissionState;
}

/**
 * Media options for getUserMedia
 */
export interface GetUserMediaOptions {
  audio?: boolean;
  video?: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
}

/**
 * Audio constraints
 */
export interface AudioConstraints {
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

/**
 * Video constraints
 */
export interface VideoConstraints {
  width?: MediaTrackConstraintSet['width'];
  height?: MediaTrackConstraintSet['height'];
  frameRate?: MediaTrackConstraintSet['frameRate'];
}

/**
 * Media device check result
 */
export interface MediaDeviceCheck {
  hasCamera: boolean;
  hasMicrophone: boolean;
}
