/**
 * Subscriber Types and Interfaces
 */

import type { ConnectionStatus } from '../core/ermisClient.types';

// Re-export ConnectionStatus for convenience
export type { ConnectionStatus } from '../core/ermisClient.types';

// Quality levels for bitrate switching
export type QualityLevel = '360p' | '720p' | '1080p';

// Protocol types for subscriber
export type SubscriberProtocol = 'webtransport' | 'webrtc' | 'websocket';

// Subscribe type (for different stream types)
export type SubscribeType = 'camera' | 'screen_share';

// Stream mode for WebTransport
export type StreamMode = 'single' | 'multi';

// Subscriber configuration
export interface SubscriberConfig {
  localStreamId: string;
  streamId: string;
  roomId?: string;
  host: string;
  userMediaWorker?: string;
  screenShareWorker?: string;
  isOwnStream?: boolean;
  protocol?: SubscriberProtocol;
  subscribeType?: SubscribeType;
  mediaWorkerUrl?: string;
  audioWorkletUrl?: string;
  mstgPolyfillUrl?: string;
  subcribeUrl: string;
  isScreenSharing?: boolean;
  streamOutputEnabled?: boolean;
  /**
   * Stream mode for WebTransport
   * - 'single': Single bidirectional stream for all media (default, SubscriberDev-style)
   * - 'multi': Separate streams for video and audio (SubscriberWs-style)
   * @default 'single'
   */
  streamMode?: StreamMode;
  /**
   * Status callback (for compatibility with original API)
   */
  onStatus?: (msg: string, isError: boolean) => void;
}

// Subscriber information
export interface SubscriberInfo {
  subscriberId: string;
  streamId: string;
  roomId: string;
  host: string;
  isOwnStream: boolean;
  isStarted: boolean;
  isAudioEnabled: boolean;
  connectionStatus: ConnectionStatus;
}

// Worker message types
export interface WorkerMessageData {
  type: WorkerMessageType;
  frame?: VideoFrame;
  message?: string;
  channelData?: Float32Array;
  sampleRate?: number;
  numberOfChannels?: number;
  timeStamp?: number;
  subscriberId?: string;
  audioEnabled?: boolean;
  data?: unknown;
  port?: MessagePort;
  isShare?: boolean;
  channelName?: string;
  readable?: ReadableStream;
  writable?: WritableStream;
  quality?: QualityLevel;
}

// Worker message types
export type WorkerMessageType =
  | 'init'
  | 'attachStream'
  | 'attachDataChannel'
  | 'attachWebSocket'
  | 'switchBitrate'
  | 'toggleAudio'
  | 'videoData'
  | 'status'
  | 'error'
  | 'audio-toggled'
  | 'skipping'
  | 'resuming';

// Remote stream ready event data
export interface RemoteStreamReadyEvent {
  stream: MediaStream;
  streamId: string;
  subscriberId: string;
  roomId: string;
  isOwnStream: boolean;
}

// Stream removed event data
export interface StreamRemovedEvent {
  streamId: string;
  subscriberId: string;
  roomId: string;
}

// Audio status event data
export interface AudioStatusEvent {
  subscriber: unknown; // Will be Subscriber instance
  type: string;
  bufferMs?: number;
  isPlaying?: boolean;
  newBufferSize?: number;
}

// Connection status changed event data
export interface ConnectionStatusChangedEvent {
  subscriber: unknown; // Will be Subscriber instance
  status: ConnectionStatus;
  previousStatus: ConnectionStatus;
}

// Error event data
export interface SubscriberErrorEvent {
  subscriber: unknown; // Will be Subscriber instance
  error: Error;
  action: SubscriberAction;
}

// Subscriber action types
export type SubscriberAction =
  | 'start'
  | 'stop'
  | 'toggleAudio'
  | 'workerMessage'
  | 'videoWrite';

// Status event data
export interface StatusEvent {
  subscriber: unknown; // Will be Subscriber instance
  message: string;
  isError: boolean;
}

// Audio mixer interface
export interface AudioMixer {
  addSubscriber: (
    subscriberId: string,
    audioWorkletUrl: string,
    isOwnStream: boolean,
    channelPort: MessagePort
  ) => Promise<AudioWorkletNode | null>;
  removeSubscriber: (subscriberId: string) => void;
}

// Audio worklet node with port
export interface AudioWorkletNodeWithPort extends AudioWorkletNode {
  port: MessagePort & {
    onmessage: ((event: MessageEvent) => void) | null;
  };
}
