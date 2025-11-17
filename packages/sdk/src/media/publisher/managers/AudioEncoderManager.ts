import EventEmitter from "../../../events/EventEmitter";
import { AUDIO_CONFIG } from "../../../types/media/constants";
import type {
  ChannelName,
  AudioEncoderConfig,
  InitAudioRecorder,
  AudioRecorder,
} from "../../../types/media/publisher.types";

/**
 * AudioEncoderManager - Manages audio encoding using Opus codec
 *
 * Responsibilities:
 * - Initialize Opus audio encoder
 * - Process and encode audio chunks
 * - Manage timing and synchronization
 * - Handle audio configuration
 * - Track encoding state and statistics
 *
 * Events:
 * - initialized: When audio recorder is initialized
 * - started: When recording starts
 * - stopped: When recording stops
 * - configReady: When Opus configuration is available
 * - audioChunk: When encoded audio chunk is ready
 * - error: When an error occurs
 */
export class AudioEncoderManager extends EventEmitter<{
  initialized: { channelName: ChannelName };
  started: { channelName: ChannelName };
  stopped: { channelName: ChannelName };
  configReady: {
    channelName: ChannelName;
    config: AudioEncoderConfig;
  };
  audioChunk: {
    channelName: ChannelName;
    data: Uint8Array;
    timestamp: number;
    samplesSent: number;
    chunkCount: number;
  };
  error: unknown;
}> {
  private audioRecorder: AudioRecorder | null = null;
  private initAudioRecorder: InitAudioRecorder;
  private channelName: ChannelName;
  private config: AudioEncoderConfig;

  // Timing management
  private baseTime = 0;
  private samplesSent = 0;
  private chunkCount = 0;

  // Configuration
  private configReady = false;
  private audioConfig: AudioEncoderConfig | null = null;

  constructor(
    channelName: ChannelName,
    config: AudioEncoderConfig,
    initAudioRecorderFunc: InitAudioRecorder,
  ) {
    super();
    this.channelName = channelName;
    this.config = config;
    this.initAudioRecorder = initAudioRecorderFunc;
  }

  /**
   * Initialize audio recorder with Opus encoding
   *
   * @param audioStream - MediaStream containing audio track
   */
  async initialize(audioStream: MediaStream): Promise<void> {
    if (!audioStream) {
      throw new Error("Audio stream is required");
    }

    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error("No audio track found in stream");
    }

    try {
      const audioRecorderOptions = {
        encoderApplication: 2051, // VOIP application
        encoderComplexity: 0, // Lowest complexity for real-time
        encoderFrameSize: 20, // 20ms frames
        timeSlice: 100, // Send data every 100ms
      };

      console.log(
        `[AudioEncoder] Initializing recorder for ${this.channelName}`,
      );

      if (!this.initAudioRecorder || typeof this.initAudioRecorder !== 'function') {
        throw new Error(`initAudioRecorder is not a function: ${typeof this.initAudioRecorder}`);
      }

      this.audioRecorder = await this.initAudioRecorder(
        audioStream,
        audioRecorderOptions,
      );

      this.audioRecorder.ondataavailable = (event: any) => {
        const data = event?.data || event;
        this.handleAudioData(data);
      };

      console.log(
        `[AudioEncoder] Recorder initialized for ${this.channelName}`,
      );
      this.emit("initialized", { channelName: this.channelName });
    } catch (error) {
      console.error(
        `[AudioEncoder] Failed to initialize ${this.channelName}:`,
        error,
      );
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Start audio recording
   */
  async start(): Promise<void> {
    if (!this.audioRecorder) {
      throw new Error("Audio recorder not initialized");
    }

    try {
      this.audioRecorder.start();

      // Reset timing
      this.baseTime = 0;
      this.samplesSent = 0;
      this.chunkCount = 0;

      console.log(`[AudioEncoder] Started recording on ${this.channelName}`);
      this.emit("started", { channelName: this.channelName });
    } catch (error) {
      console.error(
        `[AudioEncoder] Failed to start ${this.channelName}:`,
        error,
      );
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Stop audio recording
   */
  async stop(): Promise<void> {
    if (!this.audioRecorder) {
      return;
    }

    try {
      this.audioRecorder.stop();

      this.audioRecorder = null;
      this.baseTime = 0;
      this.samplesSent = 0;
      this.chunkCount = 0;
      this.configReady = false;
      this.audioConfig = null;

      console.log(`[AudioEncoder] Stopped recording on ${this.channelName}`);
      this.emit("stopped", { channelName: this.channelName });
    } catch (error) {
      console.error(
        `[AudioEncoder] Error stopping ${this.channelName}:`,
        error,
      );
    }
  }

  /**
   * Handle incoming audio data from Opus encoder
   *
   * @param typedArray - Encoded audio data
   */
  private handleAudioData(typedArray: Uint8Array): void {
    if (!typedArray || typedArray.byteLength === 0) {
      return;
    }

    const dataArray = new Uint8Array(typedArray);

    // Check for Opus header "OggS"
    const isOpusHeader =
      dataArray.length >= 4 &&
      dataArray[0] === 79 && // 'O'
      dataArray[1] === 103 && // 'g'
      dataArray[2] === 103 && // 'g'
      dataArray[3] === 83; // 'S'

    if (isOpusHeader) {
      // First chunk contains Opus configuration
      if (!this.configReady && !this.audioConfig) {
        this.audioConfig = {
          codec: "opus",
          sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
          numberOfChannels: AUDIO_CONFIG.CHANNEL_COUNT,
          description: dataArray,
        };

        console.log(`[AudioEncoder] Config ready for ${this.channelName}:`, {
          codec: this.audioConfig.codec,
          sampleRate: this.audioConfig.sampleRate,
          numberOfChannels: this.audioConfig.numberOfChannels,
        });

        this.emit("configReady", {
          channelName: this.channelName,
          config: this.audioConfig,
        });

        return;
      }

      // Initialize timing on first audio chunk after config
      if (this.baseTime === 0) {
        // Sync with video if available
        const globalWindow = window as {
          videoBaseTimestamp?: number;
          audioStartPerfTime?: number;
        };
        if (globalWindow.videoBaseTimestamp) {
          this.baseTime = globalWindow.videoBaseTimestamp;
          globalWindow.audioStartPerfTime = performance.now();
        } else {
          this.baseTime = performance.now() * 1000;
        }

        this.samplesSent = 0;
        this.chunkCount = 0;

        console.log(
          `[AudioEncoder] Initialized timing for ${this.channelName}, baseTime: ${this.baseTime}`,
        );
      }

      // Calculate timestamp based on samples sent
      const timestamp =
        this.baseTime +
        Math.floor((this.samplesSent * 1000000) / AUDIO_CONFIG.SAMPLE_RATE);

      // Emit audio chunk with metadata
      this.emit("audioChunk", {
        channelName: this.channelName,
        data: dataArray,
        timestamp,
        samplesSent: this.samplesSent,
        chunkCount: this.chunkCount,
      });

      // Update counters
      this.samplesSent += AUDIO_CONFIG.OPUS_SAMPLES_PER_CHUNK;
      this.chunkCount++;
    }
  }

  /**
   * Mark config as sent to server
   */
  setConfigSent(): void {
    this.configReady = true;
    console.log(`[AudioEncoder] Config marked as sent for ${this.channelName}`);
  }

  /**
   * Check if config is ready
   *
   * @returns True if config is ready
   */
  isConfigReady(): boolean {
    return this.audioConfig !== null;
  }

  /**
   * Check if config has been sent
   *
   * @returns True if config has been sent
   */
  isConfigSent(): boolean {
    return this.configReady;
  }

  /**
   * Get audio configuration
   *
   * @returns Audio encoder configuration
   */
  getConfig(): AudioEncoderConfig | null {
    return this.audioConfig;
  }

  /**
   * Get statistics
   *
   * @returns Encoder statistics
   */
  getStats(): {
    channelName: string;
    baseTime: number;
    samplesSent: number;
    chunkCount: number;
    configReady: boolean;
    isRecording: boolean;
  } {
    return {
      channelName: this.channelName,
      baseTime: this.baseTime,
      samplesSent: this.samplesSent,
      chunkCount: this.chunkCount,
      configReady: this.configReady,
      isRecording: this.audioRecorder !== null,
    };
  }

  /**
   * Reset timing counters
   */
  resetTiming(): void {
    this.baseTime = 0;
    this.samplesSent = 0;
    this.chunkCount = 0;
    console.log(`[AudioEncoder] Timing reset for ${this.channelName}`);
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AudioEncoderConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(
      `[AudioEncoder] Config updated for ${this.channelName}:`,
      this.config,
    );
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
   * Check if recorder is active
   *
   * @returns True if recording
   */
  isRecording(): boolean {
    return this.audioRecorder !== null;
  }

  /**
   * Get current timestamp
   *
   * @returns Current timestamp in microseconds
   */
  getCurrentTimestamp(): number {
    if (this.baseTime === 0) {
      return 0;
    }
    return (
      this.baseTime +
      Math.floor((this.samplesSent * 1000000) / AUDIO_CONFIG.SAMPLE_RATE)
    );
  }

  /**
   * Get samples sent count
   *
   * @returns Number of samples sent
   */
  getSamplesSent(): number {
    return this.samplesSent;
  }

  /**
   * Get chunk count
   *
   * @returns Number of chunks sent
   */
  getChunkCount(): number {
    return this.chunkCount;
  }
}
