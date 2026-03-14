import { ChannelName, FrameType, getStreamPriority } from "../../../types/media/publisher.types";
import type { StreamDataGop } from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import { CHANNEL_NUMBERS } from "../../../constants/mediaConstants";
import { TRANSPORT } from "../../../constants/transportConstants";

/**
 * AudioSendStrategy — encapsulates all audio publish logic with
 * explicit platform-specific branching.
 *
 * Two send modes (WebTransport only):
 * 1. **Android MIC — GOP batch rotation**: Rotates a new uni-stream every
 *    `AUDIO_GOP_SIZE` frames via `startGopGraceful` to avoid backpressure
 *    on Android WebView.
 * 2. **All other audio — persistent stream**: Uses a single long-lived
 *    uni-stream via `ensurePersistentStream` to avoid packet reordering.
 *
 * WebRTC path always delegates to sendPacket (no GOP).
 */

export class AudioSendStrategy {
  private readonly AUDIO_GOP_SIZE: number;
  private readonly isAndroid: boolean;

  // Audio TX diagnostics
  private _audioTxSent = 0;
  private _audioTxDropped = 0;
  private _audioTxRetried = 0;

  constructor(
    private gopSenders: Map<ChannelName, StreamDataGop>,
    private sendPacketFallback: (ch: ChannelName, pkt: Uint8Array, ft: FrameType) => Promise<void>,
    private getAndIncrementSequence: (ch: ChannelName) => number,
    private isWebRTC: boolean,
    isAndroid: boolean,
    gopSize: number,
  ) {
    this.isAndroid = isAndroid;
    this.AUDIO_GOP_SIZE = gopSize;
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

    const gopData = this.gopSenders.get(channelName);
    const gopSender = gopData?.gopSender;

    // WebTransport path: route audio through uni-streams
    if (!this.isWebRTC && gopSender) {
      const channel = CHANNEL_NUMBERS[channelName];
      const useGopBatching = this.isAndroid && channelName === ChannelName.MIC_48K;

      // Ensure the correct stream mode is active
      await this.ensureStream(channelName, channel, gopData, gopSender, useGopBatching);

      // Send frame
      let sent = await gopSender.sendFrame(packet, timestamp, FrameType.AUDIO);
      if (sent) {
        this._audioTxSent++;
        if (useGopBatching) gopData.currentGopFrames++;
      } else {
        // Stream died — reopen and retry once
        sent = await this.retryOnce(
          channelName, channel, gopData, gopSender,
          useGopBatching, packet, timestamp, sequenceNumber,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensureStream(
    channelName: ChannelName,
    channel: number,
    gopData: StreamDataGop,
    gopSender: StreamDataGop['gopSender'],
    useGopBatching: boolean,
  ): Promise<void> {
    if (useGopBatching) {
      // Android MIC: rotate stream every AUDIO_GOP_SIZE frames
      if (gopData.currentGopFrames >= this.AUDIO_GOP_SIZE || gopData.currentGopFrames === 0) {
        await gopSender.startGopGraceful(channel, this.AUDIO_GOP_SIZE, getStreamPriority(channelName));
        gopData.currentGopFrames = 0;
      }
    } else {
      // Persistent stream for all other audio
      await gopSender.ensurePersistentStream(channel, getStreamPriority(channelName));
    }
  }

  /**
   * Retry a failed audio frame once after reopening the stream.
   * Returns whether the retry succeeded.
   */
  private async retryOnce(
    channelName: ChannelName,
    channel: number,
    gopData: StreamDataGop,
    gopSender: StreamDataGop['gopSender'],
    useGopBatching: boolean,
    packet: Uint8Array,
    timestamp: number,
    sequenceNumber: number,
  ): Promise<boolean> {
    this._audioTxRetried++;
    console.warn(`[Audio TX] SEND FAILED seq=${sequenceNumber}, reopening stream…`);

    // Reopen
    if (useGopBatching) {
      await gopSender.startGopGraceful(channel, this.AUDIO_GOP_SIZE, getStreamPriority(channelName));
      gopData.currentGopFrames = 0;
    } else {
      await gopSender.ensurePersistentStream(channel, getStreamPriority(channelName));
    }

    // Retry the failed frame on the new stream
    const sent = await gopSender.sendFrame(packet, timestamp, FrameType.AUDIO);
    if (sent) {
      this._audioTxSent++;
      if (useGopBatching) gopData.currentGopFrames++;
      return true;
    } else {
      this._audioTxDropped++;
      console.error(`[Audio TX] RETRY FAILED seq=${sequenceNumber} — frame dropped`);
      return false;
    }
  }
}
