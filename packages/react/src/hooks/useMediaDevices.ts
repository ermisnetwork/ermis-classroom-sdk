/**
 * useMediaDevices - Hooks for media device management
 */

import { useCallback, useEffect, useState } from 'react';
import { useErmisClassroom } from './useErmisClassroom';

/**
 * Media device info
 */
export interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

/**
 * Available media devices
 */
export interface AvailableDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

/**
 * Hook to enumerate and manage media devices
 * 
 * @returns Object with available devices and device selection functions
 * 
 * @example
 * ```tsx
 * function DeviceSelector() {
 *   const { cameras, microphones, selectCamera, selectMicrophone } = useMediaDevices();
 *   return (
 *     <div>
 *       <select onChange={(e) => selectCamera(e.target.value)}>
 *         {cameras.map(cam => (
 *           <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>
 *         ))}
 *       </select>
 *     </div>
 *   );
 * }
 * ```
 */
export function useMediaDevices() {
  const { devices, selectedDevices, switchCamera, switchMicrophone } = useErmisClassroom();
  const [availableDevices, setAvailableDevices] = useState<AvailableDevices>({
    cameras: [],
    microphones: [],
    speakers: [],
  });

  // Enumerate devices on mount and when devices change
  useEffect(() => {
    const enumerateDevices = async () => {
      try {
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        const cameras = deviceList
          .filter(d => d.kind === 'videoinput')
          .map(d => ({
            deviceId: d.deviceId,
            kind: d.kind,
            label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
            groupId: d.groupId,
          }));
        const microphones = deviceList
          .filter(d => d.kind === 'audioinput')
          .map(d => ({
            deviceId: d.deviceId,
            kind: d.kind,
            label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
            groupId: d.groupId,
          }));
        const speakers = deviceList
          .filter(d => d.kind === 'audiooutput')
          .map(d => ({
            deviceId: d.deviceId,
            kind: d.kind,
            label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
            groupId: d.groupId,
          }));
        setAvailableDevices({ cameras, microphones, speakers });
      } catch (error) {
        console.error('Failed to enumerate devices:', error);
      }
    };

    enumerateDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
    };
  }, []);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      await switchCamera(deviceId);
    },
    [switchCamera]
  );

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      await switchMicrophone(deviceId);
    },
    [switchMicrophone]
  );

  return {
    cameras: availableDevices.cameras,
    microphones: availableDevices.microphones,
    speakers: availableDevices.speakers,
    selectedCamera: selectedDevices?.camera || null,
    selectedMicrophone: selectedDevices?.microphone || null,
    selectedSpeaker: selectedDevices?.speaker || null,
    selectCamera,
    selectMicrophone,
    // SDK devices (if available)
    sdkDevices: devices,
    sdkSelectedDevices: selectedDevices,
  };
}

/**
 * Hook to request media permissions
 * 
 * @returns Object with permission request functions and status
 */
export function useMediaPermissions() {
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('prompt');
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>('prompt');

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        if (navigator.permissions) {
          const camera = await navigator.permissions.query({ name: 'camera' as PermissionName });
          setCameraPermission(camera.state);
          camera.addEventListener('change', () => setCameraPermission(camera.state));

          const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setMicrophonePermission(mic.state);
          mic.addEventListener('change', () => setMicrophonePermission(mic.state));
        }
      } catch (error) {
        // Permissions API not supported
      }
    };
    checkPermissions();
  }, []);

  const requestCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      setCameraPermission('granted');
      return true;
    } catch {
      setCameraPermission('denied');
      return false;
    }
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicrophonePermission('granted');
      return true;
    } catch {
      setMicrophonePermission('denied');
      return false;
    }
  }, []);

  return {
    cameraPermission,
    microphonePermission,
    requestCameraPermission,
    requestMicrophonePermission,
  };
}

