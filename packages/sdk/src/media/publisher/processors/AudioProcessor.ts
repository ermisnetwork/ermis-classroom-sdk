import EventEmitter from "../../../events/EventEmitter";
import type {
  AudioEncoderConfig,
  ChannelName,
} from "../../../types/media/publisher.types";
import { AudioConfig } from "../../subscriber";
import { AudioEncoderManager } from "../managers/AudioEncoderManager";
import { AACEncoderManager } from "../managers/AACEncoderManager";
import { StreamManager } from "../transports/StreamManager";
import { log } from "../../../utils";

// ---------------------------------------------------------------------------
// Silence Suppression / VAD (Voice Activity Detection)
//
// Uses Web Audio API AnalyserNode to measure RMS audio level in real-time.
// When audio is below the audible threshold for a sustained period, chunks
// are suppressed (not sent) to save bandwidth.
//
// - SILENCE_THRESHOLD_DB:  Below this dB level → considered silent.  -50 dB is
//                          well below normal speech (~-30 to -10 dB).
// - SILENCE_HOLD_MS:       After voice stops, keep sending for this long to
//                          avoid clipping tail-end of words.
// - KEEPALIVE_INTERVAL_MS: Send one frame periodically during silence so the
//                          subscriber's decoder stays primed and timing stays
//                          in sync.
// ---------------------------------------------------------------------------
const SILENCE_THRESHOLD_DB  = -50;
const SILENCE_HOLD_MS       = 300;
const KEEPALIVE_INTERVAL_MS = 5_000;

/** Union type of all supported encoder managers */
type AnyEncoderManager = AudioEncoderManager | AACEncoderManager;

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
  private audioEncoderManager: AnyEncoderManager;
  private streamManager: StreamManager;
  private channelName: ChannelName;

  private micEnabled = true;
  private isProcessing = false;
  private audioTrack: MediaStreamTrack | null = null;
  // Keep stream reference to prevent garbage collection
  private audioStream: MediaStream | null = null;

  // ── Silence suppression (VAD) ────────────────────────────────────────
  private _vadEnabled = false;
  private _vadAudioCtx: AudioContext | null = null;
  private _vadSource: MediaStreamAudioSourceNode | null = null;
  private _vadAnalyser: AnalyserNode | null = null;
  private _vadTimeDomain: Float32Array | null = null;
  /** true while audio level is above threshold (or within hold period) */
  private _isSpeaking = true;
  /** Timestamp (ms) when voice was last detected above threshold */
  private _lastVoiceTime = 0;
  /** Timestamp (ms) when the last keepalive frame was sent during silence */
  private _lastKeepaliveTime = 0;

  constructor(
    audioEncoderManager: AnyEncoderManager,
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
      const isAac = data.config.codec === "mp4a.40.2";
      const config: AudioConfig = {
        codec: data.config.codec!,
        sampleRate: data.config.sampleRate,
        numberOfChannels: data.config.numberOfChannels,
        ...(data.config.description && { description: data.config.description }),
      };
      // Opus: wrap raw OGG page in Ermis packet header.
      // AAC: description is already a raw AudioSpecificConfig — send as-is.
      if (!isAac && config.description && config.description instanceof Uint8Array) {
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

      // ── Silence suppression (VAD) ──────────────────────────────────
      if (this._vadEnabled && this._vadAnalyser) {
        const speaking = this._detectVoice();
        const now = performance.now();

        if (speaking) {
          this._lastVoiceTime = now;
          if (!this._isSpeaking) {
            this._isSpeaking = true;
            log(`[AudioProcessor] 🎙️ Voice detected — resuming send`);
          }
        } else {
          // Still within hold period → keep sending
          if (this._isSpeaking && (now - this._lastVoiceTime > SILENCE_HOLD_MS)) {
            this._isSpeaking = false;
            log(`[AudioProcessor] 🔇 Silence detected — suppressing audio`);
          }
        }

        if (!this._isSpeaking) {
          // Send a keepalive frame periodically so subscriber stays in sync
          if (now - this._lastKeepaliveTime < KEEPALIVE_INTERVAL_MS) {
            return; // suppress
          }
          this._lastKeepaliveTime = now;
          // log(`[AudioProcessor] 🔇 Sending keepalive frame during silence`);
        }
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
    const isAac = configToSend.codec === "mp4a.40.2";

    // Process description if needed (add packet header for Opus only)
    if (!isAac && configToSend.description && configToSend.description instanceof Uint8Array) {
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

      // ── Setup VAD analyser ────────────────────────────────────────
      this._setupVAD(audioStream, audioContext);

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

      // Teardown VAD
      this._teardownVAD();

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

    // Reset VAD state when mic is re-enabled so first frame isn't suppressed
    if (enabled) {
      this._isSpeaking = true;
      this._lastVoiceTime = performance.now();
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
   * Enable/disable silence suppression (VAD).
   * When enabled, silent audio will not be sent to save bandwidth.
   */
  setVADEnabled(enabled: boolean): void {
    this._vadEnabled = enabled;
    if (enabled) {
      this._isSpeaking = true; // assume speaking until proven otherwise
      this._lastVoiceTime = performance.now();
    }
    log(`[AudioProcessor] VAD ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Check if VAD (silence suppression) is enabled
   */
  isVADEnabled(): boolean {
    return this._vadEnabled;
  }

  /**
   * Check if voice is currently detected
   */
  isSpeaking(): boolean {
    return this._isSpeaking;
  }

  /**
   * Get processing statistics
   *
   * @returns Processing statistics
   */
  getStats(): {
    isProcessing: boolean;
    micEnabled: boolean;
    encoderStats: ReturnType<AnyEncoderManager["getStats"]>;
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

  // ── VAD internals ──────────────────────────────────────────────────────

  /**
   * Setup AnalyserNode for real-time audio level detection.
   * Creates a separate AudioContext (or reuses the provided one) and connects
   * an AnalyserNode to the mic stream.  The analyser is sampled on each
   * audioChunk callback — no extra timer needed.
   */
  private _setupVAD(audioStream: MediaStream, audioContext?: AudioContext): void {
    try {
      const ACtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      if (!ACtor) {
        log("[AudioProcessor] AudioContext not available — VAD disabled");
        this._vadEnabled = false;
        return;
      }

      // Reuse existing context or create a lightweight one
      this._vadAudioCtx = audioContext ?? new ACtor({ sampleRate: 48000 });

      this._vadAnalyser = this._vadAudioCtx!.createAnalyser();
      // Small FFT for fast RMS calculation — we don't need frequency detail
      this._vadAnalyser.fftSize = 256;
      this._vadTimeDomain = new Float32Array(this._vadAnalyser.fftSize);

      this._vadSource = this._vadAudioCtx!.createMediaStreamSource(audioStream);
      this._vadSource.connect(this._vadAnalyser);
      // Do NOT connect analyser to destination — we don't want to play back

      this._isSpeaking = true;
      this._lastVoiceTime = performance.now();
      this._lastKeepaliveTime = 0;

      log("[AudioProcessor] VAD analyser initialized");
    } catch (err) {
      console.warn("[AudioProcessor] Failed to setup VAD analyser:", err);
      this._vadEnabled = false;
    }
  }

  /**
   * Teardown VAD resources.
   */
  private _teardownVAD(): void {
    this._vadSource?.disconnect();
    this._vadAnalyser?.disconnect();
    // Only close the AudioContext if we created it ourselves
    // (don't close if it was provided externally)
    this._vadSource = null;
    this._vadAnalyser = null;
    this._vadTimeDomain = null;
    this._vadAudioCtx = null;
  }

  /**
   * Detect voice activity by computing RMS of the time-domain signal.
   * Returns true if audio level is above SILENCE_THRESHOLD_DB.
   */
  private _detectVoice(): boolean {
    if (!this._vadAnalyser || !this._vadTimeDomain) return true; // fail-open

    this._vadAnalyser.getFloatTimeDomainData(this._vadTimeDomain);

    // Compute RMS (Root Mean Square)
    let sumSq = 0;
    for (let i = 0; i < this._vadTimeDomain.length; i++) {
      const v = this._vadTimeDomain[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this._vadTimeDomain.length);

    // Convert to dB (relative to full-scale 1.0)
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;

    return db > SILENCE_THRESHOLD_DB;
  }
}
