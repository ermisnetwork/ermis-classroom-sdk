import EventEmitter from "../../../events/EventEmitter";

// ============================================================================
// Arrival Feedback from Meeting Node
// ============================================================================

export interface PacketGroup {
  send_ts_us: number;
  arrival_ts_us: number;
  size_bytes: number;
}

export interface ArrivalFeedback {
  type: "arrival_feedback";
  groups: PacketGroup[];
  loss_fraction: number;
  rtt_us: number;
}

/**
 * Overuse signal — kept for API compatibility with GCC version.
 */
export enum OveruseSignal {
  NORMAL = "NORMAL",
  OVERUSE = "OVERUSE",
  UNDERUSE = "UNDERUSE",
}

export enum RateControlState {
  INCREASE = "INCREASE",
  DECREASE = "DECREASE",
  HOLD = "HOLD",
}

/**
 * Stats snapshot for UI — compatible with GCC version.
 */
export interface GCCStats {
  delayGradient: number;
  threshold: number;
  signal: OveruseSignal;
  rateState: RateControlState;
  delayBasedEstimate: number;
  lossBasedEstimate: number;
  targetBitrate: number;
  incomingBitrate: number;
  lossFraction: number;
  rttMs: number;
  timestamp: number;
}

// ============================================================================
// Quality Tiers (aligned with Google Meet standards)
// ============================================================================

export enum NetworkQuality {
  EXCELLENT = "EXCELLENT",
  GOOD = "GOOD",
  POOR = "POOR",
  CRITICAL = "CRITICAL",
}

interface QualityTierConfig {
  bitrateScale: number;
  signal: OveruseSignal;
  rateState: RateControlState;
}

const QUALITY_CONFIGS: Record<NetworkQuality, QualityTierConfig> = {
  [NetworkQuality.EXCELLENT]: {
    bitrateScale: 1.0,
    signal: OveruseSignal.UNDERUSE,
    rateState: RateControlState.INCREASE,
  },
  [NetworkQuality.GOOD]: {
    bitrateScale: 0.75,
    signal: OveruseSignal.NORMAL,
    rateState: RateControlState.HOLD,
  },
  [NetworkQuality.POOR]: {
    bitrateScale: 0.5,
    signal: OveruseSignal.OVERUSE,
    rateState: RateControlState.DECREASE,
  },
  [NetworkQuality.CRITICAL]: {
    bitrateScale: 0.25,
    signal: OveruseSignal.OVERUSE,
    rateState: RateControlState.DECREASE,
  },
};

// ---- RTT thresholds (strict, pessimistic) ----
const RTT_EXCELLENT_MS = 50;   // < 50ms → excellent (LAN: 1–5ms, WiFi: 10–30ms)
const RTT_GOOD_MS = 150;       // 50–150ms → good
const RTT_POOR_MS = 300;       // 150–300ms → poor
                                // > 300ms → critical

// ---- Backpressure thresholds (write failure rate 0.0–1.0) ----
// PRIMARY signal — directly measures congestion at the sender.
// Tightened: EXCELLENT/GOOD are harder to reach, avoids false recovery.
const BP_EXCELLENT = 0.01;   // < 1% write failures → excellent
const BP_GOOD = 0.05;        // 1–5% → good
const BP_POOR = 0.20;        // 5–20% → poor
                              // > 20% → critical

// ---- Feedback silence ----
const SILENCE_GOOD_MS = 1000;    // 1s without feedback → assume GOOD at best
const SILENCE_POOR_MS = 2500;    // 2.5s without feedback → assume POOR at best
const SILENCE_CRITICAL_MS = 5000; // 5s without feedback → assume CRITICAL

// ---- RTT Sliding window ----
const RTT_WINDOW_MS = 3000;      // 3s window (shorter = faster reaction to congestion)
const DEFAULT_RTT_MS = 50;
const RTT_EWMA_ALPHA = 0.3;      // EWMA smoothing: 30% new sample, 70% history

// ---- Hysteresis (time-based, bidirectional) ----
// Fast down, slow up — prevents flapping after congestion recovery.
// Time-based (not tick-based) because _evaluate() fires from multiple
// sources (timer + event callbacks) at unpredictable rates.
const DOWNGRADE_HOLD_MS = 100;     // 100ms sustained bad signal → downgrade (fast reaction)
const UPGRADE_HOLD_MS = 10_000;    // 10s sustained good signal → upgrade

// ---- Flap Damping (BGP RFC 2439 inspired) ----
// Each quality transition adds penalty. Penalty decays exponentially.
// When penalty exceeds suppress threshold, all transitions are blocked
// until penalty decays below reuse threshold. Self-tuning: stable networks
// get fast transitions, flappy networks get exponentially longer suppression.
const FLAP_PENALTY_PER_TRANSITION = 1000;  // penalty added per quality change
const FLAP_SUPPRESS_THRESHOLD = 2500;      // suppress transitions above this
const FLAP_REUSE_THRESHOLD = 800;          // allow transitions below this
const FLAP_HALF_LIFE_MS = 10_000;          // penalty halves every 10s
const FLAP_MAX_PENALTY = 5000;             // cap to prevent infinite suppression

// ---- RTT Ping Timeout ----
const RTT_TIMEOUT_MS = 5000;      // pong must arrive within 5s
const RTT_TIMEOUT_INJECT_MS = RTT_TIMEOUT_MS; // inject this RTT for timed-out pings

// ---- Bitrate bounds ----
const MIN_BITRATE_BPS = 100_000;
const MAX_BITRATE_BPS = 5_000_000;
const INITIAL_BITRATE_BPS = 300_000;

// ---- Evaluation ----
const EVAL_INTERVAL_MS = 100;

// ---- Quality ordering for worst-of comparison ----
const QUALITY_ORDER: NetworkQuality[] = [
  NetworkQuality.EXCELLENT,
  NetworkQuality.GOOD,
  NetworkQuality.POOR,
  NetworkQuality.CRITICAL,
];

function worstQuality(a: NetworkQuality, b: NetworkQuality): NetworkQuality {
  const idxA = QUALITY_ORDER.indexOf(a);
  const idxB = QUALITY_ORDER.indexOf(b);
  return idxA >= idxB ? a : b;
}

// ============================================================================
// Multi-Signal NetworkQualityMonitor
// ============================================================================

/**
 * NetworkQualityMonitor — Multi-Signal Implementation
 *
 * Combines three congestion signals for robust quality estimation:
 *
 * 1. **Write Backpressure** (PRIMARY): Write failure rate from GopStreamSender
 *    timeouts — directly measures real congestion at the sender. Works on LAN
 *    where RTT stays low.
 *
 * 2. **App-Level RTT**: Measured via ping/pong round-trip through the
 *    WebTransport connection. Replaces Quinn SRTT which is unreliable for
 *    congestion detection. Includes:
 *    - Sequence tracking to match pongs to pings
 *    - Timeout detection: pings without pong within 5s → inject CRITICAL RTT
 *    - P75 sliding window (5s) for smoothing
 *
 * 3. **Feedback Silence**: Time since last arrival_feedback from server —
 *    if the control bidi stream itself is stuck, connection may be dead.
 *
 * Quality = worst_of(rttQuality, backpressureQuality, silenceQuality)
 *
 * State transitions use time-based bidirectional hysteresis:
 * - Downgrade: 400ms sustained bad signal
 * - Upgrade: 5s sustained good signal
 * - Flap Damping (BGP RFC 2439): penalty accumulates on transitions,
 *   exponentially decays. Upgrades suppressed when penalty exceeds threshold.
 *
 * Thresholds aligned with Google Meet standards.
 */
export class NetworkQualityMonitor extends EventEmitter<{
  targetBitrateChanged: { targetBitrate: number; stats: GCCStats };
  networkQualityChanged: {
    quality: NetworkQuality;
    previousQuality: NetworkQuality;
    signals: {
      rtt: NetworkQuality;
      backpressure: NetworkQuality;
      silence: NetworkQuality;
    };
    rttMs: number;
    backpressureRate: number;
  };
}> {
  // --- RTT state ---
  private _rttSamples: Array<{ ts: number; rttMs: number }> = [];
  private _smoothedRttMs = DEFAULT_RTT_MS;  // final RTT = max(EWMA, P90)
  private _ewmaRttMs = DEFAULT_RTT_MS;      // EWMA-smoothed RTT (trend)
  private _rawRttMs = DEFAULT_RTT_MS;       // last raw sample (diagnostics only)

  // --- RTT ping tracking ---
  private _lastPongTime = 0;          // for timeout detection
  private _rttTimeoutFired = false;    // prevent repeated timeout injections
  private _totalPongsReceived = 0;
  private _highestReceivedSeq = -1;    // track out-of-order pongs

  // --- Write backpressure ---
  private _localLossProvider: (() => number) | null = null;
  private _currentBackpressure = 0;

  // --- Quality state ---
  private _currentQuality = NetworkQuality.EXCELLENT;
  private _pendingQuality: NetworkQuality | null = null;
  private _pendingStartTime = 0;  // performance.now() when pending direction started

  // --- Flap damping state ---
  private _flapPenalty = 0;
  private _lastPenaltyDecayTime = 0;
  private _isFlapSuppressed = false;

  // Per-signal quality for diagnostics
  private _rttQuality = NetworkQuality.EXCELLENT;
  private _bpQuality = NetworkQuality.EXCELLENT;
  private _silenceQuality = NetworkQuality.EXCELLENT;

  // --- Bitrate ---
  private _initialBitrate = INITIAL_BITRATE_BPS;
  private _targetBitrate = INITIAL_BITRATE_BPS;

  // --- Loss display ---
  private _currentLossFraction = 0;

  // --- Timer ---
  private _timer: ReturnType<typeof setInterval> | null = null;

  // --- Stats ---
  private _latestStats: GCCStats | null = null;

  // --- Feedback silence ---
  private _lastFeedbackTime = 0;

  constructor() {
    super();
  }

  start(initialBitrate?: number): void {
    if (this._timer) return;

    if (initialBitrate && initialBitrate > 0) {
      this._initialBitrate = initialBitrate;
      this._targetBitrate = initialBitrate;
    }

    this._lastFeedbackTime = performance.now();
    this._lastPenaltyDecayTime = performance.now();
    this._latestStats = this._buildStats();
    this._timer = setInterval(() => this._evaluate(), EVAL_INTERVAL_MS);

    // Run first evaluation immediately so bitrate is scaled correctly
    // from tick 0 (e.g. if started when network is already degraded)
    this._evaluate();

    console.log(
      `[NetMonitor] Started, initial target=${Math.round(this._targetBitrate / 1000)}kbps`,
    );
  }

  /**
   * Update the initial (baseline) bitrate used for quality scaling.
   * Call this when channels are registered/unregistered (e.g., screen share
   * starts/stops) so the target bitrate reflects all active channels.
   *
   * The target bitrate is computed as: initialBitrate × qualityScale
   * Without updating, the monitor keeps using the original value which may
   * be too low (e.g., 250kbps for camera-only) even after screen share
   * adds 500kbps of original demand.
   */
  updateInitialBitrate(newInitialBitrate: number): void {
    if (newInitialBitrate <= 0) return;
    const oldInitial = this._initialBitrate;
    this._initialBitrate = newInitialBitrate;

    console.log(
      `[NetMonitor] Initial bitrate updated: ${Math.round(oldInitial / 1000)}kbps → ${Math.round(newInitialBitrate / 1000)}kbps`,
    );

    // Re-evaluate immediately with new initial bitrate
    this._evaluate();
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._localLossProvider = null;
    this._resetState();
    console.log("[NetMonitor] Stopped");
  }

  setLocalLossProvider(provider: () => number): void {
    this._localLossProvider = provider;
  }

  onArrivalFeedback(feedback: ArrivalFeedback): void {
    this._lastFeedbackTime = performance.now();

    // Quinn SRTT — record for diagnostics only (unreliable for quality on LAN)
    if (feedback.rtt_us > 0) {
      this._rawRttMs = feedback.rtt_us / 1000;
    }

    // Loss fraction for UI
    if (feedback.loss_fraction > 0) {
      this._currentLossFraction = feedback.loss_fraction;
    }

    this._evaluate();
  }

  /**
   * Feed an application-level RTT sample measured via ping/pong.
   * This is the PRIMARY RTT signal — unlike Quinn SRTT which stays
   * low on LAN even during congestion, app-level RTT reflects real
   * end-to-end delay through the WebTransport connection.
   *
   * @param rttMs - Round-trip time in milliseconds
   * @param seq - Sequence number of the pong (for diagnostics)
   */
  onAppRtt(rttMs: number, seq?: number): void {
    if (rttMs <= 0 || !isFinite(rttMs)) return;

    // Track pong reception
    this._lastPongTime = performance.now();
    this._rttTimeoutFired = false; // reset timeout flag
    this._totalPongsReceived++;

    if (seq !== undefined && seq > this._highestReceivedSeq) {
      this._highestReceivedSeq = seq;
    }

    this._lastFeedbackTime = performance.now();
    this._rttSamples.push({ ts: performance.now(), rttMs });
    this._pruneRttWindow();

    // Update EWMA: alpha * new + (1-alpha) * old
    // Asymmetric: RTT increases are applied faster (alpha=0.5) than
    // decreases (alpha=0.3) — pessimistic for congestion detection
    const alpha = rttMs > this._ewmaRttMs ? 0.5 : RTT_EWMA_ALPHA;
    this._ewmaRttMs = alpha * rttMs + (1 - alpha) * this._ewmaRttMs;

    // Final smoothed RTT = max(EWMA, P90) — pessimistic
    const p90 = this._computeP90();
    this._smoothedRttMs = Math.max(this._ewmaRttMs, p90);

    this._evaluate();
  }

  getTargetBitrate(): number {
    return this._targetBitrate;
  }

  getStats(): GCCStats | null {
    return this._latestStats;
  }

  getNetworkQuality(): NetworkQuality {
    return this._currentQuality;
  }

  /** Expose per-signal quality and ping stats for UI diagnostics. */
  getSignalQualities(): {
    rtt: NetworkQuality;
    backpressure: NetworkQuality;
    silence: NetworkQuality;
    backpressureRate: number;
    pongsReceived: number;
  } {
    return {
      rtt: this._rttQuality,
      backpressure: this._bpQuality,
      silence: this._silenceQuality,
      backpressureRate: this._currentBackpressure,
      pongsReceived: this._totalPongsReceived,
    };
  }

  // ========================================================================
  // RTT Sliding Window: EWMA + P90 (Pessimistic)
  // ========================================================================

  private _pruneRttWindow(): void {
    const cutoff = performance.now() - RTT_WINDOW_MS;
    while (this._rttSamples.length > 0 && this._rttSamples[0].ts < cutoff) {
      this._rttSamples.shift();
    }
  }

  /**
   * Compute P90 (90th percentile) of RTT samples in the sliding window.
   * P90 is more pessimistic than P75 — it captures congestion spikes
   * that P75 would smooth over. For congestion detection, we WANT to
   * be pessimistic: a few bad samples should pull the quality down.
   */
  private _computeP90(): number {
    const len = this._rttSamples.length;
    if (len === 0) return this._ewmaRttMs;
    if (len === 1) return this._rttSamples[0].rttMs;

    const values: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      values[i] = this._rttSamples[i].rttMs;
    }
    values.sort((a, b) => a - b);

    const idx = Math.floor(len * 0.90);
    return values[Math.min(idx, len - 1)];
  }

  // ========================================================================
  // RTT Ping Timeout Detection
  // ========================================================================

  /**
   * Check for RTT timeout — if no pong has been received for > RTT_TIMEOUT_MS,
   * inject a CRITICAL RTT sample to degrade quality.
   * Only fires once per timeout period (reset when pong arrives).
   */
  private _checkPingTimeouts(): void {
    // Only check if we've ever received a pong (monitor is active)
    if (this._lastPongTime === 0) return;

    const silenceSincePong = performance.now() - this._lastPongTime;

    if (silenceSincePong > RTT_TIMEOUT_MS && !this._rttTimeoutFired) {
      this._rttTimeoutFired = true;

      // Inject high RTT sample to push quality toward CRITICAL
      this._rttSamples.push({
        ts: performance.now(),
        rttMs: RTT_TIMEOUT_INJECT_MS,
      });
      this._pruneRttWindow();
      // Update EWMA with timeout RTT (fast alpha for degradation)
      this._ewmaRttMs = 0.5 * RTT_TIMEOUT_INJECT_MS + 0.5 * this._ewmaRttMs;
      const p90 = this._computeP90();
      this._smoothedRttMs = Math.max(this._ewmaRttMs, p90);

      console.log(
        `[NetMonitor] RTT timeout: no pong for ${Math.round(silenceSincePong)}ms (>${RTT_TIMEOUT_MS}ms)` +
        ` — injected RTT=${RTT_TIMEOUT_INJECT_MS}ms`,
      );
    }
  }

  // ========================================================================
  // Flap Damping — Exponential Decay Penalty (BGP RFC 2439 inspired)
  // ========================================================================

  /**
   * Decay the flap penalty exponentially. Called at the start of each
   * _evaluate() cycle. When penalty drops below reuse threshold, the
   * suppression flag is lifted and quality transitions are allowed again.
   */
  private _decayFlapPenalty(now: number): void {
    if (this._lastPenaltyDecayTime === 0) {
      this._lastPenaltyDecayTime = now;
      return;
    }

    const elapsed = now - this._lastPenaltyDecayTime;
    this._lastPenaltyDecayTime = now;

    if (this._flapPenalty > 0) {
      // Exponential decay: penalty *= 2^(-elapsed / halfLife)
      const decayFactor = Math.pow(2, -elapsed / FLAP_HALF_LIFE_MS);
      this._flapPenalty *= decayFactor;

      // Check reuse threshold — lift suppression when penalty is low enough
      if (this._isFlapSuppressed && this._flapPenalty < FLAP_REUSE_THRESHOLD) {
        this._isFlapSuppressed = false;
        console.log(
          `[NetMonitor] Flap suppression LIFTED: penalty=${Math.round(this._flapPenalty)}` +
          ` (<${FLAP_REUSE_THRESHOLD}), transitions allowed`,
        );
      }

      // Clean up negligible penalty
      if (this._flapPenalty < 1) {
        this._flapPenalty = 0;
      }
    }
  }

  // ========================================================================
  // Core: Multi-Signal → Quality → Target Bitrate
  // ========================================================================

  private _evaluate(): void {
    const now = performance.now();
    this._pruneRttWindow();

    // ---- Decay flap penalty ----
    this._decayFlapPenalty(now);

    // ---- Check ping timeouts ----
    this._checkPingTimeouts();

    // ---- Signal 1: RTT ----
    this._rttQuality = this._rttToQuality(this._smoothedRttMs);

    // ---- Signal 2: Write Backpressure (PRIMARY) ----
    if (this._localLossProvider) {
      this._currentBackpressure = this._localLossProvider();
    }
    this._bpQuality = this._backpressureToQuality(this._currentBackpressure);

    // Update loss fraction from backpressure if server doesn't provide it
    if (this._currentLossFraction === 0 && this._currentBackpressure > 0) {
      this._currentLossFraction = this._currentBackpressure;
    }

    // ---- Signal 3: Feedback Silence ----
    const silenceMs = now - this._lastFeedbackTime;
    this._silenceQuality = this._silenceToQuality(silenceMs);

    // ---- Composite: worst-of all signals ----
    let composite = this._rttQuality;
    composite = worstQuality(composite, this._bpQuality);
    composite = worstQuality(composite, this._silenceQuality);

    // ---- Bidirectional Hysteresis (direction-based) ----
    // Track by direction (upgrade vs downgrade), NOT exact target quality.
    // This prevents counter resets when network oscillates (e.g. POOR↔CRITICAL
    // during a downgrade — both are "downgrade" direction, so counter continues).
    if (composite !== this._currentQuality) {
      const compositeIdx = QUALITY_ORDER.indexOf(composite);
      const currentIdx = QUALITY_ORDER.indexOf(this._currentQuality);
      const isUpgrade = compositeIdx < currentIdx;
      const isDowngrade = compositeIdx > currentIdx;

      // Stepwise-only upgrades: can only improve by ONE tier at a time.
      // Downgrades can skip tiers (fast response to congestion).
      let targetQuality = composite;
      if (isUpgrade) {
        // Clamp to one tier above current
        targetQuality = QUALITY_ORDER[currentIdx - 1];
      }

      // Determine required hysteresis count based on direction
      // Required hold time based on direction
      const requiredMs = isDowngrade
        ? DOWNGRADE_HOLD_MS     // degrading: fast (400ms)
        : UPGRADE_HOLD_MS;      // improving: slow (5s)

      // Direction-based timer logic:
      // - If pending direction matches, keep timer running
      // - During downgrade, if worse quality appears, update target but keep timer
      // - If direction changes, restart timer
      const pendingIdx = this._pendingQuality
        ? QUALITY_ORDER.indexOf(this._pendingQuality)
        : -1;
      const isPendingDowngrade = this._pendingQuality
        ? pendingIdx > currentIdx
        : false;
      const isPendingUpgrade = this._pendingQuality
        ? pendingIdx < currentIdx
        : false;
      const isSameDirection =
        (isDowngrade && isPendingDowngrade) ||
        (isUpgrade && isPendingUpgrade);

      if (isSameDirection) {
        // Same direction — keep timer running
        // If new target is worse than pending during downgrade, update target
        if (isDowngrade) {
          const targetIdx = QUALITY_ORDER.indexOf(targetQuality);
          if (targetIdx > pendingIdx) {
            this._pendingQuality = targetQuality;
          }
        }
        // Timer keeps running from _pendingStartTime
      } else {
        // Direction changed or first pending — start fresh timer
        this._pendingQuality = targetQuality;
        this._pendingStartTime = now;
      }

      const elapsed = now - this._pendingStartTime;
      if (this._pendingStartTime > 0 && elapsed >= requiredMs) {
        // ---- Flap Damping: check before committing transition ----
        // CRITICAL: Downgrades ALWAYS pass through — never block congestion
        // signals. Flap Damping only suppresses UPGRADES.
        const isFlapBlocked = this._isFlapSuppressed && isUpgrade;

        if (isFlapBlocked) {
          // Upgrade blocked — reset so timer restarts after suppression lifts
          this._pendingQuality = null;
          this._pendingStartTime = 0;
        } else {
          // Commit transition + add flap penalty
          this._flapPenalty = Math.min(
            FLAP_MAX_PENALTY,
            this._flapPenalty + FLAP_PENALTY_PER_TRANSITION,
          );
          if (this._flapPenalty >= FLAP_SUPPRESS_THRESHOLD) {
            this._isFlapSuppressed = true;
            console.log(
              `[NetMonitor] FLAP SUPPRESSED: penalty=${Math.round(this._flapPenalty)}` +
              ` (>=${FLAP_SUPPRESS_THRESHOLD}), upgrades blocked until penalty` +
              ` decays below ${FLAP_REUSE_THRESHOLD}`,
            );
          }

          const finalTarget = this._pendingQuality!;
          const oldQuality = this._currentQuality;
          this._currentQuality = finalTarget;
          this._pendingQuality = null;
          this._pendingStartTime = 0;
          this._logQualityChange(oldQuality, finalTarget);

          // Emit quality change event for UI notification
          this.emit("networkQualityChanged", {
            quality: finalTarget,
            previousQuality: oldQuality,
            signals: {
              rtt: this._rttQuality,
              backpressure: this._bpQuality,
              silence: this._silenceQuality,
            },
            rttMs: this._smoothedRttMs,
            backpressureRate: this._currentBackpressure,
          });
        }
      }
    } else {
      // Composite matches current — network is stable, reset pending
      this._pendingQuality = null;
      this._pendingStartTime = 0;
    }

    // ---- Compute target bitrate ----
    const tierConfig = QUALITY_CONFIGS[this._currentQuality];
    const newTarget = Math.max(
      MIN_BITRATE_BPS,
      Math.min(
        MAX_BITRATE_BPS,
        Math.round(this._initialBitrate * tierConfig.bitrateScale),
      ),
    );

    this._latestStats = this._buildStats();

    // Emit on significant change (>1%)
    const changeRatio =
      Math.abs(newTarget - this._targetBitrate) / Math.max(this._targetBitrate, 1);
    if (changeRatio > 0.01) {
      this._targetBitrate = newTarget;

      console.log(
        `[NetMonitor] target=${Math.round(newTarget / 1000)}kbps` +
        ` quality=${this._currentQuality}` +
        ` [RTT:${this._rttQuality} BP:${this._bpQuality} Sil:${this._silenceQuality}]` +
        ` P75=${Math.round(this._smoothedRttMs)}ms` +
        ` bp=${(this._currentBackpressure * 100).toFixed(1)}%` +
        ` silence=${Math.round(performance.now() - this._lastFeedbackTime)}ms` +
        ` pongs=${this._totalPongsReceived}` +
        ` flapPenalty=${Math.round(this._flapPenalty)}${this._isFlapSuppressed ? ' SUPPRESSED' : ''}`,
      );

      this.emit("targetBitrateChanged", {
        targetBitrate: newTarget,
        stats: this._latestStats,
      });
    }
  }

  private _logQualityChange(from: NetworkQuality, to: NetworkQuality): void {
    const direction = QUALITY_ORDER.indexOf(to) > QUALITY_ORDER.indexOf(from) ? '↓' : '↑';
    console.log(
      `[NetMonitor] Quality: ${from} ${direction} ${to}` +
      ` [RTT:${this._rttQuality} BP:${this._bpQuality} Sil:${this._silenceQuality}]` +
      ` P75=${Math.round(this._smoothedRttMs)}ms` +
      ` bp=${(this._currentBackpressure * 100).toFixed(1)}%` +
      ` pongs=${this._totalPongsReceived}`,
    );
  }

  // ========================================================================
  // Signal → Quality Mapping (Google Meet aligned)
  // ========================================================================

  private _rttToQuality(rttMs: number): NetworkQuality {
    if (rttMs >= RTT_POOR_MS) return NetworkQuality.CRITICAL;
    if (rttMs >= RTT_GOOD_MS) return NetworkQuality.POOR;
    if (rttMs >= RTT_EXCELLENT_MS) return NetworkQuality.GOOD;
    return NetworkQuality.EXCELLENT;
  }

  private _backpressureToQuality(rate: number): NetworkQuality {
    if (rate >= BP_POOR) return NetworkQuality.CRITICAL;
    if (rate >= BP_GOOD) return NetworkQuality.POOR;
    if (rate >= BP_EXCELLENT) return NetworkQuality.GOOD;
    return NetworkQuality.EXCELLENT;
  }

  private _silenceToQuality(silenceMs: number): NetworkQuality {
    if (silenceMs >= SILENCE_CRITICAL_MS) return NetworkQuality.CRITICAL;
    if (silenceMs >= SILENCE_POOR_MS) return NetworkQuality.POOR;
    if (silenceMs >= SILENCE_GOOD_MS) return NetworkQuality.GOOD;
    return NetworkQuality.EXCELLENT;
  }

  // ========================================================================
  // Stats
  // ========================================================================

  private _buildStats(): GCCStats {
    const tierConfig = QUALITY_CONFIGS[this._currentQuality];
    return {
      delayGradient: this._currentBackpressure, // Repurpose: show backpressure rate
      threshold: tierConfig.bitrateScale,
      signal: tierConfig.signal,
      rateState: tierConfig.rateState,
      delayBasedEstimate: this._targetBitrate,
      lossBasedEstimate: this._targetBitrate,
      targetBitrate: this._targetBitrate,
      incomingBitrate: 0,
      lossFraction: this._currentLossFraction,
      rttMs: this._smoothedRttMs,
      timestamp: Date.now(),
    };
  }

  private _resetState(): void {
    this._rttSamples = [];
    this._smoothedRttMs = DEFAULT_RTT_MS;
    this._ewmaRttMs = DEFAULT_RTT_MS;
    this._rawRttMs = DEFAULT_RTT_MS;
    this._lastPongTime = 0;
    this._rttTimeoutFired = false;
    this._totalPongsReceived = 0;
    this._highestReceivedSeq = -1;
    this._currentBackpressure = 0;
    this._currentQuality = NetworkQuality.EXCELLENT;
    this._rttQuality = NetworkQuality.EXCELLENT;
    this._bpQuality = NetworkQuality.EXCELLENT;
    this._silenceQuality = NetworkQuality.EXCELLENT;
    this._pendingQuality = null;
    this._pendingStartTime = 0;
    this._flapPenalty = 0;
    this._lastPenaltyDecayTime = 0;
    this._isFlapSuppressed = false;
    this._initialBitrate = INITIAL_BITRATE_BPS;
    this._targetBitrate = INITIAL_BITRATE_BPS;
    this._currentLossFraction = 0;
    this._latestStats = null;
    this._lastFeedbackTime = 0;
  }
}
