import EventEmitter from "../../../events/EventEmitter";
import { VIDEO_CONFIG } from "../../../types/media/constants";
import type {
  ChannelName,
  VideoEncoderConfig,
  VideoEncoderObject,
} from "../../../types/media/publisher.types";

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
        // Add encoder info to metadata
        const enrichedMetadata = {
          ...metadata,
          encoderName: name,
          channelName,
        } as EncodedVideoChunkMetadata;

        onOutput(chunk, enrichedMetadata);
      },
      error: (error) => {
        console.error(`[VideoEncoder] ${name} error:`, error);
        this.emit("encoderError", { name, error });
        onError(error);
      },
    });

    // Configure encoder with optimal settings
    const encoderConfig: VideoEncoderConfig = {
      ...config,
      latencyMode: "realtime",
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

    console.log(
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

      // Check if encoder has capacity
      if (encoderObj.encoder.encodeQueueSize > VIDEO_CONFIG.MAX_QUEUE_SIZE) {
        console.warn(
          `[VideoEncoder] ${name} queue full (${encoderObj.encoder.encodeQueueSize}), skipping frame`,
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

    // Close original frame if it wasn't used (all encoders made clones)
    if (targetEncoders.length > 1) {
      frame.close();
    }
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

      console.log(`[VideoEncoder] Reconfigured ${name}:`, newConfig);
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
      console.log(`[VideoEncoder] Metadata ready for ${name}`);
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
      console.log(`[VideoEncoder] Flushed ${name}`);
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
      console.log(`[VideoEncoder] Closed encoder ${name}`);
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

    console.log("[VideoEncoder] All encoders closed");
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
    console.log("[VideoEncoder] Frame counter reset");
  }

  /**
   * Set keyframe interval
   *
   * @param interval - Number of frames between keyframes
   */
  setKeyframeInterval(interval: number): void {
    this.keyframeInterval = interval;
    console.log(`[VideoEncoder] Keyframe interval set to ${interval}`);
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
}
