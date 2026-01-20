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
        // Close previous stream if exists
        if (this.currentStream) {
            await this.closeCurrentGop();
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

        await this.currentStream.write(gopHeader);

        this.frameSequence = 0;
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
            throw new Error('No active GOP stream. Call startGop() first.');
        }

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

        await this.currentStream.write(combined);
    }

    /**
     * Close current GOP stream
     */
    async closeCurrentGop(): Promise<void> {
        if (this.currentStream) {
            await this.currentStream.close();
            this.currentStream = null;
            this.currentGopId++;
        }
    }

    /**
     * Abort current GOP stream (on error)
     */
    async abortCurrentGop(reason?: string): Promise<void> {
        if (this.currentStream) {
            await this.currentStream.abort(reason);
            console.warn(`[GOP] Aborted GOP ${this.currentGopId}: ${reason}`);
            this.currentStream = null;
            this.currentGopId++;
        }
    } 
}