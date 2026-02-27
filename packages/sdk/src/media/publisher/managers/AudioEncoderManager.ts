import EventEmitter from "../../../events/EventEmitter";
import { AUDIO_CONFIG } from "../../../constants/mediaConstants";
import type {
  ChannelName,
  AudioEncoderConfig,
  InitAudioRecorder,
  AudioRecorder,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";

// ---------------------------------------------------------------------------
// OGG BOS page normalization — iOS 15 Safari fix
//
// Safari iOS 15: Recorder.js WASM encoder does not reset its internal OGG
// page counter between sessions. When audio+video are published together the
// first OGG page (OpusHead BOS) arrives with a non-zero page_sequence (e.g.
// 23) and granule_position = -1 instead of the required 0 for both fields
// per RFC 7845. Aurora.js (decoderWorker.min.js) rejects such a malformed
// BOS page → completely silent audio on the receiver side.
//
// Fix: detect the malformed BOS page, patch it to spec-compliant values,
// store the sequence offset, and renumber all subsequent OGG pages so the
// stream is contiguous: BOS(seq=0), Tags(seq=1), Audio(seq=2, 3, …)
// ---------------------------------------------------------------------------

/** OGG CRC-32/MPEG-2 lookup table (computed once at module load). */
const _oggCrcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = (i << 24) >>> 0;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) ? (((r << 1) >>> 0) ^ 0x04c11db7) : ((r << 1) >>> 0);
    }
    t[i] = r;
  }
  return t;
})();

/** Compute OGG CRC-32/MPEG-2 over a page (CRC field must already be zeroed). */
function _oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < page.length; i++) {
    crc = (((crc << 8) >>> 0) ^ _oggCrcTable[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0;
  }
  return crc;
}

/**
 * Return a patched copy of an OGG page with a new page_sequence number
 * (and optionally granule_position zeroed) and a recomputed CRC checksum.
 */
function _patchOggPage(page: Uint8Array, newSeq: number, zeroGranule: boolean): Uint8Array {
  const p = new Uint8Array(page);
  if (zeroGranule) {
    for (let i = 6; i < 14; i++) p[i] = 0;      // granule_position (LE int64) = 0
  }
  p[18] =  newSeq        & 0xff;                  // page_sequence (LE uint32)
  p[19] = (newSeq >>>  8) & 0xff;
  p[20] = (newSeq >>> 16) & 0xff;
  p[21] = (newSeq >>> 24) & 0xff;
  p[22] = 0; p[23] = 0; p[24] = 0; p[25] = 0;   // zero CRC field before computing
  const crc = _oggCrc(p);
  p[22] = (crc >>> 24) & 0xff;
  p[23] = (crc >>> 16) & 0xff;
  p[24] = (crc >>>  8) & 0xff;
  p[25] =  crc         & 0xff;
  return p;
}

/** Read page_sequence (bytes 18-21, LE uint32) from a raw OGG page. */
function _readOggSeq(page: Uint8Array): number {
  return (page[18] | (page[19] << 8) | (page[20] << 16) | (page[21] << 24)) >>> 0;
}

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
  // Keep stream reference to prevent garbage collection
  private audioStream: MediaStream | null = null;

  // Timing management
  private baseTime = 0;
  private samplesSent = 0;
  private chunkCount = 0;

  // Configuration
  private configReady = false;
  private audioConfig: AudioEncoderConfig | null = null;
  
  // Buffer for audio pages received before OpusHead BOS page
  private pendingAudioPages: Uint8Array[] = [];

  // OGG sequence offset for iOS 15 BOS page normalization.
  // Stores the original page_sequence of the malformed BOS page so that
  // all subsequent OGG pages can be renumbered to start from seq=1.
  private _oggSeqOffset = 0;

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
   * @param audioContext - Optional pre-resumed AudioContext (required for iOS 15
   *   where resume() must happen within user gesture before any await)
   */
  async initialize(audioStream: MediaStream, audioContext?: AudioContext): Promise<void> {
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
        numberOfChannels: AUDIO_CONFIG.CHANNEL_COUNT,
        encoderBitrate: AUDIO_CONFIG.BITRATE,
      };

      if (!this.initAudioRecorder || typeof this.initAudioRecorder !== 'function') {
        throw new Error(`initAudioRecorder is not a function: ${typeof this.initAudioRecorder}`);
      }

      // CRITICAL: Store stream reference to prevent garbage collection
      this.audioStream = audioStream;

      this.audioRecorder = await this.initAudioRecorder(
        audioStream,
        audioRecorderOptions,
        audioContext,
      );

      this.audioRecorder.ondataavailable = (event: any) => {
        const data = event?.data || event;
        this.handleAudioData(data);
      };

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
      // CRITICAL: Must pass timeSlice to emit ondataavailable every 100ms
      // Without this, the recorder may only emit data at the end or stop after 2 chunks
      this.audioRecorder.start();

      // Reset timing
      this.baseTime = 0;
      this.samplesSent = 0;
      this.chunkCount = 0;

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
      this.audioStream = null; // Clear stream reference
      this.baseTime = 0;
      this.samplesSent = 0;
      this.chunkCount = 0;
      this.configReady = false;
      this.audioConfig = null;
      this._oggSeqOffset = 0;

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
    // Debug: log every call to handleAudioData
    // log(`[AudioEncoder] handleAudioData called for ${this.channelName}, size: ${typedArray?.byteLength || 0}, chunk#: ${this.chunkCount + 1}`);

    if (!typedArray || typedArray.byteLength === 0) {
      console.warn(`[AudioEncoder] Empty data received for ${this.channelName}`);
      return;
    }

    const dataArray = new Uint8Array(typedArray);

    // Check for OggS page with BOS flag and OpusHead payload
    // OggS structure:
    // - Bytes 0-3: "OggS" magic
    // - Byte 5: Header type (bit 1 = BOS flag)
    // - Bytes 28-35: Payload start (should be "OpusHead" for config page)
    const isOggS =
      dataArray.length >= 4 &&
      dataArray[0] === 79 && // 'O'
      dataArray[1] === 103 && // 'g'
      dataArray[2] === 103 && // 'g'
      dataArray[3] === 83; // 'S'
    
    // Check BOS flag (bit 1 of header type at byte 5)
    const hasBOS = dataArray.length > 5 && (dataArray[5] & 0x02) !== 0;
    
    // Check for OpusHead signature at position 28 ("OpusHead")
    const hasOpusHead = dataArray.length >= 36 &&
      dataArray[28] === 0x4f && // 'O'
      dataArray[29] === 0x70 && // 'p'
      dataArray[30] === 0x75 && // 'u'
      dataArray[31] === 0x73 && // 's'
      dataArray[32] === 0x48 && // 'H'
      dataArray[33] === 0x65 && // 'e'
      dataArray[34] === 0x61 && // 'a'
      dataArray[35] === 0x64;   // 'd'

    // Only treat as config if it's an OggS page with BOS flag AND OpusHead payload
    const isOpusConfigPage = isOggS && hasBOS && hasOpusHead;

    if (isOpusConfigPage) {
      // This is the genuine OpusHead BOS page - use for config
      if (!this.configReady && !this.audioConfig) {
        // iOS 15 Safari fix: Recorder.js WASM encoder sometimes produces the
        // BOS page with page_sequence != 0 and granule_position = -1 when
        // audio and video are published simultaneously. Patch to valid values.
        const bosSeq = _readOggSeq(dataArray);
        const granuleNonZero = dataArray.slice(6, 14).some(b => b !== 0);
        let description: Uint8Array = dataArray;
        if (bosSeq !== 0 || granuleNonZero) {
          log(`[AudioEncoder] iOS 15: fixing malformed OGG BOS page for ${this.channelName} (page_seq=${bosSeq}, granule_non_zero=${granuleNonZero})`);
          this._oggSeqOffset = bosSeq;
          description = _patchOggPage(dataArray, 0, granuleNonZero);
        }
        this.audioConfig = {
          codec: "opus",
          sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
          numberOfChannels: AUDIO_CONFIG.CHANNEL_COUNT,
          description,
        };

        log(`[AudioEncoder] Config ready for ${this.channelName} (BOS OpusHead page, ${dataArray.length} bytes):`, {
          codec: this.audioConfig.codec,
          sampleRate: this.audioConfig.sampleRate,
          numberOfChannels: this.audioConfig.numberOfChannels,
        });

        this.emit("configReady", {
          channelName: this.channelName,
          config: this.audioConfig,
        });

        // Replay any buffered audio pages now that config is ready
        if (this.pendingAudioPages.length > 0) {
          log(`[AudioEncoder] Replaying ${this.pendingAudioPages.length} buffered audio pages`);
          for (const bufferedPage of this.pendingAudioPages) {
            this.handleAudioData(bufferedPage);
          }
          this.pendingAudioPages = [];
        }

        // Don't return - continue to send this chunk after config is sent
      }
    } else if (isOggS) {
      // OggS page but NOT config page (audio data or OpusTags)
      // If we haven't received config yet, buffer this page
      if (!this.configReady && !this.audioConfig) {
        this.pendingAudioPages.push(dataArray);
        return; // Wait for config before processing
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

        log(
          `[AudioEncoder] Initialized timing for ${this.channelName}, baseTime: ${this.baseTime}`,
        );
      }

      // Calculate timestamp based on samples sent
      const timestamp =
        this.baseTime +
        Math.floor((this.samplesSent * 1000000) / AUDIO_CONFIG.SAMPLE_RATE);

      // Renumber OGG page_sequence if the BOS page was patched (iOS 15 fix)
      const audioPage = this._oggSeqOffset > 0
        ? _patchOggPage(dataArray, _readOggSeq(dataArray) - this._oggSeqOffset, false)
        : dataArray;

      // Emit audio chunk with metadata
      this.emit("audioChunk", {
        channelName: this.channelName,
        data: audioPage,
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
    log(`[AudioEncoder] Config marked as sent for ${this.channelName}`);
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
    log(`[AudioEncoder] Timing reset for ${this.channelName}`);
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<AudioEncoderConfig>): void {
    this.config = { ...this.config, ...config };
    log(
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
