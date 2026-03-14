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

  // --- GOP (Group of Pictures) ---
  /** Number of video frames per GOP stream (≈ 1 second at 30 fps) */
  VIDEO_GOP_SIZE: 30,
  /** Number of audio frames per GOP batch (≈ 1 second of audio) */
  AUDIO_GOP_SIZE: 50,

  // --- GopStreamSender thresholds ---
  /** Write timeout per frame (ms) */
  GOP_WRITE_TIMEOUT_MS: 300,
  /** Graceful close timeout before falling back to abort (ms) */
  GOP_GRACEFUL_CLOSE_TIMEOUT_MS: 200,

  /** Consecutive write timeouts before aborting the GOP stream */
  GOP_MAX_CONSECUTIVE_FAILURES: 3,
  /** Frame count sentinel for unbounded / persistent streams */
  GOP_PERSISTENT_STREAM_FRAMES: 0xFFFF,


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
