import { EventEmitter } from "../../events/EventEmitter";
import type {
    MediaDeviceInfo,
    MediaDevices,
    SelectedDevices,
    MediaPermissions,
    DeviceSelectedEvent,
    PermissionChangedEvent,
} from "../../types/media/mediaDevices.types";

/**
 * MediaDeviceManager
 * Manages media devices (cameras, microphones, speakers)
 * Handles device enumeration, selection, and monitoring
 */
export class MediaDeviceManager extends EventEmitter {
    devices: MediaDevices;
    selectedDevices: SelectedDevices;
    permissions: MediaPermissions;
    isMonitoring: boolean;

    private _boundDeviceChangeHandler: (() => void) | null;

    constructor() {
        super();

        this.devices = {
            cameras: [],
            microphones: [],
            speakers: [],
        };

        this.selectedDevices = {
            camera: null,
            microphone: null,
            speaker: null,
        };

        this.permissions = {
            camera: "prompt",
            microphone: "prompt",
        };

        this.isMonitoring = false;
        this._boundDeviceChangeHandler = null;
    }

    /**
     * Initialize the device manager
     * Enumerates devices, checks permissions, and starts monitoring
     */
    async initialize(): Promise<MediaDevices> {
        if (!navigator.mediaDevices) {
            throw new Error("Media devices not supported in this browser");
        }

        await this.refreshDevices();
        await this.checkPermissions();
        this.startMonitoring();

        return this.devices;
    }

    /**
     * Refresh the list of available devices
     */
    async refreshDevices(): Promise<MediaDevices> {
        try {
            const deviceList = await navigator.mediaDevices.enumerateDevices();

            this.devices.cameras = deviceList
                .filter((d) => d.kind === "videoinput")
                .map((d, index) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Camera ${index + 1}`,
                    kind: d.kind,
                    groupId: d.groupId,
                }));

            this.devices.microphones = deviceList
                .filter((d) => d.kind === "audioinput")
                .map((d, index) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${index + 1}`,
                    kind: d.kind,
                    groupId: d.groupId,
                }));

            this.devices.speakers = deviceList
                .filter((d) => d.kind === "audiooutput")
                .map((d, index) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Speaker ${index + 1}`,
                    kind: d.kind,
                    groupId: d.groupId,
                }));

            // Auto-select first device if none selected
            if (!this.selectedDevices.camera && this.devices.cameras.length > 0) {
                this.selectedDevices.camera = this.devices.cameras[0].deviceId;
            }

            if (
                !this.selectedDevices.microphone &&
                this.devices.microphones.length > 0
            ) {
                this.selectedDevices.microphone = this.devices.microphones[0].deviceId;
            }

            if (!this.selectedDevices.speaker && this.devices.speakers.length > 0) {
                this.selectedDevices.speaker = this.devices.speakers[0].deviceId;
            }

            this.emit("devicesChanged", this.devices);

            return this.devices;
        } catch (error) {
            console.error("Failed to enumerate devices:", error);
            throw error;
        }
    }

    /**
     * Check media permissions status
     */
    async checkPermissions(): Promise<MediaPermissions> {
        if (!navigator.permissions) {
            return this.permissions;
        }

        try {
            const cameraPermission = await navigator.permissions.query({
                name: "camera" as PermissionName,
            });
            this.permissions.camera = cameraPermission.state;

            cameraPermission.addEventListener("change", () => {
                this.permissions.camera = cameraPermission.state;
                this.emit("permissionChanged", {
                    type: "camera",
                    state: cameraPermission.state,
                } as PermissionChangedEvent);
            });
        } catch (error) {
            console.warn("Camera permission check failed:", error);
        }

        try {
            const micPermission = await navigator.permissions.query({
                name: "microphone" as PermissionName,
            });
            this.permissions.microphone = micPermission.state;

            micPermission.addEventListener("change", () => {
                this.permissions.microphone = micPermission.state;
                this.emit("permissionChanged", {
                    type: "microphone",
                    state: micPermission.state,
                } as PermissionChangedEvent);
            });
        } catch (error) {
            console.warn("Microphone permission check failed:", error);
        }

        return this.permissions;
    }

    /**
     * Start monitoring device changes
     */
    startMonitoring(): void {
        if (this.isMonitoring) return;

        this._boundDeviceChangeHandler = () => {
            this.refreshDevices();
        };

        navigator.mediaDevices.addEventListener(
            "devicechange",
            this._boundDeviceChangeHandler
        );
        this.isMonitoring = true;
    }

    /**
     * Stop monitoring device changes
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) return;

        if (this._boundDeviceChangeHandler) {
            navigator.mediaDevices.removeEventListener(
                "devicechange",
                this._boundDeviceChangeHandler
            );
            this._boundDeviceChangeHandler = null;
        }

        this.isMonitoring = false;
    }

    /**
     * Select a camera device
     */
    selectCamera(deviceId: string): MediaDeviceInfo {
        const device = this.devices.cameras.find((d) => d.deviceId === deviceId);
        if (!device) {
            throw new Error(`Camera with deviceId ${deviceId} not found`);
        }

        this.selectedDevices.camera = deviceId;
        this.emit("deviceSelected", {
            type: "camera",
            deviceId,
            device,
        } as DeviceSelectedEvent);

        return device;
    }

    /**
     * Select a microphone device
     */
    selectMicrophone(deviceId: string): MediaDeviceInfo {
        const device = this.devices.microphones.find(
            (d) => d.deviceId === deviceId
        );
        if (!device) {
            throw new Error(`Microphone with deviceId ${deviceId} not found`);
        }

        this.selectedDevices.microphone = deviceId;
        this.emit("deviceSelected", {
            type: "microphone",
            deviceId,
            device,
        } as DeviceSelectedEvent);

        return device;
    }

    /**
     * Select a speaker device
     */
    selectSpeaker(deviceId: string): MediaDeviceInfo {
        const device = this.devices.speakers.find((d) => d.deviceId === deviceId);
        if (!device) {
            throw new Error(`Speaker with deviceId ${deviceId} not found`);
        }

        this.selectedDevices.speaker = deviceId;
        this.emit("deviceSelected", {
            type: "speaker",
            deviceId,
            device,
        } as DeviceSelectedEvent);

        return device;
    }

    /**
     * Get user media with selected devices
     */
    async getUserMedia(
        constraints: MediaStreamConstraints = {}
    ): Promise<MediaStream> {
        const finalConstraints: MediaStreamConstraints = { ...constraints };

        if (constraints.video && this.selectedDevices.camera) {
            finalConstraints.video = {
                ...(typeof constraints.video === "object" ? constraints.video : {}),
                deviceId: { exact: this.selectedDevices.camera },
            };
        }

        if (constraints.audio && this.selectedDevices.microphone) {
            finalConstraints.audio = {
                ...(typeof constraints.audio === "object" ? constraints.audio : {}),
                deviceId: { exact: this.selectedDevices.microphone },
            };
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia(
                finalConstraints
            );
            await this.refreshDevices();
            return stream;
        } catch (error) {
            console.error("getUserMedia failed:", error);
            throw error;
        }
    }

    /**
     * Get all available devices
     */
    getDevices(): MediaDevices {
        return this.devices;
    }

    /**
     * Get currently selected devices
     */
    getSelectedDevices(): SelectedDevices {
        return this.selectedDevices;
    }

    /**
     * Get current permissions status
     */
    getPermissions(): MediaPermissions {
        return this.permissions;
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.stopMonitoring();
        this.removeAllListeners();
    }
}
