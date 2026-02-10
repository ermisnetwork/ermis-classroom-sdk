import EventEmitter from "../../../events/EventEmitter";
import type {
  AudioEncoderConfig,
  ChannelName,
} from "../../../types/media/publisher.types";
import { AudioConfig } from "../../subscriber";
import { AudioEncoderManager } from "../managers/AudioEncoderManager";
import { StreamManager } from "../transports/StreamManager";
import { log } from "../../../utils";

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
  private audioTrack: MediaStreamTrack | null = null;
  // Keep stream reference to prevent garbage collection
  private audioStream: MediaStream | null = null;

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
      // Wrap description in packet header.
      const config: AudioConfig = {
        codec: data.config.codec!,
        sampleRate: data.config.sampleRate,
        numberOfChannels: data.config.numberOfChannels,
        ...(data.config.description && { description: data.config.description }),
      };
      if (config.description && config.description instanceof Uint8Array) {
        const packetWithHeader = this.streamManager.createAudioConfigPacket(
          this.channelName,
          config.description,
        );
        config.description = packetWithHeader;
      }

      // Send config to server
      await this.streamManager.sendConfig(this.channelName, config, "audio");

      this.audioEncoderManager.setConfigSent();
      this.emit("configReady", data);
    });

    this.audioEncoderManager.on("audioChunk", async (data) => {
      // DEBUG: Log audio chunk reception
      // log(`[AudioProcessor] 🎤 Audio chunk received - micEnabled: ${this.micEnabled}, timestamp: ${data.timestamp}, size: ${data.data.length}`);

      if (!this.micEnabled) {
        // log(`[AudioProcessor] ⏭️ Skipping audio chunk - mic is disabled`);
        return;
      }

      // Check if config has been sent
      const configSent = this.streamManager.isConfigSent(this.channelName);
      if (!configSent) {
        log(`[AudioProcessor] ⏭️ Skipping audio chunk - config not sent yet for ${this.channelName}`);
        return;
      }

      try {
        // log(`[AudioProcessor] 📤 Sending audio chunk to StreamManager for ${this.channelName}`);
        // Send audio chunk
        await this.streamManager.sendAudioChunk(
          this.channelName,
          data.data,
          data.timestamp,
        );

        // log(`[AudioProcessor] ✅ Audio chunk sent successfully, bytes: ${data.data.length}`);
        this.emit("chunkSent", {
          channelName: this.channelName,
          timestamp: data.timestamp,
          byteLength: data.data.length,
        });
      } catch (error) {
        // ? add exception handling for microphone banned
        // console.error("[AudioProcessor] Error sending chunk:", error);
        this.emit("chunkError", { channelName: this.channelName, error });
      }
    });

    this.audioEncoderManager.on("error", (error) => {
      console.error("[AudioProcessor] Encoder error:", error);
      this.emit("encoderError", error);
    });
  }

  /**
   * Resend audio configuration from saved state
   * Used when reconnecting streams after unban
   */
  async resendConfig(): Promise<void> {
    const savedConfig = this.audioEncoderManager.getConfig();
    if (!savedConfig) {
      log(`[AudioProcessor] ⚠️ No saved config for ${this.channelName}, valid config will be captured from next chunks`);
      return;
    }

    log(`[AudioProcessor] Resending saved audio config for ${this.channelName}...`);

    // Copy config to avoid modifying original
    const configToSend = { ...savedConfig };

    // Process description if needed (add packet header)
    // Process description if needed (add packet header)
    if (configToSend.description && configToSend.description instanceof Uint8Array) {
      // Always wrap the raw OggS header in an Ermis packet, matching setupEncoderHandlers logic
      const packetWithHeader = this.streamManager.createAudioConfigPacket(
        this.channelName,
        configToSend.description,
      );
      configToSend.description = packetWithHeader;
    }

    // Send config to server
    await this.streamManager.sendConfig(
      this.channelName,
      {
        codec: configToSend.codec!,
        sampleRate: configToSend.sampleRate,
        numberOfChannels: configToSend.numberOfChannels,
        ...(configToSend.description && { description: configToSend.description }),
      },
      "audio"
    );

    this.audioEncoderManager.setConfigSent();
    log(`[AudioProcessor] ✅ Audio config resent for ${this.channelName}`);
  }

  /**
   * Initialize audio processing
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.

   *
   * @param audioStream - MediaStream containing audio track
   */
  async initialize(audioStream: MediaStream, audioContext?: AudioContext): Promise<void> {
    if (!audioStream) {
      throw new Error("Audio stream is required");
    }

    try {
      log("[AudioProcessor] Initializing...");

      // CRITICAL: Store stream reference to prevent garbage collection
      // This fixes "MediaStreamTrack was destroyed" error
      this.audioStream = audioStream;

      // Store audio track reference for enabling/disabling
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.audioTrack = audioTracks[0];
        // Sync initial micEnabled state with track's enabled state
        this.micEnabled = this.audioTrack.enabled;
        log("[AudioProcessor] Initial mic enabled state:", this.micEnabled);
      }

      await this.audioEncoderManager.initialize(audioStream, audioContext);

      log("[AudioProcessor] Initialized successfully");
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

      log("[AudioProcessor] Started successfully");
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
      log("[AudioProcessor] Stopping...");
      this.isProcessing = false;

      await this.audioEncoderManager.stop();

      // Clear stream reference
      this.audioStream = null;
      this.audioTrack = null;

      log("[AudioProcessor] Stopped successfully");
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
      log("[AudioProcessor] Switching microphone...");

      // Stop current encoder
      await this.audioEncoderManager.stop();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Reinitialize with new stream
      await this.audioEncoderManager.initialize(audioStream);

      // Restart
      await this.audioEncoderManager.start();

      log("[AudioProcessor] Microphone switched successfully");
      this.emit("microphoneSwitched", { stream: audioStream });
    } catch (error) {
      console.error("[AudioProcessor] Failed to switch microphone:", error);
      this.emit("microphoneSwitchError", error);
      throw error;
    }
  }

  /**
   * Switch audio track without reinitializing the encoder
   * More efficient than switchMicrophone() for quick device changes
   *
   * @param track - New audio track to use
   */
  async switchAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.isProcessing) {
      throw new Error("Audio processor not running");
    }

    if (!track || track.kind !== "audio") {
      throw new Error("Valid audio track is required");
    }

    try {
      log("[AudioProcessor] Switching audio track...");

      // Create new stream with the track
      const newStream = new MediaStream([track]);

      // Use the switchMicrophone method for now
      // TODO: In future, implement direct track replacement in encoder
      await this.switchMicrophone(newStream);

      log("[AudioProcessor] Audio track switched successfully");
    } catch (error) {
      console.error("[AudioProcessor] Failed to switch audio track:", error);
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

    // Also toggle the actual MediaStreamTrack's enabled property
    if (this.audioTrack) {
      this.audioTrack.enabled = enabled;
      log(`[AudioProcessor] Audio track enabled set to: ${enabled}`);
    }

    log(`[AudioProcessor] Microphone ${enabled ? "enabled" : "disabled"}`);
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
