import EventEmitter from "../../../events/EventEmitter";
import type {
  ChannelName,
  AudioEncoderConfig,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";

/**
 * AAC Audio Configuration Constants
 */
const AAC_CONFIG = {
  SAMPLE_RATE: 48000,
  CHANNEL_COUNT: 2, // Stereo for better HLS compatibility
  BITRATE: 128000, // 128kbps for good quality AAC
  SAMPLES_PER_FRAME: 1024, // AAC frame size
} as const;

/**
 * AACEncoderManager - Manages audio encoding using AAC codec for HLS livestream
 *
 * Uses Web Audio API's native AudioEncoder with AAC codec (mp4a.40.2)
 * for HLS compatibility instead of Opus.
 *
 * Responsibilities:
 * - Initialize AAC audio encoder
 * - Process and encode audio chunks
 * - Manage timing and synchronization
 * - Handle audio configuration
 * - Track encoding state and statistics
 *
 * Events:
 * - initialized: When audio encoder is initialized
 * - started: When encoding starts
 * - stopped: When encoding stops
 * - configReady: When AAC configuration is available
 * - audioChunk: When encoded audio chunk is ready
 * - error: When an error occurs
 */
export class AACEncoderManager extends EventEmitter<{
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
  private audioEncoder: AudioEncoder | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private channelName: ChannelName;
  private config: AudioEncoderConfig;
  private audioStream: MediaStream | null = null;

  // Timing management
  private baseTime = 0;
  private samplesSent = 0;
  private chunkCount = 0;

  // Configuration
  private configReady = false;
  private audioConfig: AudioEncoderConfig | null = null;
  private isEncoding = false;

  constructor(channelName: ChannelName, config: AudioEncoderConfig) {
    super();
    this.channelName = channelName;
    this.config = config;
  }

  /**
   * Check if AAC encoding is supported by the browser
   */
  static isSupported(): boolean {
    return typeof AudioEncoder !== "undefined";
  }

  /**
   * Initialize AAC audio encoder
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

    if (!AACEncoderManager.isSupported()) {
      throw new Error("AudioEncoder API is not supported in this browser");
    }

    try {
      // Store stream reference
      this.audioStream = audioStream;

      // Create AudioContext for processing
      this.audioContext = new AudioContext({
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
      });

      // Create AAC encoder
      this.audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => {
          this.handleEncodedChunk(chunk, metadata);
        },
        error: (error) => {
          console.error(`[AACEncoder] Encoder error:`, error);
          this.emit("error", error);
        },
      });

      // Configure encoder with AAC codec
      const encoderConfig: AudioEncoderConfig & { codec: string; bitrate: number } = {
        codec: "mp4a.40.2", // AAC-LC
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
        numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
        bitrate: AAC_CONFIG.BITRATE,
      };

      // Check if AAC is supported
      const support = await AudioEncoder.isConfigSupported(encoderConfig);
      if (!support.supported) {
        throw new Error("AAC codec configuration not supported");
      }

      this.audioEncoder.configure(encoderConfig);

      // Store config with codec info
      this.audioConfig = {
        codec: "mp4a.40.2",
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
        numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
      };

      log(`[AACEncoder] Initialized for ${this.channelName}`);
      this.emit("initialized", { channelName: this.channelName });
    } catch (error) {
      console.error(
        `[AACEncoder] Failed to initialize ${this.channelName}:`,
        error
      );
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Start audio encoding
   */
  async start(): Promise<void> {
    if (!this.audioEncoder || !this.audioContext || !this.audioStream) {
      throw new Error("Audio encoder not initialized");
    }

    try {
      // Resume AudioContext if it's suspended (browsers policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Load AudioWorklet module
      // Assuming the worker file is served at /workers/audio-worklet.js
      try {
        await this.audioContext.audioWorklet.addModule("/workers/audio-worklet.js");
      } catch (e) {
        console.warn("[AACEncoder] Failed to load audio-worklet.js, trying relative path...", e);
        // Fallback or retry logic if needed, but for now we assume standard path
      }

      // Create media stream source
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(
        this.audioStream
      );

      // Create AudioWorkletNode
      this.audioWorkletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-capture-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [AAC_CONFIG.CHANNEL_COUNT], // Stereo output
          processorOptions: {
            bufferSize: 4096,
          },
        }
      );

      // Handle messages from worklet
      this.audioWorkletNode.port.onmessage = (event) => {
        if (!this.isEncoding || !this.audioEncoder) return;

        const { type, planarData } = event.data;

        if (type === 'audioData' && planarData) {
          this.processAudioChunk(planarData);
        }
      };

      this.audioWorkletNode.onprocessorerror = (err) => {
        console.error(`[AACEncoder] AudioWorklet processor error:`, err);
        this.emit("error", err);
      };

      // Connect the audio graph
      this.mediaStreamSource.connect(this.audioWorkletNode);
      this.audioWorkletNode.connect(this.audioContext.destination); // Needed to keep processor alive

      // Reset timing
      this.baseTime = performance.now() * 1000; // Convert to microseconds
      this.samplesSent = 0;
      this.chunkCount = 0;
      this.isEncoding = true;

      this.emit("started", { channelName: this.channelName });
      log(`[AACEncoder] Started for ${this.channelName} using AudioWorklet`);
    } catch (error) {
      console.error(`[AACEncoder] Failed to start ${this.channelName}:`, error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Process audio chunk from worklet
   */
  private processAudioChunk(planarChannelBuffers: Float32Array[]): void {
    if (!this.audioEncoder) return;

    const numberOfChannels = planarChannelBuffers.length;
    const numberOfFrames = planarChannelBuffers[0].length;
    
    // Flatten planar data for AudioData (all channels sequentially)
    const totalLength = numberOfFrames * numberOfChannels;
    const planarData = new Float32Array(totalLength);
    
    for (let ch = 0; ch < numberOfChannels; ch++) {
       planarData.set(planarChannelBuffers[ch], ch * numberOfFrames);
    }

    try {
      // Create AudioData from the input buffer
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
        numberOfFrames: numberOfFrames,
        numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
        timestamp: this.getCurrentTimestamp(),
        data: planarData.buffer as ArrayBuffer,
      });

      this.audioEncoder.encode(audioData);
      audioData.close();

      this.samplesSent += numberOfFrames;
    } catch (error) {
      console.error(`[AACEncoder] Encode error:`, error);
    }
  }

  /**
   * Handle encoded AAC chunk from encoder
   */
  private handleEncodedChunk(
    chunk: EncodedAudioChunk,
    metadata?: EncodedAudioChunkMetadata
  ): void {
    // Get the encoded data
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    // Handle first chunk with config (description)
    if (metadata?.decoderConfig?.description && !this.configReady) {
      const description = new Uint8Array(
        metadata.decoderConfig.description as ArrayBuffer
      );

      this.audioConfig = {
        codec: "mp4a.40.2",
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
        numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
        description: description,
      };

      this.emit("configReady", {
        channelName: this.channelName,
        config: this.audioConfig,
      });

      this.configReady = true;
      log(`[AACEncoder] AAC config with description ready for ${this.channelName}`);
    }

    // Emit audio chunk
    this.emit("audioChunk", {
      channelName: this.channelName,
      data: data,
      timestamp: chunk.timestamp,
      samplesSent: this.samplesSent,
      chunkCount: this.chunkCount,
    });

    this.chunkCount++;
  }

  /**
   * Stop audio encoding
   */
  async stop(): Promise<void> {
    this.isEncoding = false;

    try {
      // Disconnect audio graph
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.onmessage = null;
        this.audioWorkletNode.disconnect();
        this.audioWorkletNode = null;
      }

      if (this.mediaStreamSource) {
        this.mediaStreamSource.disconnect();
        this.mediaStreamSource = null;
      }

      // Flush and close encoder
      if (this.audioEncoder && this.audioEncoder.state !== "closed") {
        await this.audioEncoder.flush();
        this.audioEncoder.close();
      }
      this.audioEncoder = null;

      // Close audio context
      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close();
      }
      this.audioContext = null;

      // Clear stream reference
      this.audioStream = null;

      // Reset state
      this.baseTime = 0;
      this.samplesSent = 0;
      this.chunkCount = 0;
      this.configReady = false;
      this.audioConfig = null;

      this.emit("stopped", { channelName: this.channelName });
      log(`[AACEncoder] Stopped for ${this.channelName}`);
    } catch (error) {
      console.error(`[AACEncoder] Error stopping ${this.channelName}:`, error);
    }
  }

  /**
   * Mark config as sent to server
   */
  setConfigSent(): void {
    this.configReady = true;
    log(`[AACEncoder] Config marked as sent for ${this.channelName}`);
  }

  /**
   * Check if config is ready
   */
  isConfigReady(): boolean {
    return this.audioConfig !== null;
  }

  /**
   * Check if config has been sent
   */
  isConfigSent(): boolean {
    return this.configReady;
  }

  /**
   * Get audio configuration
   */
  getConfig(): AudioEncoderConfig | null {
    return this.audioConfig;
  }

  /**
   * Get statistics
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
      isRecording: this.isEncoding,
    };
  }

  /**
   * Reset timing counters
   */
  resetTiming(): void {
    this.baseTime = 0;
    this.samplesSent = 0;
    this.chunkCount = 0;
    log(`[AACEncoder] Timing reset for ${this.channelName}`);
  }

  /**
   * Get channel name
   */
  getChannelName(): ChannelName {
    return this.channelName;
  }

  /**
   * Check if encoder is active
   */
  isRecording(): boolean {
    return this.isEncoding;
  }

  /**
   * Get current timestamp in microseconds
   */
  getCurrentTimestamp(): number {
    if (this.baseTime === 0) {
      return 0;
    }
    return Math.floor(
      this.baseTime + (this.samplesSent * 1000000) / AAC_CONFIG.SAMPLE_RATE
    );
  }

  /**
   * Get samples sent count
   */
  getSamplesSent(): number {
    return this.samplesSent;
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunkCount;
  }
}
