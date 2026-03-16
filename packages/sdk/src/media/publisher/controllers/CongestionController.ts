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
 * Level 1: Mild    — reduce fps + bitrate 50%
 * Level 2: Moderate — reduce fps + bitrate 25%
 * Level 3: Severe  — minimum video
 * Level 4: Critical — video OFF
 */
export enum CongestionLevel {
  NORMAL   = 0,
  MILD     = 1,
  MODERATE = 2,
  SEVERE   = 3,
  CRITICAL = 4,
}

/** Per-level degradation factors */
export const DEGRADATION_PROFILES: Record<CongestionLevel, { fpsCap: number; bitrateFactor: number }> = {
  [CongestionLevel.NORMAL]:   { fpsCap: 30, bitrateFactor: 1.0  },
  [CongestionLevel.MILD]:     { fpsCap: 15, bitrateFactor: 0.5  },
  [CongestionLevel.MODERATE]: { fpsCap: 10, bitrateFactor: 0.25 },
  [CongestionLevel.SEVERE]:   { fpsCap: 5,  bitrateFactor: 0.15 },
  [CongestionLevel.CRITICAL]: { fpsCap: 0,  bitrateFactor: 0    },
};

/**
 * CongestionController
 *
 * Detects uplink congestion using standard-based signals:
 *
 * 1. **Write latency EMA** (from GopStreamSender — direct uplink):
 *    Measures how long `writer.write()` blocks on the QUIC stream.
 *    When QUIC send buffer is full (uplink congested), writes block longer.
 *    Thresholds: ≥40ms → MILD, ≥70ms → MODERATE (per transportConstants).
 *
 * 2. **Write timeouts** (from GopStreamSender / AudioStreamSender):
 *    Video write >200ms → SEVERE. Audio timeout → CRITICAL (kill video).
 *
 * 3. **Packet loss** (WebRTC hybrid mode only — per GCC standard):
 *    ≥3 lost packets → MODERATE, ≥10 → SEVERE.
 *
 * RTT ratio (smoothedRtt/baseRtt) was removed — it is NOT a standard signal.
 * GCC uses delay gradient via Kalman filter; RTT ratio produces false positives
 * on low-latency links (e.g. baseRtt=6ms, jitter→20ms = ratio 3x, 0% loss).
 *
 * Server RTT is still tracked for debug logging but is NOT used for detection.
 *
 * ╭───────────────────────────────────────────────────────╮
 * │  Degrade: IMMEDIATE when threshold crossed            │
 * │  Recover: only after RECOVERY_HOLD_MS of sustained    │
 * │           good metrics, ONE level at a time            │
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
  // ─── Write-latency EMA (primary uplink signal from GopStreamSender) ───
  private _latencyEMA = 0;
  private _consecutiveTimeouts = 0;

  // ─── Server-reported RTT (bidirectional) ───
  private _smoothedRtt = 0;            // ms — from server (Quinn) or WebRTC
  private _baseRtt = 0;               // first RTT seen (proxy for minRtt)
  private _hasServerStats = false;     // true once first server stats arrive

  // ─── WebRTC client-side stats (preferred over server stats) ───
  private _hasWebRTCStats = false;     // true once first WebRTC stats arrive
  private _webRTCPacketsLost = 0;      // cumulative from WebRTC
  private _prevWebRTCPacketsLost = 0;  // for computing loss delta
  private _availableBitrate = 0;       // GCC bandwidth estimate (bps)
  private _packetsLost = 0;           // unified for debug log

  // ─── State ───
  private _level = CongestionLevel.NORMAL;
  private _recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  // ──────────── DEBUG: bandwidth estimation log ────────────
  private _debugTimer: ReturnType<typeof setInterval> | null = null;

  /** When true, all report/update methods are no-ops — level stays NORMAL. */
  private _disabled: boolean;

  constructor(disabled: boolean = false) {
    super();
    this._disabled = disabled;
    if (!disabled) {
      this._startDebugLog();
    }
  }

  /** Whether this controller is disabled (QUIC CC only). */
  get disabled(): boolean { return this._disabled; }

  // ─── Server stats (called by StreamManager when connection_stats event arrives) ───

  /**
   * Update from server-reported QUIC connection stats.
   * Called by StreamManager when a `connection_stats` event is received.
   *
   * On the publisher connection, server only sends RTT (bidirectional).
   * cwnd/lost_packets/congestion_events were removed because they measured
   * the near-empty server→client path, not the client's upload.
   *
   * When WebRTC stats are available, they take priority since they measure
   * the upload path directly.
   */
  updateFromServerStats(stats: ServerConnectionStats): void {
    if (this._disabled) return;
    // If WebRTC stats are active, skip server stats — WebRTC is more accurate
    // for publisher congestion (measures upload path, available locally)
    if (this._hasWebRTCStats) return;

    this._hasServerStats = true;
    this._smoothedRtt = stats.rtt_ms;

    // Sliding minimum baseRtt — always track the lowest observed RTT
    if (this._smoothedRtt > 0 && (this._baseRtt === 0 || this._smoothedRtt < this._baseRtt)) {
      this._baseRtt = this._smoothedRtt;
    }

    // Use RTT-based level computation (no loss data available on publisher connection)
    this._evaluateLevelFromRtt();
  }

  // ─── WebRTC client-side stats (preferred source) ───

  /**
   * Update from WebRTC `getStats()` — client-side measurements.
   *
   * Unlike server stats, these:
   * 1. Measure the client→server **upload** path (correct for publisher)
   * 2. Are available as a local API call — no network delay
   * 3. Include GCC bandwidth estimate (availableOutgoingBitrate)
   */
  updateFromWebRTCStats(stats: WebRTCCongestionStats): void {
    if (this._disabled) return;
    this._hasWebRTCStats = true;
    this._smoothedRtt = stats.rttMs;

    // Sliding minimum baseRtt — always track the lowest observed RTT
    if (this._smoothedRtt > 0 && (this._baseRtt === 0 || this._smoothedRtt < this._baseRtt)) {
      this._baseRtt = this._smoothedRtt;
    }

    // Compute loss delta since last poll
    const lossThisPeriod = stats.packetsLost - this._prevWebRTCPacketsLost;
    this._prevWebRTCPacketsLost = stats.packetsLost;
    this._webRTCPacketsLost = stats.packetsLost;
    this._packetsLost = stats.packetsLost; // unify for debug log

    // Store GCC bandwidth estimate
    if (stats.availableOutgoingBitrate !== undefined) {
      this._availableBitrate = stats.availableOutgoingBitrate;
    }

    this._evaluateLevelFromWebRTC(lossThisPeriod);
  }

  // ─── Public API (called by GopStreamSender / AudioStreamSender) ───

  /**
   * Report a successful write with its measured latency.
   * This is the PRIMARY uplink congestion signal — measures directly
   * how long writer.write() blocks on the QUIC send buffer.
   */
  reportWriteLatency(latencyMs: number, _bytesSent: number): void {
    if (this._disabled) return;
    const alpha = TRANSPORT.CONGESTION_EMA_ALPHA;
    this._latencyEMA = this._latencyEMA === 0
      ? latencyMs
      : alpha * latencyMs + (1 - alpha) * this._latencyEMA;

    if (this._consecutiveTimeouts > 0) {
      this._consecutiveTimeouts = 0;
    }

    // Only evaluate from write latency if no server stats are arriving
    if (!this._hasServerStats) {
      this._evaluateLevel();
    }
  }

  /**
   * Report a write timeout (video frame could not be sent within deadline).
   */
  reportTimeout(): void {
    if (this._disabled) return;
    this._consecutiveTimeouts++;
    this._latencyEMA = Math.max(this._latencyEMA, TRANSPORT.GOP_WRITE_TIMEOUT_MS);
    this._evaluateLevel();
  }

  /**
   * Report an audio write timeout.
   * Audio is highest priority — immediately escalate to CRITICAL
   * to kill all video and free the uplink.
   */
  reportAudioTimeout(): void {
    if (this._disabled) return;
    console.warn('[CongestionController] 🚨 Audio write timeout — escalating to CRITICAL');
    this._consecutiveTimeouts = TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES;
    this._latencyEMA = TRANSPORT.GOP_WRITE_TIMEOUT_MS;
    this._clearRecoveryTimer();
    this._setLevel(CongestionLevel.CRITICAL);
  }

  // ─── Getters ───

  get level(): CongestionLevel { return this._level; }
  get latencyEMA(): number { return this._latencyEMA; }
  get smoothedRtt(): number { return this._smoothedRtt; }
  get availableBitrate(): number { return this._availableBitrate; }
  get hasWebRTCStats(): boolean { return this._hasWebRTCStats; }

  // ─── RTT-only level evaluation (server stats path — no loss data) ───

  /**
   * Compute congestion level from server-reported RTT path.
   *
   * Uses write latency EMA as the primary uplink signal (direct measurement
   * of QUIC send buffer pressure). RTT ratio was removed — it is not a
   * standard signal (GCC uses delay gradient via Kalman filter, not ratio)
   * and produces false positives on low-latency links.
   */
  private _evaluateLevelFromRtt(): void {
    // Write timeouts always override
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

    // Write latency EMA (direct uplink congestion signal)
    if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L2_MS) {
      target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
    } else if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L1_MS) {
      target = Math.max(target, CongestionLevel.MILD) as CongestionLevel;
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
   *
   * Uses write latency EMA + packet loss (per GCC standard).
   * RTT ratio removed — not a standard signal.
   * Loss thresholds per GCC: ≥10 = SEVERE, ≥3 = MODERATE.
   */
  private _evaluateLevelFromWebRTC(recentLoss: number): void {
    // Write timeouts always override
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

    // Write latency EMA (direct uplink signal)
    if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L2_MS) {
      target = Math.max(target, CongestionLevel.MODERATE) as CongestionLevel;
    } else if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L1_MS) {
      target = Math.max(target, CongestionLevel.MILD) as CongestionLevel;
    }

    // Packet loss from WebRTC (measures upload path — valid signal per GCC)
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

  // ─── Internal (shared) ───

  /**
   * Fallback evaluation when no server stats available.
   * Uses write latency EMA + timeout count only.
   */
  private _evaluateLevel(): void {
    const target = this._computeTargetLevelFromEMA();

    if (target > this._level) {
      this._clearRecoveryTimer();
      this._setLevel(target);
    } else if (target < this._level) {
      this._scheduleRecovery();
    }
  }

  private _computeTargetLevelFromEMA(): CongestionLevel {
    const ema = this._latencyEMA;
    const timeouts = this._consecutiveTimeouts;

    if (timeouts >= TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES) {
      return CongestionLevel.CRITICAL;
    }
    if (timeouts >= 1) {
      return CongestionLevel.SEVERE;
    }
    if (ema >= TRANSPORT.CONGESTION_LATENCY_L2_MS) {
      return CongestionLevel.MODERATE;
    }
    if (ema >= TRANSPORT.CONGESTION_LATENCY_L1_MS) {
      return CongestionLevel.MILD;
    }
    return CongestionLevel.NORMAL;
  }

  private _setLevel(newLevel: CongestionLevel): void {
    if (newLevel === this._level) return;
    const prev = this._level;
    this._level = newLevel;

    const levelNames = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE', 'CRITICAL'];
    console.warn(
      `[CongestionController] Level ${levelNames[prev]} → ${levelNames[newLevel]}` +
      `  (rtt=${this._smoothedRtt.toFixed(1)}ms, baseRtt=${this._baseRtt.toFixed(1)}ms,` +
      ` writeEMA=${this._latencyEMA.toFixed(1)}ms, timeouts=${this._consecutiveTimeouts})`,
    );

    this.emit('levelChanged', {
      level: newLevel,
      previousLevel: prev,
      latencyEMA: this._latencyEMA,
      smoothedRtt: this._smoothedRtt,
      estimatedSendRate: 0, // deprecated, kept for API compat
    });
  }

  private _scheduleRecovery(): void {
    if (this._recoveryTimer) return;

    this._recoveryTimer = setTimeout(() => {
      this._recoveryTimer = null;

      // Re-check: is the situation still improved?
      // Uses the same signals as detection — write-latency EMA + timeouts only.
      // RTT ratio was removed (not a standard signal, produces false positives).
      let currentTarget = CongestionLevel.NORMAL;
      if (this._consecutiveTimeouts >= TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES) {
        currentTarget = CongestionLevel.CRITICAL;
      } else if (this._consecutiveTimeouts >= 1) {
        currentTarget = CongestionLevel.SEVERE;
      } else if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L2_MS) {
        currentTarget = CongestionLevel.MODERATE;
      } else if (this._latencyEMA >= TRANSPORT.CONGESTION_LATENCY_L1_MS) {
        currentTarget = CongestionLevel.MILD;
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
      const source = this._hasWebRTCStats ? 'webrtc' : this._hasServerStats ? 'server(rtt)' : 'write-latency';
      const bweStr = this._availableBitrate > 0 ? `${(this._availableBitrate / 1000).toFixed(0)}kbps` : 'N/A';
      console.log(
        `[CongestionController] 📊 uplink (${source}): ` +
        `rtt=${this._smoothedRtt.toFixed(1)}ms  ` +
        `baseRtt=${this._baseRtt.toFixed(1)}ms  ` +
        `ratio=${rttRatio}  ` +
        `lost=${this._packetsLost}  ` +
        `bwe=${bweStr}  ` +
        `writeEMA=${this._latencyEMA.toFixed(1)}ms  ` +
        `level=${levelNames[this._level]}`,
      );
    }, interval);
  }

  /**
   * Cleanup timers. Call when publisher is destroyed.
   */
  dispose(): void {
    this._clearRecoveryTimer();
    // ──── DEBUG ────
    if (this._debugTimer) {
      clearInterval(this._debugTimer);
      this._debugTimer = null;
    }
    // ──── /DEBUG ────
  }
}
