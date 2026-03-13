import { ChannelName } from "../../../types/media/publisher.types";
import type { VideoEncoderConfig } from "../../../types/media/publisher.types";
import type { VideoProcessor } from "../processors/VideoProcessor";

/**
 * Per-channel allocation state.
 */
export interface ChannelAllocation {
  channelName: ChannelName;
  /** Original bitrate from SubStream config */
  originalBitrate: number;
  /** Original fps from SubStream config */
  originalFps: number;
  /** Currently applied bitrate */
  currentBitrate: number;
  /** Currently applied fps */
  currentFps: number;
  /** Whether this channel is fully paused (skip all frames) */
  paused: boolean;
  /** Priority order: lower = more important = degraded last */
  priority: number;
}

/**
 * Summary of the current allocation for UI display.
 */
export interface AllocationSummary {
  /** GCC target bitrate (bps) */
  targetBitrate: number;
  /** Total video bitrate currently allocated (bps) */
  allocatedBitrate: number;
  /** Per-channel allocations */
  channels: ChannelAllocation[];
}

// --------------------------------------------------------------------------
// Stream priority (lower = more important = degraded LAST)
// --------------------------------------------------------------------------
const PRIORITY_MAP: Partial<Record<ChannelName, number>> = {
  // Audio streams: priority 0 — NEVER degraded
  [ChannelName.MICROPHONE]: 0,
  [ChannelName.SCREEN_SHARE_AUDIO]: 0,
  [ChannelName.LIVESTREAM_AUDIO]: 0,

  // Screen share video: priority 1 — degraded after camera
  [ChannelName.SCREEN_SHARE_720P]: 1,
  [ChannelName.SCREEN_SHARE_1080P]: 1,
  [ChannelName.LIVESTREAM_720P]: 1,

  // Camera video: priority 2 — degraded FIRST
  [ChannelName.VIDEO_360P]: 2,
  [ChannelName.VIDEO_720P]: 2,
  [ChannelName.VIDEO_1080P]: 2,
  [ChannelName.VIDEO_1440P]: 2,
};

function isAudioChannel(ch: ChannelName): boolean {
  return (PRIORITY_MAP[ch] ?? 99) === 0;
}

// FPS degradation ladder for smooth reduction
const FPS_LADDER = [30, 24, 20, 15, 10, 7, 5];

function findClosestFps(targetFps: number): number {
  for (const fps of FPS_LADDER) {
    if (fps <= targetFps) return fps;
  }
  return FPS_LADDER[FPS_LADDER.length - 1];
}

/**
 * AdaptiveMediaController — Continuous Bitrate Allocator
 *
 * Receives a continuous `targetBitrate` (bps) from the GCC engine and
 * distributes it across video channels according to priority:
 *
 * 1. Audio channels are NEVER touched
 * 2. Camera video is degraded FIRST (highest priority number)
 * 3. Screen share video is degraded AFTER camera
 *
 * Uses proportional allocation: each video channel gets a fraction of the
 * remaining bitrate budget proportional to its original share.
 */
export class AdaptiveMediaController {
  private _channels = new Map<ChannelName, ChannelAllocation>();
  private _pausedChannels = new Set<ChannelName>();
  private _currentTargetBitrate = 0;

  // References to processors for reconfiguration
  private _videoProcessor: VideoProcessor | null = null;
  private _screenVideoProcessor: VideoProcessor | null = null;

  // Callback to abort GOP streams on pause (wired to StreamManager)
  private _gopAbortCallback: ((channelName: ChannelName) => Promise<void>) | null = null;

  /**
   * Register the camera video processor.
   */
  setVideoProcessor(processor: VideoProcessor | null): void {
    this._videoProcessor = processor;
  }

  /**
   * Register the screen share video processor.
   */
  setScreenVideoProcessor(processor: VideoProcessor | null): void {
    this._screenVideoProcessor = processor;
  }

  /**
   * Set callback to abort GOP streams when channels are paused.
   * Wired by Publisher to StreamManager.abortGopForChannel().
   */
  setGopAbortCallback(cb: ((channelName: ChannelName) => Promise<void>) | null): void {
    this._gopAbortCallback = cb;
  }

  /**
   * Register a channel with its original config.
   */
  registerChannel(channelName: ChannelName, bitrate: number, fps: number): void {
    this._channels.set(channelName, {
      channelName,
      originalBitrate: bitrate,
      originalFps: fps,
      currentBitrate: bitrate,
      currentFps: fps,
      paused: false,
      priority: PRIORITY_MAP[channelName] ?? 99,
    });
  }

  /**
   * Unregister a channel (e.g. when screen share stops).
   */
  unregisterChannel(channelName: ChannelName): void {
    this._channels.delete(channelName);
    this._pausedChannels.delete(channelName);
  }

  /**
   * Apply a new target bitrate from the GCC engine.
   * Distributes the budget across video channels proportionally.
   */
  async applyTargetBitrate(targetBitrate: number): Promise<void> {
    this._currentTargetBitrate = targetBitrate;

    // Separate audio vs video channels
    const audioChannels: ChannelAllocation[] = [];
    const videoChannels: ChannelAllocation[] = [];

    for (const ch of this._channels.values()) {
      if (isAudioChannel(ch.channelName)) {
        audioChannels.push(ch);
      } else {
        videoChannels.push(ch);
      }
    }

    // Audio is never degraded — subtract their original bitrate from budget
    let audioBudget = 0;
    for (const ch of audioChannels) {
      audioBudget += ch.originalBitrate;
    }

    // Remaining budget for video
    const videoBudget = Math.max(0, targetBitrate - audioBudget);

    // Total original video bitrate
    let totalOriginalVideo = 0;
    for (const ch of videoChannels) {
      totalOriginalVideo += ch.originalBitrate;
    }

    if (totalOriginalVideo === 0) return;

    // Sort video channels by priority (highest number = degraded first)
    videoChannels.sort((a, b) => b.priority - a.priority);

    // Ratio of available budget to total original
    const budgetRatio = videoBudget / totalOriginalVideo;

    if (budgetRatio >= 1.0) {
      // Plenty of budget — restore all to original
      for (const ch of videoChannels) {
        await this._setChannelBitrate(ch, ch.originalBitrate, ch.originalFps, false);
      }
    } else if (budgetRatio <= 0) {
      // No video budget at all — pause everything
      for (const ch of videoChannels) {
        await this._setChannelBitrate(ch, 0, 0, true);
      }
    } else {
      // Proportional degradation with priority-aware distribution
      // Camera channels (priority 2) get degraded more aggressively than screen share (priority 1)
      await this._allocateByPriority(videoChannels, videoBudget, totalOriginalVideo);
    }
  }

  /**
   * Priority-aware allocation: degrade highest-priority-number channels first.
   */
  private async _allocateByPriority(
    channels: ChannelAllocation[], // sorted by priority DESC (camera first)
    budget: number,
    totalOriginal: number,
  ): Promise<void> {
    // Group by priority
    const priorityGroups = new Map<number, ChannelAllocation[]>();
    for (const ch of channels) {
      const group = priorityGroups.get(ch.priority) ?? [];
      group.push(ch);
      priorityGroups.set(ch.priority, group);
    }

    // Sort priorities descending (camera=2 first, screen=1 second)
    const priorities = Array.from(priorityGroups.keys()).sort((a, b) => b - a);

    let remainingBudget = budget;

    for (const priority of priorities) {
      const group = priorityGroups.get(priority)!;
      const groupOriginal = group.reduce((sum, ch) => sum + ch.originalBitrate, 0);

      // How much other groups (higher priority = lower number) need
      const otherGroupsOriginal = totalOriginal - groupOriginal;
      const budgetForOtherGroups = Math.min(remainingBudget, otherGroupsOriginal);

      // This group gets whatever's left after reserving for more important groups
      const budgetForThisGroup = Math.max(0, remainingBudget - budgetForOtherGroups);
      const groupRatio = groupOriginal > 0 ? budgetForThisGroup / groupOriginal : 0;

      for (const ch of group) {
        if (groupRatio <= 0.05) {
          // Less than 5% of original → pause entirely
          await this._setChannelBitrate(ch, 0, 0, true);
        } else {
          const newBitrate = Math.round(ch.originalBitrate * Math.min(groupRatio, 1.0));
          // Scale FPS proportionally — but use ladder for clean values
          const fpsRatio = Math.min(groupRatio * 1.2, 1.0); // FPS degrades slower than bitrate
          const targetFps = findClosestFps(Math.round(ch.originalFps * fpsRatio));
          await this._setChannelBitrate(ch, newBitrate, targetFps, false);
        }
      }

      remainingBudget = Math.max(0, remainingBudget - budgetForThisGroup);
    }
  }

  private async _setChannelBitrate(
    ch: ChannelAllocation,
    bitrate: number,
    fps: number,
    paused: boolean,
  ): Promise<void> {
    // Skip if nothing changed
    if (ch.currentBitrate === bitrate && ch.currentFps === fps && ch.paused === paused) {
      return;
    }

    // Detect unpause transition: was paused, now resuming
    const isResuming = ch.paused && !paused;

    ch.currentBitrate = bitrate;
    ch.currentFps = fps;
    ch.paused = paused;

    // Update pause set
    if (paused) {
      this._pausedChannels.add(ch.channelName);

      // Proactive flush: abort current GOP stream to discard buffered frames.
      // Without this, stale video frames continue draining through QUIC,
      // clogging bandwidth and starving audio during congestion.
      if (this._gopAbortCallback) {
        this._gopAbortCallback(ch.channelName).catch((err) =>
          console.warn(`[GCC Allocator] GOP abort failed for ${ch.channelName}:`, err)
        );
      }
    } else {
      this._pausedChannels.delete(ch.channelName);
    }

    // Reconfigure encoder (skip if paused — frames will be skipped by StreamManager)
    if (!paused && bitrate > 0) {
      const isCamera = (ch.priority === 2);
      const processor = isCamera ? this._videoProcessor : this._screenVideoProcessor;
      if (processor) {
        const doReconfigure = async (attempt: number) => {
          try {
            await processor.reconfigureEncoder(ch.channelName, {
              bitrate,
              framerate: fps,
            } as Partial<VideoEncoderConfig>);

            // Force keyframe on resume so a new GOP stream opens immediately.
            if (isResuming) {
              processor.requestKeyframeForChannel(ch.channelName);
              console.log(
                `[GCC Allocator] RESUME: ${ch.channelName} — forcing keyframe for new GOP`,
              );
            }
          } catch (error) {
            console.error(
              `[GCC Allocator] Failed to reconfigure ${ch.channelName} (attempt ${attempt}):`,
              error,
            );
            // Retry once after a short delay (gives encoder time to settle)
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 200));
              return doReconfigure(attempt + 1);
            }
          }
        };
        await doReconfigure(1);
      }
    }

    console.log(
      `[GCC Allocator] ${ch.channelName}: ${Math.round(bitrate / 1000)}kbps` +
      ` ${fps}fps paused=${paused}` +
      ` (was ${Math.round(ch.originalBitrate / 1000)}kbps ${ch.originalFps}fps)`,
    );
  }

  /**
   * Immediately pause ALL video channels to free bandwidth for audio.
   * Called when quality drops to POOR/CRITICAL — audio must not compete
   * with video for bandwidth during congestion.
   */
  async pauseAllVideo(): Promise<void> {
    for (const ch of this._channels.values()) {
      if (!isAudioChannel(ch.channelName) && !ch.paused) {
        await this._setChannelBitrate(ch, 0, 0, true);
      }
    }
  }

  /**
   * Check whether a video frame for the given channel should be skipped.
   */
  shouldSkipFrame(channelName: ChannelName): boolean {
    return this._pausedChannels.has(channelName);
  }

  /**
   * Get the current allocation summary for UI.
   */
  getAllocationSummary(): AllocationSummary {
    let allocated = 0;
    for (const ch of this._channels.values()) {
      if (!isAudioChannel(ch.channelName)) {
        allocated += ch.currentBitrate;
      }
    }

    return {
      targetBitrate: this._currentTargetBitrate,
      allocatedBitrate: allocated,
      channels: Array.from(this._channels.values()),
    };
  }

  /**
   * Get the total original bitrate of all registered channels.
   * Used to update NetworkQualityMonitor.initialBitrate when channels change.
   */
  getTotalRegisteredBitrate(): number {
    let total = 0;
    for (const ch of this._channels.values()) {
      total += ch.originalBitrate;
    }
    return total;
  }

  /** Clean up. */
  dispose(): void {
    this._channels.clear();
    this._pausedChannels.clear();
    this._videoProcessor = null;
    this._screenVideoProcessor = null;
    this._gopAbortCallback = null;
    console.log("[GCC Allocator] Disposed");
  }
}
