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
