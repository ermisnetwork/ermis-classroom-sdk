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
  private _lastLogTime = 0;

  constructor(private readonly congestionController: CongestionController) {}

  /**
   * Should this video frame be sent?
   *
   * Decision matrix (based on CongestionLevel):
   * - NORMAL / MILD:  send all
   * - MODERATE:       keyframes only + 50% deltas (probabilistic thinning)
   * - SEVERE:         keyframes only
   * - CRITICAL:       drop ALL video (audio needs the entire pipe)
   */
  shouldSendVideo(isKeyframe: boolean): boolean {
    const level = this.congestionController.level;

    let allow: boolean;

    switch (level) {
      case CongestionLevel.NORMAL:
      case CongestionLevel.MILD:
        allow = true;
        break;

      case CongestionLevel.MODERATE:
        // Keep keyframes + thin delta frames to ~50%
        allow = isKeyframe || (this._passedFrames % 2 === 0);
        break;

      case CongestionLevel.SEVERE:
        // Only keyframes survive
        allow = isKeyframe;
        break;

      case CongestionLevel.CRITICAL:
        // Audio can't send → kill ALL video
        allow = false;
        break;

      default:
        allow = true;
    }

    if (allow) {
      this._passedFrames++;
    } else {
      this._droppedFrames++;
      this._logDrops(level);
    }

    return allow;
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
      `dropped=${this._droppedFrames} passed=${this._passedFrames}`,
    );
  }
}
