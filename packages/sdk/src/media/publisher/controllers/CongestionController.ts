import EventEmitter from '../../../events/EventEmitter';
import { TRANSPORT } from '../../../constants/transportConstants';
import type { WebRTCCongestionStats } from './WebRTCStatsPoller';

/** Server-sent QUIC connection stats (from Quinn) — publisher connection only sends RTT. */
export interface ServerConnectionStats {
  rtt_ms: number;
}

/**
 * Congestion severity levels — drives progressive video degradation.
 *
 * Level 0: Full quality
 * Level 1: Mild     — reduce fps + bitrate 50%
 * Level 2: Moderate — reduce fps + bitrate 25%
 * Level 3: Severe   — keyframes only, minimum bitrate
 * Level 4: Critical — keyframes only, 5% bitrate (video is NEVER turned off)
 */
export enum CongestionLevel {
  NORMAL   = 0,
  MILD     = 1,
  MODERATE = 2,
  SEVERE   = 3,
  CRITICAL = 4,
}

/** Per-level degradation factors — video is NEVER fully killed */
export const DEGRADATION_PROFILES: Record<CongestionLevel, { fpsCap: number; bitrateFactor: number }> = {
  [CongestionLevel.NORMAL]:   { fpsCap: 30, bitrateFactor: 1.0  },
  [CongestionLevel.MILD]:     { fpsCap: 15, bitrateFactor: 0.5  },
  [CongestionLevel.MODERATE]: { fpsCap: 10, bitrateFactor: 0.25 },
  [CongestionLevel.SEVERE]:   { fpsCap: 5,  bitrateFactor: 0.15 },
  [CongestionLevel.CRITICAL]: { fpsCap: 2,  bitrateFactor: 0.05 },
};

/**
 * CongestionController
 *
 * Detects uplink congestion using RFC 9002-aligned algorithms:
 *
 * 1. **Audio write latency** (HIGHEST priority — early-warning):
 *    Measured by AudioStreamSender on every successful write.
 *    Uses RFC 9002 §5.3 EWMA (7/8 + 1/8) for smoothing,
 *    and RFC 9002 §6.2 PTO-inspired variance thresholds for detection.
 *    Audio latency rise triggers proactive video degradation BEFORE
 *    audio is impacted.
 *
 * 2. **Video write latency** (secondary uplink signal):
 *    Measured by GopStreamSender. Same RFC 9002 EWMA + variance.
 *
 * 3. **RTT** (from server — bidirectional):
 *    Server sends `connection_stats` with `rtt_ms` every second.
 *    RTT ratio (smoothedRtt / baseRtt) detects queuing delays.
 *    Uses RFC 9002 §5.2 min_rtt with periodic reset.
 *
 * 4. **WebRTC getStats()** (optional — hybrid mode):
 *    Direct upload path measurements with  * The client-side CongestionController uses:
 *   1. writer.desiredSize      — PRIMARY: QUIC send buffer fill level
 *      desiredSize = highWaterMark - queueSize → gradual signal
 *      ratio = desiredSize / maxDesiredSize → 1.0=empty, 0=full, <0=over
 *   2. Write timeouts           — backup, triggers SEVERE/CRITICAL
 *   3. Server-reported RTT      — tertiary, detects path-level changes
 *   4. WebRTC stats             — packet loss + BWE from upload path
 *
 * ╭───────────────────────────────────────────────────────╮
 * │  Degrade: IMMEDIATE when threshold crossed            │
 * │  Recover: only after RECOVERY_HOLD_MS of sustained    │
 * │           good metrics, ONE level at a time            │
 * │  Video:  NEVER fully killed — min keyframes always    │
 * ╰───────────────────────────────────────────────────────╯
 */
export class CongestionController extends EventEmitter<{
  levelChanged: {
    level: CongestionLevel;
    previousLevel: CongestionLevel;
    latencyEMA: number;
    smoothedRtt: number;
    estimatedSendRate: number;
  };
}> {
  // ─── desiredSize tracking (PRIMARY signal) ───
  // desiredSize = highWaterMark - queueSize
  // ratio = current / max → 1.0 = empty, 0 = full, <0 = overfull
  private _videoDesiredSize = -1;   // latest video stream desiredSize
  private _videoMaxDS = 0;          // max seen (= highWaterMark reference)
  private _audioDesiredSize = -1;   // latest audio stream desiredSize
  private _audioMaxDS = 0;          // max seen

  // ─── Write latency EWMA (kept for debug logging) ───
  private _audioSmoothed = 0;
  private _audioVar = 0;
  private _audioBaseLatency = 0;
  private _audioBaseTimestamp = 0;
  private _writeSmoothed = 0;
  private _writeVar = 0;
  private _writeBaseLatency = 0;
  private _writeBaseTimestamp = 0;
  private _consecutiveTimeouts = 0;

  // ─── Server-reported RTT (bidirectional) ───
  private _smoothedRtt = 0;         // ms — from server (Quinn) or WebRTC
  private _baseRtt = 0;             // sliding min RTT (RFC 9002 §5.2)
  private _baseRttTimestamp = 0;    // for periodic reset
  private _hasServerStats = false;  // true once first server stats arrive

  // ─── WebRTC client-side stats (preferred over server stats) ───
  private _hasWebRTCStats = false;
  private _webRTCPacketsLost = 0;
  private _prevWebRTCPacketsLost = 0;
  private _availableBitrate = 0;     // GCC bandwidth estimate (bps)
  private _packetsLost = 0;          // unified for debug log

  // ─── State ───
  private _level = CongestionLevel.NORMAL;
  private _recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Backwards compatibility ───
  /** @deprecated Use writeSmoothed instead. Kept for API compat. */
  get latencyEMA(): number { return this._writeSmoothed; }

  // ──────────── DEBUG: bandwidth estimation log ────────────
  private _debugTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this._startDebugLog();
  }

  // ═══════════════════════════════════════════════════════════
  // desiredSize reporting (PRIMARY signal)
  // Called by AudioStreamSender / GopStreamSender on each write.
  // ═══════════════════════════════════════════════════════════

  /**
   * Report audio stream's writer.desiredSize.
   * desiredSize > 0 → buffer has space, ≤ 0 → buffer full/overfull.
   * We track the max observed value as reference (≈ highWaterMark).
   */
  reportAudioDesiredSize(desiredSize: number): void {
    if (desiredSize > this._audioMaxDS) {
      this._audioMaxDS = desiredSize;
    }
    this._audioDesiredSize = desiredSize;
    this._evaluateLevel();
  }

  /**
   * Report video stream's writer.desiredSize.
   */
  reportVideoDesiredSize(desiredSize: number): void {
    if (desiredSize > this._videoMaxDS) {
      this._videoMaxDS = desiredSize;
    }
    this._videoDesiredSize = desiredSize;
    this._evaluateLevel();
  }

  /**
   * Report audio write latency (kept for EWMA debug logging + fallback).
   */
  reportAudioWriteLatency(latencyMs: number): void {
    const now = Date.now();
    if (this._audioBaseLatency === 0
        || latencyMs < this._audioBaseLatency
        || now - this._audioBaseTimestamp > TRANSPORT.CONGESTION_BASE_RTT_WINDOW_MS) {
      this._audioBaseLatency = latencyMs;
      this._audioBaseTimestamp = now;
    }
    if (this._audioSmoothed === 0) {
      this._audioSmoothed = latencyMs;
      this._audioVar = latencyMs / 2;
    } else {
      this._audioVar = 0.75 * this._audioVar
          + 0.25 * Math.abs(this._audioSmoothed - latencyMs);
      this._audioSmoothed = 0.875 * this._audioSmoothed + 0.125 * latencyMs;
    }
    // NOTE: _evaluateLevel is NOT called here — desiredSize drives evaluation
  }

  /**
   * Report an audio write timeout.
   * Audio is highest priority — immediately escalate to CRITICAL
   * to maximally degrade video (keyframes only at 5% bitrate).
   */
  reportAudioTimeout(): void {
    // If already at CRITICAL, don't touch recovery timer.
    // Orphaned fire-and-forget writes from dead streams still fire
    // timeouts — clearing the recovery timer here would prevent
    // recovery from ever completing.
    if (this._level === CongestionLevel.CRITICAL) return;

    console.warn('[CongestionController] 🚨 Audio write timeout — escalating to CRITICAL');
    this._consecutiveTimeouts = TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES;
    this._writeSmoothed = TRANSPORT.GOP_WRITE_TIMEOUT_MS;
    this._clearRecoveryTimer();
    this._setLevel(CongestionLevel.CRITICAL);
  }

  // ═══════════════════════════════════════════════════════════
  // Video write latency (secondary uplink signal)
  // Called by GopStreamSender on each successful write.
  // ═══════════════════════════════════════════════════════════

  /**
   * Report a successful video write with its measured latency.
   *
   * Uses RFC 9002 §5.3 EWMA (7/8 + 1/8) for smoothing.
   */
  reportWriteLatency(latencyMs: number, _bytesSent: number): void {
    const now = Date.now();

    // RFC 9002 §5.2: sliding minimum with periodic reset
    if (this._writeBaseLatency === 0
        || latencyMs < this._writeBaseLatency
        || now - this._writeBaseTimestamp > TRANSPORT.CONGESTION_BASE_RTT_WINDOW_MS) {
      this._writeBaseLatency = latencyMs;
      this._writeBaseTimestamp = now;
    }

    // RFC 9002 §5.3
    if (this._writeSmoothed === 0) {
      this._writeSmoothed = latencyMs;
      this._writeVar = latencyMs / 2;
    } else {
      this._writeVar = 0.75 * this._writeVar
          + 0.25 * Math.abs(this._writeSmoothed - latencyMs);
      this._writeSmoothed = 0.875 * this._writeSmoothed + 0.125 * latencyMs;
    }

    if (this._consecutiveTimeouts > 0) {
      this._consecutiveTimeouts = 0;
    }

    this._evaluateLevel();
  }

  /**
   * Report a video write timeout (video frame could not be sent within deadline).
   */
  reportTimeout(): void {
    this._consecutiveTimeouts++;
    this._writeSmoothed = Math.max(this._writeSmoothed, TRANSPORT.GOP_WRITE_TIMEOUT_MS);
    this._evaluateLevel();
  }

  // ═══════════════════════════════════════════════════════════
  // Server stats (RTT from server — bidirectional)
  // Called by StreamManager when connection_stats event arrives.
  // ═══════════════════════════════════════════════════════════

  /**
   * Update from server-reported QUIC connection stats.
   *
   * On the publisher connection, server only sends RTT (bidirectional).
   * cwnd/lost_packets/congestion_events measure server→client downlink,
   * NOT the client's upload — they are NOT used.
   *
   * When WebRTC stats are available, they take priority.
   */
  updateFromServerStats(stats: ServerConnectionStats): void {
    if (this._hasWebRTCStats) return;

    this._hasServerStats = true;
    this._smoothedRtt = stats.rtt_ms;

    // RFC 9002 §5.2: sliding minimum with periodic reset
    this._updateBaseRtt(this._smoothedRtt);

    this._evaluateLevel();
  }

  // ═══════════════════════════════════════════════════════════
  // WebRTC client-side stats (preferred source)
  // ═══════════════════════════════════════════════════════════

  /**
   * Update from WebRTC `getStats()` — client-side measurements.
   * These measure the client→server upload path directly.
   */
  updateFromWebRTCStats(stats: WebRTCCongestionStats): void {
    this._hasWebRTCStats = true;
    this._smoothedRtt = stats.rttMs;

    this._updateBaseRtt(this._smoothedRtt);

    // Compute loss delta since last poll
    const lossThisPeriod = stats.packetsLost - this._prevWebRTCPacketsLost;
    this._prevWebRTCPacketsLost = stats.packetsLost;
    this._webRTCPacketsLost = stats.packetsLost;
    this._packetsLost = stats.packetsLost;

    if (stats.availableOutgoingBitrate !== undefined) {
      this._availableBitrate = stats.availableOutgoingBitrate;
    }

    this._evaluateLevelFromWebRTC(lossThisPeriod);
  }

  // ─── Getters ───

  get level(): CongestionLevel { return this._level; }
  get smoothedRtt(): number { return this._smoothedRtt; }
  get availableBitrate(): number { return this._availableBitrate; }
  get hasWebRTCStats(): boolean { return this._hasWebRTCStats; }
  get audioSmoothed(): number { return this._audioSmoothed; }
  get audioVar(): number { return this._audioVar; }
  get writeSmoothed(): number { return this._writeSmoothed; }
  get writeVar(): number { return this._writeVar; }

  // ═══════════════════════════════════════════════════════════
  // Level evaluation — unified, audio-first
  // ═══════════════════════════════════════════════════════════

  /**
   * Compute congestion level from all available signals.
   * Priority order: timeouts > audio latency > video latency > RTT ratio.
   *
   * Thresholds use RFC 9002 §6.2 PTO concept:
   *   threshold = smoothed + N × var  (with minimum floor)
   */
  private _evaluateLevel(): void {
    // Write / audio timeouts always override
    if (this._consecutiveTimeouts >= TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES) {
      this._clearRecoveryTimer();
      this._setLevel(CongestionLevel.CRITICAL);
      return;
    }
    if (this._consecutiveTimeouts >= 1) {
      this._clearRecoveryTimer();
      this._setLevel(CongestionLevel.SEVERE);
      return;
    }

    let target = CongestionLevel.NORMAL;

    // ── 1. desiredSize ratio (PRIMARY signal) ──
    // ratio = desiredSize / maxDesiredSize
    //   1.0  = buffer empty → no congestion
    //   0.75 = 25% full → watch
    //   0.5  = 50% full → MILD
    //   0.25 = 75% full → MODERATE/SEVERE
    //   ≤ 0  = 100% full → CRITICAL

    // Video desiredSize (largest bandwidth consumer)
    if (this._videoMaxDS > 0 && this._videoDesiredSize !== -1) {
      const vRatio = this._videoDesiredSize / this._videoMaxDS;
      if (vRatio <= 0) {
        target = Math.max(target, CongestionLevel.CRITICAL) as CongestionLevel;
      } else if (vRatio <= 0.25) {
        target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
      } else if (vRatio <= 0.5) {
        target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
      } else if (vRatio <= 0.75) {
        target = Math.max(target, CongestionLevel.MILD) as CongestionLevel;
      }
    }

    // Audio desiredSize (highest priority — overrides video if worse)
    if (this._audioMaxDS > 0 && this._audioDesiredSize !== -1) {
      const aRatio = this._audioDesiredSize / this._audioMaxDS;
      if (aRatio <= 0) {
        target = Math.max(target, CongestionLevel.CRITICAL) as CongestionLevel;
      } else if (aRatio <= 0.25) {
        target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
      } else if (aRatio <= 0.5) {
        target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
      }
    }

    // ── 2. RTT ratio (backup — detects path-level congestion) ──
    if (this._baseRtt > 0 && this._smoothedRtt > 0) {
      const rttRatio = this._smoothedRtt / this._baseRtt;
      if (rttRatio >= 5.0) {
        target = Math.max(target, CongestionLevel.CRITICAL) as CongestionLevel;
      } else if (rttRatio >= 3.0) {
        target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
      } else if (rttRatio >= 2.0) {
        target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
      } else if (rttRatio >= 1.5) {
        target = Math.max(target, CongestionLevel.MILD) as CongestionLevel;
      }
    }

    // Apply level transition rules
    if (target > this._level) {
      this._clearRecoveryTimer();
      this._setLevel(target);
    } else if (target < this._level) {
      this._scheduleRecovery();
    }
  }

  // ─── WebRTC stats level evaluation (has loss data from upload path) ───

  /**
   * Compute congestion level when WebRTC stats are available.
   * Adds packet loss (upload path measurement) on top of standard evaluation.
   */
  private _evaluateLevelFromWebRTC(recentLoss: number): void {
    // Write / audio timeouts always override
    if (this._consecutiveTimeouts >= TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES) {
      this._clearRecoveryTimer();
      this._setLevel(CongestionLevel.CRITICAL);
      return;
    }
    if (this._consecutiveTimeouts >= 1) {
      this._clearRecoveryTimer();
      this._setLevel(CongestionLevel.SEVERE);
      return;
    }

    let target = CongestionLevel.NORMAL;

    // desiredSize ratio (primary signal)
    if (this._videoMaxDS > 0 && this._videoDesiredSize !== -1) {
      const vRatio = this._videoDesiredSize / this._videoMaxDS;
      if (vRatio <= 0) target = Math.max(target, CongestionLevel.CRITICAL) as CongestionLevel;
      else if (vRatio <= 0.25) target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
      else if (vRatio <= 0.5) target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
      else if (vRatio <= 0.75) target = Math.max(target, CongestionLevel.MILD) as CongestionLevel;
    }
    if (this._audioMaxDS > 0 && this._audioDesiredSize !== -1) {
      const aRatio = this._audioDesiredSize / this._audioMaxDS;
      if (aRatio <= 0) target = Math.max(target, CongestionLevel.CRITICAL) as CongestionLevel;
      else if (aRatio <= 0.25) target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
      else if (aRatio <= 0.5) target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
    }

    // Packet loss from WebRTC (measures upload path)
    if (recentLoss >= 10) {
      target = Math.max(target, CongestionLevel.SEVERE) as CongestionLevel;
    } else if (recentLoss >= 3) {
      target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
    }

    // Apply level transition rules
    if (target > this._level) {
      this._clearRecoveryTimer();
      this._setLevel(target);
    } else if (target < this._level) {
      this._scheduleRecovery();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Update baseRtt with RFC 9002 §5.2 sliding minimum + periodic reset.
   * "Endpoints SHOULD set min_rtt to the newest RTT sample after persistent
   * congestion is established."
   */
  private _updateBaseRtt(rttMs: number): void {
    if (rttMs <= 0) return;
    const now = Date.now();

    if (this._baseRtt === 0
        || rttMs < this._baseRtt
        || now - this._baseRttTimestamp > TRANSPORT.CONGESTION_BASE_RTT_WINDOW_MS) {
      this._baseRtt = rttMs;
      this._baseRttTimestamp = now;
    }
  }

  private _setLevel(newLevel: CongestionLevel): void {
    if (newLevel === this._level) return;
    const prev = this._level;
    this._level = newLevel;

    // When entering CRITICAL, SendGate drops ALL video, so no new
    // reportVideoDesiredSize() calls will arrive. Reset stale signals
    // so the recovery timer doesn't get stuck on old values.
    if (newLevel === CongestionLevel.CRITICAL) {
      this._videoDesiredSize = -1;  // "no signal" — won't block recovery
      this._audioDesiredSize = -1;  // audio stream may also be dead
      this._consecutiveTimeouts = 0; // already at max level
      // Proactively schedule recovery so we don't depend solely on
      // external signals (server RTT) to kick-start the step-down.
      this._scheduleRecovery();
    }

    const levelNames = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE', 'CRITICAL'];
    console.warn(
      `[CongestionController] Level ${levelNames[prev]} → ${levelNames[newLevel]}` +
      `  (rtt=${this._smoothedRtt.toFixed(1)}ms, baseRtt=${this._baseRtt.toFixed(1)}ms,` +
      ` audioSmoothed=${this._audioSmoothed.toFixed(1)}ms, audioVar=${this._audioVar.toFixed(1)}ms,` +
      ` writeSmoothed=${this._writeSmoothed.toFixed(1)}ms, writeVar=${this._writeVar.toFixed(1)}ms,` +
      ` timeouts=${this._consecutiveTimeouts})`,
    );

    this.emit('levelChanged', {
      level: newLevel,
      previousLevel: prev,
      latencyEMA: this._writeSmoothed,
      smoothedRtt: this._smoothedRtt,
      estimatedSendRate: 0, // deprecated, kept for API compat
    });
  }

  private _scheduleRecovery(): void {
    if (this._recoveryTimer) return;

    this._recoveryTimer = setTimeout(() => {
      this._recoveryTimer = null;

      // Re-check: compute current target level from desiredSize
      let currentTarget = CongestionLevel.NORMAL;

      // desiredSize check
      if (this._videoMaxDS > 0 && this._videoDesiredSize !== -1) {
        const vRatio = this._videoDesiredSize / this._videoMaxDS;
        if (vRatio <= 0) currentTarget = Math.max(currentTarget, CongestionLevel.CRITICAL) as CongestionLevel;
        else if (vRatio <= 0.25) currentTarget = Math.max(currentTarget, CongestionLevel.SEVERE) as CongestionLevel;
        else if (vRatio <= 0.5) currentTarget = Math.max(currentTarget, CongestionLevel.MODERATE) as CongestionLevel;
        else if (vRatio <= 0.75) currentTarget = Math.max(currentTarget, CongestionLevel.MILD) as CongestionLevel;
      }
      if (this._audioMaxDS > 0 && this._audioDesiredSize !== -1) {
        const aRatio = this._audioDesiredSize / this._audioMaxDS;
        if (aRatio <= 0) currentTarget = Math.max(currentTarget, CongestionLevel.CRITICAL) as CongestionLevel;
        else if (aRatio <= 0.25) currentTarget = Math.max(currentTarget, CongestionLevel.SEVERE) as CongestionLevel;
        else if (aRatio <= 0.5) currentTarget = Math.max(currentTarget, CongestionLevel.MODERATE) as CongestionLevel;
      }

      // RTT check
      if (this._baseRtt > 0 && this._smoothedRtt > 0) {
        const rttRatio = this._smoothedRtt / this._baseRtt;
        if (rttRatio >= 5.0) currentTarget = Math.max(currentTarget, CongestionLevel.CRITICAL) as CongestionLevel;
        else if (rttRatio >= 3.0) currentTarget = Math.max(currentTarget, CongestionLevel.SEVERE) as CongestionLevel;
        else if (rttRatio >= 2.0) currentTarget = Math.max(currentTarget, CongestionLevel.MODERATE) as CongestionLevel;
        else if (rttRatio >= 1.5) currentTarget = Math.max(currentTarget, CongestionLevel.MILD) as CongestionLevel;
      }

      if (currentTarget < this._level) {
        this._setLevel((this._level - 1) as CongestionLevel);
        if (currentTarget < this._level) {
          this._scheduleRecovery();
        }
      }
    }, TRANSPORT.CONGESTION_RECOVERY_HOLD_MS);
  }

  private _clearRecoveryTimer(): void {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }

  // ──────────── DEBUG: bandwidth estimation log ────────────

  private _startDebugLog(): void {
    const interval = TRANSPORT.CONGESTION_DEBUG_LOG_INTERVAL_MS;
    if (!interval) return;

    this._debugTimer = setInterval(() => {
      const levelNames = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE', 'CRITICAL'];
      const rttRatio = this._baseRtt > 0 ? (this._smoothedRtt / this._baseRtt).toFixed(2) : 'N/A';
      const source = this._hasWebRTCStats ? 'webrtc'
        : (this._videoMaxDS > 0 || this._audioMaxDS > 0) ? 'desiredSize'
        : this._hasServerStats ? 'server(rtt)'
        : 'no-signal';
      const bweStr = this._availableBitrate > 0 ? `${(this._availableBitrate / 1000).toFixed(0)}kbps` : 'N/A';
      const vDS = this._videoMaxDS > 0 ? `${(this._videoDesiredSize / this._videoMaxDS * 100).toFixed(0)}%` : 'N/A';
      const aDS = this._audioMaxDS > 0 ? `${(this._audioDesiredSize / this._audioMaxDS * 100).toFixed(0)}%` : 'N/A';
      console.log(
        `[CongestionController] 📊 uplink (${source}): ` +
        `videoDS=${vDS}  audioDS=${aDS}  ` +
        `rtt=${this._smoothedRtt.toFixed(1)}ms  ` +
        `baseRtt=${this._baseRtt.toFixed(1)}ms  ` +
        `ratio=${rttRatio}  ` +
        `lost=${this._packetsLost}  ` +
        `bwe=${bweStr}  ` +
        `level=${levelNames[this._level]}`,
      );
    }, interval);
  }

  /**
   * Cleanup timers. Call when publisher is destroyed.
   */
  dispose(): void {
    this._clearRecoveryTimer();
    if (this._debugTimer) {
      clearInterval(this._debugTimer);
      this._debugTimer = null;
    }
  }
}
