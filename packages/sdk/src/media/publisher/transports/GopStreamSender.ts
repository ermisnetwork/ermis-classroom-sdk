import { FrameHeaderEncoder, FrameType, GopStreamHeaderEncoder } from "../../shared";

// gopStreamSender.ts
export class GopStreamSender {
    private session: WebTransport;
    private streamId: string;
    private currentStream: WritableStreamDefaultWriter | null = null;
    private currentGopId = 0;
    private frameSequence = 0;

    constructor(session: WebTransport, streamId: string) {
        this.session = session;
        this.streamId = streamId;
    }

    /**
     * Start a new GOP stream (called when encoding a keyframe)
     * @param channel - Channel number (0-6)
     * @param expectedFrames - Expected number of frames in this GOP
     * @param sendOrder - Optional send priority (higher = sent first during congestion)
     */
    async startGop(channel: number, expectedFrames: number, sendOrder?: number): Promise<void> {
        try {
            // Close previous stream if exists
            if (this.currentStream) {
                await this.abortCurrentGop("Starting new GOP");
            }

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
        } catch (error) {
            console.error('[GOP] Error starting GOP:', error);
            // Don't close GOP on error - let next keyframe handle recovery
        }
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
     * Send a single frame in the current GOP
     */
    async sendFrame(
        frameData: Uint8Array,
        timestamp: number,
        frameType: FrameType
    ): Promise<void> {
        if (!this.currentStream) {
            return;
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
        } catch (error) {
            if (error instanceof Error && error.message === 'write timeout') {
                console.warn('[GOP] ⏱️ Frame write timed out — dropping stale frame, aborting GOP');
                await this.abortCurrentGop('Write timeout — congestion');
            } else {
                console.error('[GOP] Error sending frame:', error);
            }
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
        console.log('[GOP] GopStreamSender cleaned up');
    }
}
