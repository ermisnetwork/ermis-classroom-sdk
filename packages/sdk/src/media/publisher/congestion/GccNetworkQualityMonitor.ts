import EventEmitter from "../../../events/EventEmitter";

// ============================================================================
// GCC Types — Arrival Feedback from Meeting Node
// ============================================================================

/**
 * A group of packets that arrived within a burst window (5ms).
 * Sent from Meeting Node to Publisher Client.
 */
export interface PacketGroup {
  /** Sender timestamp in microseconds (from frame header) */
  send_ts_us: number;
  /** Arrival timestamp at Meeting Node in microseconds */
  arrival_ts_us: number;
  /** Total size in bytes of packets in this group */
  size_bytes: number;
}

/**
 * Arrival feedback message from Meeting Node (replaces CongestionReport).
 * Sent periodically (~30ms) over MeetingControl bidi stream.
 */
export interface ArrivalFeedback {
  type: "arrival_feedback";
  /** Packet groups observed since last feedback */
  groups: PacketGroup[];
  /** Packet loss fraction 0.0–1.0 since last feedback */
  loss_fraction: number;
  /** Quinn QUIC-level RTT in microseconds */
  rtt_us: number;
}

/**
 * GCC overuse signal (3 states per RFC).
 */
export enum OveruseSignal {
  NORMAL = "NORMAL",
  OVERUSE = "OVERUSE",
  UNDERUSE = "UNDERUSE",
}

/**
 * GCC rate controller state.
 */
export enum RateControlState {
  INCREASE = "INCREASE",
  DECREASE = "DECREASE",
  HOLD = "HOLD",
}

/**
 * Snapshot of the full GCC pipeline state for UI/logging.
 */
export interface GCCStats {
  /** Kalman filter estimated delay gradient (ms) */
  delayGradient: number;
  /** Current adaptive threshold (ms) */
  threshold: number;
  /** Current overuse signal */
  signal: OveruseSignal;
  /** Rate controller state */
  rateState: RateControlState;
  /** Delay-based estimated available bandwidth (bps) */
  delayBasedEstimate: number;
  /** Loss-based estimated available bandwidth (bps) */
  lossBasedEstimate: number;
  /** Final target bitrate = min(delay, loss) (bps) */
  targetBitrate: number;
  /** Measured incoming bitrate (bps) */
  incomingBitrate: number;
  /** Current loss fraction 0.0–1.0 */
  lossFraction: number;
  /** RTT from Node (ms) */
  rttMs: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// GCC Parameters (Table 1 from draft-ietf-rmcat-gcc-02)
// ============================================================================

const BURST_TIME_MS = 5;

// Kalman filter
const Q = 1e-3;              // State noise covariance
const E_INITIAL = 0.1;       // Initial error covariance
const CHI = 0.01;            // Noise variance filter coefficient

// Overuse detector
const DEL_VAR_TH_INITIAL = 12.5;  // ms
const OVERUSE_TIME_TH_MS = 10;    // ms
const K_U = 0.01;                 // Threshold increase rate
const K_D = 0.00018;              // Threshold decrease rate
const DEL_VAR_TH_MIN = 6;        // ms
const DEL_VAR_TH_MAX = 600;      // ms

// Rate controller
const BETA = 0.85;           // Decrease factor
const ETA_BASE = 1.08;       // Multiplicative increase base (8%/s)
const ADDITIVE_ALPHA = 0.5;  // Additive increase coefficient
const RESPONSE_TIME_OFFSET_MS = 100; // Added to RTT for response time
const FEEDBACK_SILENCE_MS = 500;     // Max time without feedback before freezing rate

// Loss-based controller — aligned with RFC draft-ietf-rmcat-gcc-02 Section 6
const LOSS_THRESHOLD_LOW = 0.02;   // <2% → increase (RFC standard)
const LOSS_THRESHOLD_HIGH = 0.10;  // >10% → decrease (RFC standard)
const LOSS_INCREASE_FACTOR = 1.05; // 5% increase per feedback (normal)
const LOSS_RECOVERY_FACTOR = 1.20; // 20% increase when deeply degraded
const LOSS_DECREASE_COEFF = 0.5;   // As = As*(1-0.5*p)
const LOSS_RECOVERY_THRESHOLD = 0.5; // "Deeply degraded" = As_hat < 50% of initial
const PROBE_INTERVAL_MS = 5000;    // Probe every 5s when stuck at floor

// Bitrate bounds
const MIN_BITRATE_BPS = 100_000;    // 100 kbps floor (30k = garbage encoder output)
const MAX_BITRATE_BPS = 5_000_000;  // 5 Mbps ceiling
const INITIAL_BITRATE_BPS = 300_000; // 300 kbps (Chrome standard, probe up)

// Incoming bitrate measurement window
const INCOMING_RATE_WINDOW_MS = 500; // 500ms — faster reaction to congestion

// ============================================================================
// GCC Engine (NetworkQualityMonitor rewrite)
// ============================================================================

/**
 * NetworkQualityMonitor — GCC Implementation
 *
 * Implements Google Congestion Control (draft-ietf-rmcat-gcc-02) with:
 * 1. Kalman filter for delay gradient estimation
 * 2. Overuse detector with adaptive threshold
 * 3. AIMD rate controller (Increase/Decrease/Hold)
 * 4. Loss-based controller
 *
 * Receives ArrivalFeedback from Meeting Node and outputs a continuous
 * target bitrate (bps) for the AdaptiveMediaController to distribute
 * across video channels.
 */
export class NetworkQualityMonitor extends EventEmitter<{
  targetBitrateChanged: { targetBitrate: number; stats: GCCStats };
}> {
  // --- Kalman filter state ---
  private _mHat = 0;         // Estimated delay gradient (ms)
  private _e = E_INITIAL;    // Error covariance
  private _varV = 0.5;       // Estimated noise variance
  private _prevGroupSendTs = -1;    // Previous group send timestamp (µs)
  private _prevGroupArrivalTs = -1; // Previous group arrival timestamp (µs)

  // --- Overuse detector state ---
  private _delVarTh = DEL_VAR_TH_INITIAL;  // Adaptive threshold (ms)
  private _overuseCounter = 0;              // ms of sustained overuse
  private _signal: OveruseSignal = OveruseSignal.NORMAL;
  private _prevMHat = 0;                    // Previous m_hat for slope check

  // --- Rate controller state ---
  private _rateState: RateControlState = RateControlState.INCREASE;
  private _aHat = INITIAL_BITRATE_BPS;     // Delay-based estimate (bps)
  private _asHat = INITIAL_BITRATE_BPS;    // Loss-based estimate (bps)
  private _targetBitrate = INITIAL_BITRATE_BPS;
  private _lastUpdateTime = 0;             // ms (performance.now)

  // Convergence tracking for multiplicative vs additive increase
  private _avgMaxBitrate = -1;  // EMA of bitrate at Decrease events
  private _varMaxBitrate = 0;   // Variance tracker
  private _inMultiplicativeIncrease = true;

  // --- Incoming bitrate measurement ---
  private _incomingBytes: Array<{ ts: number; size: number }> = [];

  // --- Loss tracking ---
  private _currentLossFraction = 0;
  private _rttMs = 50; // Default RTT estimate

  // --- Latest stats for UI ---
  private _latestStats: GCCStats | null = null;

  // --- Timer ---
  private _timer: ReturnType<typeof setInterval> | null = null;

  // --- Local loss provider (reads write failure rate from StreamManager) ---
  private _localLossProvider: (() => number) | null = null;

  // --- Feedback silence detection ---
  private _lastFeedbackTime = 0; // performance.now() of last ArrivalFeedback

  // --- Probe timer (recovery from floor) ---
  private _lastMinTime = 0;      // Timestamp when As_hat first hit MIN_BITRATE
  private _initialBitrate = INITIAL_BITRATE_BPS; // Store actual initial for recovery reference

  constructor() {
    super();
  }

  /**
   * Start the GCC engine. Call after publisher is connected.
   * @param initialBitrate Initial sending bitrate in bps
   */
  start(initialBitrate?: number): void {
    if (this._timer) return;

    if (initialBitrate && initialBitrate > 0) {
      this._aHat = initialBitrate;
      this._asHat = initialBitrate;
      this._targetBitrate = initialBitrate;
      this._initialBitrate = initialBitrate;
    }

    this._lastUpdateTime = performance.now();
    this._lastMinTime = 0;
    this._lastFeedbackTime = performance.now();

    // Build initial stats so UI has data immediately (before first feedback)
    this._latestStats = this._buildStats(0);

    // Run rate controller periodically (every 100ms) even without feedback
    // to ensure Increase state makes progress
    this._timer = setInterval(() => this._runRateController(), 100);

    console.log(`[GCC] Engine started, initial target=${Math.round(this._targetBitrate / 1000)}kbps`);
  }

  /** Stop the engine. */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._localLossProvider = null;
    this._resetState();
    console.log("[GCC] Engine stopped");
  }

  /**
   * Set a local loss provider — a function that returns the current
   * write failure rate (0.0–1.0) from StreamManager's central tracker.
   * Used as the loss signal when Node doesn't have per-frame tracking.
   */
  setLocalLossProvider(provider: () => number): void {
    this._localLossProvider = provider;
  }

  /**
   * Process an ArrivalFeedback message from Meeting Node.
   * This is the main input to the GCC pipeline.
   */
  onArrivalFeedback(feedback: ArrivalFeedback): void {
    // Track feedback arrival for silence detection
    this._lastFeedbackTime = performance.now();

    // Update RTT
    if (feedback.rtt_us > 0) {
      this._rttMs = feedback.rtt_us / 1000;
    }

    // Loss fraction: prefer Node's value, fallback to local write failure rate
    if (feedback.loss_fraction > 0) {
      this._currentLossFraction = feedback.loss_fraction;
    } else if (this._localLossProvider) {
      this._currentLossFraction = this._localLossProvider();
    }

    // Process each packet group through the delay-based pipeline
    for (const group of feedback.groups) {
      this._processGroup(group);
    }

    // Run loss-based controller
    this._updateLossBasedEstimate();

    // Run rate controller with fresh signal
    this._runRateController();
  }

  /** Get the current target bitrate (bps). */
  getTargetBitrate(): number {
    return this._targetBitrate;
  }

  /** Get the latest GCC stats for UI. */
  getStats(): GCCStats | null {
    return this._latestStats;
  }

  // ========================================================================
  // 1. Pre-filtering + Kalman Filter (Sections 5.2–5.3)
  // ========================================================================

  private _processGroup(group: PacketGroup): void {
    // Record incoming bytes for bitrate measurement
    const nowMs = performance.now();
    this._incomingBytes.push({ ts: nowMs, size: group.size_bytes });
    this._pruneIncomingBytes(nowMs);

    // Need at least 2 groups for inter-group delay variation
    if (this._prevGroupSendTs < 0) {
      this._prevGroupSendTs = group.send_ts_us;
      this._prevGroupArrivalTs = group.arrival_ts_us;
      return;
    }

    // Compute inter-group delay variation d(i) in milliseconds
    const interDepartureUs = group.send_ts_us - this._prevGroupSendTs;
    const interArrivalUs = group.arrival_ts_us - this._prevGroupArrivalTs;
    const dMs = (interArrivalUs - interDepartureUs) / 1000; // µs → ms

    // Pre-filtering: if inter-arrival < burst_time AND d < 0,
    // this is a queue flush burst — merge into previous group
    // by accumulating timestamps so the NEXT group's dMs is correct.
    const interArrivalMs = interArrivalUs / 1000;
    if (interArrivalMs < BURST_TIME_MS && dMs < 0) {
      // Merge: extend the previous group's span to include this burst.
      // Keep _prevGroupSendTs unchanged (start of merged group),
      // but update arrival to latest (end of merged group).
      this._prevGroupArrivalTs = group.arrival_ts_us;
      return;
    }

    // Update prev timestamps (after pre-filter pass)
    this._prevGroupSendTs = group.send_ts_us;
    this._prevGroupArrivalTs = group.arrival_ts_us;

    // --- Kalman Filter ---
    // Innovation: z = d(i) - m_hat(i-1)
    const z = dMs - this._mHat;

    // Update noise variance estimate with exponential filter
    // alpha = (1 - chi)^(30 / (1000 * f_max))
    // For simplicity, use interDepartureUs to compute f_max
    const dtSec = Math.max(interDepartureUs / 1_000_000, 0.001);
    const fMax = 1 / dtSec;
    const alpha = Math.pow(1 - CHI, 30 / (1000 * fMax));

    // Clamp outliers: if z > 3*sqrt(var_v), use 3*sqrt(var_v)
    const sqrtVarV = Math.sqrt(this._varV);
    const zClamped = Math.abs(z) > 3 * sqrtVarV ? 3 * sqrtVarV * Math.sign(z) : z;
    this._varV = Math.max(alpha * this._varV + (1 - alpha) * zClamped * zClamped, 1);

    // Kalman gain
    const k = (this._e + Q) / (this._varV + this._e + Q);

    // Update estimate
    this._prevMHat = this._mHat;
    this._mHat = this._mHat + z * k;

    // Update error covariance
    this._e = (1 - k) * (this._e + Q);

    // --- Overuse Detector ---
    this._updateOveruseDetector(interArrivalMs);
  }

  // ========================================================================
  // 2. Overuse Detector (Section 5.4)
  // ========================================================================

  private _updateOveruseDetector(dtMs: number): void {
    const absMHat = Math.abs(this._mHat);

    // Update adaptive threshold
    // del_var_th(i) = del_var_th(i-1) + dt * K(i) * (|m(i)| - del_var_th(i-1))
    if (absMHat - this._delVarTh <= 15) {
      const kI = absMHat < this._delVarTh ? K_D : K_U;
      this._delVarTh += (dtMs / 1000) * kI * (absMHat - this._delVarTh);
      this._delVarTh = Math.max(DEL_VAR_TH_MIN, Math.min(DEL_VAR_TH_MAX, this._delVarTh));
    }

    // Determine signal
    if (this._mHat > this._delVarTh) {
      // Potential overuse — but check if m is still increasing
      if (this._mHat > this._prevMHat) {
        this._overuseCounter += dtMs;
        if (this._overuseCounter >= OVERUSE_TIME_TH_MS) {
          this._signal = OveruseSignal.OVERUSE;
        }
      }
      // m(i) < m(i-1) → don't signal overuse even if above threshold
    } else if (this._mHat < -this._delVarTh) {
      this._overuseCounter = 0;
      this._signal = OveruseSignal.UNDERUSE;
    } else {
      this._overuseCounter = 0;
      this._signal = OveruseSignal.NORMAL;
    }
  }

  // ========================================================================
  // 3. Delay-based Rate Controller (Section 5.5)
  // ========================================================================

  private _runRateController(): void {
    const now = performance.now();
    const dtMs = now - this._lastUpdateTime;
    if (dtMs < 10) return; // Avoid too-frequent updates
    this._lastUpdateTime = now;
    const dtSec = dtMs / 1000;

    // Measure incoming bitrate
    this._pruneIncomingBytes(now);
    const incomingBitrate = this._measureIncomingBitrate(now);

    // State transition table
    const prevState = this._rateState;
    switch (this._signal) {
      case OveruseSignal.OVERUSE:
        this._rateState = RateControlState.DECREASE;
        break;
      case OveruseSignal.NORMAL:
        if (this._rateState === RateControlState.HOLD) {
          this._rateState = RateControlState.INCREASE;
        } else if (this._rateState === RateControlState.DECREASE) {
          // Stay in Decrease until signal changes
        } else {
          this._rateState = RateControlState.INCREASE;
        }
        break;
      case OveruseSignal.UNDERUSE:
        if (this._rateState === RateControlState.DECREASE) {
          this._rateState = RateControlState.HOLD;
        }
        // Hold stays Hold, Increase stays Increase
        break;
    }

    // --- Feedback silence guard ---
    // If no ArrivalFeedback for >500ms, the connection may be dead.
    // Freeze rate to prevent A_hat from inflating unchecked.
    const feedbackSilenceMs = now - this._lastFeedbackTime;
    const isSilent = feedbackSilenceMs > FEEDBACK_SILENCE_MS;

    // Apply rate control based on state
    switch (this._rateState) {
      case RateControlState.INCREASE:
        if (!isSilent) {
          this._increaseRate(dtSec, incomingBitrate);
        }
        // When silent: don't increase — effectively HOLD
        break;
      case RateControlState.DECREASE:
        if (prevState !== RateControlState.DECREASE) {
          // Only decrease once per overuse event
          this._decreaseRate(incomingBitrate);
        }
        break;
      case RateControlState.HOLD:
        // Keep A_hat constant — waiting for queues to drain
        break;
    }

    // Ensure A_hat doesn't diverge too far from actual sending rate
    // A_hat < 1.5 * R_hat
    if (incomingBitrate > 0) {
      this._aHat = Math.min(this._aHat, 1.5 * incomingBitrate);
    }

    // Clamp
    this._aHat = Math.max(MIN_BITRATE_BPS, Math.min(MAX_BITRATE_BPS, this._aHat));

    // Final target = min(delay-based, loss-based)
    const newTarget = Math.max(
      MIN_BITRATE_BPS,
      Math.min(this._aHat, this._asHat),
    );

    // Always update stats snapshot so UI polling sees live values
    // (loss rate, signal, state, RTT etc.) regardless of bitrate change
    const stats = this._buildStats(incomingBitrate);
    this._latestStats = stats;

    // Emit event + log only if bitrate changed significantly (>1%)
    const changeRatio = Math.abs(newTarget - this._targetBitrate) / Math.max(this._targetBitrate, 1);
    if (changeRatio > 0.01) {
      this._targetBitrate = newTarget;

      // Diagnostic log
      console.log(
        `[GCC] target=${Math.round(newTarget / 1000)}kbps` +
        ` m_hat=${this._mHat.toFixed(2)}ms th=${this._delVarTh.toFixed(1)}ms` +
        ` signal=${this._signal} state=${this._rateState}` +
        ` A_hat=${Math.round(this._aHat / 1000)}k As_hat=${Math.round(this._asHat / 1000)}k` +
        ` R_hat=${Math.round(incomingBitrate / 1000)}k loss=${(this._currentLossFraction * 100).toFixed(1)}%`,
      );

      this.emit("targetBitrateChanged", { targetBitrate: newTarget, stats });
    }
  }

  private _increaseRate(dtSec: number, incomingBitrate: number): void {
    // Check if we should use multiplicative or additive increase
    this._updateConvergenceTracker(incomingBitrate);

    if (this._inMultiplicativeIncrease) {
      // Multiplicative: A_hat = 1.08^dt * A_hat (max 8% per second)
      const eta = Math.pow(ETA_BASE, Math.min(dtSec, 1.0));
      this._aHat = eta * this._aHat;
    } else {
      // Additive: A_hat += max(1000, alpha * packet_size * dt/response_time)
      const responseTimeMs = RESPONSE_TIME_OFFSET_MS + this._rttMs;
      const alpha = ADDITIVE_ALPHA * Math.min(dtSec * 1000 / responseTimeMs, 1.0);

      // Estimate packet size from current bitrate
      const bitsPerFrame = this._aHat / 30;
      const packetsPerFrame = Math.max(1, Math.ceil(bitsPerFrame / (1200 * 8)));
      const avgPacketSizeBits = bitsPerFrame / packetsPerFrame;

      this._aHat += Math.max(1000, alpha * avgPacketSizeBits);
    }
  }

  private _decreaseRate(incomingBitrate: number): void {
    // Record bitrate at decrease for convergence tracking
    const rHat = incomingBitrate > 0 ? incomingBitrate : this._aHat;

    // EMA of max bitrate at decrease events
    if (this._avgMaxBitrate < 0) {
      this._avgMaxBitrate = rHat;
    } else {
      this._avgMaxBitrate = 0.95 * this._avgMaxBitrate + 0.05 * rHat;
    }

    // A_hat = beta * R_hat
    this._aHat = BETA * rHat;
    this._aHat = Math.max(MIN_BITRATE_BPS, this._aHat);

    // Reset overuse counter for next detection cycle
    this._overuseCounter = 0;
    this._signal = OveruseSignal.NORMAL;

    console.log(
      `[GCC] DECREASE: A_hat → ${Math.round(this._aHat / 1000)}kbps` +
      ` (beta=${BETA} × R_hat=${Math.round(rHat / 1000)}k)`,
    );
  }

  private _updateConvergenceTracker(incomingBitrate: number): void {
    if (this._avgMaxBitrate < 0) {
      // No decrease events yet → multiplicative
      this._inMultiplicativeIncrease = true;
      return;
    }

    // "Close" = within 3 standard deviations of avg max bitrate
    const diff = Math.abs(incomingBitrate - this._avgMaxBitrate);
    // Variance is approximated; use a simple comparison
    this._varMaxBitrate = 0.95 * this._varMaxBitrate + 0.05 * diff * diff;
    const stddev = Math.sqrt(this._varMaxBitrate);

    if (incomingBitrate > this._avgMaxBitrate + 3 * stddev) {
      // Congestion level changed — reset and go to multiplicative
      this._avgMaxBitrate = -1;
      this._inMultiplicativeIncrease = true;
    } else if (diff < 3 * stddev) {
      // Close to convergence — switch to additive
      this._inMultiplicativeIncrease = false;
    } else {
      this._inMultiplicativeIncrease = true;
    }
  }

  // ========================================================================
  // 4. Loss-based Controller (Section 6)
  // ========================================================================

  private _updateLossBasedEstimate(): void {
    const p = this._currentLossFraction;
    const now = performance.now();

    if (p < LOSS_THRESHOLD_LOW) {
      // < 2% loss → increase
      // Use faster recovery when deeply degraded (As_hat < 50% of initial)
      const isDeeplyDegraded = this._asHat < LOSS_RECOVERY_THRESHOLD * this._initialBitrate;
      const factor = isDeeplyDegraded ? LOSS_RECOVERY_FACTOR : LOSS_INCREASE_FACTOR;
      this._asHat = factor * this._asHat;
      // Reset min timer since we're recovering
      this._lastMinTime = 0;
    } else if (p > LOSS_THRESHOLD_HIGH) {
      // > 10% loss → decrease: As = As * (1 - 0.5 * p)
      this._asHat = this._asHat * (1 - LOSS_DECREASE_COEFF * p);
    }
    // 2–10% → keep unchanged

    this._asHat = Math.max(MIN_BITRATE_BPS, Math.min(MAX_BITRATE_BPS, this._asHat));

    // Probe timer: if stuck at or near MIN for too long, probe higher
    if (this._asHat <= MIN_BITRATE_BPS * 1.5) {
      if (this._lastMinTime === 0) {
        this._lastMinTime = now;
      } else if (now - this._lastMinTime > PROBE_INTERVAL_MS) {
        // Probe: jump to 2× current to test if network recovered
        this._asHat = Math.min(this._asHat * 2, this._initialBitrate);
        this._lastMinTime = now; // Reset timer for next probe cycle
        console.log(
          `[GCC] PROBE: As_hat → ${Math.round(this._asHat / 1000)}kbps (testing recovery)`,
        );
      }
    } else {
      this._lastMinTime = 0;
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private _measureIncomingBitrate(nowMs: number): number {
    if (this._incomingBytes.length < 2) return 0;

    let totalBytes = 0;
    for (const entry of this._incomingBytes) {
      totalBytes += entry.size;
    }

    const windowMs = nowMs - this._incomingBytes[0].ts;
    if (windowMs <= 0) return 0;

    return (totalBytes * 8 * 1000) / windowMs; // bps
  }

  private _pruneIncomingBytes(nowMs: number): void {
    const cutoff = nowMs - INCOMING_RATE_WINDOW_MS;
    while (this._incomingBytes.length > 0 && this._incomingBytes[0].ts < cutoff) {
      this._incomingBytes.shift();
    }
  }

  private _buildStats(incomingBitrate: number): GCCStats {
    return {
      delayGradient: this._mHat,
      threshold: this._delVarTh,
      signal: this._signal,
      rateState: this._rateState,
      delayBasedEstimate: this._aHat,
      lossBasedEstimate: this._asHat,
      targetBitrate: this._targetBitrate,
      incomingBitrate,
      lossFraction: this._currentLossFraction,
      rttMs: this._rttMs,
      timestamp: Date.now(),
    };
  }

  private _resetState(): void {
    this._mHat = 0;
    this._e = E_INITIAL;
    this._varV = 0.5;
    this._prevGroupSendTs = -1;
    this._prevGroupArrivalTs = -1;
    this._delVarTh = DEL_VAR_TH_INITIAL;
    this._overuseCounter = 0;
    this._signal = OveruseSignal.NORMAL;
    this._prevMHat = 0;
    this._rateState = RateControlState.INCREASE;
    this._aHat = INITIAL_BITRATE_BPS;
    this._asHat = INITIAL_BITRATE_BPS;
    this._targetBitrate = INITIAL_BITRATE_BPS;
    this._lastUpdateTime = 0;
    this._avgMaxBitrate = -1;
    this._varMaxBitrate = 0;
    this._inMultiplicativeIncrease = true;
    this._incomingBytes = [];
    this._currentLossFraction = 0;
    this._rttMs = 50;
    this._latestStats = null;
    this._lastFeedbackTime = 0;
    this._lastMinTime = 0;
    this._initialBitrate = INITIAL_BITRATE_BPS;
  }
}
