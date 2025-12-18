/**
 * VideoProcessor - Manages video processing for subscriber
 *
 * Responsibilities:
 * - Initializes MediaStreamTrackGenerator for video
 * - Handles video frame writing
 * - Manages video track lifecycle
 */

import EventEmitter from "../../../events/EventEmitter";
import { log } from "../../../utils";

/**
 * Video processor events
 */
interface VideoProcessorEvents extends Record<string, unknown> {
  initialized: { stream: MediaStream };
  frameProcessed: undefined;
  error: { error: Error; context: string };
}

/**
 * VideoProcessor class
 */
export class VideoProcessor extends EventEmitter<VideoProcessorEvents> {
  private videoGenerator: MediaStreamTrackGenerator | null = null;
  private videoWriter: WritableStream | null = null;
  private mediaStream: MediaStream | null = null;

  /**
   * Initialize video system
   */
  init(): MediaStream {
    try {
      log("[VideoProcessor] Initializing video system...");

      // Check for MediaStreamTrackGenerator support
      if (typeof MediaStreamTrackGenerator !== "function") {
        console.error("[VideoProcessor] MediaStreamTrackGenerator not supported in this browser");
        throw new Error(
          "MediaStreamTrackGenerator not supported in this browser"
        );
      }

      log("[VideoProcessor] Creating MediaStreamTrackGenerator...");
      // Create video track generator
      this.videoGenerator = new MediaStreamTrackGenerator({
        kind: "video",
      });

      this.videoWriter = this.videoGenerator.writable;

      // Create MediaStream with video track only
      this.mediaStream = new MediaStream([this.videoGenerator]);

      // DEBUG: Track state
      // log("[VideoProcessor] 🎥 Track created, readyState:", this.videoGenerator.readyState);

      log("[VideoProcessor] ✅ Video system initialized, emitting 'initialized' event");
      this.emit("initialized", { stream: this.mediaStream });

      return this.mediaStream;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Video initialization failed");
      console.error("[VideoProcessor] ❌ Failed to initialize video system:", err);
      this.emit("error", { error: err, context: "init" });
      throw err;
    }
  }

  private frameCount = 0;

  /**
   * Write video frame
   */
  async writeFrame(frame: VideoFrame): Promise<void> {
    if (!this.videoWriter || !frame) {
      console.error("[VideoProcessor] ❌ writeFrame error: writer not initialized or invalid frame");
      throw new Error("Video writer not initialized or invalid frame");
    }

    // DEBUG: Check track state before writing
    if (this.videoGenerator) {
      const trackState = this.videoGenerator.readyState;
      if (trackState !== "live") {
        console.warn(`[VideoProcessor] ⚠️ Track is not live, state: ${trackState}`);
      }
    }

    try {
      const writer = this.videoWriter.getWriter();
      await writer.write(frame);
      writer.releaseLock();

      this.frameCount++;
      // if (this.frameCount <= 5 || this.frameCount % 100 === 0) {
      //   log(`[VideoProcessor] ✅ Frame ${this.frameCount} written successfully`);
      // }

      this.emit("frameProcessed", undefined);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Video write failed");
      console.error(`[VideoProcessor] ❌ Failed to write video frame #${this.frameCount}:`, err);

      // Check track state after error
      if (this.videoGenerator) {
        console.error("[VideoProcessor] Track state after error:", this.videoGenerator.readyState);
      }

      this.emit("error", { error: err, context: "writeFrame" });
      throw err;
    }
  }

  /**
   * Get media stream
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Cleanup video system
   */
  cleanup(): void {
    try {
      // Close video writer
      if (this.videoWriter) {
        try {
          const writer = this.videoWriter.getWriter();
          writer.releaseLock();
        } catch {
          // Writer might already be released
        }
        this.videoWriter = null;
      }

      // Stop video generator
      if (this.videoGenerator) {
        try {
          if (this.videoGenerator.stop) {
            this.videoGenerator.stop();
          }
        } catch {
          // Generator might already be stopped
        }
        this.videoGenerator = null;
      }

      this.mediaStream = null;

      log("Video system cleaned up");
    } catch (error) {
      console.warn("Error cleaning video system:", error);
    }
  }
}
