/**
 * VideoProcessor - Manages video processing for subscriber
 *
 * Responsibilities:
 * - Initializes MediaStreamTrackGenerator for video
 * - Handles video frame writing
 * - Optional jitter buffer for smooth playback (screen share)
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
  private videoWriter: WritableStreamDefaultWriter | null = null;
  private mediaStream: MediaStream | null = null;

  // Jitter buffer - smooths bursty frame delivery into adaptive-rate output
  private jitterBufferEnabled = false;
  private jitterBuffer: VideoFrame[] = [];
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackTimerActive = false;
  private playbackIntervalMs = 50; // 20fps output rate
  private targetBufferSize = 3; // Aim to keep ~3 frames buffered (150ms at 20fps)
  private maxBufferSize = 15; // Drop oldest frames if buffer exceeds this
  private isWriting = false; // Guard against overlapping writes

  // Diagnostics
  private frameCount = 0;
  private lastFrameArrivalTime = 0;
  private frameArrivalGaps: number[] = [];

  /**
   * Enable jitter buffer for smooth playback
   * @param fps - Target output framerate (used to calculate playback interval)
   */
  enableJitterBuffer(fps: number = 20): void {
    this.jitterBufferEnabled = true;
    this.playbackIntervalMs = Math.round(1000 / fps);
    this.targetBufferSize = Math.max(2, Math.ceil(fps * 0.15)); // ~150ms worth of frames
    this.maxBufferSize = fps; // 1 second max
    log(`[VideoProcessor] Jitter buffer enabled: ${fps}fps, interval=${this.playbackIntervalMs}ms, targetBuffer=${this.targetBufferSize}`);
  }

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

      this.videoWriter = this.videoGenerator.writable.getWriter();

      // Create MediaStream with video track only
      this.mediaStream = new MediaStream([this.videoGenerator]);

      // Start jitter buffer playback timer
      if (this.jitterBufferEnabled) {
        this.startPlaybackTimer();
      }

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

  /**
   * Write video frame (with optional jitter buffer)
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

    // Diagnostic: measure arrival timing
    const now = performance.now();
    if (this.lastFrameArrivalTime > 0) {
      this.frameArrivalGaps.push(now - this.lastFrameArrivalTime);
    }
    this.lastFrameArrivalTime = now;

    if (this.frameArrivalGaps.length >= 100) {
      const gaps = this.frameArrivalGaps;
      const min = Math.min(...gaps).toFixed(1);
      const max = Math.max(...gaps).toFixed(1);
      const avg = (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1);
      const jitter = gaps.filter(g => g > 100).length;
      console.warn(`[VideoProcessor] 📊 ARRIVAL: min=${min}ms max=${max}ms avg=${avg}ms jitter(>100ms)=${jitter}/100 buffer=${this.jitterBuffer.length}`);
      this.frameArrivalGaps = [];
    }

    // Jitter buffer mode: queue frame for fixed-rate playback
    if (this.jitterBufferEnabled) {
      this.jitterBuffer.push(frame);

      // Drop oldest frames if buffer is too large (prevent memory buildup)
      while (this.jitterBuffer.length > this.maxBufferSize) {
        const dropped = this.jitterBuffer.shift();
        try { dropped?.close(); } catch {}
        console.warn(`[VideoProcessor] ⚠️ Jitter buffer overflow, dropped frame (size=${this.jitterBuffer.length})`);
      }
      return;
    }

    // No jitter buffer — write immediately
    await this.writeFrameDirect(frame);
  }

  /**
   * Write a single frame to the video writer directly
   */
  private async writeFrameDirect(frame: VideoFrame): Promise<void> {
    try {
      await this.videoWriter!.write(frame);

      this.frameCount++;
      this.emit("frameProcessed", undefined);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Video write failed");
      console.error(`[VideoProcessor] ❌ Failed to write video frame #${this.frameCount}:`, err);

      if (this.videoGenerator) {
        console.error("[VideoProcessor] Track state after error:", this.videoGenerator.readyState);
      }

      this.emit("error", { error: err, context: "writeFrame" });
      throw err;
    }
  }

  // ==========================================
  // === Jitter Buffer Playback             ===
  // ==========================================

  /**
   * Start the adaptive-rate playback timer
   * Writes one frame from the buffer at each tick, adjusting rate based on backlog
   */
  private startPlaybackTimer(): void {
    this.stopPlaybackTimer();
    this.playbackTimerActive = true;
    log(`[VideoProcessor] Starting jitter buffer playback at ~${this.playbackIntervalMs}ms intervals`);

    const tick = () => {
      if (!this.playbackTimerActive) return;

      this.playbackTick().finally(() => {
        if (!this.playbackTimerActive) return;

        let delay = this.playbackIntervalMs;
        const backlog = this.jitterBuffer.length;

        // Adaptive delay: drain faster if buffer builds up
        if (backlog > this.targetBufferSize * 2) {
          delay = 5;  // extremely fast to catch up
        } else if (backlog > this.targetBufferSize) {
          delay = Math.max(5, Math.floor(this.playbackIntervalMs / 2)); // faster drain
        }

        this.playbackTimer = setTimeout(tick, delay);
      });
    };

    this.playbackTimer = setTimeout(tick, this.playbackIntervalMs);
  }

  /**
   * Stop the playback timer
   */
  private stopPlaybackTimer(): void {
    this.playbackTimerActive = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * Playback tick: write one frame from the buffer
   * Called at fixed intervals for smooth output
   */
  private async playbackTick(): Promise<void> {
    // Guard against overlapping writes
    if (this.isWriting) return;

    if (this.jitterBuffer.length === 0) {
      // Buffer underrun — no frame to show, keep showing last frame
      return;
    }

    this.isWriting = true;
    try {
      // Take the next frame from the buffer
      const frame = this.jitterBuffer.shift()!;
      await this.writeFrameDirect(frame);
    } catch {
      // Write failed, skip frame
    } finally {
      this.isWriting = false;
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
      // Stop playback timer and close buffered frames
      this.stopPlaybackTimer();
      for (const frame of this.jitterBuffer) {
        try { frame.close(); } catch {}
      }
      this.jitterBuffer = [];

      // Close video writer
      if (this.videoWriter) {
        try {
          this.videoWriter.releaseLock();
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
