import EventEmitter from "../../../events/EventEmitter";
import { VIDEO_CONFIG } from "../../../constants/mediaConstants";
import type {
  ChannelName,
  VideoEncoderConfig,
  VideoEncoderObject,
} from "../../../types/media/publisher.types";
import { log } from "../../../utils";

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
   * @returns The created VideoEncoder instance
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
    if (this.encoders.has(name)) {
      throw new Error(`Encoder ${name} already exists`);
    }

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        // DEBUG: Count and log chunks
        // const count = (this.chunkCounters.get(name) || 0) + 1;
        // this.chunkCounters.set(name, count);
        // if (count <= 5 || count % 100 === 0) {
        //   log(`[VideoEncoder] ✅ ${name} output chunk #${count}, size: ${chunk.byteLength}, type: ${chunk.type}`);
        // }

        // Add encoder info to metadata
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
      latencyMode: config.latencyMode || "realtime",
      hardwareAcceleration: "prefer-hardware",
    };

    encoder.configure(encoderConfig);

    // Store encoder info
    this.encoders.set(name, {
      encoder,
      channelName,
      config: encoderConfig,
      metadataReady: false,
      videoDecoderConfig: null,
    });

    log(
      `[VideoEncoder] Created encoder "${name}" for ${channelName}:`,
      encoderConfig,
    );
    this.emit("encoderCreated", { name, channelName, config: encoderConfig });

    return encoder;
  }

  /**
   * Encode video frame across multiple encoders
   *
   * @param frame - Video frame to encode
   * @param encoderNames - Optional list of specific encoders to use
   */
  async encodeFrame(frame: VideoFrame, encoderNames?: string[]): Promise<void> {
    const targetEncoders = encoderNames
      ? Array.from(this.encoders.entries()).filter(([name]) =>
        encoderNames.includes(name),
      )
      : Array.from(this.encoders.entries());

    if (targetEncoders.length === 0) {
      console.warn("[VideoEncoder] No encoders available");
      frame.close();
      return;
    }

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
        // Clone frame for all but last encoder
        const frameToEncode = isLastEncoder ? frame : new VideoFrame(frame);

        encoderObj.encoder.encode(frameToEncode, { keyFrame: isKeyFrame });

        // Close cloned frames
        if (!isLastEncoder) {
          frameToEncode.close();
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
