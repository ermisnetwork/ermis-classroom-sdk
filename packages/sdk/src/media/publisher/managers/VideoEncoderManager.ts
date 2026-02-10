import EventEmitter from "../../../events/EventEmitter";
import { VIDEO_CONFIG } from "../../../constants/mediaConstants";
import type {
  ChannelName,
  VideoEncoderConfig,
  VideoEncoderObject,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";
// @ts-ignore - JavaScript module without types
import { H264Encoder, isNativeH264EncoderSupported } from "../../../codec-polyfill/video-codec-polyfill.js";

// Detect if native VideoEncoder is available
const HAS_NATIVE_VIDEO_ENCODER = typeof VideoEncoder !== 'undefined';

/**
 * VideoEncoderManager - Manages video encoding for multiple qualities
 *
 * Responsibilities:
 * - Create and configure video encoders for different qualities (360p, 720p, screen)
 * - Handle video frame encoding across multiple encoders
 * - Manage encoder lifecycle (create, configure, flush, close)
 * - Generate and track decoder configurations
 * - Monitor encoding performance and queue sizes
 *
 * Events:
 * - encoderCreated: When a new encoder is created
 * - encoderClosed: When an encoder is closed
 * - encoderReconfigured: When encoder config is updated
 * - encoderError: When encoder encounters an error
 * - encodeError: When frame encoding fails
 * - metadataReady: When encoder metadata is available
 * - allEncodersClosed: When all encoders are closed
 */
export class VideoEncoderManager extends EventEmitter<{
  encoderCreated: {
    name: string;
    channelName: ChannelName;
    config: VideoEncoderConfig;
  };
  encoderClosed: string;
  encoderReconfigured: { name: string; config: VideoEncoderConfig };
  encoderError: { name: string; error: Error };
  encodeError: { name: string; error: unknown };
  metadataReady: { name: string; decoderConfig: VideoDecoderConfig };
  allEncodersClosed: undefined;
}> {
  private encoders = new Map<string, VideoEncoderObject>();
  private frameCounter = 0;
  private keyframeInterval: number = VIDEO_CONFIG.KEYFRAME_INTERVAL;
  // private chunkCounters = new Map<string, number>(); // DEBUG: Track chunks per encoder

  /**
   * Create video encoder for specific quality
   *
   * @param name - Encoder name (e.g., "360p", "720p", "screen")
   * @param channelName - Channel name for the encoder
   * @param config - Video encoder configuration
   * @param onOutput - Callback for encoded chunks
   * @param onError - Callback for errors
   * @returns Promise resolving to the created encoder instance (native VideoEncoder or WASM wrapper)
   */
  async createEncoderAsync(
    name: string,
    channelName: ChannelName,
    config: VideoEncoderConfig,
    onOutput: (
      chunk: EncodedVideoChunk,
      metadata: EncodedVideoChunkMetadata,
    ) => void,
    onError: (error: Error) => void,
  ): Promise<VideoEncoder | any> {
    if (this.encoders.has(name)) {
      throw new Error(`Encoder ${name} already exists`);
    }

    // Configure encoder with optimal settings
    // Use Annex B format for WASM decoder compatibility (SPS/PPS inline with start codes)
    const encoderConfig: VideoEncoderConfig = {
      ...config,
      latencyMode: "realtime",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: 'annexb' },
    } as VideoEncoderConfig;

    let encoder: any;
    let isWasmEncoder = false;

    if (HAS_NATIVE_VIDEO_ENCODER) {
      // Use native VideoEncoder
      encoder = new VideoEncoder({
        output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
          const enrichedMetadata = {
            ...(metadata || {}),
            encoderName: name,
            channelName,
          } as EncodedVideoChunkMetadata;
          onOutput(chunk, enrichedMetadata);
        },
        error: (error: Error) => {
          console.error(`[VideoEncoder] ❌ ${name} error:`, error);
          this.emit("encoderError", { name, error });
          onError(error);
        },
      });

      encoder.configure(encoderConfig);
      log(`[VideoEncoder] Created native encoder "${name}" for ${channelName}:`, encoderConfig);
    } else {
      // Fallback to WASM H264Encoder (iOS 15 Safari, etc.)
      log(`[VideoEncoder] Native VideoEncoder not available, using WASM H264Encoder fallback for "${name}"`);
      
      encoder = new H264Encoder({
        width: encoderConfig.width,
        height: encoderConfig.height,
        bitrate: encoderConfig.bitrate,
        framerate: encoderConfig.framerate,
        forceWasm: true, // Always use WASM since native is not available
        keyFrameInterval: 60,
      });

      // Set up callbacks before configure
      encoder.onOutput = (chunk: any, metadata: any) => {
        // WASM encoder produces chunks that may need conversion to EncodedVideoChunk-like objects
        const enrichedMetadata = {
          ...metadata,
          encoderName: name,
          channelName,
        };
        onOutput(chunk, enrichedMetadata as EncodedVideoChunkMetadata);
      };
      encoder.onError = (error: Error) => {
        console.error(`[VideoEncoder WASM] ❌ ${name} error:`, error);
        this.emit("encoderError", { name, error });
        onError(error);
      };

      await encoder.configure({
        width: encoderConfig.width,
        height: encoderConfig.height,
        bitrate: encoderConfig.bitrate,
        framerate: encoderConfig.framerate,
      });

      isWasmEncoder = true;
      log(`[VideoEncoder] Created WASM encoder "${name}" for ${channelName}:`, encoderConfig);
    }

    // Store encoder info - wrap WASM encoder to match interface
    this.encoders.set(name, {
      encoder: encoder,
      channelName,
      config: encoderConfig,
      metadataReady: false,
      videoDecoderConfig: null,
      isWasmEncoder, // Track which type of encoder
    } as VideoEncoderObject & { isWasmEncoder?: boolean });

    this.emit("encoderCreated", { name, channelName, config: encoderConfig });

    return encoder;
  }

  /**
   * Create video encoder (sync version for backwards compatibility)
   * NOTE: This will throw on browsers without native VideoEncoder (iOS 15)
   * Use createEncoderAsync for full compatibility
   *
   * @deprecated Use createEncoderAsync instead for iOS 15 compatibility
   */
  createEncoder(
    name: string,
    channelName: ChannelName,
    config: VideoEncoderConfig,
    onOutput: (
      chunk: EncodedVideoChunk,
      metadata: EncodedVideoChunkMetadata,
    ) => void,
    onError: (error: Error) => void,
  ): VideoEncoder {
    if (!HAS_NATIVE_VIDEO_ENCODER) {
      throw new Error(
        "Native VideoEncoder not available. Use createEncoderAsync() for WASM fallback support (iOS 15 Safari)."
      );
    }

    if (this.encoders.has(name)) {
      throw new Error(`Encoder ${name} already exists`);
    }

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const enrichedMetadata = {
          ...metadata,
          encoderName: name,
          channelName,
        } as EncodedVideoChunkMetadata;
        onOutput(chunk, enrichedMetadata);
      },
      error: (error) => {
        console.error(`[VideoEncoder] ❌ ${name} error:`, error);
        this.emit("encoderError", { name, error });
        onError(error);
      },
    });

    // Configure encoder with optimal settings
    const encoderConfig: VideoEncoderConfig = {
      ...config,
      latencyMode: "realtime",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: 'annexb' },
    } as VideoEncoderConfig;

    encoder.configure(encoderConfig);

    // Store encoder info
    this.encoders.set(name, {
      encoder,
      channelName,
      config: encoderConfig,
      metadataReady: false,
      videoDecoderConfig: null,
    });

    log(`[VideoEncoder] Created encoder "${name}" for ${channelName}:`, encoderConfig);
    this.emit("encoderCreated", { name, channelName, config: encoderConfig });

    return encoder;
  }

  /**
   * Encode video frame across multiple encoders
   * Supports VideoFrame (native) and ImageData-like objects (iOS 15 fallback)
   *
   * @param frame - Video frame to encode (VideoFrame or ImageData-like object)
   * @param encoderNames - Optional list of specific encoders to use
   */
  async encodeFrame(frame: VideoFrame | any, encoderNames?: string[]): Promise<void> {
    const targetEncoders = encoderNames
      ? Array.from(this.encoders.entries()).filter(([name]) =>
        encoderNames.includes(name),
      )
      : Array.from(this.encoders.entries());

    if (targetEncoders.length === 0) {
      console.warn("[VideoEncoder] No encoders available");
      frame.close?.();
      return;
    }

    // Check if this is an iOS 15 fallback frame (ImageData-like object)
    const isImageDataFallback = frame && frame.type === 'imagedata' && frame.data;
    const isRealVideoFrame = typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame;

    this.frameCounter++;
    const isKeyFrame = this.frameCounter % this.keyframeInterval === 0;

    // Encode frame for each encoder
    for (let i = 0; i < targetEncoders.length; i++) {
      const [name, encoderObj] = targetEncoders[i];
      const isLastEncoder = i === targetEncoders.length - 1;

      // Check if encoder has capacity - but ALWAYS encode keyframes
      const isQueueFull = encoderObj.encoder.encodeQueueSize > VIDEO_CONFIG.MAX_QUEUE_SIZE;
      if (isQueueFull && !isKeyFrame) {
        console.warn(
          `[VideoEncoder] ${name} queue full (${encoderObj.encoder.encodeQueueSize}), skipping delta frame`,
        );
        continue;
      }

      try {
        if ((encoderObj as any).isWasmEncoder) {
          // WASM encoder: pass frame directly (handles both VideoFrame and ImageData-like)
          // WASM encoder's encode() handles the conversion internally
          (encoderObj.encoder as any).encode(frame, isKeyFrame);
        } else if (isRealVideoFrame) {
          // Native encoder: requires real VideoFrame
          // Clone frame for all but last encoder
          const frameToEncode = isLastEncoder ? frame : new VideoFrame(frame);
          encoderObj.encoder.encode(frameToEncode, { keyFrame: isKeyFrame });

          // Close cloned frames
          if (!isLastEncoder) {
            frameToEncode.close();
          }
        } else if (isImageDataFallback) {
          // iOS 15 fallback with native encoder - this shouldn't happen
          // because native VideoEncoder isn't available on iOS 15
          console.warn(`[VideoEncoder] ${name}: Native encoder received ImageData fallback - skipping`);
        }
      } catch (error) {
        console.error(
          `[VideoEncoder] Failed to encode frame with ${name}:`,
          error,
        );
        this.emit("encodeError", { name, error });
      }
    }

    // NOTE: Do NOT close the original frame here!
    // The caller (VideoProcessor.processFrames) is responsible for closing the frame
    // after encodeFrame returns. Double-closing causes crashes and video corruption.
  }

  /**
   * Update encoder configuration
   *
   * @param name - Encoder name
   * @param config - Partial configuration to update
   */
  async reconfigureEncoder(
    name: string,
    config: Partial<VideoEncoderConfig>,
  ): Promise<void> {
    const encoderObj = this.encoders.get(name);
    if (!encoderObj) {
      throw new Error(`Encoder ${name} not found`);
    }

    const newConfig: VideoEncoderConfig = {
      ...encoderObj.config,
      ...config,
    };

    try {
      // Flush existing frames
      await encoderObj.encoder.flush();

      // Reconfigure
      encoderObj.encoder.configure(newConfig);
      encoderObj.config = newConfig;
      encoderObj.metadataReady = false;

      log(`[VideoEncoder] Reconfigured ${name}:`, newConfig);
      this.emit("encoderReconfigured", { name, config: newConfig });
    } catch (error) {
      console.error(`[VideoEncoder] Failed to reconfigure ${name}:`, error);
      throw error;
    }
  }

  /**
   * Mark encoder metadata as ready
   *
   * @param name - Encoder name
   * @param decoderConfig - Decoder configuration from encoder
   */
  setMetadataReady(name: string, decoderConfig: VideoDecoderConfig): void {
    const encoderObj = this.encoders.get(name);
    if (encoderObj) {
      encoderObj.metadataReady = true;
      encoderObj.videoDecoderConfig = decoderConfig;
      this.emit("metadataReady", { name, decoderConfig });
      log(`[VideoEncoder] Metadata ready for ${name}`);
    }
  }

  /**
   * Check if encoder metadata is ready
   *
   * @param name - Encoder name
   * @returns True if metadata is ready
   */
  isMetadataReady(name: string): boolean {
    return this.encoders.get(name)?.metadataReady ?? false;
  }

  /**
   * Reset encoder metadata flag to force resend config
   * Called when streams are reconnected after unban
   *
   * @param name - Encoder name
   */
  resetMetadata(name: string): void {
    const encoderObj = this.encoders.get(name);
    if (encoderObj) {
      encoderObj.metadataReady = false;
      log(`[VideoEncoder] Metadata reset for ${name}, config will be resent`);
    }
  }

  /**
   * Reset metadata for all encoders
   * Called when streams are reconnected after unban
   */
  resetAllMetadata(): void {
    for (const [name, encoderObj] of this.encoders) {
      encoderObj.metadataReady = false;
      log(`[VideoEncoder] Metadata reset for ${name}`);
    }
  }

  /**
   * Get saved decoder config for an encoder
   * Used to resend config after stream reconnection
   *
   * @param name - Encoder name
   * @returns Saved decoder config or null
   */
  getSavedDecoderConfig(name: string): VideoDecoderConfig | null {
    return this.encoders.get(name)?.videoDecoderConfig ?? null;
  }

  /**
   * Get encoder by name
   *
   * @param name - Encoder name
   * @returns Encoder object or undefined
   */
  getEncoder(name: string): VideoEncoderObject | undefined {
    return this.encoders.get(name);
  }

  /**
   * Get all encoders for a specific channel type
   *
   * @param channelPrefix - Channel name prefix to filter by
   * @returns Array of matching encoder objects
   */
  getEncodersByChannel(channelPrefix: string): VideoEncoderObject[] {
    return Array.from(this.encoders.values()).filter((obj) =>
      obj.channelName.startsWith(channelPrefix),
    );
  }

  /**
   * Flush encoder
   *
   * @param name - Encoder name
   */
  async flushEncoder(name: string): Promise<void> {
    const encoderObj = this.encoders.get(name);
    if (!encoderObj) {
      throw new Error(`Encoder ${name} not found`);
    }

    try {
      await encoderObj.encoder.flush();
      log(`[VideoEncoder] Flushed ${name}`);
    } catch (error) {
      console.error(`[VideoEncoder] Failed to flush ${name}:`, error);
      throw error;
    }
  }

  /**
   * Close encoder
   *
   * @param name - Encoder name
   */
  async closeEncoder(name: string): Promise<void> {
    const encoderObj = this.encoders.get(name);
    if (!encoderObj) {
      return;
    }

    try {
      if (encoderObj.encoder.state !== "closed") {
        await encoderObj.encoder.flush();
        encoderObj.encoder.close();
      }

      this.encoders.delete(name);
      log(`[VideoEncoder] Closed encoder ${name}`);
      this.emit("encoderClosed", name);
    } catch (error) {
      console.error(`[VideoEncoder] Error closing ${name}:`, error);
    }
  }

  /**
   * Close all encoders
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [name] of this.encoders) {
      closePromises.push(this.closeEncoder(name));
    }

    await Promise.all(closePromises);
    this.encoders.clear();
    this.frameCounter = 0;

    log("[VideoEncoder] All encoders closed");
    this.emit("allEncodersClosed");
  }

  /**
   * Get encoding statistics
   *
   * @returns Encoder statistics
   */
  getStats(): {
    totalEncoders: number;
    frameCounter: number;
    encoders: Record<
      string,
      {
        channelName: string;
        queueSize: number;
        state: string;
        metadataReady: boolean;
        config: VideoEncoderConfig;
      }
    >;
  } {
    const encoderStats: Record<
      string,
      {
        channelName: string;
        queueSize: number;
        state: string;
        metadataReady: boolean;
        config: VideoEncoderConfig;
      }
    > = {};

    for (const [name, obj] of this.encoders) {
      encoderStats[name] = {
        channelName: obj.channelName,
        queueSize: obj.encoder.encodeQueueSize,
        state: obj.encoder.state,
        metadataReady: obj.metadataReady,
        config: obj.config,
      };
    }

    return {
      totalEncoders: this.encoders.size,
      frameCounter: this.frameCounter,
      encoders: encoderStats,
    };
  }

  /**
   * Reset frame counter
   */
  resetFrameCounter(): void {
    this.frameCounter = 0;
    log("[VideoEncoder] Frame counter reset");
  }

  /**
   * Set keyframe interval
   *
   * @param interval - Number of frames between keyframes
   */
  setKeyframeInterval(interval: number): void {
    this.keyframeInterval = interval;
    log(`[VideoEncoder] Keyframe interval set to ${interval}`);
  }

  /**
   * Get number of active encoders
   *
   * @returns Number of encoders
   */
  getEncoderCount(): number {
    return this.encoders.size;
  }

  /**
   * Check if encoder exists
   *
   * @param name - Encoder name
   * @returns True if encoder exists
   */
  hasEncoder(name: string): boolean {
    return this.encoders.has(name);
  }

  /**
   * Get all encoder names
   *
   * @returns Array of encoder names
   */
  getEncoderNames(): string[] {
    return Array.from(this.encoders.keys());
  }

  /**
   * Check if any encoder is busy (queue size > 0)
   *
   * @returns True if any encoder is busy
   */
  isAnyEncoderBusy(): boolean {
    return Array.from(this.encoders.values()).some(
      (obj) => obj.encoder.encodeQueueSize > 0,
    );
  }

  /**
   * Request a keyframe from a specific encoder
   * Forces the next encoded frame to be a keyframe
   *
   * @param name - Encoder name
   */
  requestKeyframe(name: string): void {
    const encoderObj = this.encoders.get(name);
    if (!encoderObj) {
      console.warn(`[VideoEncoder] Encoder ${name} not found for keyframe request`);
      return;
    }

    // Set frameCounter to make next frame a keyframe
    // By setting it to keyframeInterval - 1, the next encodeFrame will produce a keyframe
    this.frameCounter = this.keyframeInterval - 1;
    log(`[VideoEncoder] Keyframe requested for ${name}, next frame will be keyframe`);
  }
}
