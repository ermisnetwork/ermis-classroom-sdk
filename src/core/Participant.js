import EventEmitter from "../events/EventEmitter.js";

/**
 * Represents a participant in a meeting room
 */
class Participant extends EventEmitter {
  constructor(config) {
    super();

    this.userId = config.userId;
    this.streamId = config.streamId;
    this.membershipId = config.membershipId;
    this.role = config.role || "participant";
    this.roomId = config.roomId;
    this.isLocal = config.isLocal || false;

    // Media state
    this.isAudioEnabled = true;
    this.isVideoEnabled = true;
    this.isPinned = false;
    this.isHandRaised = false;

    // Media components
    this.publisher = null;
    this.subscriber = null;

    // Screen share state
    this.isScreenSharing = config.isScreenSharing || false;
    this.screenSubscriber = null;

    // Status
    this.connectionStatus = "disconnected"; // 'connecting', 'connected', 'disconnected', 'failed'
  }

  /**
   * Get display name with role
   */
  getDisplayName() {
    const roleText = this.role === "owner" ? " (Host)" : "";
    const localText = this.isLocal ? " (You)" : "";
    return `${this.userId}${roleText}${localText}`;
  }

  /**
   * Toggle microphone (local only)
   */
  async toggleMicrophone() {
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
        error,
        action: "toggleMicrophone",
      });
    }
  }

  /**
   * Toggle camera (local only)
   */
  async toggleCamera() {
    if (!this.isLocal || !this.publisher) return;

    try {
      await this.publisher.toggleCamera();
      this.isVideoEnabled = !this.isVideoEnabled;
      this.emit("videoToggled", {
        participant: this,
        enabled: this.isVideoEnabled,
      });
    } catch (error) {
      this.emit("error", { participant: this, error, action: "toggleCamera" });
    }
  }

  /**
   * Toggle remote participant's audio
   */
  async toggleRemoteAudio() {
    if (this.isLocal || !this.subscriber) return;

    try {
      await this.subscriber.toggleAudio();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("remoteAudioToggled", {
        participant: this,
        enabled: this.isAudioEnabled,
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error,
        action: "toggleRemoteAudio",
      });
    }
  }

  /**
   * Toggle pin status
   */
  togglePin() {
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
  async toggleRaiseHand() {
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
      console.log("toggleRaiseHand", this.isHandRaised);

    } catch (error) {
      console.log("toggleRaiseHand error", error);

      this.emit("error", {
        participant: this,
        error,
        action: "toggleRaiseHand",
      });
    }
  }

  /**
   * Update connection status
   */
  setConnectionStatus(status) {
    this.connectionStatus = status;
    this.emit("statusChanged", { participant: this, status });
  }

  /**
   * Get status text for display
   */
  _getStatusText(status) {
    switch (status) {
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
      case "failed":
        return "Connection Failed";
      default:
        return status;
    }
  }

  /**
   * Set publisher instance
   */
  setPublisher(publisher) {
    this.publisher = publisher;
    if (publisher) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Set subscriber instance
   */
  setSubscriber(subscriber) {
    this.subscriber = subscriber;
    if (subscriber) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Update media stream (local only)
   */
  updateMediaStream(newStream) {
    if (!this.isLocal || !this.publisher) {
      console.warn("Cannot update media stream: not a local participant or no publisher");
      return;
    }

    if (!newStream || !(newStream instanceof MediaStream)) {
      console.error("Invalid media stream provided");
      return;
    }

    try {
      const audioTracks = newStream.getAudioTracks();
      const videoTracks = newStream.getVideoTracks();

      this.publisher.stream = newStream;
      this.publisher.hasCamera = videoTracks.length > 0;
      this.publisher.hasMic = audioTracks.length > 0;

      if (videoTracks.length > 0) {
        this.publisher.cameraEnabled = true;
        this.isVideoEnabled = true;
      }

      if (audioTracks.length > 0) {
        this.publisher.micEnabled = true;
        this.isAudioEnabled = true;
      }

      this.emit("mediaStreamUpdated", {
        participant: this,
        stream: newStream,
        hasAudio: audioTracks.length > 0,
        hasVideo: videoTracks.length > 0,
      });

      console.log("Media stream updated successfully");
    } catch (error) {
      console.error("Failed to update media stream:", error);
      this.emit("error", {
        participant: this,
        error,
        action: "updateMediaStream",
      });
    }
  }

  /**
   * Update microphone status from server event
   */
  updateMicStatus(enabled) {
    this.isAudioEnabled = enabled;
    this.emit("remoteAudioStatusChanged", {
      participant: this,
      enabled: this.isAudioEnabled,
    });
  }

  /**
   * Update camera status from server event
   */
  updateCameraStatus(enabled) {
    this.isVideoEnabled = enabled;
    this.emit("remoteVideoStatusChanged", {
      participant: this,
      enabled: this.isVideoEnabled,
    });
  }

  /**
   * Update hand raise status from server event
   */
  updateHandRaiseStatus(enabled) {
    this.isHandRaised = enabled;
    this.emit("remoteHandRaisingStatusChanged", {
      participant: this,
      enabled: this.isHandRaised,
    });
  }

  /**
   * Cleanup participant resources
   */
  cleanup() {
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
   * Get participant info
   */
  getInfo() {
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
      isScreenSharing: this.isScreenSharing,
      connectionStatus: this.connectionStatus,
    };
  }
}

export default Participant;
