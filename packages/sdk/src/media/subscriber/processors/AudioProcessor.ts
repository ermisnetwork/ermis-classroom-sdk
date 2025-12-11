/**
 * AudioProcessor - Manages audio processing for subscriber
 *
 * Responsibilities:
 * - Integrates with audio mixer
 * - Handles audio worklet setup
 * - Manages audio status events
 */

import EventEmitter from "../../../events/EventEmitter";
import type {
  AudioMixer,
  AudioWorkletNodeWithPort,
} from "../../../types/media/subscriber.types";
import {log} from "../../../utils";

/**
 * Audio processor events
 */
interface AudioProcessorEvents extends Record<string, unknown> {
  initialized: { workletNode: AudioWorkletNodeWithPort | null };
  status: {
    type: string;
    bufferMs?: number;
    isPlaying?: boolean;
    newBufferSize?: number;
  };
  skipped: { reason: string };
  error: { error: Error; context: string };
}

/**
 * AudioProcessor class
 */
export class AudioProcessor extends EventEmitter<AudioProcessorEvents> {
  private audioMixer: AudioMixer | null = null;
  private audioWorkletNode: AudioWorkletNodeWithPort | null = null;
  private subscriberId: string;
  private isOwnStream: boolean;

  constructor(subscriberId: string, isOwnStream: boolean) {
    super();
    this.subscriberId = subscriberId;
    this.isOwnStream = isOwnStream;
  }

  /**
   * Set audio mixer reference
   */
  setAudioMixer(audioMixer: AudioMixer): void {
    this.audioMixer = audioMixer;
  }

  /**
   * Initialize audio system
   */
  async init(
    audioWorkletUrl: string,
    channelPort: MessagePort
  ): Promise<AudioWorkletNodeWithPort | null> {
    try {
      // Skip audio setup for own stream to prevent echo
      if (this.isOwnStream) {
        log("Skipping audio for own stream to prevent echo");
        this.emit("skipped", { reason: "Own stream - preventing echo" });
        return null;
      }

      // Check if audio mixer is set
      if (!this.audioMixer) {
        throw new Error("Audio mixer not set");
      }

      log("Adding subscriber to audio mixer:", this.subscriberId);

      // Add subscriber to audio mixer
      this.audioWorkletNode = await this.audioMixer.addSubscriber(
        this.subscriberId,
        audioWorkletUrl,
        this.isOwnStream,
        channelPort
      );

      // Setup audio status listener
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.onmessage = (event: MessageEvent) => {
          const { type, bufferMs, isPlaying, newBufferSize } = event.data;
          this.emit("status", { type, bufferMs, isPlaying, newBufferSize });
        };
      }

      log("Audio system initialized");
      this.emit("initialized", { workletNode: this.audioWorkletNode });

      return this.audioWorkletNode;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Audio initialization failed");
      console.error("Failed to initialize audio system:", err);
      this.emit("error", { error: err, context: "init" });
      throw err;
    }
  }

  /**
   * Remove from audio mixer
   */
  cleanup(): void {
    if (this.audioMixer) {
      this.audioMixer.removeSubscriber(this.subscriberId);
      log("Removed from audio mixer:", this.subscriberId);
    }

    this.audioWorkletNode = null;
  }

  /**
   * Get audio worklet node
   */
  getAudioWorkletNode(): AudioWorkletNodeWithPort | null {
    return this.audioWorkletNode;
  }
}
