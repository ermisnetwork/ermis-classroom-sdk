import EventEmitter from "../../../events/EventEmitter";
import type {
  ChannelName,
  AudioEncoderConfig,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";
import { AUDIO_CONFIG } from "../../../constants/mediaConstants";

// ---------------------------------------------------------------------------
// AACEncoderManager
//
// Encodes microphone audio to AAC.
//
// Architecture — two paths, chosen at runtime:
//
//   NATIVE path (Chrome ≥107, Safari ≥26 — browser has WebCodecs AudioEncoder):
//   1. AudioWorklet "aac-capture-processor" captures PCM quanta (128 frames).
//   2. Manager accumulates quanta until a full AAC frame (1024 samples) is ready.
//   3. Manager creates AudioData and calls AudioEncoder.encode() directly on the
//      main thread.  The browser offloads encoding internally — no Worker needed.
//   4. AudioEncoder output callback delivers EncodedAudioChunk + metadata.
//
//   WASM path (Firefox, older Safari — no native AudioEncoder):
//   1–2. Same as above.
//   3. Accumulated frame is transferred to aac-encoder-worker.js (an ES module
//      Worker served from /public/workers/).  The Worker imports FDK-AAC WASM.
//   4. Worker emits 'output' messages with raw AAC-LC bytes + metadata.
//
//   Both paths emit configReady and audioChunk events compatible with
//   AudioEncoderManager, so AudioProcessor accepts either.
// ---------------------------------------------------------------------------

const AAC_CONFIG = {
  SAMPLE_RATE: AUDIO_CONFIG.SAMPLE_RATE,
  CHANNEL_COUNT: AUDIO_CONFIG.CHANNEL_COUNT,
  BITRATE: 128_000,
  SAMPLES_PER_FRAME: 1024, // AAC-LC frame size
} as const;

const AAC_WORKLET_PROCESSOR = "aac-capture-processor";

export class AACEncoderManager extends EventEmitter<{
  initialized: { channelName: ChannelName };
  started: { channelName: ChannelName };
  stopped: { channelName: ChannelName };
  configReady: { channelName: ChannelName; config: AudioEncoderConfig };
  audioChunk: {
    channelName: ChannelName;
    data: Uint8Array;
    timestamp: number;
    samplesSent: number;
    chunkCount: number;
  };
  error: unknown;
}> {
  private channelName: ChannelName;
  private config: AudioEncoderConfig;

  // Audio graph
  private audioContext: AudioContext | null = null;
  private audioStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;

  // ── Encoder: native or Worker ──────────────────────────────────────────
  // When native AudioEncoder is available, _nativeEncoder is used directly
  // on the main thread (the browser offloads encoding internally).
  // Otherwise, encoderWorker hosts FDK-AAC WASM in a dedicated thread.
  private _useNative = false;
  private _nativeEncoder: any = null; // WebCodecs AudioEncoder (typed as any to avoid TS lib issues)
  private encoderWorker: Worker | null = null;
  private workerReady = false;

  // PCM accumulation buffer
  // Size = SAMPLES_PER_FRAME × CHANNEL_COUNT (planar layout: [ch0...ch0, ch1...ch1])
  private pcmBuffer: Float32Array = new Float32Array(
    AAC_CONFIG.SAMPLES_PER_FRAME * AAC_CONFIG.CHANNEL_COUNT,
  );
  private pcmBufferOffset = 0;

  // Timing
  private baseTimestampUs = 0; // microseconds
  private samplesSent = 0;
  private chunkCount = 0;

  // State
  private _configSent = false;
  private audioConfig: AudioEncoderConfig | null = null;
  private _isEncoding = false;
  private _decoderConfigSent = false;

  // URL defaults (callers may override)
  private workerUrl = "/workers/aac-encoder-worker.js";
  private workletUrl = "/workers/aac-capture-worklet.js";

  constructor(channelName: ChannelName, config: AudioEncoderConfig) {
    super();
    this.channelName = channelName;
    this.config = config;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialize the encoder.
   *
   * @param audioStream  MediaStream with at least one audio track.
   * @param audioContext Optional pre-created AudioContext (iOS 15: create in user gesture).
   * @param workletUrl   URL of aac-capture-worklet.js. Default: /workers/aac-capture-worklet.js
   * @param workerUrl    URL of aac-encoder-worker.js.  Default: /workers/aac-encoder-worker.js
   */
  async initialize(
    audioStream: MediaStream,
    audioContext?: AudioContext,
    workletUrl = "/workers/aac-capture-worklet.js",
    workerUrl = "/workers/aac-encoder-worker.js",
  ): Promise<void> {
    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      throw new Error("[AACEncoderManager] No audio track in stream");
    }

    this.audioStream = audioStream;
    this.workletUrl = workletUrl;
    this.workerUrl = workerUrl;

    // AudioContext — reuse caller's or create new one.
    const AudioContextClass =
      (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    this.audioContext =
      audioContext ??
      new AudioContextClass({ sampleRate: AAC_CONFIG.SAMPLE_RATE, latencyHint: "interactive" });

    // Start the encoder (native or worker) early so configure() can run in
    // parallel with AudioWorklet module loading.
    await this._startEncoder();

    log(`[AACEncoderManager] Initialized for ${this.channelName}`);
    this.emit("initialized", { channelName: this.channelName });
  }

  /** Start capturing and encoding. Must be called after initialize(). */
  async start(): Promise<void> {
    if (!this.audioContext || !this.audioStream) {
      throw new Error("[AACEncoderManager] Not initialized — call initialize() first");
    }
    if (this._isEncoding) {
      console.warn("[AACEncoderManager] Already encoding");
      return;
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    // Register the capture AudioWorklet module (idempotent).
    try {
      await this.audioContext.audioWorklet.addModule(this.workletUrl);
    } catch (err) {
      console.warn("[AACEncoderManager] AudioWorklet addModule (may be benign duplicate):", err);
    }

    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.audioStream);
    this.captureWorkletNode = new AudioWorkletNode(
      this.audioContext,
      AAC_WORKLET_PROCESSOR,
      {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: AAC_CONFIG.CHANNEL_COUNT,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      },
    );

    this.captureWorkletNode.port.onmessage = (event: MessageEvent) => {
      // event.data = { channelData: Float32Array[] } (buffers transferred)
      this._accumulatePCM(event.data.channelData as Float32Array[]);
    };

    this.mediaStreamSource.connect(this.captureWorkletNode);

    // Reset counters.
    this.baseTimestampUs = Math.round(performance.now() * 1000);
    this.samplesSent = 0;
    this.chunkCount = 0;
    this.pcmBufferOffset = 0;
    this._decoderConfigSent = false;
    this._isEncoding = true;

    log(`[AACEncoderManager] Started encoding for ${this.channelName}`);
    this.emit("started", { channelName: this.channelName });
  }

  /** Stop encoding and release resources. */
  async stop(): Promise<void> {
    if (!this._isEncoding && !this.encoderWorker && !this._nativeEncoder) return;

    this._isEncoding = false;

    // ── Flush & close encoder ────────────────────────────────────────────
    if (this._useNative && this._nativeEncoder) {
      try {
        if (this._nativeEncoder.state === "configured") {
          await this._nativeEncoder.flush();
        }
      } catch { /* ignore */ }
      try {
        this._nativeEncoder.close();
      } catch { /* ignore */ }
      this._nativeEncoder = null;
    } else {
      // Worker/WASM path
      if (this.encoderWorker && this.workerReady) {
        this.encoderWorker.postMessage({ type: "flush" });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (this.encoderWorker) {
        this.encoderWorker.postMessage({ type: "close" });
        this.encoderWorker.terminate();
        this.encoderWorker = null;
      }
    }

    // Tear down audio graph.
    this.mediaStreamSource?.disconnect();
    this.captureWorkletNode?.disconnect();
    this.captureWorkletNode = null;
    this.mediaStreamSource = null;

    this.workerReady = false;
    this._useNative = false;
    this.audioConfig = null;
    this._configSent = false;
    this._decoderConfigSent = false;
    this.baseTimestampUs = 0;
    this.samplesSent = 0;
    this.chunkCount = 0;
    this.pcmBufferOffset = 0;

    log(`[AACEncoderManager] Stopped for ${this.channelName}`);
    this.emit("stopped", { channelName: this.channelName });
  }

  // ── AudioEncoderManager-compatible API ────────────────────────────────────

  setConfigSent(): void { this._configSent = true; }
  isConfigReady(): boolean { return this.audioConfig !== null; }
  isConfigSent(): boolean { return this._configSent; }
  getConfig(): AudioEncoderConfig | null { return this.audioConfig; }
  updateConfig(config: Partial<AudioEncoderConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.audioConfig) this.audioConfig = { ...this.audioConfig, ...config };
  }
  getStats() {
    return {
      channelName: this.channelName,
      baseTime: this.baseTimestampUs,
      samplesSent: this.samplesSent,
      chunkCount: this.chunkCount,
      configReady: this._configSent,
      isRecording: this._isEncoding,
    };
  }
  resetTiming(): void { this.baseTimestampUs = 0; this.samplesSent = 0; this.chunkCount = 0; }
  getCurrentTimestamp(): number { return this._computeTimestampUs(); }
  getChannelName(): ChannelName { return this.channelName; }
  isRecording(): boolean { return this._isEncoding; }

  /**
   * Detect whether the browser supports native AudioEncoder with AAC-LC.
   */
  private async _checkNativeSupport(): Promise<boolean> {
    const g = globalThis as any;
    if (typeof g.AudioEncoder === "undefined") return false;
    try {
      const support = await g.AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2",
        sampleRate: AAC_CONFIG.SAMPLE_RATE,
        numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
        bitrate: AAC_CONFIG.BITRATE,
      });
      return support.supported === true;
    } catch {
      return false;
    }
  }

  /**
   * Start the encoder — native or Worker depending on browser capabilities.
   */
  private async _startEncoder(): Promise<void> {
    this._useNative = await this._checkNativeSupport();
    if (this._useNative) {
      await this._startNativeEncoder();
    } else {
      await this._startWorkerEncoder();
    }
  }

  /**
   * Native path — create AudioEncoder directly on the main thread.
   * The browser offloads encoding internally; no Worker needed.
   */
  private async _startNativeEncoder(): Promise<void> {
    const AudioEncoderClass = (globalThis as any).AudioEncoder;

    this._nativeEncoder = new AudioEncoderClass({
      output: (chunk: any, metadata: any) => {
        this._handleNativeOutput(chunk, metadata);
      },
      error: (err: any) => {
        console.error("[AACEncoderManager] Native encoder error:", err);
        this.emit("error", err);
      },
    });

    this._nativeEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: AAC_CONFIG.SAMPLE_RATE,
      numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
      bitrate: AAC_CONFIG.BITRATE,
    });

    this.workerReady = true; // reuse flag to indicate encoder is ready
    log(
      `[AACEncoderManager] Native AudioEncoder configured for ${this.channelName}` +
      ` — no Worker needed`,
    );
  }

  /**
   * WASM path — create Worker that hosts FDK-AAC WASM encoder.
   */
  private async _startWorkerEncoder(): Promise<void> {
    this.encoderWorker = new Worker(this.workerUrl, { type: "module" });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("aac-encoder-worker configure timeout")), 10_000);

      this.encoderWorker!.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        switch (msg.type) {
          case "configured":
            clearTimeout(timeout);
            this.workerReady = true;
            log(
              `[AACEncoderManager] Worker configured for ${this.channelName}` +
              ` — using ${msg.usingNative ? "native WebCodecs" : "FDK-AAC WASM"}`,
            );
            resolve();
            // Reassign message handler for ongoing messages.
            this.encoderWorker!.onmessage = (ev) => this._handleWorkerMessage(ev);
            break;
          case "error":
            clearTimeout(timeout);
            reject(new Error(msg.message));
            break;
        }
      };

      this.encoderWorker!.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(`aac-encoder-worker error: ${err.message}`));
      };

      this.encoderWorker!.postMessage({
        type: "configure",
        config: {
          sampleRate: AAC_CONFIG.SAMPLE_RATE,
          numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
          bitrate: AAC_CONFIG.BITRATE,
        },
      });
    });
  }

  /**
   * Handle output from the native AudioEncoder (main-thread path).
   * Extracts raw AAC bytes from EncodedAudioChunk and emits events.
   */
  private _handleNativeOutput(chunk: any, metadata: any): void {
    // onfigReady (first output with decoderConfig)
    if (!this._decoderConfigSent && metadata?.decoderConfig) {
      this._decoderConfigSent = true;
      const dc = metadata.decoderConfig;
      let descBytes: Uint8Array | undefined;
      if (dc.description) {
        if (dc.description instanceof ArrayBuffer) {
          descBytes = new Uint8Array(dc.description);
        } else if (dc.description instanceof Uint8Array) {
          descBytes = dc.description;
        } else if (ArrayBuffer.isView(dc.description)) {
          descBytes = new Uint8Array(
            (dc.description as ArrayBufferView).buffer,
            (dc.description as ArrayBufferView).byteOffset,
            (dc.description as ArrayBufferView).byteLength,
          );
        }
      }
      const audioConfig: AudioEncoderConfig = {
        codec: dc.codec ?? "mp4a.40.2",
        sampleRate: dc.sampleRate ?? AAC_CONFIG.SAMPLE_RATE,
        numberOfChannels: dc.numberOfChannels ?? AAC_CONFIG.CHANNEL_COUNT,
        ...(descBytes && { description: descBytes }),
      };
      this.audioConfig = audioConfig;
      this.emit("configReady", { channelName: this.channelName, config: audioConfig });
      log(
        `[AACEncoderManager] configReady for ${this.channelName}` +
        (audioConfig.description
          ? ` — ASC: ${Array.from(audioConfig.description).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`
          : ""),
      );
    }

    // Extract raw bytes from EncodedAudioChunk
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    if (data.length === 0) return;

    const timestamp = this._computeTimestampUs();
    this.emit("audioChunk", {
      channelName: this.channelName,
      data,
      timestamp,
      samplesSent: this.samplesSent,
      chunkCount: this.chunkCount,
    });
    this.chunkCount++;
  }

  /**
   * Handle messages from the encoder Worker (WASM path).
   */
  private _handleWorkerMessage(e: MessageEvent): void {
    const msg = e.data;

    switch (msg.type) {
      case "output": {
        // configReady (first output only)
        if (!this._decoderConfigSent && msg.metadata?.decoderConfig) {
          this._decoderConfigSent = true;
          const dc = msg.metadata.decoderConfig;
          const audioConfig: AudioEncoderConfig = {
            codec: dc.codec ?? "mp4a.40.2",
            sampleRate: dc.sampleRate ?? AAC_CONFIG.SAMPLE_RATE,
            numberOfChannels: dc.numberOfChannels ?? AAC_CONFIG.CHANNEL_COUNT,
            ...(dc.description && { description: new Uint8Array(dc.description) }),
          };
          this.audioConfig = audioConfig;
          this.emit("configReady", { channelName: this.channelName, config: audioConfig });
          log(
            `[AACEncoderManager] configReady for ${this.channelName}` +
            (audioConfig.description
              ? ` — ASC: ${Array.from(audioConfig.description).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`
              : ""),
          );
        }

        // audioChunk
        const data: Uint8Array = msg.data;
        if (!data || data.length === 0) break;

        const timestamp = this._computeTimestampUs();
        this.emit("audioChunk", {
          channelName: this.channelName,
          data,
          timestamp,
          samplesSent: this.samplesSent,
          chunkCount: this.chunkCount,
        });
        this.chunkCount++;
        break;
      }

      case "error":
        console.error("[AACEncoderManager] Worker error:", msg.message);
        this.emit("error", new Error(msg.message));
        break;

      case "flushed":
        log(`[AACEncoderManager] Worker flushed for ${this.channelName}`);
        break;
    }
  }

  /**
   * Accumulate 128-frame PCM quanta into 1024-sample AAC frames.
   *
   * pcmBuffer layout is **planar**: [ch0 × 1024, ch1 × 1024, ...]
   * This matches the WebCodecs AudioData 'f32-planar' format expected by the encoder.
   * For mono, ch1 plane is unused (CHANNEL_COUNT = 1).
   */
  private _accumulatePCM(channelData: Float32Array[]): void {
    if (!this._isEncoding || !this.workerReady) return;
    // At least one encoder backend must be available.
    if (!this._nativeEncoder && !this.encoderWorker) return;

    const ch0 = channelData[0];
    if (!ch0) return;

    const numChannels = AAC_CONFIG.CHANNEL_COUNT;
    const frameSize = AAC_CONFIG.SAMPLES_PER_FRAME;

    let offset = 0;
    while (offset < ch0.length) {
      const space = frameSize - this.pcmBufferOffset;
      const toCopy = Math.min(space, ch0.length - offset);

      // Write each channel into its own plane inside pcmBuffer.
      for (let c = 0; c < numChannels; c++) {
        const src = channelData[c] ?? ch0; // fall back to ch0 if channel missing
        this.pcmBuffer.set(
          src.subarray(offset, offset + toCopy),
          c * frameSize + this.pcmBufferOffset,
        );
      }

      this.pcmBufferOffset += toCopy;
      offset += toCopy;

      if (this.pcmBufferOffset === frameSize) {
        // Full frame — encode.
        const timestamp = this._computeTimestampUs();
        const frame = this.pcmBuffer.slice(); // copy so we can reuse pcmBuffer

        if (this._useNative && this._nativeEncoder) {
          // Native path — encode directly, no Worker postMessage overhead.
          const AudioDataClass = (globalThis as any).AudioData;
          const audioData = new AudioDataClass({
            format: "f32-planar",
            sampleRate: AAC_CONFIG.SAMPLE_RATE,
            numberOfFrames: frameSize,
            numberOfChannels: numChannels,
            timestamp,
            data: frame,
          });
          this._nativeEncoder.encode(audioData);
          audioData.close();
        } else if (this.encoderWorker) {
          // Worker/WASM path — transfer PCM buffer to worker thread.
          this.encoderWorker.postMessage(
            {
              type: "encode",
              pcm: frame,
              sampleRate: AAC_CONFIG.SAMPLE_RATE,
              numberOfFrames: frameSize,
              numberOfChannels: numChannels,
              timestamp,
            },
            [frame.buffer],
          );
        }

        this.samplesSent += frameSize;
        this.pcmBufferOffset = 0;
      }
    }
  }

  private _computeTimestampUs(): number {
    if (this.baseTimestampUs === 0) return 0;
    return Math.floor(
      this.baseTimestampUs + (this.samplesSent * 1_000_000) / AAC_CONFIG.SAMPLE_RATE,
    );
  }
}
