import { CongestionLevel } from './CongestionController';
import type { CongestionController } from './CongestionController';

/**
 * SendGate — proactive admission control (virtual queue).
 *
 * Sits BETWEEN the encoder output and the transport layer.
 * Decides whether a frame should be sent or dropped **before** it
 * touches the QUIC pipe, preventing video from hogging the congestion
 * window when audio is struggling.
 *
 * Key rule: if audio can't send (CongestionLevel = CRITICAL),
 * ALL video is dropped at the gate — zero cost, zero pipe waste.
 *
 * ┌──────────┐      ┌──────────┐      ┌──────────┐
 * │ Encoder  │ ───▶ │ SendGate │ ───▶ │ Sender   │
 * └──────────┘      │ (drop?)  │      └──────────┘
 *                   └──────────┘
 */
export class SendGate {
  private _droppedFrames = 0;
  private _passedFrames = 0;
  private _droppedGops = 0;
  private _passedGops = 0;
  private _lastLogTime = 0;

  /** Whether the current GOP is allowed through the gate */
  private _currentGopAllowed = true;
  /** GOP counter — used for alternating drop in MODERATE */
  private _gopCount = 0;

  constructor(private readonly congestionController: CongestionController) {}

  /**
   * Called when a new GOP starts (keyframe detected by VideoSendStrategy).
   *
   * Makes a **GOP-level** decision: the entire GOP will be sent or dropped.
   * This prevents mid-GOP frame dropping which causes H.264 decoder artifacts
   * (delta frames depend on ALL previous frames in the GOP).
   *
   * Decision matrix:
   * - NORMAL / MILD:     send entire GOP
   * - MODERATE:          alternating GOPs (~50% GOP drop → video freezes ~1s)
   * - SEVERE:            keyframe-only (send KF, drop all deltas → freeze after 1 frame)
   * - CRITICAL:          drop ALL video (audio needs the entire pipe)
   *
   * @returns true if the GOP's keyframe should be sent (GOP is allowed or SEVERE keyframe-only)
   */
  startNewGop(): boolean {
    const level = this.congestionController.level;
    this._gopCount++;

    switch (level) {
      case CongestionLevel.NORMAL:
      case CongestionLevel.MILD:
        this._currentGopAllowed = true;
        break;

      case CongestionLevel.MODERATE:
        // Drop every other GOP — video freezes for ~1 GOP duration (~1s)
        // instead of showing broken frames from partial GOP delivery
        this._currentGopAllowed = (this._gopCount % 2 === 0);
        break;

      case CongestionLevel.SEVERE:
        // Keyframe-only mode: don't send full GOPs, only isolated keyframes
        // Decoder will show 1 frame then freeze — no artifacts
        this._currentGopAllowed = false;
        break;

      case CongestionLevel.CRITICAL:
        this._currentGopAllowed = false;
        break;

      default:
        this._currentGopAllowed = true;
    }

    // Track GOP stats
    if (this._currentGopAllowed) {
      this._passedGops++;
    } else {
      this._droppedGops++;
    }

    // In SEVERE: we still want to send the keyframe itself (just no deltas)
    // so the decoder can show a still frame instead of nothing
    const sendKeyframe = this._currentGopAllowed || level === CongestionLevel.SEVERE;

    if (!sendKeyframe) {
      this._logDrops(level);
    }

    return sendKeyframe;
  }

  /**
   * Should this video frame be sent?
   *
   * Uses the GOP-level decision from startNewGop().
   * Frames within a GOP are either ALL sent or ALL dropped — never partial.
   * This prevents H.264 decoder artifacts from incomplete GOPs.
   *
   * Exception: SEVERE mode sends keyframe only (decided in startNewGop),
   * then drops all subsequent delta frames.
   */
  shouldSendVideo(isKeyframe: boolean): boolean {
    const level = this.congestionController.level;

    // CRITICAL: drop everything
    if (level === CongestionLevel.CRITICAL) {
      this._droppedFrames++;
      this._logDrops(level);
      return false;
    }

    // SEVERE: keyframe only — delta frames are always dropped
    // The keyframe was already allowed through in startNewGop()
    if (level === CongestionLevel.SEVERE && !isKeyframe) {
      this._droppedFrames++;
      this._logDrops(level);
      return false;
    }

    // For NORMAL/MILD/MODERATE: follow the GOP-level decision
    if (this._currentGopAllowed) {
      this._passedFrames++;
      return true;
    }

    this._droppedFrames++;
    this._logDrops(level);
    return false;
  }

  /**
   * Audio is NEVER gated — always returns true.
   * Audio bandwidth (~50kbps) is negligible; blocking it only makes things worse.
   */
  shouldSendAudio(): boolean {
    return true;
  }

  /** Number of video frames dropped by the gate since creation. */
  get droppedFrames(): number {
    return this._droppedFrames;
  }

  /** Number of video frames allowed through since creation. */
  get passedFrames(): number {
    return this._passedFrames;
  }

  /** Log drops periodically (max once per second) to avoid spam. */
  private _logDrops(level: CongestionLevel): void {
    const now = performance.now();
    if (now - this._lastLogTime < 1_000) return;
    this._lastLogTime = now;

    const levelNames = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE', 'CRITICAL'];
    console.warn(
      `[SendGate] 🚫 Video gated — level=${levelNames[level]} ` +
      `dropped=${this._droppedFrames} passed=${this._passedFrames} ` +
      `gopsDropped=${this._droppedGops} gopsPassed=${this._passedGops}`,
    );
  }
}
