import { FrameHeaderEncoder, FrameType, GopStreamHeaderEncoder } from "../../shared";
import { TRANSPORT } from "../../../constants/transportConstants";
import { log } from "../../../utils";
import type { CongestionController } from "../controllers/CongestionController";

/**
 * AudioStreamSender — manages WebTransport uni-streams for audio data.
 *
 * Two modes:
 * 1. **Batch rotation** (Android MIC): rotates a new uni-stream every N frames
 *    via `startBatchGraceful()` to avoid backpressure on Android WebView.
 * 2. **Persistent stream** (all other audio): uses a single long-lived
 *    uni-stream via `ensurePersistentStream()` to avoid packet reordering.
 *
 * Unlike GopStreamSender (video), audio never uses abort() — it always
 * flushes buffered frames via close() before opening a new stream.
 */
export type StreamDataAudio = {
    batchId: number;
    audioSender: AudioStreamSender;
    currentBatchFrames: number;
};

export class AudioStreamSender {
    private session: WebTransport;
    private streamId: string;
    private currentStream: WritableStreamDefaultWriter | null = null;
    private currentBatchId = 0;
    private frameSequence = 0;
    private _consecutiveFailures = 0;
    private streamHealthy = false;

    /** Shared congestion controller — audio timeouts escalate to CRITICAL. */
    private congestionController?: CongestionController;

    constructor(session: WebTransport, streamId: string, congestionController?: CongestionController) {
        this.session = session;
        this.streamId = streamId;
        this.congestionController = congestionController;
    }

    /**
     * Start a new audio batch stream with graceful close of the previous stream.
     * Uses close() to flush all buffered frames before opening the next stream.
     * Suitable for audio where we don't want to lose any frames.
     * @param channel - Channel number (0-6)
     * @param expectedFrames - Expected number of frames in this batch
     * @param sendOrder - Optional send priority (higher = sent first during congestion)
     */
    async startBatchGraceful(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        try {
            // Gracefully close previous stream, but with a timeout to avoid
            // blocking audio indefinitely on a congested connection.
            if (this.currentStream) {
                try {
                    await Promise.race([
                        this.closeCurrentStream(),
                        new Promise<void>((_, reject) =>
                            setTimeout(() => reject(new Error('close timeout')), TRANSPORT.AUDIO_GRACEFUL_CLOSE_TIMEOUT_MS)
                        ),
                    ]);
                } catch {
                    // Close timed out — abort immediately to unblock audio
                    await this.abortCurrentStream('Close timed out — congestion');
                }
            }

            await this.openNewStream(channel, expectedFrames, sendOrder);
            this._consecutiveFailures = 0;
        } catch (error) {
            console.error('[AudioStream] Error starting batch (graceful):', error);
        }
    }

    /**
     * Ensure a single persistent uni-stream is open for audio.
     * Opens the stream on first call; subsequent calls are no-ops.
     * This avoids the concurrent-batch-task race that causes out-of-order
     * delivery when rotating streams every N frames.
     * Only reopens if the stream has died (write error, timeout, etc.).
     */
    async ensurePersistentStream(channel: number, sendOrder?: number): Promise<void> {
        if (this.currentStream) return; // already open — no-op
        try {
            await this.openNewStream(channel, TRANSPORT.AUDIO_PERSISTENT_STREAM_FRAMES, sendOrder);
            this._consecutiveFailures = 0;
            log(`[AudioStream] Persistent audio stream opened ch=${channel} batchId=${this.currentBatchId - 1}`);
        } catch (error) {
            console.error('[AudioStream] Error opening persistent audio stream:', error);
        }
    }

    /**
     * Open a new unidirectional stream and write the stream header.
     */
    private async openNewStream(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        const options: Record<string, unknown> = {};
        if (sendOrder !== undefined) {
            options.sendOrder = sendOrder;
        }
        const stream = await this.session.createUnidirectionalStream(options);
        this.currentStream = stream.getWriter();

        // Send stream header (reuses the same binary format as GOP header)
        const header = GopStreamHeaderEncoder.encode({
            streamId: this.streamId,
            channel,
            gopId: this.currentBatchId,
            expectedFrames,
        });
        await this.writeWithTimeout(header, TRANSPORT.AUDIO_WRITE_TIMEOUT_MS);

        this.frameSequence = 0;
        this.streamHealthy = true;
    }

    /**
     * Whether the current stream is healthy (alive and accepting writes).
     * When false, callers should reopen the stream before sending.
     */
    isHealthy(): boolean {
        return this.currentStream !== null && this.streamHealthy;
    }

    /**
     * Write data with a timeout to prevent indefinite blocking during congestion.
     * Unlike video (GopStreamSender), audio does NOT await writer.ready —
     * it writes immediately to avoid blocking real-time audio on backpressure.
     */
    private async writeWithTimeout(data: Uint8Array, timeoutMs: number = TRANSPORT.AUDIO_WRITE_TIMEOUT_MS): Promise<void> {
        if (!this.currentStream) {
            throw new Error('No current stream');
        }

        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            await Promise.race([
                this.currentStream!.write(data),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('write timeout')),
                        timeoutMs
                    );
                }),
            ]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    /**
     * Send a single audio frame on the current stream.
     * **Fire-and-forget**: the write is dispatched to the QUIC layer without
     * blocking the caller.  If the write eventually fails (timeout, congestion,
     * stream error), the stream is marked unhealthy so the next call reopens it.
     * Returns true if the write was dispatched (not necessarily delivered).
     */
    sendFrame(
        frameData: Uint8Array,
        timestamp: number,
        frameType: FrameType
    ): boolean {
        if (!this.currentStream || !this.streamHealthy) {
            return false;
        }

        try {
            const frameHeader = FrameHeaderEncoder.encode({
                sequence: this.frameSequence++,
                timestamp,
                frameType,
                payloadSize: frameData.length,
            });

            const combined = new Uint8Array(frameHeader.length + frameData.length);
            combined.set(frameHeader, 0);
            combined.set(frameData, frameHeader.length);

            // Fire-and-forget: dispatch write but do NOT await it.
            // This ensures the audio pipeline is never blocked by QUIC backpressure.
            this.writeWithTimeout(combined).then(() => {
                this._consecutiveFailures = 0;
            }).catch((error) => {
                if (error instanceof Error && error.message === 'write timeout') {
                    this._consecutiveFailures++;

                    // Audio write timeout → tell CongestionController to kill video
                    this.congestionController?.reportAudioTimeout();

                    if (this._consecutiveFailures >= TRANSPORT.AUDIO_MAX_CONSECUTIVE_FAILURES) {
                        console.warn(`[AudioStream] ⏱️ ${this._consecutiveFailures} consecutive write timeouts — marking stream unhealthy`);
                        this.streamHealthy = false;
                        this._consecutiveFailures = 0;
                    }
                } else {
                    console.error('[AudioStream] Background write error:', error);
                    this.streamHealthy = false;
                }
            });

            return true;
        } catch (error) {
            console.error('[AudioStream] Error preparing frame:', error);
            this.streamHealthy = false;
            return false;
        }
    }

    /**
     * Close current audio stream gracefully (flush buffered data).
     */
    async closeCurrentStream(): Promise<void> {
        const stream = this.currentStream;
        this.currentStream = null;
        this.streamHealthy = false;

        if (stream) {
            try {
                await stream.close();
            } catch (error) {
                console.warn('[AudioStream] Error closing stream:', error);
            }
            this.currentBatchId++;
        }
    }

    /**
     * Abort current audio stream (on error / timeout fallback).
     */
    async abortCurrentStream(reason?: string): Promise<void> {
        const stream = this.currentStream;
        this.currentStream = null;
        this.streamHealthy = false;

        if (stream) {
            try {
                await stream.abort(reason);
            } catch (error) {
                console.warn('[AudioStream] Error aborting stream:', error);
            }
            this.currentBatchId++;
        }
    }

    /**
     * Cleanup sender when connection closes.
     */
    cleanup(): void {
        this.currentStream = null;
        this.streamHealthy = false;
        log('[AudioStream] AudioStreamSender cleaned up');
    }
}
