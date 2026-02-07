import EventEmitter from "../../../events/EventEmitter";
import type {
  WebRTCConfig,
  WebRTCManagerEvents,
} from "../../../types/media/transport.types";
import {log} from "../../../utils";

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
  private peerConnections: Map<string, RTCPeerConnection> = new Map(); // Multiple connections (same as JS)
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
   * Close connection
   */
  async close(): Promise<void> {
    // Close all multiple connections (same as JS)
    if (this.peerConnections.size > 0) {
      for (const [channelName, connection] of this.peerConnections) {
        log(`[WebRTCManager] Closing connection for ${channelName}`);
        connection.close();
      }
      this.peerConnections.clear();
    }

    this.isConnected = false;
    this.emit("closed", undefined);
    log("[WebRTC] Connection closed");
  }

  /**
   * Check if connected
   */
  isRTCConnected(): boolean {
    return this.isConnected && this.peerConnections.size > 0;
  }

  /**
   * Get all peer connections
   */
  getPeerConnections(): Map<string, RTCPeerConnection> {
    return this.peerConnections;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebRTCConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Connect multiple channels (EXACT copy from JS)
   */
  async connectMultipleChannels(
    channelNames: string[],
    streamManager: any
  ): Promise<void> {
    try {
      for (const channelName of channelNames) {
        log(`[WebRTC] Setting up connection for: ${channelName}`);

        const webRtc = new RTCPeerConnection();
        this.peerConnections.set(channelName, webRtc);

        // Log ICE candidates for debugging
        webRtc.onicecandidate = (event) => {
          if (event.candidate) {
            log(`[WebRTC] ${channelName} ICE candidate:`, event.candidate.candidate);
          } else {
            log(`[WebRTC] ${channelName} ICE gathering complete`);
          }
        };

        log(`[WebRTC] Creating data channel for: ${channelName}`);
        streamManager.createDataChannelDirect(channelName, webRtc);

        log(`[WebRTC] Creating offer for: ${channelName}`);
        const offer = await webRtc.createOffer();
        await webRtc.setLocalDescription(offer);

        log(`[WebRTC] Sending offer to server for: ${channelName}`);
        const bodyData = {
          offer,
          room_id: this.roomId,
          stream_id: this.streamId,
          action: "publisher_offer",
          channel: channelName,
        };
        console.log("Offer body data:", bodyData);
        const response = await fetch(
          `https://${this.serverUrl}/meeting/sdp/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData),
          }
        );

        if (!response.ok) {
          console.error(`[WebRTC] Server error ${response.status} for ${channelName}`);
          throw new Error(
            `Server responded with ${response.status} for ${channelName}`
          );
        }

        const answer = await response.json();
        log(`[WebRTC] Got answer from server for: ${channelName}`);
        log(`[WebRTC] Answer SDP for ${channelName}:`, answer.sdp);

        await webRtc.setRemoteDescription(answer);
        log(`[WebRTC] Set remote description for: ${channelName}`);

        log(
          `WebRTC connection established for channel: ${channelName}`
        );
      }

      this.isConnected = true;
      log(`[WebRTC] All ${channelNames.length} channels setup complete`);
    } catch (error) {
      console.error("WebRTC setup error:", error);
    }
  }
}
