import EventEmitter from "../../../events/EventEmitter";
import type {
  AudioEncoderConfig,
  ChannelName,
} from "../../../types/media/publisher.types";
import { AudioEncoderManager } from "../managers/AudioEncoderManager";
import { StreamManager } from "../transports/StreamManager";

/**
 * AudioProcessor - Manages audio processing and encoding pipeline
 *
 * Responsibilities:
 * - Process audio from MediaStream
 * - Manage Opus audio encoding
 * - Handle microphone switching
 * - Coordinate with StreamManager
 * - Forward encoded chunks to StreamManager
 *
 * Events:
 * - initialized: When processor is initialized
 * - started: When processing starts
 * - stopped: When processing stops
 * - configReady: When audio config is ready
 * - chunkSent: When encoded chunk is sent
 * - chunkError: When chunk sending fails
 * - encoderError: When encoder error occurs
 * - microphoneSwitched: When microphone is switched
 * - microphoneSwitchError: When microphone switch fails
 * - micStateChanged: When mic enable state changes
 * - configUpdated: When config is updated
 */
export class AudioProcessor extends EventEmitter<{
  initialized: { channelName: ChannelName };
  started: { channelName: ChannelName };
  stopped: { channelName: ChannelName };
  configReady: {
    channelName: ChannelName;
    config: AudioEncoderConfig;
  };
  chunkSent: {
    channelName: ChannelName;
    timestamp: number;
    byteLength: number;
  };
  chunkError: { channelName: ChannelName; error: unknown };
  encoderError: unknown;
  microphoneSwitched: { stream: MediaStream };
  microphoneSwitchError: unknown;
  micStateChanged: boolean;
  configUpdated: Partial<AudioEncoderConfig>;
}> {
  private audioEncoderManager: AudioEncoderManager;
  private streamManager: StreamManager;
  private channelName: ChannelName;

  private micEnabled = true;
  private isProcessing = false;

  constructor(
    audioEncoderManager: AudioEncoderManager,
    streamManager: StreamManager,
    channelName: ChannelName,
  ) {
    super();
    this.audioEncoderManager = audioEncoderManager;
    this.streamManager = streamManager;
    this.channelName = channelName;

    // Setup encoder event handlers
    this.setupEncoderHandlers();
  }

  /**
   * Setup encoder event handlers
   */
  private setupEncoderHandlers(): void {
    this.audioEncoderManager.on("configReady", async (data) => {
      console.log("[AudioProcessor] Config ready:", data);

      // Send config to server
      await this.streamManager.sendConfig(
        this.channelName,
        data.config,
        "audio",
      );

      this.audioEncoderManager.setConfigSent();
      this.emit("configReady", data);
    });

    this.audioEncoderManager.on("audioChunk", async (data) => {
      if (!this.micEnabled) {
        return;
      }

      // Check if config has been sent
      if (!this.streamManager.isConfigSent(this.channelName)) {
        return;
      }

      try {
        // Send audio chunk
        await this.streamManager.sendAudioChunk(
          this.channelName,
          data.data,
          data.timestamp,
        );

        this.emit("chunkSent", {
          channelName: this.channelName,
          timestamp: data.timestamp,
          byteLength: data.data.length,
        });
      } catch (error) {
        console.error("[AudioProcessor] Error sending chunk:", error);
        this.emit("chunkError", { channelName: this.channelName, error });
      }
    });

    this.audioEncoderManager.on("error", (error) => {
      console.error("[AudioProcessor] Encoder error:", error);
      this.emit("encoderError", error);
    });
  }

  /**
   * Initialize audio processing
   *
   * @param audioStream - MediaStream containing audio track
   */
  async initialize(audioStream: MediaStream): Promise<void> {
    if (!audioStream) {
      throw new Error("Audio stream is required");
    }

    try {
      console.log("[AudioProcessor] Initializing...");

      await this.audioEncoderManager.initialize(audioStream);

      console.log("[AudioProcessor] Initialized successfully");
      this.emit("initialized", { channelName: this.channelName });
    } catch (error) {
      console.error("[AudioProcessor] Initialization failed:", error);
      this.emit("encoderError", error);
      throw error;
    }
  }

  /**
   * Start audio processing
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      console.warn("[AudioProcessor] Already processing");
      return;
    }

    try {
      this.isProcessing = true;

      await this.audioEncoderManager.start();

      console.log("[AudioProcessor] Started successfully");
      this.emit("started", { channelName: this.channelName });
    } catch (error) {
      console.error("[AudioProcessor] Failed to start:", error);
      this.isProcessing = false;
      throw error;
    }
  }

  /**
   * Stop audio processing
   */
  async stop(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    try {
      console.log("[AudioProcessor] Stopping...");
      this.isProcessing = false;

      await this.audioEncoderManager.stop();

      console.log("[AudioProcessor] Stopped successfully");
      this.emit("stopped", { channelName: this.channelName });
    } catch (error) {
      console.error("[AudioProcessor] Error stopping:", error);
      throw error;
    }
  }

  /**
   * Switch to a different microphone
   *
   * @param audioStream - New audio stream from microphone
   */
  async switchMicrophone(audioStream: MediaStream): Promise<void> {
    if (!this.isProcessing) {
      throw new Error("Audio processor not running");
    }

    try {
      console.log("[AudioProcessor] Switching microphone...");

      // Stop current encoder
      await this.audioEncoderManager.stop();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Reinitialize with new stream
      await this.audioEncoderManager.initialize(audioStream);

      // Restart
      await this.audioEncoderManager.start();

      console.log("[AudioProcessor] Microphone switched successfully");
      this.emit("microphoneSwitched", { stream: audioStream });
    } catch (error) {
      console.error("[AudioProcessor] Failed to switch microphone:", error);
      this.emit("microphoneSwitchError", error);
      throw error;
    }
  }

  /**
   * Enable/disable microphone
   *
   * @param enabled - True to enable, false to disable
   */
  setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
    console.log(`[AudioProcessor] Microphone ${enabled ? "enabled" : "disabled"}`);
    this.emit("micStateChanged", enabled);
  }

  /**
   * Check if microphone is enabled
   *
   * @returns True if microphone is enabled
   */
  isMicEnabled(): boolean {
    return this.micEnabled;
  }

  /**
   * Get processing statistics
   *
   * @returns Processing statistics
   */
  getStats(): {
    isProcessing: boolean;
    micEnabled: boolean;
    encoderStats: ReturnType<AudioEncoderManager["getStats"]>;
  } {
    return {
      isProcessing: this.isProcessing,
      micEnabled: this.micEnabled,
      encoderStats: this.audioEncoderManager.getStats(),
    };
  }

  /**
   * Update audio configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AudioEncoderConfig>): void {
    this.audioEncoderManager.updateConfig(config);
    this.emit("configUpdated", config);
  }

  /**
   * Get channel name
   *
   * @returns Channel name
   */
  getChannelName(): ChannelName {
    return this.channelName;
  }

  /**
   * Check if config is ready
   *
   * @returns True if config is ready
   */
  isConfigReady(): boolean {
    return this.audioEncoderManager.isConfigReady();
  }

  /**
   * Check if config has been sent
   *
   * @returns True if config has been sent
   */
  isConfigSent(): boolean {
    return this.audioEncoderManager.isConfigSent();
  }

  /**
   * Check if processing is active
   *
   * @returns True if processing
   */
  isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Reset timing counters
   */
  resetTiming(): void {
    this.audioEncoderManager.resetTiming();
  }

  /**
   * Get current timestamp
   *
   * @returns Current timestamp in microseconds
   */
  getCurrentTimestamp(): number {
    return this.audioEncoderManager.getCurrentTimestamp();
  }
}
