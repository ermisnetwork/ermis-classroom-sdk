import EventEmitter from "../../../events/EventEmitter";
import type {
  WebRTCConfig,
  WebRTCManagerEvents,
} from "../../../types/media/transport.types";

/**
 * WebRTCManager - Manages WebRTC peer connection lifecycle
 *
 * Responsibilities:
 * - Establish and maintain WebRTC connection
 * - Handle SDP offer/answer exchange
 * - Manage ICE candidates
 * - Handle connection state changes
 * - Create and manage data channels
 *
 * Events:
 * - connected: When peer connection is established
 * - disconnected: When connection is lost
 * - connectionError: When connection error occurs
 * - iceConnectionStateChange: ICE connection state changes
 * - connectionStateChange: Connection state changes
 * - iceCandidate: New ICE candidate available
 * - signalingStateChange: Signaling state changes
 * - iceGatheringStateChange: ICE gathering state changes
 * - dataChannel: Data channel received
 * - dataChannelOpen: Data channel opened
 * - dataChannelClose: Data channel closed
 * - dataChannelError: Data channel error
 * - closed: When connection is closed
 * - iceRestart: When ICE restart completes
 */
export class WebRTCManager extends EventEmitter<
  Record<keyof WebRTCManagerEvents, unknown>
> {
  private peerConnection: RTCPeerConnection | null = null;
  private config: WebRTCConfig;
  private serverUrl: string;
  private roomId: string;
  private streamId: string;
  private isConnected = false;

  constructor(
    serverUrl: string,
    roomId: string,
    streamId: string,
    config?: WebRTCConfig,
  ) {
    super();
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.streamId = streamId;
    this.config = config || this.getDefaultConfig();
  }

  /**
   * Get default WebRTC configuration
   */
  private getDefaultConfig(): WebRTCConfig {
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
  }

  /**
   * Initialize peer connection
   */
  async connect(): Promise<RTCPeerConnection> {
    if (this.isConnected && this.peerConnection) {
      console.log("[WebRTC] Already connected");
      return this.peerConnection;
    }

    try {
      console.log("[WebRTC] Creating peer connection...");

      this.peerConnection = new RTCPeerConnection(this.config);

      this.setupEventHandlers();

      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      console.log("[WebRTC] Local offer created");

      // Exchange SDP with server
      const answer = await this.exchangeSDP(offer);
      await this.peerConnection.setRemoteDescription(answer);

      this.isConnected = true;
      console.log("[WebRTC] Connection established");
      this.emit("connected", this.peerConnection);

      return this.peerConnection;
    } catch (error) {
      console.error("[WebRTC] Connection failed:", error);
      this.emit("connectionError", error);
      throw error;
    }
  }

  /**
   * Exchange SDP with server
   */
  private async exchangeSDP(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    try {
      console.log("[WebRTC] Sending offer to server...");

      const response = await fetch(
        `https://${this.serverUrl}/meeting/sdp/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer,
            room_id: this.roomId,
            stream_id: this.streamId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Server responded with ${response.status}: ${response.statusText}`,
        );
      }

      const answer = await response.json();
      console.log("[WebRTC] Received answer from server");

      return answer;
    } catch (error) {
      console.error("[WebRTC] SDP exchange failed:", error);
      throw error;
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    if (!this.peerConnection) return;

    // ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);

      if (state) {
        this.emit("iceConnectionStateChange", state);

        if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        ) {
          this.handleDisconnection(state);
        }
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log("[WebRTC] Connection state:", state);

      if (state) {
        this.emit("connectionStateChange", state);

        if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        ) {
          this.handleDisconnection(state);
        }
      }
    };

    // ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] ICE candidate:", event.candidate);
        this.emit("iceCandidate", event.candidate);
      }
    };

    // Signaling state changes
    this.peerConnection.onsignalingstatechange = () => {
      const state = this.peerConnection?.signalingState;
      console.log("[WebRTC] Signaling state:", state);

      if (state) {
        this.emit("signalingStateChange", state);
      }
    };

    // ICE gathering state changes
    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState;
      console.log("[WebRTC] ICE gathering state:", state);

      if (state) {
        this.emit("iceGatheringStateChange", state);
      }
    };

    // Data channel events
    this.peerConnection.ondatachannel = (event) => {
      console.log("[WebRTC] Data channel received:", event.channel.label);
      this.emit("dataChannel", event.channel);
    };
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(state: string): void {
    console.warn("[WebRTC] Disconnected, state:", state);
    this.isConnected = false;
    this.emit("disconnected", state);
  }

  /**
   * Create data channel
   */
  createDataChannel(
    label: string,
    options?: RTCDataChannelInit,
  ): RTCDataChannel {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      const dataChannel = this.peerConnection.createDataChannel(label, options);

      dataChannel.binaryType = "arraybuffer";

      dataChannel.onopen = () => {
        console.log(`[WebRTC] Data channel "${label}" opened`);
        this.emit("dataChannelOpen", { label, channel: dataChannel });
      };

      dataChannel.onclose = () => {
        console.log(`[WebRTC] Data channel "${label}" closed`);
        this.emit("dataChannelClose", label);
      };

      dataChannel.onerror = (error) => {
        console.error(`[WebRTC] Data channel "${label}" error:`, error);
        this.emit("dataChannelError", { label, error });
      };

      return dataChannel;
    } catch (error) {
      console.error("[WebRTC] Failed to create data channel:", error);
      throw error;
    }
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      await this.peerConnection.addIceCandidate(candidate);
      console.log("[WebRTC] ICE candidate added");
    } catch (error) {
      console.error("[WebRTC] Failed to add ICE candidate:", error);
      throw error;
    }
  }

  /**
   * Get connection statistics
   */
  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.peerConnection) {
      return null;
    }

    try {
      const stats = await this.peerConnection.getStats();
      return stats;
    } catch (error) {
      console.error("[WebRTC] Failed to get stats:", error);
      return null;
    }
  }

  /**
   * Close connection
   */
  close(): void {
    if (!this.peerConnection) {
      console.log("[WebRTC] No active connection to close");
      return;
    }

    try {
      console.log("[WebRTC] Closing peer connection...");
      this.peerConnection.close();
      this.peerConnection = null;
      this.isConnected = false;
      this.emit("closed");
      console.log("[WebRTC] Peer connection closed");
    } catch (error) {
      console.error("[WebRTC] Error closing peer connection:", error);
    }
  }

  /**
   * Check if connected
   */
  isRTCConnected(): boolean {
    return (
      this.isConnected &&
      this.peerConnection !== null &&
      this.peerConnection.connectionState === "connected"
    );
  }

  /**
   * Get peer connection
   */
  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebRTCConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Restart ICE
   */
  async restartIce(): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      console.log("[WebRTC] Restarting ICE...");
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);

      const answer = await this.exchangeSDP(offer);
      await this.peerConnection.setRemoteDescription(answer);

      console.log("[WebRTC] ICE restart completed");
      this.emit("iceRestart");
    } catch (error) {
      console.error("[WebRTC] ICE restart failed:", error);
      throw error;
    }
  }

  /**
   * Get local description
   */
  getLocalDescription(): RTCSessionDescription | null {
    return this.peerConnection?.localDescription || null;
  }

  /**
   * Get remote description
   */
  getRemoteDescription(): RTCSessionDescription | null {
    return this.peerConnection?.remoteDescription || null;
  }

  /**
   * Get connection state
   */
  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null;
  }

  /**
   * Get ICE connection state
   */
  getIceConnectionState(): RTCIceConnectionState | null {
    return this.peerConnection?.iceConnectionState || null;
  }

  /**
   * Get signaling state
   */
  getSignalingState(): RTCSignalingState | null {
    return this.peerConnection?.signalingState || null;
  }
}
