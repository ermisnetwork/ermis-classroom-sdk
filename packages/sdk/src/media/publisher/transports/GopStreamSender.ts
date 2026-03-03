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
     */
    async startGop(channel: number, expectedFrames: number): Promise<void> {
        try {
            // Close previous stream if exists
            if (this.currentStream) {
                await this.abortCurrentGop("Starting new GOP");
            }

            // Open new unidirectional stream
            const stream = await this.session.createUnidirectionalStream();
            this.currentStream = stream.getWriter();

            // Send GOP stream header
            const gopHeader = GopStreamHeaderEncoder.encode({
                streamId: this.streamId,
                channel,
                gopId: this.currentGopId,
                expectedFrames,
            });
            await this.currentStream.ready;
            await this.currentStream.write(gopHeader);

            this.frameSequence = 0;
        } catch (error) {
            console.error('[GOP] Error starting GOP:', error);
            // Don't close GOP on error - let next keyframe handle recovery
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

            // Send header + payload
            const combined = new Uint8Array(frameHeader.length + frameData.length);
            combined.set(frameHeader, 0);
            combined.set(frameData, frameHeader.length);
            await this.currentStream.ready;
            await this.currentStream.write(combined);
        } catch (error) {
            console.error('[GOP] Error sending frame:', error);
            // Don't close GOP on single frame error - let subsequent frames continue
            // The next keyframe will close old GOP and start new one
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
