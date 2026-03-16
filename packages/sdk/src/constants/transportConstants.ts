/**
 * Transport, timeout, and network-related constants.
 *
 * Centralises values that were previously scattered as magic numbers
 * across StreamManager, GopStreamSender, Publisher, Subscriber,
 * WebTransportManager, and AudioSendStrategy.
 */

/**
 * General transport timeouts and configuration
 */
export const TRANSPORT = {
  // --- Timeouts (ms) ---
  /** Default timeout when waiting for a stream to become ready */
  STREAM_WAIT_TIMEOUT: 10_000,
  /** Timeout when waiting for a media config to be sent */
  CONFIG_WAIT_TIMEOUT: 5_000,
  /** WebTransport / WebRTC connection timeout */
  CONNECTION_TIMEOUT: 10_000,
  /** Maximum polling timeout during reconnect loops */
  RECONNECT_POLL_TIMEOUT: 30_000,
  /** Grace period when racing a transport close */
  CLOSE_TIMEOUT: 500,
  /** WASM module ready timeout */
  WASM_READY_TIMEOUT: 5_000,

  // --- Reconnection ---
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_BASE_DELAY: 1_000,
  MAX_RECONNECT_DELAY: 10_000,
  MAX_RECONNECT_BACKOFF_DELAY: 30_000,

  // --- GOP (Group of Pictures) — video only ---
  /** Number of video frames per GOP stream (≈ 1 second at 30 fps) */
  VIDEO_GOP_SIZE: 30,

  // --- GopStreamSender thresholds (video) ---
  /** Write timeout per video frame (ms) — aggressive to release congestion window faster */
  GOP_WRITE_TIMEOUT_MS: 200,
  /** Consecutive write timeouts before aborting the GOP stream — abort fast to free window for audio */
  GOP_MAX_CONSECUTIVE_FAILURES: 2,
  /** Frame count sentinel for unbounded / persistent streams */
  GOP_PERSISTENT_STREAM_FRAMES: 0xFFFF,
  /** Maximum lifetime (ms) for a video GOP before client-side abort.
   *  Must match or be slightly less than server-side MAX_GOP_LATENCY_SECS (2s).
   *  Client aborts early so the server doesn't need to STOP_SENDING. */
  GOP_MAX_LIFETIME_MS: 2_000,

  // --- AudioStreamSender thresholds ---
  /** Number of audio frames per batch (≈ 1 second of audio) */
  AUDIO_BATCH_SIZE: 50,
  /** Write timeout per audio frame (ms) — very aggressive so audio never blocks long */
  AUDIO_WRITE_TIMEOUT_MS: 100,
  /** Graceful close timeout before falling back to abort (ms) */
  AUDIO_GRACEFUL_CLOSE_TIMEOUT_MS: 100,
  /** Consecutive write timeouts before aborting the audio stream (higher threshold since timeout is shorter) */
  AUDIO_MAX_CONSECUTIVE_FAILURES: 5,
  /** Frame count sentinel for unbounded / persistent audio streams */
  AUDIO_PERSISTENT_STREAM_FRAMES: 0xFFFF,

  // --- Congestion Controller (progressive degradation) ---
  /** Write-latency EMA threshold → Level 1 (mild) */
  CONGESTION_LATENCY_L1_MS: 40,
  /** Write-latency EMA threshold → Level 2 (moderate) */
  CONGESTION_LATENCY_L2_MS: 70,
  /** Write timeout already triggers Level 3 via reportTimeout() */
  /** Hold time at current level before stepping up (recovery) */
  CONGESTION_RECOVERY_HOLD_MS: 3_000,
  /** EMA smoothing factor (0-1). Higher = react faster, noisier */
  CONGESTION_EMA_ALPHA: 0.3,
  /** Bandwidth reserved for audio — video budget = estimated - this (bps) */
  AUDIO_RESERVATION_BPS: 50_000,
  /** Minimum video bitrate floor before turning video OFF (bps) */
  CONGESTION_MIN_VIDEO_BITRATE: 50_000,
  /** Interval for debug bandwidth estimation log (ms). Set to 0 to disable. */
  CONGESTION_DEBUG_LOG_INTERVAL_MS: 0,

  // --- WebRTC hybrid mode ---
  /** Interval for polling WebRTC getStats() in hybrid mode (ms) */
  WEBRTC_STATS_POLL_INTERVAL_MS: 1_000,

} as const;

/**
 * Forward Error Correction (FEC / RaptorQ) parameters for WebRTC
 */
export const FEC = {
  MAX_MTU: 512,
  MIN_MTU: 100,
  MIN_CHUNKS: 5,
  MAX_REDUNDANCY: 10,
  MIN_REDUNDANCY: 1,
  REDUNDANCY_RATIO: 0.1,
  HEADER_SIZE: 20,
  /** Extra redundancy used when sending config packets */
  CONFIG_REDUNDANCY: 3,
} as const;

/**
 * WebRTC DataChannel bufferedAmountLowThreshold presets
 */
export const WEBRTC_BUFFER = {
  SMALL: 8_192,
  LOW: 16_384,
  MEDIUM: 32_768,
  HIGH: 65_536,
} as const;
