import EventEmitter from "../../../events/EventEmitter";
import type {
  ChannelName,
  AudioEncoderConfig,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";

// ---------------------------------------------------------------------------
// AACEncoderManager
//
// Encodes microphone audio to AAC.
//
// Architecture (avoids Vite's restriction on dynamic import() from /public):
//   1. AudioWorklet "aac-capture-processor" captures PCM quanta (128 frames)
//      from the mic and sends them to this manager via postMessage.
//   2. Manager accumulates quanta until a full AAC frame (1024 samples) is ready.
//   3. Accumulated frame is transferred to aac-encoder-worker.js (a plain
//      ES module Worker served from /public/workers/).  The worker can safely
//      import from /public/codec-polyfill/ because Workers are outside
//      Vite's module graph — no "file in /public" error.
//   4. Worker emits 'output' messages with raw AAC-LC bytes + optional
//      AudioSpecificConfig metadata (first chunk only).
//   5. Manager emits configReady (with AudioSpecificConfig) and audioChunk events
//      that are identical to AudioEncoderManager, so AudioProcessor accepts both.
// ---------------------------------------------------------------------------

const AAC_CONFIG = {
  SAMPLE_RATE: 48000,
  CHANNEL_COUNT: 1, // mono – mirrors current Opus configuration
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

  // Encoder Worker (served from /public/workers/aac-encoder-worker.js)
  private encoderWorker: Worker | null = null;
  private workerReady = false;

  // PCM accumulation buffer
  private pcmBuffer: Float32Array = new Float32Array(AAC_CONFIG.SAMPLES_PER_FRAME);
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

    // Start the encoder worker early so configure() can run in parallel with
    // AudioWorklet module loading.
    await this._startEncoderWorker();

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
    if (!this._isEncoding && !this.encoderWorker) return;

    this._isEncoding = false;

    // Flush the worker encoder.
    if (this.encoderWorker && this.workerReady) {
      this.encoderWorker.postMessage({ type: "flush" });
      // Give it 500ms to flush before terminating.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Tear down audio graph.
    this.mediaStreamSource?.disconnect();
    this.captureWorkletNode?.disconnect();
    this.captureWorkletNode = null;
    this.mediaStreamSource = null;

    // Terminate worker.
    if (this.encoderWorker) {
      this.encoderWorker.postMessage({ type: "close" });
      this.encoderWorker.terminate();
      this.encoderWorker = null;
    }

    this.workerReady = false;
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

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Create and configure the encoder Worker.
   * The Worker is an ES module served from /public/workers/ so it can import
   * from /public/codec-polyfill/ without Vite interference.
   */
  private async _startEncoderWorker(): Promise<void> {
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

  private _handleWorkerMessage(e: MessageEvent): void {
    const msg = e.data;

    switch (msg.type) {
      case "output": {
        // ── configReady (first output only) ───────────────────────────────
        if (!this._decoderConfigSent && msg.metadata?.decoderConfig) {
          this._decoderConfigSent = true;
          const dc = msg.metadata.decoderConfig;
          this.audioConfig = {
            codec: dc.codec ?? "mp4a.40.2",
            sampleRate: dc.sampleRate ?? AAC_CONFIG.SAMPLE_RATE,
            numberOfChannels: dc.numberOfChannels ?? AAC_CONFIG.CHANNEL_COUNT,
            ...(dc.description && { description: new Uint8Array(dc.description) }),
          };
          this.emit("configReady", { channelName: this.channelName, config: this.audioConfig });
          log(
            `[AACEncoderManager] configReady for ${this.channelName}` +
            (this.audioConfig.description
              ? ` — ASC: ${Array.from(this.audioConfig.description).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`
              : ""),
          );
        }

        // ── audioChunk ─────────────────────────────────────────────────────
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
   * Accumulate 128-frame PCM quanta into 1024-sample (one AAC frame) buffers.
   * When full, transfer the buffer to the encoder worker.
   */
  private _accumulatePCM(channelData: Float32Array[]): void {
    if (!this._isEncoding || !this.workerReady || !this.encoderWorker) return;

    const samples = channelData[0]; // mono: take channel 0
    if (!samples) return;

    let offset = 0;
    while (offset < samples.length) {
      const space = AAC_CONFIG.SAMPLES_PER_FRAME - this.pcmBufferOffset;
      const toCopy = Math.min(space, samples.length - offset);

      this.pcmBuffer.set(samples.subarray(offset, offset + toCopy), this.pcmBufferOffset);
      this.pcmBufferOffset += toCopy;
      offset += toCopy;

      if (this.pcmBufferOffset === AAC_CONFIG.SAMPLES_PER_FRAME) {
        // Full frame — transfer to worker.
        const timestamp = this._computeTimestampUs();
        const frame = this.pcmBuffer.slice(); // copy so we can reuse pcmBuffer
        this.encoderWorker.postMessage(
          {
            type: "encode",
            pcm: frame,
            sampleRate: AAC_CONFIG.SAMPLE_RATE,
            numberOfFrames: AAC_CONFIG.SAMPLES_PER_FRAME,
            numberOfChannels: AAC_CONFIG.CHANNEL_COUNT,
            timestamp,
          },
          [frame.buffer],
        );
        this.samplesSent += AAC_CONFIG.SAMPLES_PER_FRAME;
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
