/**
 * Subscriber Types and Interfaces
 */

// Connection status type
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

// Quality levels for bitrate switching
export type QualityLevel = '360p' | '720p' | '1080p';

// Subscriber configuration
export interface SubscriberConfig {
  streamId: string;
  roomId?: string;
  host?: string;
  userMediaWorker?: string;
  screenShareWorker?: string;
  isOwnStream?: boolean;
  mediaWorkerUrl?: string;
  audioWorkletUrl?: string;
  mstgPolyfillUrl?: string;
  subcribeUrl: string;
  isScreenSharing?: boolean;
  streamOutputEnabled?: boolean;
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
