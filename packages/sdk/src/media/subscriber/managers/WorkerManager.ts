/**
 * WorkerManager - Manages media worker for subscriber
 *
 * Responsibilities:
 * - Initializes and manages media worker
 * - Handles worker message communication
 * - Attaches streams to worker
 * - Controls audio toggle and bitrate switching
 */

import EventEmitter from "../../../events/EventEmitter";
import type { QualityLevel, SubscribeType, WorkerMessageData, } from "../../../types/media/subscriber.types";
import { log } from "../../../utils";
import { ChannelName } from "../../publisher";

/**
 * Worker manager events
 */
interface WorkerManagerEvents extends Record<string, unknown> {
  workerReady: undefined;
  videoData: { frame: VideoFrame };
  status: { message: string; isError: boolean };
  audioToggled: { enabled: boolean };
  frameSkipped: undefined;
  frameResumed: undefined;
  error: { error: Error; context: string };
}

/**
 * WorkerManager class
 */
export class WorkerManager extends EventEmitter<WorkerManagerEvents> {
  private worker: Worker | null = null;
  private workerUrl: string;
  private isInitialized = false;
  private subscriberId: string;
  private protocol: "webrtc" | "webtransport" | "websocket";
  private wasmReady = false;
  private decoderWorker: Worker | null = null;
  private decoderChannel: MessageChannel | null = null;
  // private videoFrameCount = 0; // DEBUG: Count video frames

  constructor(workerUrl: string, subscriberId: string, protocol: "webrtc" | "webtransport" | "websocket") {
    super();
    this.workerUrl = workerUrl;
    this.subscriberId = subscriberId;
    this.protocol = protocol;

    this.on("wasmReady", () => {
      this.wasmReady = true;
    });
  }

  /**
   * Detect if nested workers are unsupported (iOS Safari < 15.5).
   * When true, the decoder worker must be created from the main thread
   * and bridged to the media worker via MessagePort.
   */
  private needsExternalDecoderWorker(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS 13+ reports "Macintosh" in UA — detect via maxTouchPoints
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Macintosh') && navigator.maxTouchPoints > 0);
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);

    // Module workers (type: "module") on iOS Safari do not expose the Worker
    // constructor regardless of Safari version (even 15.5+ which added nested
    // worker support for classic workers only).  Always use the external
    // decoder worker bridge for iOS Safari.
    return isIOS && isSafari;
  }

  /**
   * Initialize the worker
   * @param channelPort - MessagePort for audio communication
   * @param subscribeType - Type of subscription (camera or screen_share)
   * @param audioEnabled - Whether audio should be subscribed (default: true)
   */
  async init(
    channelPort: MessagePort,
    subscribeType: SubscribeType = "camera",
    audioEnabled: boolean = true,
    initialQuality?: QualityLevel,
    enableLogging: boolean = false
  ): Promise<void> {
    try {
      // Create worker with cache busting
      this.worker = new Worker(`${this.workerUrl}?t=${Date.now()}`, {
        type: "module",
      });

      // Setup message handler
      this.worker.onmessage = (e: MessageEvent<WorkerMessageData>) => {
        this.handleWorkerMessage(e.data);
      };

      // Setup error handler
      this.worker.onerror = (error: ErrorEvent) => {
        this.emit("error", {
          error: new Error(error.message),
          context: "worker",
        });
      };

      // Create external decoder worker for platforms without nested worker
      // support (iOS 15 Safari).  The decoder Worker is created here on the
      // main thread and messages are relayed through a MessagePort.
      let decoderPort: MessagePort | undefined;
      const transferables: Transferable[] = [channelPort];

      if (this.needsExternalDecoderWorker()) {
        log('[WorkerManager] Creating external decoder worker (iOS 15 compat)');
        const timestamp = Date.now();
        this.decoderWorker = new Worker(
          `/opus_decoder/decoderWorker.min.js?t=${timestamp}`
        );
        this.decoderChannel = new MessageChannel();

        // Relay: media worker (port2) → decoder worker
        this.decoderChannel.port2.onmessage = (e: MessageEvent) => {
          if (!this.decoderWorker) return;
          const data = e.data;
          const xfer: Transferable[] = [];
          if (data?.pages?.buffer) xfer.push(data.pages.buffer);
          this.decoderWorker.postMessage(data, xfer);
        };

        // Relay: decoder worker → media worker (port2)
        this.decoderWorker.onmessage = (e: MessageEvent) => {
          if (!this.decoderChannel) return;
          const data = e.data;
          const xfer: Transferable[] = [];
          if (Array.isArray(data)) {
            for (const arr of data) {
              if (arr?.buffer) xfer.push(arr.buffer);
            }
          }
          this.decoderChannel.port2.postMessage(data, xfer);
        };

        this.decoderWorker.onerror = (e: ErrorEvent) => {
          console.error('[WorkerManager] Decoder worker error:', e.message);
        };

        decoderPort = this.decoderChannel.port1;
        transferables.push(decoderPort);
      }

      // Send init message with subscriberId, subscribeType, and audioEnabled
      // ⚠️ CRITICAL: Worker expects FLAT structure, not nested in 'data'
      this.worker.postMessage(
        {
          type: "init",
          subscriberId: this.subscriberId,
          subscribeType: subscribeType,
          audioEnabled: audioEnabled, // Pass audio enabled state to worker
          initialQuality: initialQuality,
          port: channelPort,
          decoderPort: decoderPort,
          enableLogging,
          protocol: this.protocol,
        },
        transferables
      );

      this.isInitialized = true;
      this.emit("workerReady", undefined);

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Worker initialization failed");
      this.emit("error", { error: err, context: "init" });
      throw err;
    }
  }

  waitForWasmReady(timeoutMs = 5000): Promise<void> {
    if (this.wasmReady) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("WASM initialization timeout"));
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("wasmReady", onReady);
      };

      this.on("wasmReady", onReady);
    });
  }

  /**
   * Attach a stream to the worker
   */
  attachStream(
    channelName: ChannelName,
    readable: ReadableStream,
    writable: WritableStream,
    localStreamId: string
  ): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    log(`Attaching stream to worker: ${channelName}`);

    this.worker.postMessage(
      {
        type: "attachStream",
        channelName,
        readable,
        writable,
        localStreamId,
      },
      [readable as unknown as Transferable, writable as unknown as Transferable]
    );
  }

  /**
   * Attach a WebRTC data channel to the worker
   */
  attachDataChannel(
    channelName: ChannelName,
    dataChannel: RTCDataChannel
  ): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    log(`Attaching data channel to worker: ${channelName}`);

    // Set binaryType before transfer — Safari 15 throws TypeMismatchError
    // when setting binaryType on a transferred RTCDataChannel inside a worker.
    dataChannel.binaryType = "arraybuffer";

    this.worker.postMessage(
      {
        type: "attachDataChannel",
        channelName,
        dataChannel,
      },
      [dataChannel as unknown as Transferable]
    );
  }

  /**
   * Attach WebSocket to the worker
   */
  attachWebSocket(wsUrl: string, localStreamId: string): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    log(`Attaching WebSocket to worker: ${wsUrl}`);

    this.worker.postMessage({
      type: "attachWebSocket",
      wsUrl,
      localStreamId,
    });
  }

  /**
   * Toggle audio on/off
   */
  toggleAudio(): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.worker.postMessage({ type: "toggleAudio" });
  }

  /**
   * Switch bitrate quality
   */
  switchBitrate(quality: QualityLevel): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    log(`Switching bitrate to ${quality}`);
    this.worker.postMessage({ type: "switchBitrate", quality });
  }

  /**
   * Send start stream command to server
   */
  startStream(): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }
    this.worker.postMessage({ type: "startStream" });
  }

  /**
   * Send stop stream command to server
   */
  stopStream(): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }
    this.worker.postMessage({ type: "stopStream" });
  }

  /**
   * Send pause stream command to server
   */
  pauseStream(): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }
    this.worker.postMessage({ type: "pauseStream" });
  }

  /**
   * Send resume stream command to server
   */
  resumeStream(): void {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Worker not initialized");
    }
    this.worker.postMessage({ type: "resumeStream" });
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.decoderWorker) {
      this.decoderWorker.terminate();
      this.decoderWorker = null;
    }
    if (this.decoderChannel) {
      this.decoderChannel.port2.close();
      this.decoderChannel = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      log("Media worker terminated");
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(data: WorkerMessageData): void {
    const { type, frame, message, audioEnabled } = data;

    switch (type) {
      case "videoData":
        if (frame) {
          this.emit("videoData", { frame });
        }
        break;

      case "status":
        if (message) {
          this.emit("status", { message, isError: false });
        }
        break;

      case "error":
        if (message) {
          console.error(`[WorkerManager] ❌ Worker error: ${message}`);
          this.emit("status", { message, isError: true });
          this.emit("error", {
            error: new Error(message),
            context: "workerMessage",
          });
        }
        break;

      case "audio-toggled":
        if (audioEnabled !== undefined) {
          this.emit("audioToggled", { enabled: audioEnabled });
        }
        break;

      case "skipping":
        this.emit("frameSkipped", undefined);
        break;

      case "resuming":
        this.emit("frameResumed", undefined);
        break;

      case "raptorq-initialized":
        log("[WorkerManager] RaptorQ WASM module initialized in worker");
        this.emit("wasmReady", undefined);
        break;

      default:
        log(`Unknown worker message type: ${type}`, data);
    }
  }

  /**
   * Check if worker is initialized
   */
  isWorkerInitialized(): boolean {
    return this.isInitialized;
  }
}
