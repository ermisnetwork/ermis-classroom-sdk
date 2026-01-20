import { FrameType } from "../../../types/media/publisher.types";

// frameCodec.ts
export interface FrameHeaderData {
    sequence: number;
    timestamp: number;
    frameType: FrameType;
    payloadSize: number;
}



export class FrameHeaderEncoder {
    static readonly SIZE = 13; // 4 + 4 + 1 + 4

    static encode(header: FrameHeaderData): Uint8Array {
        const buffer = new ArrayBuffer(this.SIZE);
        const view = new DataView(buffer);

        view.setUint32(0, header.sequence, false); // big-endian
        view.setUint32(4, header.timestamp, false);
        view.setUint8(8, header.frameType);
        view.setUint32(9, header.payloadSize, false);

        return new Uint8Array(buffer);
    }
}

export interface GopStreamHeaderData {
    streamId: string;
    channel: number;
    gopId: number;
    expectedFrames: number;
}

export class GopStreamHeaderEncoder {
    static encode(header: GopStreamHeaderData): Uint8Array {
        const streamIdBytes = new TextEncoder().encode(header.streamId);
        const size = 2 + streamIdBytes.length + 1 + 4 + 2;

        const buffer = new ArrayBuffer(size);
        const view = new DataView(buffer);
        const uint8Array = new Uint8Array(buffer);

        let offset = 0;

        // Stream ID length
        view.setUint16(offset, streamIdBytes.length, false);
        offset += 2;

        // Stream ID
        uint8Array.set(streamIdBytes, offset);
        offset += streamIdBytes.length;

        // Channel
        view.setUint8(offset, header.channel);
        offset += 1;

        // GOP ID
        view.setUint32(offset, header.gopId, false);
        offset += 4;

        // Expected frames
        view.setUint16(offset, header.expectedFrames, false);

        return uint8Array;
    }
}