import { log } from "../../../utils";

/**
 * AudioDatagramSender — sends audio frames as unreliable WebTransport datagrams.
 *
 * Unlike AudioStreamSender (uni-streams), datagrams are fire-and-forget:
 * - No stream lifecycle (no open/close/abort)
 * - No retransmissions — stale packets are dropped immediately
 * - No head-of-line blocking — perfect for real-time audio under congestion
 *
 * Datagram format on the wire:
 *   [channel: 1 byte][packet: N bytes]
 * where `packet` is the standard 9-byte header (seq+ts+frameType) + audio payload
 * produced by PacketBuilder.createPacket().
 *
 * The `channel` byte maps to CHANNEL_NUMBERS / MeetingChannel::to_u8() so the
 * server can identify which audio channel the datagram belongs to.
 */
export class AudioDatagramSender {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _sent = 0;
  private _dropped = 0;

  constructor(session: WebTransport) {
    try {
      this.writer = session.datagrams.writable.getWriter();
      log("[AudioDatagramSender] Writer acquired");
    } catch (e) {
      console.error("[AudioDatagramSender] Failed to acquire datagram writer:", e);
    }
  }

  /**
   * Send a pre-built audio packet as a datagram.
   *
   * @param channel  - CHANNEL_NUMBERS[channelName] (1 byte on wire)
   * @param packet   - Full packet from PacketBuilder.createPacket() (header + payload)
   * @returns true if the write was initiated, false if dropped
   */
  sendFrame(channel: number, packet: Uint8Array): boolean {
    if (!this.writer) {
      this._dropped++;
      return false;
    }

    // Prepend 1-byte channel identifier
    const datagram = new Uint8Array(1 + packet.length);
    datagram[0] = channel;
    datagram.set(packet, 1);

    // Fire-and-forget: we intentionally do NOT await this
    this.writer.write(datagram).catch(() => {
      // Datagram dropped (backpressure or session closed) — this is expected
      // under congestion and is the whole point of using datagrams
      this._dropped++;
    });

    this._sent++;
    return true;
  }

  /** Number of datagrams successfully queued for send. */
  get sent(): number {
    return this._sent;
  }

  /** Number of datagrams dropped (writer unavailable or write rejected). */
  get dropped(): number {
    return this._dropped;
  }

  /** Release the writer lock. Call during cleanup. */
  cleanup(): void {
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        // Ignore — stream may already be closed
      }
      this.writer = null;
      log(`[AudioDatagramSender] Cleaned up. Sent=${this._sent}, Dropped=${this._dropped}`);
    }
  }
}
