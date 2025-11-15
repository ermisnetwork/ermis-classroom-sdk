/**
 * LengthDelimitedReader - Reads length-delimited messages from a stream
 *
 * Format: [4 bytes length][message bytes]
 *
 * Used for reading messages from WebTransport bidirectional streams,
 * especially the MEETING_CONTROL channel for receiving server events.
 */
export class LengthDelimitedReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer: Uint8Array;

    constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
        this.reader = reader;
        this.buffer = new Uint8Array(0);
    }

    /**
     * Append new data to internal buffer
     */
    private appendBuffer(newData: Uint8Array): void {
        const combined = new Uint8Array(this.buffer.length + newData.length);
        combined.set(this.buffer);
        combined.set(newData, this.buffer.length);
        this.buffer = combined;
    }

    /**
     * Read one complete message from the stream
     * Returns null when stream is done
     */
    async readMessage(): Promise<Uint8Array | null> {
        while (true) {
            // Check if we have enough bytes to read the length prefix
            if (this.buffer.length >= 4) {
                const view = new DataView(
                    this.buffer.buffer,
                    this.buffer.byteOffset,
                    4,
                );
                const messageLength = view.getUint32(0, false);

                const totalLength = 4 + messageLength;

                // Check if we have the complete message
                if (this.buffer.length >= totalLength) {
                    const message = this.buffer.slice(4, totalLength);
                    this.buffer = this.buffer.slice(totalLength);

                    return message;
                }
            }

            // Read more data from the stream
            const { value, done } = await this.reader.read();

            if (done) {
                if (this.buffer.length > 0) {
                    throw new Error("Stream ended with incomplete message");
                }
                return null;
            }

            this.appendBuffer(value);
        }
    }
}
