import EventEmitter from "../../../events/EventEmitter";
import type {
  VideoEncoderConfig,
  SubStreamConfig,
  ChannelName,
} from "../../../types/media/publisher.types";
import { VideoEncoderManager } from "../managers/VideoEncoderManager";
import { StreamManager } from "../transports/StreamManager";

/**
 * VideoProcessor - Manages video frame processing and encoding pipeline
 *
 * Responsibilities:
 * - Process video frames from MediaStreamTrack
 * - Coordinate multiple quality encoders
 * - Handle camera switching
 * - Manage video frame timing
 * - Forward encoded chunks to StreamManager
 *
 * Events:
 * - initialized: When processor is initialized
 * - started: When processing starts
 * - stopped: When processing stops
 * - chunkSent: When encoded chunk is sent
 * - chunkError: When chunk sending fails
 * - encoderError: When encoder error occurs
 * - cameraSwitched: When camera is switched
 * - cameraSwitchError: When camera switch fails
 * - cameraStateChanged: When camera enable state changes
 * - encoderReconfigured: When encoder is reconfigured
 * - processingError: When frame processing error occurs
 */
export class VideoProcessor extends EventEmitter<{
  initialized: { subStreams: SubStreamConfig[] };
  started: undefined;
  stopped: undefined;
  chunkSent: {
    channelName: ChannelName;
    type: string;
    timestamp: number;
    byteLength: number;
  };
  chunkError: { channelName: ChannelName; error: unknown };
  encoderError: { encoderName: string; error: Error };
  cameraSwitched: { track: MediaStreamTrack };
  cameraSwitchError: unknown;
  cameraStateChanged: boolean;
  encoderReconfigured: { encoderName: string; config: Partial<VideoEncoderConfig> };
  processingError: unknown;
}> {
  private videoEncoderManager: VideoEncoderManager;
  private streamManager: StreamManager;
  private videoProcessor: any = null;
  private videoReader: any = null;
  private triggerWorker: Worker | null = null;

  private isProcessing = false;
  private cameraEnabled = true;
  private frameCounter = 0;

  // Sub-stream configurations
  private subStreams: SubStreamConfig[] = [];

  constructor(
    videoEncoderManager: VideoEncoderManager,
    streamManager: StreamManager,
    subStreams: SubStreamConfig[],
  ) {
    super();
    this.videoEncoderManager = videoEncoderManager;
    this.streamManager = streamManager;
    this.subStreams = subStreams.filter((s) => s.channelName.startsWith("cam"));
  }

  /**
   * Initialize video processing
   *
   * @param videoTrack - MediaStreamTrack for video
   * @param config - Base video encoder configuration
   */
  async initialize(
    videoTrack: MediaStreamTrack,
    config: VideoEncoderConfig,
  ): Promise<void> {
    if (!videoTrack) {
      throw new Error("Video track is required");
    }

    try {
      console.log("[VideoProcessor] Initializing...");

      // Create encoders for each sub-stream
      for (const subStream of this.subStreams) {
        const encoderConfig: VideoEncoderConfig = {
          codec: config.codec,
          width: subStream.width!,
          height: subStream.height!,
          framerate: subStream.framerate!,
          bitrate: subStream.bitrate!,
        };

        this.videoEncoderManager.createEncoder(
          subStream.name,
          subStream.channelName,
          encoderConfig,
          (chunk, metadata) =>
            this.handleEncodedChunk(chunk, metadata, subStream.channelName),
          (error) => this.handleEncoderError(error, subStream.name),
        );
      }

      // Setup video processor with trigger worker
      this.triggerWorker = new Worker("/polyfills/triggerWorker.js");
      this.triggerWorker.postMessage({ frameRate: config.framerate });

      this.videoProcessor = new (window as any).MediaStreamTrackProcessor(
        videoTrack,
        this.triggerWorker,
        true,
      );

      this.videoReader = this.videoProcessor.readable.getReader();

      console.log("[VideoProcessor] Initialized successfully");
      this.emit("initialized", { subStreams: this.subStreams });
    } catch (error) {
      console.error("[VideoProcessor] Initialization failed:", error);
      this.emit("processingError", error);
      throw error;
    }
  }

  /**
   * Start video frame processing
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      console.warn("[VideoProcessor] Already processing");
      return;
    }

    if (!this.videoReader) {
      throw new Error("Video processor not initialized");
    }

    try {
      this.isProcessing = true;
      this.frameCounter = 0;

      // Reset base timestamp
      (window as any).videoBaseTimestamp = undefined;

      console.log("[VideoProcessor] Starting frame processing...");
      this.emit("started");

      // Start processing loop in background (fire-and-forget)
      // Do NOT await - this is an infinite loop that should run asynchronously
      this.processFrames();
    } catch (error) {
      console.error("[VideoProcessor] Failed to start:", error);
      this.isProcessing = false;
      throw error;
    }
  }

  /**
   * Stop video frame processing
   */
  async stop(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    try {
      console.log("[VideoProcessor] Stopping...");
      this.isProcessing = false;

      // Cancel video reader
      if (this.videoReader) {
        try {
          await this.videoReader.cancel();
        } catch (error) {
          console.warn("[VideoProcessor] Error canceling reader:", error);
        }
        this.videoReader = null;
      }

      // Stop video processor
      if (this.videoProcessor) {
        this.videoProcessor = null;
      }

      // Close all encoders
      await this.videoEncoderManager.closeAll();

      // Stop trigger worker
      if (this.triggerWorker) {
        this.triggerWorker.terminate();
        this.triggerWorker = null;
      }

      // Reset state
      this.frameCounter = 0;
      (window as any).videoBaseTimestamp = undefined;

      console.log("[VideoProcessor] Stopped successfully");
      this.emit("stopped");
    } catch (error) {
      console.error("[VideoProcessor] Error stopping:", error);
      throw error;
    }
  }

  /**
   * Process video frames loop
   */
  private async processFrames(): Promise<void> {
    try {
      while (this.isProcessing && this.videoReader) {
        const result = await this.videoReader.read();

        if (result.done) {
          console.log("[VideoProcessor] Frame reading completed");
          break;
        }

        const frame = result.value;

        // Set base timestamp on first frame
        if (!(window as any).videoBaseTimestamp) {
          (window as any).videoBaseTimestamp = frame.timestamp;
          console.log(
            "[VideoProcessor] Base timestamp set:",
            frame.timestamp,
          );
        }

        // Skip frame if camera disabled
        if (!this.cameraEnabled) {
          frame.close();
          continue;
        }

        // Encode frame across all encoders
        const encoderNames = this.subStreams.map((s) => s.name);
        await this.videoEncoderManager.encodeFrame(frame, encoderNames);

        this.frameCounter++;
      }
    } catch (error) {
      console.error("[VideoProcessor] Frame processing error:", error);
      this.emit("processingError", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle encoded video chunk
   *
   * @param chunk - Encoded video chunk
   * @param metadata - Chunk metadata
   * @param channelName - Channel name for the chunk
   */
  private async handleEncodedChunk(
    chunk: EncodedVideoChunk,
    metadata: EncodedVideoChunkMetadata,
    channelName: ChannelName,
  ): Promise<void> {
    try {
      // Handle decoder config
      if (
        metadata?.decoderConfig &&
        !this.videoEncoderManager.isMetadataReady((metadata as any).encoderName)
      ) {
        const decoderConfig = {
          codec: metadata.decoderConfig.codec,
          codedWidth: metadata.decoderConfig.codedWidth!,
          codedHeight: metadata.decoderConfig.codedHeight!,
          description: metadata.decoderConfig.description!,
        };

        this.videoEncoderManager.setMetadataReady(
          (metadata as any).encoderName,
          decoderConfig as VideoDecoderConfig,
        );

        // Send config to server
        const subStream = this.subStreams.find(
          (s) => s.channelName === channelName,
        );
        await this.streamManager.sendConfig(
          channelName,
          {
            codec: decoderConfig.codec,
            width: decoderConfig.codedWidth,
            height: decoderConfig.codedHeight,
            framerate: subStream?.framerate || 30,
            bitrate: subStream?.bitrate || 800_000,
          },
          "video",
        );
      }

      // Wait for config to be sent before sending video chunks
      if (!this.streamManager.isConfigSent(channelName)) {
        return;
      }

      // Send video chunk
      await this.streamManager.sendVideoChunk(channelName, chunk, metadata);

      this.emit("chunkSent", {
        channelName,
        type: chunk.type,
        timestamp: chunk.timestamp,
        byteLength: chunk.byteLength,
      });
    } catch (error) {
      console.error("[VideoProcessor] Error handling chunk:", error);
      this.emit("chunkError", { channelName, error });
    }
  }

  /**
   * Handle encoder error
   *
   * @param error - Error from encoder
   * @param encoderName - Name of the encoder
   */
  private handleEncoderError(error: Error, encoderName: string): void {
    console.error(`[VideoProcessor] Encoder ${encoderName} error:`, error);
    this.emit("encoderError", { encoderName, error });
  }

  /**
   * Switch to a different camera
   *
   * @param newVideoTrack - New video track from camera
   */
  async switchCamera(newVideoTrack: MediaStreamTrack): Promise<void> {
    if (!this.isProcessing) {
      throw new Error("Video processor not running");
    }

    try {
      console.log("[VideoProcessor] Switching camera...");

      // Temporarily stop processing
      const wasProcessing = this.isProcessing;
      this.isProcessing = false;

      // Wait for current frame to finish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cancel old reader
      if (this.videoReader) {
        try {
          await this.videoReader.cancel();
        } catch (error) {
          console.warn("[VideoProcessor] Error canceling old reader:", error);
        }
      }

      // Stop old processor
      if (this.videoProcessor) {
        this.videoProcessor = null;
      }

      // Create new processor with new track
      this.videoProcessor = new (window as any).MediaStreamTrackProcessor(
        newVideoTrack,
        this.triggerWorker,
        true,
      );

      this.videoReader = this.videoProcessor.readable.getReader();

      // Reset frame counter (keep base timestamp)
      this.frameCounter = 0;

      // Resume processing
      this.isProcessing = wasProcessing;
      if (this.isProcessing) {
        void this.processFrames();
      }

      console.log("[VideoProcessor] Camera switched successfully");
      this.emit("cameraSwitched", { track: newVideoTrack });
    } catch (error) {
      console.error("[VideoProcessor] Failed to switch camera:", error);
      this.emit("cameraSwitchError", error);
      throw error;
    }
  }

  /**
   * Enable/disable camera
   *
   * @param enabled - True to enable, false to disable
   */
  setCameraEnabled(enabled: boolean): void {
    this.cameraEnabled = enabled;
    console.log(`[VideoProcessor] Camera ${enabled ? "enabled" : "disabled"}`);
    this.emit("cameraStateChanged", enabled);
  }

  /**
   * Check if camera is enabled
   *
   * @returns True if camera is enabled
   */
  isCameraEnabled(): boolean {
    return this.cameraEnabled;
  }

  /**
   * Get processing statistics
   *
   * @returns Processing statistics
   */
  getStats(): {
    isProcessing: boolean;
    cameraEnabled: boolean;
    frameCounter: number;
    encoderStats: ReturnType<VideoEncoderManager["getStats"]>;
  } {
    return {
      isProcessing: this.isProcessing,
      cameraEnabled: this.cameraEnabled,
      frameCounter: this.frameCounter,
      encoderStats: this.videoEncoderManager.getStats(),
    };
  }

  /**
   * Reconfigure encoder quality
   *
   * @param encoderName - Name of encoder to reconfigure
   * @param config - Partial configuration to update
   */
  async reconfigureEncoder(
    encoderName: string,
    config: Partial<VideoEncoderConfig>,
  ): Promise<void> {
    await this.videoEncoderManager.reconfigureEncoder(encoderName, config);
    this.emit("encoderReconfigured", { encoderName, config });
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
   * Get frame counter
   *
   * @returns Number of frames processed
   */
  getFrameCounter(): number {
    return this.frameCounter;
  }

  /**
   * Get sub-streams configuration
   *
   * @returns Array of sub-stream configs
   */
  getSubStreams(): SubStreamConfig[] {
    return this.subStreams;
  }
}
