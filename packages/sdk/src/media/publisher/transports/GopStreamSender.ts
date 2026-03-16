import { FrameHeaderEncoder, FrameType, GopStreamHeaderEncoder } from "../../shared";
import { TRANSPORT } from "../../../constants/transportConstants";
import { log } from "../../../utils";
import type { CongestionController } from "../controllers/CongestionController";

// gopStreamSender.ts
export type StreamDataGop = {
    gopId: number;
    gopSender: GopStreamSender;
    currentGopFrames: number;
};

export class GopStreamSender {
    private session: WebTransport;
    private streamId: string;
    private currentStream: WritableStreamDefaultWriter | null = null;
    private currentGopId = 0;
    private frameSequence = 0;
    private _consecutiveFailures = 0;
    /** Timestamp (ms) when the current GOP stream was opened — for deadline expiry */
    private gopStartTime = 0;

    /** Shared congestion controller — receives latency/timeout reports */
    private congestionController?: CongestionController;

    constructor(session: WebTransport, streamId: string, congestionController?: CongestionController) {
        this.session = session;
        this.streamId = streamId;
        this.congestionController = congestionController;
    }

    /**
     * Start a new GOP stream (called when encoding a keyframe)
     * Uses abort() to immediately drop the previous stream — suitable for video
     * where stale frames should be discarded during congestion.
     * @param channel - Channel number (0-6)
     * @param expectedFrames - Expected number of frames in this GOP
     * @param sendOrder - Optional send priority (higher = sent first during congestion)
     */
    async startGop(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        try {
            // Abort previous stream if exists (immediate drop for video)
            if (this.currentStream) {
                await this.abortCurrentGop("Starting new GOP");
            }

            await this.openNewStream(channel, expectedFrames, sendOrder);
            this.gopStartTime = performance.now();
        } catch (error) {
            console.error('[GOP] Error starting GOP:', error);
            // Don't close GOP on error - let next keyframe handle recovery
        }
    }

    /**
     * Open a new unidirectional stream and write the GOP header.
     * Shared by both startGop() and startGopGraceful().
     */
    private async openNewStream(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        // Open new unidirectional stream with optional send priority
        // Higher sendOrder = higher priority = bytes sent first during congestion
        const options: Record<string, unknown> = {};
        if (sendOrder !== undefined) {
            options.sendOrder = sendOrder;
        }
        const stream = await this.session.createUnidirectionalStream(options);
        this.currentStream = stream.getWriter();

        // Send GOP stream header
        const gopHeader = GopStreamHeaderEncoder.encode({
            streamId: this.streamId,
            channel,
            gopId: this.currentGopId,
            expectedFrames,
        });
        await this.writeWithTimeout(gopHeader, TRANSPORT.GOP_WRITE_TIMEOUT_MS);

        this.frameSequence = 0;
    }

    /**
     * Write data with a timeout to prevent indefinite blocking during congestion.
     * If the write takes longer than timeoutMs, the frame is dropped and the
     * current stream is aborted so the next batch starts fresh.
     *
     * Returns the elapsed time (ms) so the caller can report latency.
     */
    private async writeWithTimeout(data: Uint8Array, timeoutMs: number = TRANSPORT.GOP_WRITE_TIMEOUT_MS): Promise<number> {
        if (!this.currentStream) {
            throw new Error('No current stream');
        }

        // Measure total time: writer.ready (backpressure wait) + write (queue)
        // writer.ready is the real congestion signal — it blocks when the
        // QUIC send buffer is full. write() alone just queues instantly.
        const t0 = performance.now();
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            await Promise.race([
                (async () => {
                    await this.currentStream!.ready;
                    await this.currentStream!.write(data);
                })(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('write timeout')),
                        timeoutMs
                    );
                }),
            ]);
            return performance.now() - t0;
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    /**
     * Send a single frame in the current GOP.
     * Returns true if the frame was sent successfully, false if dropped
     * (no active stream, write timeout, or error).
     */
    async sendFrame(
        frameData: Uint8Array,
        timestamp: number,
        frameType: FrameType
    ): Promise<boolean> {
        if (!this.currentStream) {
            return false;
        }

        // ── MOQ-inspired Group Expiration (client-side) ──
        // If this GOP has been alive longer than the deadline, abort it proactively
        // to free congestion window for audio. This is the client-side counterpart
        // of the server's MAX_GOP_LATENCY_SECS check.
        // NOTE: Do NOT call reportTimeout() here — the deadline is an application-level
        // decision, not a network timeout. Actual write timeouts (200ms) already feed
        // the CongestionController through sendFrame()'s catch block.
        if (this.gopStartTime > 0) {
            const elapsed = performance.now() - this.gopStartTime;
            if (elapsed > TRANSPORT.GOP_MAX_LIFETIME_MS) {
                console.warn(`[GOP] ⏱️ GOP ${this.currentGopId} expired after ${elapsed.toFixed(0)}ms — aborting to free congestion window`);
                await this.abortCurrentGop('GOP deadline expired');
                return false;
            }
        }

        try {
            // Encode frame header
            const frameHeader = FrameHeaderEncoder.encode({
                sequence: this.frameSequence++,
                timestamp,
                frameType,
                payloadSize: frameData.length,
            });

            // Send header + payload with timeout to avoid blocking during congestion
            const combined = new Uint8Array(frameHeader.length + frameData.length);
            combined.set(frameHeader, 0);
            combined.set(frameData, frameHeader.length);

            // ── Report writer.desiredSize to CongestionController (PRIMARY signal) ──
            // desiredSize = highWaterMark - queueSize → gradual congestion signal.
            // Reports on every write attempt for real-time buffer level tracking.
            const desiredSize = this.currentStream?.desiredSize;
            if (desiredSize !== null && desiredSize !== undefined) {
                this.congestionController?.reportVideoDesiredSize(desiredSize);
            }

            const elapsed = await this.writeWithTimeout(combined);

            // Report successful write latency to congestion controller
            this.congestionController?.reportWriteLatency(elapsed, combined.byteLength);

            this._consecutiveFailures = 0;
            return true;
        } catch (error) {
            if (error instanceof Error && error.message === 'write timeout') {
                this._consecutiveFailures++;

                // Report timeout to congestion controller
                this.congestionController?.reportTimeout();

                if (this._consecutiveFailures >= TRANSPORT.GOP_MAX_CONSECUTIVE_FAILURES) {
                    // Multiple consecutive timeouts — stream is stuck, abort and
                    // let the next batch start fresh
                    console.warn(`[GOP] ⏱️ ${this._consecutiveFailures} consecutive write timeouts — aborting GOP`);
                    await this.abortCurrentGop('Multiple write timeouts — congestion');
                    this._consecutiveFailures = 0;
                }
                // else: drop this frame but keep stream alive for next attempt
            } else {
                // Non-timeout errors (stream reset, new GOP starting, etc.)
                // are also congestion signals — report them
                this.congestionController?.reportTimeout();
                console.error('[GOP] Error sending frame:', error);
                await this.abortCurrentGop('Send error');
            }
            return false;
        }
    }

    /**
     * Close current GOP stream
     */
    async closeCurrentGop(): Promise<void> {
        const stream = this.currentStream;
        this.currentStream = null;

        if (stream) {
            try {
                await stream.close();
            } catch (error) {
                console.warn('[GOP] Error closing GOP stream:', error);
            }
            this.currentGopId++;
        }
    }

    /**
     * Abort current GOP stream (on error)
     */
    async abortCurrentGop(reason?: string): Promise<void> {
        const stream = this.currentStream;
        this.currentStream = null;

        if (stream) {
            try {
                await stream.abort(reason);
                // console.warn(`[GOP] Aborted GOP ${this.currentGopId}: ${reason}`);
            } catch (error) {
                console.warn('[GOP] Error aborting GOP stream:', error);
            }
            this.currentGopId++;
        }
    }

    /**
     * Cleanup sender when connection closes
     */
    cleanup(): void {
        this.currentStream = null;
        log('[GOP] GopStreamSender cleaned up');
    }

}
