import { FrameHeaderEncoder, FrameType, GopStreamHeaderEncoder } from "../../shared";

// gopStreamSender.ts
export class GopStreamSender {
    private session: WebTransport;
    private streamId: string;
    private currentStream: WritableStreamDefaultWriter | null = null;
    private currentGopId = 0;
    private frameSequence = 0;
    private _consecutiveFailures = 0;

    // Write timeout tracking for NetworkQualityMonitor (sliding 5s window)
    private _writeAttempts: number[] = []; // timestamps of all write attempts
    private _writeTimeouts: number[] = []; // timestamps of timed-out writes
    private static readonly TIMEOUT_WINDOW_MS = 5000;

    constructor(session: WebTransport, streamId: string) {
        this.session = session;
        this.streamId = streamId;
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
        } catch (error) {
            console.error('[GOP] Error starting GOP:', error);
            // Don't close GOP on error - let next keyframe handle recovery
        }
    }

    /**
     * Start a new GOP stream with graceful close of the previous stream.
     * Uses close() to flush all buffered frames before opening the next stream.
     * Suitable for audio where we don't want to lose any frames.
     * @param channel - Channel number (0-6)
     * @param expectedFrames - Expected number of frames in this GOP
     * @param sendOrder - Optional send priority (higher = sent first during congestion)
     */
    async startGopGraceful(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        try {
            // Gracefully close previous stream, but with a timeout to avoid
            // blocking audio indefinitely on a congested connection.
            if (this.currentStream) {
                try {
                    await Promise.race([
                        this.closeCurrentGop(),
                        new Promise<void>((_, reject) =>
                            setTimeout(() => reject(new Error('close timeout')), 200)
                        ),
                    ]);
                } catch {
                    // Close timed out — abort immediately to unblock audio
                    await this.abortCurrentGop('Close timed out — congestion');
                }
            }

            await this.openNewStream(channel, expectedFrames, sendOrder);
            this._consecutiveFailures = 0;
        } catch (error) {
            console.error('[GOP] Error starting GOP (graceful):', error);
        }
    }

    /**
     * Ensure a single persistent uni-stream is open for audio.
     * Opens the stream on first call; subsequent calls are no-ops.
     * This avoids the concurrent-GOP-task race that causes out-of-order
     * delivery when rotating streams every N frames.
     * Only reopens if the stream has died (write error, timeout, etc.).
     */
    async ensurePersistentStream(channel: number, sendOrder?: number): Promise<void> {
        if (this.currentStream) return; // already open — no-op
        try {
            await this.openNewStream(channel, 0xFFFF, sendOrder); // 0xFFFF = unbounded
            this._consecutiveFailures = 0;
            console.log(`[GOP] 🔊 Persistent audio stream opened ch=${channel} gopId=${this.currentGopId - 1}`);
        } catch (error) {
            console.error('[GOP] Error opening persistent audio stream:', error);
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
        await this.writeWithTimeout(gopHeader, 300);

        this.frameSequence = 0;
    }

    /**
     * Write data with a timeout to prevent indefinite blocking during congestion.
     * If the write takes longer than timeoutMs, the frame is dropped and the
     * current stream is aborted so the next batch starts fresh.
     */
    private async writeWithTimeout(data: Uint8Array, timeoutMs: number = 300): Promise<void> {
        if (!this.currentStream) {
            throw new Error('No current stream');
        }

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
            await this.writeWithTimeout(combined);
            this._consecutiveFailures = 0;
            this._recordWrite(false);
            return true;
        } catch (error) {
            if (error instanceof Error && error.message === 'write timeout') {
                this._consecutiveFailures++;
                this._recordWrite(true);
                if (this._consecutiveFailures >= 3) {
                    // Multiple consecutive timeouts — stream is stuck, abort and
                    // let the next batch start fresh
                    console.warn(`[GOP] ⏱️ ${this._consecutiveFailures} consecutive write timeouts — aborting GOP`);
                    await this.abortCurrentGop('Multiple write timeouts — congestion');
                    this._consecutiveFailures = 0;
                }
                // else: drop this frame but keep stream alive for next attempt
            } else {
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
        this._writeAttempts = [];
        this._writeTimeouts = [];
        console.log('[GOP] GopStreamSender cleaned up');
    }

    /**
     * Get the write timeout rate within the last 5-second window.
     * Returns a value between 0.0 (no timeouts) and 1.0 (all writes timed out).
     * Used by NetworkQualityMonitor as a secondary congestion signal.
     */
    getWriteTimeoutRate(): number {
        const now = Date.now();
        const cutoff = now - GopStreamSender.TIMEOUT_WINDOW_MS;
        this._pruneWindow(cutoff);

        if (this._writeAttempts.length === 0) return 0;
        return this._writeTimeouts.length / this._writeAttempts.length;
    }

    /** Record a write attempt (success or timeout). */
    private _recordWrite(timedOut: boolean): void {
        const now = Date.now();
        this._writeAttempts.push(now);
        if (timedOut) {
            this._writeTimeouts.push(now);
        }
        // Prune old entries
        const cutoff = now - GopStreamSender.TIMEOUT_WINDOW_MS;
        this._pruneWindow(cutoff);
    }

    /** Remove entries older than cutoff from sliding windows. */
    private _pruneWindow(cutoff: number): void {
        while (this._writeAttempts.length > 0 && this._writeAttempts[0] < cutoff) {
            this._writeAttempts.shift();
        }
        while (this._writeTimeouts.length > 0 && this._writeTimeouts[0] < cutoff) {
            this._writeTimeouts.shift();
        }
    }
}
