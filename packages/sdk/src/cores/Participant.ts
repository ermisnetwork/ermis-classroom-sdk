/**
 * Participant - Represents a participant in a meeting room
 * Handles both local and remote participants with media management
 */

import { EventEmitter } from "../events/EventEmitter";
import type {
  ParticipantConfig,
  ParticipantConnectionStatus,
  ParticipantInfo,
  ParticipantRole,
  MediaStreamReplaceResult,
} from "../types/core/participant.types";
import type { Publisher } from "../media/publisher/Publisher";
import type { Subscriber } from "../media/subscriber/Subscriber";
import { ChannelName, ParticipantPermissions, PinType } from "../types/media/publisher.types";

export class Participant extends EventEmitter {
  // Identity
  readonly userId: string;
  readonly streamId: string;
  readonly membershipId: string;
  readonly role: ParticipantRole;
  readonly roomId: string;
  readonly isLocal: boolean;
  readonly name?: string;

  // Media state
  isAudioEnabled = true;
  isVideoEnabled = true;
  isPinned = false;
  isHandRaised = false;
  pinType?: PinType | null = null;
  // Media components
  publisher: Publisher | null = null;
  subscriber: Subscriber | null = null;

  // Screen share state
  isScreenSharing: boolean;
  hasScreenShareAudio: boolean;
  hasScreenShareVideo: boolean;
  screenSubscriber: Subscriber | null = null;

  // Sub-room state
  subRoomId: string | null;

  // Status
  connectionStatus: ParticipantConnectionStatus = "disconnected";
  permissions: ParticipantPermissions;
  constructor(config: ParticipantConfig) {
    super();

    this.userId = config.userId;
    this.streamId = config.streamId;
    this.membershipId = config.membershipId;
    this.role = config.role || "participant";
    this.roomId = config.roomId;
    this.isLocal = config.isLocal || false;
    this.name = config.name;

    this.isScreenSharing = config.isScreenSharing || false;
    this.hasScreenShareAudio = config.hasScreenShareAudio ?? false;
    this.hasScreenShareVideo = config.hasScreenShareVideo ?? true;
    this.subRoomId = config.subRoomId || null;
    this.permissions = config.permissions || {
      can_subscribe: true,
      can_publish: true,
      can_publish_data: true,
      can_publish_sources: [["mic_48k", true], ["video_360p", true], ["video_720p", true], ["screen_share_720p", true], ["screen_share_1080p", true], ["screen_share_audio", true]],
      hidden: false,
      can_update_metadata: false,
    };

    // Set initial audio/video enabled state from server data
    // Default to true if not provided (for backwards compatibility)
    this.isAudioEnabled = config.isAudioEnabled !== undefined ? config.isAudioEnabled : true;
    this.isVideoEnabled = config.isVideoEnabled !== undefined ? config.isVideoEnabled : true;
  }

  /**
   * Get participant name
   */
  getName(): string {
    return this.name || "";
  }

  /**
   * Get display name with role indicator
   */
  getDisplayName(): string {
    const roleText = this.role === "owner" ? " (Host)" : "";
    const localText = this.isLocal ? " (You)" : "";
    return `${this.userId}${roleText}${localText}`;
  }

  /**
   * Toggle microphone (local only)
   */
  async toggleMicrophone(): Promise<void> {
    if (!this.isLocal || !this.publisher) return;

    try {
      await this.publisher.toggleMic();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("audioToggled", {
        participant: this,
        enabled: this.isAudioEnabled,
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "toggleMicrophone",
      });
    }
  }

  /**
   * Toggle camera (local only)
   */
  async toggleCamera(): Promise<void> {
    if (!this.isLocal || !this.publisher) return;

    try {
      await this.publisher.toggleCamera();
      this.isVideoEnabled = !this.isVideoEnabled;
      this.emit("videoToggled", {
        participant: this,
        enabled: this.isVideoEnabled,
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "toggleCamera",
      });
    }
  }

  /**
   * Toggle remote participant's audio
   */
  async toggleRemoteAudio(): Promise<void> {
    if (this.isLocal || !this.subscriber) return;

    try {
      this.subscriber.toggleAudio();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("remoteAudioToggled", {
        participant: this,
        enabled: this.isAudioEnabled,
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "toggleRemoteAudio",
      });
    }
  }

  /**
   * Toggle pin status
   */
  togglePin(): void {
    if (!this.isLocal) {
      if (this.isPinned) {
        this.subscriber?.switchBitrate("360p");
        console.warn("Unpin participant, switch to low quality");
      } else {
        this.subscriber?.switchBitrate("720p");
        console.warn("Pin participant, switch to high quality");
      }
    }

    this.isPinned = !this.isPinned;
    this.emit("pinToggled", { participant: this, pinned: this.isPinned });
  }

  /**
   * Toggle raise hand (local only)
   */
  async toggleRaiseHand(): Promise<void> {
    if (!this.isLocal || !this.publisher) return;

    try {
      if (this.isHandRaised) {
        await this.publisher.lowerHand();
      } else {
        await this.publisher.raiseHand();
      }
      this.isHandRaised = !this.isHandRaised;
      this.emit("handRaiseToggled", {
        participant: this,
        enabled: this.isHandRaised,
      });
    } catch (error) {
      console.error("toggleRaiseHand error", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "toggleRaiseHand",
      });
    }
  }

  /**
   * Pin a target participant for everyone (local only)
   * @param targetStreamId - The streamId of the participant to pin
   * @param pinType - The pin type: PinType.User (1) or PinType.ScreenShare (2)
   */
  async pinForEveryone(targetStreamId: string, pinType: PinType = PinType.User): Promise<void> {
    if (!this.isLocal || !this.publisher) return;

    try {
      await this.publisher.pinForEveryone(targetStreamId, pinType);
    } catch (error) {
      console.error("pinForEveryone error", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "pinForEveryone",
      });
    }
  }

  /**
   * Unpin a target participant for everyone (local only)
   * @param targetStreamId - The streamId of the participant to unpin
   * @param pinType - The pin type: PinType.User (1) or PinType.ScreenShare (2)
   */
  async unPinForEveryone(targetStreamId: string, pinType: PinType = PinType.User): Promise<void> {
    if (!this.isLocal || !this.publisher) return;

    try {
      await this.publisher.unPinForEveryone(targetStreamId, pinType);
    } catch (error) {
      console.error("unPinForEveryone error", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "unPinForEveryone",
      });
    }
  }

  /**
   * Start screen sharing (local only)
   * @returns The screen share MediaStream
   */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.isLocal || !this.publisher) {
      throw new Error("Cannot start screen share: not a local participant or no publisher");
    }

    try {
      // Get display media
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080 } as any,
        audio: true,
      });

      // Start screen share through publisher
      await this.publisher.startShareScreen(screenStream);

      this.isScreenSharing = true;
      this.emit("screenShareStarted", {
        participant: this,
        stream: screenStream,
      });

      return screenStream;
    } catch (error) {
      console.error("startScreenShare error", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "startScreenShare",
      });
      throw error;
    }
  }

  /**
   * Stop screen sharing (local only)
   */
  async stopScreenShare(): Promise<void> {
    if (!this.isLocal || !this.publisher) {
      throw new Error("Cannot stop screen share: not a local participant or no publisher");
    }

    try {
      await this.publisher.stopShareScreen();

      this.isScreenSharing = false;
      this.emit("screenShareStopped", {
        participant: this,
      });
    } catch (error) {
      console.error("stopScreenShare error", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "stopScreenShare",
      });
      throw error;
    }
  }

  /**
   * Toggle screen sharing (local only)
   */
  async toggleScreenShare(): Promise<MediaStream | void> {
    if (!this.isLocal || !this.publisher) return;

    if (this.isScreenSharing) {
      await this.stopScreenShare();
    } else {
      return await this.startScreenShare();
    }
  }

  /**
   * Update connection status
   */
  setConnectionStatus(status: ParticipantConnectionStatus): void {
    this.connectionStatus = status;
    this.emit("statusChanged", { participant: this, status });
  }

  /**
   * Set publisher instance
   */
  setPublisher(publisher: Publisher | null): void {
    this.publisher = publisher;
    if (publisher) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Set subscriber instance
   */
  setSubscriber(subscriber: Subscriber | null): void {
    this.subscriber = subscriber;
    if (subscriber) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Update media stream (local only)
   */
  async updateMediaStream(newStream: MediaStream): Promise<void> {
    if (!this.isLocal || !this.publisher) {
      console.warn(
        "Cannot update media stream: not a local participant or no publisher",
      );
      return;
    }

    if (!newStream || !(newStream instanceof MediaStream)) {
      console.error("Invalid media stream provided");
      return;
    }

    try {
      const audioTracks = newStream.getAudioTracks();
      const videoTracks = newStream.getVideoTracks();

      // Replace the media stream using Publisher's public method
      await this.publisher.replaceMediaStream(newStream);

      // Update local state based on tracks
      if (videoTracks.length > 0) {
        this.isVideoEnabled = true;
      }

      if (audioTracks.length > 0) {
        this.isAudioEnabled = true;
      }

      this.emit("mediaStreamUpdated", {
        participant: this,
        stream: newStream,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });
    } catch (error) {
      console.error("Failed to update media stream:", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "updateMediaStream",
      });
    }
  }

  /**
   * Replace media stream (local only)
   */
  async replaceMediaStream(
    newStream: MediaStream,
  ): Promise<MediaStreamReplaceResult> {
    if (!this.isLocal || !this.publisher) {
      throw new Error(
        "Cannot replace media stream: not a local participant or no publisher",
      );
    }

    if (!newStream || !(newStream instanceof MediaStream)) {
      throw new Error("Invalid MediaStream provided");
    }

    try {
      // Replace the media stream
      await this.publisher.replaceMediaStream(newStream);

      // Get the updated stream info
      const audioTracks = newStream.getAudioTracks();
      const videoTracks = newStream.getVideoTracks();
      const hasAudio = audioTracks.length > 0;
      const hasVideo = videoTracks.length > 0;

      this.isVideoEnabled = hasVideo;
      this.isAudioEnabled = hasAudio;

      const result: MediaStreamReplaceResult = {
        stream: newStream,
        videoOnlyStream: newStream, // Publisher.replaceMediaStream doesn't return this separately
        hasAudio,
        hasVideo,
      };

      this.emit("mediaStreamReplaced", {
        participant: this,
        stream: result.stream,
        videoOnlyStream: result.videoOnlyStream,
        hasAudio: result.hasAudio,
        hasVideo: result.hasVideo,
      });

      return result;
    } catch (error) {
      console.error("Failed to replace media stream:", error);
      this.emit("error", {
        participant: this,
        error: error instanceof Error ? error : new Error(String(error)),
        action: "replaceMediaStream",
      });
      throw error;
    }
  }

  /**
   * Update microphone status from server event
   */
  updateMicStatus(enabled: boolean): void {
    this.isAudioEnabled = enabled;
    this.emit("remoteAudioStatusChanged", {
      participant: this,
      enabled: this.isAudioEnabled,
    });
  }

  /**
   * Update camera status from server event
   */
  updateCameraStatus(enabled: boolean): void {
    this.isVideoEnabled = enabled;
    this.emit("remoteVideoStatusChanged", {
      participant: this,
      enabled: this.isVideoEnabled,
    });
  }

  /**
   * Update hand raise status from server event
   */
  updateHandRaiseStatus(enabled: boolean): void {
    this.isHandRaised = enabled;
    this.emit("remoteHandRaisingStatusChanged", {
      participant: this,
      enabled: this.isHandRaised,
    });
  }

  /**
   * Check if mic is banned by host
   */
  get isMicBanned(): boolean {
    if (!this.permissions.can_publish_sources) return false;
    for (const [channel, allowed] of this.permissions.can_publish_sources) {
      if (channel === "mic_48k" && allowed === false) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if camera is banned by host
   */
  get isCameraBanned(): boolean {
    if (!this.permissions.can_publish_sources) return false;
    for (const [channel, allowed] of this.permissions.can_publish_sources) {
      if ((channel === "video_360p" || channel === "video_720p") && allowed === false) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update permissions from server update_permission event
   */
  updatePermissions(permissionChanged: {
    can_subscribe?: boolean;
    can_publish?: boolean;
    can_publish_data?: boolean;
    can_publish_sources?: Array<[string, boolean]>;
    hidden?: boolean;
    can_update_metadata?: boolean;
  }): void {
    if (permissionChanged.can_subscribe !== undefined) {
      this.permissions.can_subscribe = permissionChanged.can_subscribe;
    }
    if (permissionChanged.can_publish !== undefined) {
      this.permissions.can_publish = permissionChanged.can_publish;
    }
    if (permissionChanged.can_publish_data !== undefined) {
      this.permissions.can_publish_data = permissionChanged.can_publish_data;
    }
    if (permissionChanged.can_publish_sources !== undefined) {
      this.permissions.can_publish_sources = permissionChanged.can_publish_sources as Array<[ChannelName, boolean]>;
    }
    if (permissionChanged.hidden !== undefined) {
      this.permissions.hidden = permissionChanged.hidden;
    }
    if (permissionChanged.can_update_metadata !== undefined) {
      this.permissions.can_update_metadata = permissionChanged.can_update_metadata;
    }

    this.emit("permissionUpdated", {
      participant: this,
      permissions: this.permissions,
      isMicBanned: this.isMicBanned,
      isCameraBanned: this.isCameraBanned,
    });
  }

  /**
   * Cleanup participant resources
   */
  cleanup(): void {
    // Stop media streams
    if (this.publisher) {
      this.publisher.stop();
      this.publisher = null;
    }

    if (this.subscriber) {
      this.subscriber.stop();
      this.subscriber = null;
    }

    // Stop screen subscriber
    if (this.screenSubscriber) {
      this.screenSubscriber.stop();
      this.screenSubscriber = null;
    }

    this.setConnectionStatus("disconnected");
    this.removeAllListeners();

    this.emit("cleanup", { participant: this });
  }

  /**
   * Get participant info snapshot
   */
  getInfo(): ParticipantInfo {
    return {
      userId: this.userId,
      streamId: this.streamId,
      membershipId: this.membershipId,
      role: this.role,
      isLocal: this.isLocal,
      isAudioEnabled: this.isAudioEnabled,
      isVideoEnabled: this.isVideoEnabled,
      isHandRaised: this.isHandRaised,
      isPinned: this.isPinned,
      pinType: this.pinType,
      isScreenSharing: this.isScreenSharing,
      connectionStatus: this.connectionStatus,
      name: this.name,
      participantPermissions: this.permissions
    };
  }
}

export default Participant;
