import { TRANSPORT } from '../../../constants/transportConstants';
import { log } from '../../../utils';
import type { CongestionController } from './CongestionController';

/**
 * WebRTC stats derived from `pc.getStats()`.
 * These are client-side measurements of the **upload** path —
 * unlike Quinn server stats which measure server→client.
 */
export interface WebRTCCongestionStats {
  /** Round-trip time in milliseconds (from candidate-pair report) */
  rttMs: number;
  /** Cumulative packets lost (from outbound-rtp report) */
  packetsLost: number;
  /** Cumulative packets sent (from outbound-rtp report) */
  packetsSent: number;
  /** GCC bandwidth estimate in bps (from candidate-pair, may be undefined) */
  availableOutgoingBitrate?: number;
}

/**
 * WebRTCStatsPoller — polls `RTCPeerConnection.getStats()` at a
 * fixed interval and feeds the results into the CongestionController.
 *
 * `getStats()` is a **local browser API call** that returns immediately
 * even during severe network congestion. This solves the critical flaw
 * of relying on server-sent Quinn stats which:
 * 1. Measure server→client (wrong direction for publisher upload)
 * 2. Arrive late or not at all when the path is congested
 */
export class WebRTCStatsPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private controller: CongestionController | null = null;

  /**
   * Start polling a peer connection's stats.
   * @param pc         The RTCPeerConnection to poll
   * @param controller CongestionController to feed stats into
   * @param intervalMs Polling interval (default: WEBRTC_STATS_POLL_INTERVAL_MS)
   */
  start(
    pc: RTCPeerConnection,
    controller: CongestionController,
    intervalMs: number = TRANSPORT.WEBRTC_STATS_POLL_INTERVAL_MS,
  ): void {
    this.stop(); // Clear any previous poller

    this.peerConnection = pc;
    this.controller = controller;

    log(`[WebRTCStatsPoller] Starting, interval=${intervalMs}ms`);

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        console.warn('[WebRTCStatsPoller] Poll error:', err);
      });
    }, intervalMs);

    // Immediate first poll
    this.poll().catch(() => {});
  }

  /**
   * Stop polling and release references.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.peerConnection = null;
    this.controller = null;
    log('[WebRTCStatsPoller] Stopped');
  }

  /**
   * Single poll iteration.
   * Extracts:
   * - `currentRoundTripTime` from the nominated candidate-pair
   * - `availableOutgoingBitrate` from the nominated candidate-pair (GCC estimate)
   * - `packetsSent` / `packetsLost` from outbound-rtp (retransmitted count)
   */
  private async poll(): Promise<void> {
    if (!this.peerConnection || !this.controller) return;

    try {
      const stats = await this.peerConnection.getStats();

      let rttMs = 0;
      let availableOutgoingBitrate: number | undefined;
      let totalPacketsSent = 0;
      let totalPacketsLost = 0;

      stats.forEach((report) => {
        // Nominated candidate pair — has RTT and GCC bandwidth estimate
        if (report.type === 'candidate-pair' && report.nominated) {
          if (typeof report.currentRoundTripTime === 'number') {
            rttMs = report.currentRoundTripTime * 1000; // seconds → ms
          }
          if (typeof report.availableOutgoingBitrate === 'number') {
            availableOutgoingBitrate = report.availableOutgoingBitrate;
          }
        }

        // Outbound RTP — packet counts
        if (report.type === 'outbound-rtp') {
          if (typeof report.packetsSent === 'number') {
            totalPacketsSent += report.packetsSent;
          }
          // Note: packetsLost is on 'remote-inbound-rtp', linked via report.remoteId
          // We handle it separately below
        }

        // Remote inbound RTP — has packetsLost reported by the remote peer
        if (report.type === 'remote-inbound-rtp') {
          if (typeof report.packetsLost === 'number') {
            totalPacketsLost += report.packetsLost;
          }
        }
      });

      // Only feed stats if we got a valid RTT
      if (rttMs > 0) {
        this.controller.updateFromWebRTCStats({
          rttMs,
          packetsLost: totalPacketsLost,
          packetsSent: totalPacketsSent,
          availableOutgoingBitrate,
        });
      }
    } catch (err) {
      // getStats() can fail if connection is closing
      console.warn('[WebRTCStatsPoller] getStats() failed:', err);
    }
  }
}
