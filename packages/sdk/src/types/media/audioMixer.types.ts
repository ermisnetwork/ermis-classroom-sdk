/**
 * Audio Mixer Types
 * Type definitions for AudioMixer class
 */

/**
 * Configuration options for AudioMixer
 */
export interface AudioMixerConfig {
  /** Master volume level (0-1) */
  masterVolume?: number;
  /** Audio sample rate in Hz */
  sampleRate?: number;
  /** Audio buffer size */
  bufferSize?: number;
  /** Enable echo cancellation */
  enableEchoCancellation?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Subscriber audio node data
 */
export interface SubscriberAudioNode {
  /** AudioWorkletNode for processing */
  workletNode: AudioWorkletNode;
  /** GainNode for volume control */
  gainNode: GainNode;
  /** Whether subscriber is currently active */
  isActive: boolean;
  /** Timestamp when subscriber was added */
  addedAt: number;
}

/**
 * Audio mixer statistics
 */
export interface AudioMixerStats {
  /** Whether mixer is initialized */
  isInitialized: boolean;
  /** Number of active subscribers */
  subscriberCount: number;
  /** Master volume level */
  masterVolume: number;
  /** Current audio context state */
  audioContextState: AudioContextState;
  /** Audio sample rate */
  sampleRate: number;
  /** List of subscriber info */
  subscribers: AudioMixerSubscriberInfo[];
}

/**
 * Individual subscriber information in audio mixer
 */
export interface AudioMixerSubscriberInfo {
  /** Subscriber ID */
  id: string;
  /** Current volume level */
  volume: number;
  /** Whether subscriber is active */
  isActive: boolean;
  /** Timestamp when added */
  addedAt: number;
}

/**
 * Audio worklet message types
 */
export type AudioWorkletMessageType =
  | "bufferStatus"
  | "bufferSizeChanged"
  | "workletDiag"
  | "error"
  | "connectWorker";

/**
 * Audio worklet message data
 */
export interface AudioWorkletMessage {
  /** Message type */
  type: AudioWorkletMessageType;
  /** Buffer status in milliseconds */
  bufferMs?: number;
  /** Whether audio is playing */
  isPlaying?: boolean;
  /** New buffer size */
  newBufferSize?: number;
  /** Error information */
  error?: string;
  /** Message channel port */
  port?: MessagePort;
}

/**
 * Audio context configuration
 */
export interface AudioContextConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Latency hint for audio context */
  latencyHint: AudioContextLatencyCategory;
}
