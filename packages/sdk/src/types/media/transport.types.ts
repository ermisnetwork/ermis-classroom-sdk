/**
 * Transport Configuration Types
 *
 * Type definitions for WebTransport and WebRTC configurations
 */

/**
 * WebTransport configuration
 */
export interface WebTransportConfig {
  url: string;
  serverCertificateHashes?: ServerCertificateHash[];
}

/**
 * Server certificate hash for WebTransport
 */
export interface ServerCertificateHash {
  algorithm: string;
  value: ArrayBuffer;
}

/**
 * WebRTC configuration
 */
export interface WebRTCConfig {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Packet header structure
 */
export interface PacketHeader {
  timestamp: number;
  type: number;
  sequenceNumber?: number;
  fecMarker?: number;
}

/**
 * FEC packet header
 */
export interface FECPacketHeader extends PacketHeader {
  sequenceNumber: number;
  fecMarker: number;
  raptorQConfig: RaptorQHeaderConfig;
}

/**
 * RaptorQ header configuration
 */
export interface RaptorQHeaderConfig {
  transferLength: bigint;
  symbolSize: number;
  sourceBlocks: number;
  subBlocks: number;
  alignment: number;
}

/**
 * Transport packet structure
 */
export interface TransportPacket {
  header: PacketHeader;
  payload: Uint8Array;
}

/**
 * Stream event structure
 */
export interface StreamEvent {
  stream: WritableStream | ReadableStream;
  channelName: string;
  timestamp: number;
}

/**
 * Transport Manager Events
 */
export interface TransportManagerEvents {
  connected: undefined;
  disconnected: { reason?: string; error?: unknown };
  reconnecting: { attempt: number; delay: number };
  reconnectFailed: unknown;
  connectionError: unknown;
  streamCreated: "bidirectional" | "unidirectional";
  streamError: unknown;
  closed: undefined;
}

/**
 * WebRTC Manager Events
 */
export interface WebRTCManagerEvents {
  connected: RTCPeerConnection;
  disconnected: string;
  connectionError: unknown;
  iceConnectionStateChange: RTCIceConnectionState;
  connectionStateChange: RTCPeerConnectionState;
  iceCandidate: RTCIceCandidate;
  signalingStateChange: RTCSignalingState;
  iceGatheringStateChange: RTCIceGatheringState;
  dataChannel: RTCDataChannel;
  dataChannelOpen: { label: string; channel: RTCDataChannel };
  dataChannelClose: string;
  dataChannelError: { label: string; error: unknown };
  closed: undefined;
  iceRestart: undefined;
}

/**
 * Connection state
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

/**
 * Transport type
 */
export type TransportType = "webtransport" | "webrtc";

/**
 * Transport statistics
 */
export interface TransportStats {
  type: TransportType;
  connected: boolean;
  reconnectAttempts?: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  lastActivity?: number;
}
