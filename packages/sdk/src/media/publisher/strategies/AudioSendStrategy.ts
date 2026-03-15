import { ChannelName, FrameType, getStreamPriority } from "../../../types/media/publisher.types";
import type { StreamDataAudio } from "../transports/AudioStreamSender";
import type { AudioDatagramSender } from "../transports/AudioDatagramSender";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { CHANNEL_NUMBERS } from "../../../constants/mediaConstants";

/**
 * AudioSendStrategy — encapsulates all audio publish logic with
 * explicit platform-specific branching.
 *
 * Two send modes (WebTransport only):
 * 1. **Android MIC — batch rotation**: Rotates a new uni-stream every
 *    `AUDIO_BATCH_SIZE` frames via `startBatchGraceful` to avoid backpressure
 *    on Android WebView.
 * 2. **All other audio — persistent stream**: Uses a single long-lived
 *    uni-stream via `ensurePersistentStream` to avoid packet reordering.
 *
 * WebRTC path always delegates to sendPacket (no batching).
 */

export class AudioSendStrategy {
  private readonly AUDIO_BATCH_SIZE: number;
  private readonly isAndroid: boolean;

  // Audio TX diagnostics
  private _audioTxSent = 0;
  private _audioTxDropped = 0;
  private _audioTxRetried = 0;

  constructor(
    private audioSenders: Map<ChannelName, StreamDataAudio>,
    private sendPacketFallback: (ch: ChannelName, pkt: Uint8Array, ft: FrameType) => Promise<void>,
    private getAndIncrementSequence: (ch: ChannelName) => number,
    private isWebRTC: boolean,
    isAndroid: boolean,
    batchSize: number,
    private datagramSender?: AudioDatagramSender,
  ) {
    this.isAndroid = isAndroid;
    this.AUDIO_BATCH_SIZE = batchSize;
  }

  /**
   * Send a single audio frame over the appropriate transport.
   */
  async send(
    channelName: ChannelName,
    audioData: Uint8Array,
    timestamp: number,
  ): Promise<void> {
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      audioData,
      timestamp,
      FrameType.AUDIO,
      sequenceNumber,
    );

    // ── Datagram path: fire-and-forget, bypass uni-streams entirely ──
    if (this.datagramSender && !this.isWebRTC) {
      const channel = CHANNEL_NUMBERS[channelName];
      this.datagramSender.sendFrame(channel, packet);
      this._audioTxSent++;
      return;
    }

    const audioData_ = this.audioSenders.get(channelName);
    const audioSender = audioData_?.audioSender;

    // WebTransport path: route audio through uni-streams
    if (!this.isWebRTC && audioSender) {
      const channel = CHANNEL_NUMBERS[channelName];

      // Android MIC — batch rotation
      const useBatching = this.isAndroid && channelName === ChannelName.MIC_48K;

      // Ensure the correct stream mode is active
      await this.ensureStream(channelName, channel, audioData_, audioSender, useBatching);

      // Send frame (fire-and-forget — sendFrame is synchronous, never blocks)
      const sent = audioSender.sendFrame(packet, timestamp, FrameType.AUDIO);
      if (sent) {
        this._audioTxSent++;
        if (useBatching) audioData_.currentBatchFrames++;
      } else {
        // Stream died — reopen and retry once
        await this.retryOnce(
          channelName, channel, audioData_, audioSender,
          useBatching, packet, timestamp, sequenceNumber,
        );
      }

      // Periodic summary available via _audioTxSent / _audioTxDropped counters
    } else {
      // WebRTC path or fallback
      await this.sendPacketFallback(channelName, packet, FrameType.AUDIO);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure a uni-stream is open using the correct mode for this platform/channel.
   */
  private async ensureStream(
    channelName: ChannelName,
    channel: number,
    audioData: StreamDataAudio,
    audioSender: StreamDataAudio['audioSender'],
    useBatching: boolean,
  ): Promise<void> {
    // Force reopen if the stream was marked unhealthy by background write failures
    const needsReopen = !audioSender.isHealthy();

    if (useBatching) {
      // Android MIC: rotate stream every AUDIO_BATCH_SIZE frames
      if (needsReopen || audioData.currentBatchFrames >= this.AUDIO_BATCH_SIZE || audioData.currentBatchFrames === 0) {
        if (needsReopen) {
          console.warn(`[Audio TX] Stream unhealthy for ${channelName}, forcing reopen`);
        }
        await audioSender.startBatchGraceful(channel, this.AUDIO_BATCH_SIZE, getStreamPriority(channelName));
        audioData.currentBatchFrames = 0;
      }
    } else {
      // Persistent stream for all other audio
      if (needsReopen) {
        console.warn(`[Audio TX] Stream unhealthy for ${channelName}, forcing reopen`);
        // Close the dead stream before reopening
        await audioSender.abortCurrentStream('Unhealthy — background write failures');
      }
      // Wrap in timeout so stream reopen never blocks audio pipeline > 200ms
      try {
        await Promise.race([
          audioSender.ensurePersistentStream(channel, getStreamPriority(channelName)),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('stream reopen timeout')), 200),
          ),
        ]);
      } catch {
        // Reopen timed out — will retry on next frame, don't block
        console.warn(`[Audio TX] Stream reopen timed out for ${channelName} — frame will be dropped`);
      }
    }
  }

  /**
   * Retry a failed audio frame once after reopening the stream.
   * Returns whether the retry succeeded.
   */
  private async retryOnce(
    channelName: ChannelName,
    channel: number,
    audioData: StreamDataAudio,
    audioSender: StreamDataAudio['audioSender'],
    useBatching: boolean,
    packet: Uint8Array,
    timestamp: number,
    sequenceNumber: number,
  ): Promise<boolean> {
    this._audioTxRetried++;
    console.warn(`[Audio TX] SEND FAILED seq=${sequenceNumber}, reopening stream…`);

    // Reopen
    if (useBatching) {
      await audioSender.startBatchGraceful(channel, this.AUDIO_BATCH_SIZE, getStreamPriority(channelName));
      audioData.currentBatchFrames = 0;
    } else {
      await audioSender.ensurePersistentStream(channel, getStreamPriority(channelName));
    }

    // Retry the failed frame on the new stream (fire-and-forget)
    const sent = audioSender.sendFrame(packet, timestamp, FrameType.AUDIO);
    if (sent) {
      this._audioTxSent++;
      if (useBatching) audioData.currentBatchFrames++;
      return true;
    } else {
      this._audioTxDropped++;
      console.error(`[Audio TX] RETRY FAILED seq=${sequenceNumber} — frame dropped`);
      return false;
    }
  }
}
