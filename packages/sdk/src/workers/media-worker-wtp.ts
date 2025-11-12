/// <reference lib="webworker" />
import { OpusAudioDecoder } from '../opus_decoder/opusDecoder.js';
import '../polyfills/audioData.js';
import '../polyfills/encodedAudioChunk.js';

// Types
interface VideoConfig {
    codec: string;
    codedWidth: number;
    codedHeight: number;
    frameRate: number;
    description: Uint8Array;
}

interface AudioConfig {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description: Uint8Array;
}

interface StreamConfig {
    type: 'StreamConfig';
    config: {
        codec: string;
        codedWidth?: number;
        codedHeight?: number;
        frameRate?: number;
        sampleRate?: number;
        numberOfChannels?: number;
        description: string;
    };
}

interface InitMessage {
    type: 'init';
    port?: MessagePort;
}

interface AttachStreamMessage {
    type: 'attachStream';
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    channelName: string;
}

interface ToggleAudioMessage {
    type: 'toggleAudio';
}

interface SwitchBitrateMessage {
    type: 'switchBitrate';
    quality: '360p' | '720p';
}

interface ResetMessage {
    type: 'reset';
}

interface StopMessage {
    type: 'stop';
}

type WorkerMessage =
    | InitMessage
    | AttachStreamMessage
    | ToggleAudioMessage
    | SwitchBitrateMessage
    | ResetMessage
    | StopMessage;

interface VideoDataMessage {
    type: 'videoData';
    frame: VideoFrame;
    quality: '360p' | '720p';
}

interface AudioDataMessage {
    type: 'audioData';
    channelData: Float32Array[];
    timestamp: number;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

interface AudioToggledMessage {
    type: 'audio-toggled';
    audioEnabled: boolean;
}

interface CodecReceivedMessage {
    type: 'codecReceived';
    stream: 'video' | 'audio';
    video360pConfig?: VideoConfig;
    video720pConfig?: VideoConfig;
    audioConfig?: AudioConfig;
}

interface BitrateChangedMessage {
    type: 'bitrateChanged';
    quality: '360p' | '720p';
}

interface LogMessage {
    type: 'log';
    event: string;
    message: string;
}

interface StreamInfo {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    writer: WritableStreamDefaultWriter<Uint8Array>;
}

// Worker state
let videoDecoder360p: VideoDecoder | null = null;
let videoDecoder720p: VideoDecoder | null = null;
let currentVideoDecoder: VideoDecoder | null = null;
let currentQuality: '360p' | '720p' = '360p';
let audioDecoder: OpusAudioDecoder | null = null;

let workletPort: MessagePort | null = null;
let audioEnabled = true;

let video360pConfig: VideoConfig | null = null;
let video720pConfig: VideoConfig | null = null;
let audioConfig: AudioConfig | null = null;

let videoFrameRate = 30;
let audioFrameRate = 46.875; // 48000 / 1024

let curVideoInterval: { speed: number; rate: number } | null = null;
let curAudioInterval: { speed: number; rate: number } | null = null;

let videoIntervalID: number | null = null;
let audioIntervalID: number | null = null;

let videoCodecReceived = false;
let audioCodecReceived = false;
let keyFrameReceived = false;

const channelStreams = new Map<string, StreamInfo>();

// Video decoder factory
const createVideoInit = (quality: '360p' | '720p'): VideoDecoderInit => ({
    output: (frame: VideoFrame) => {
        self.postMessage(
            { type: 'videoData', frame, quality } as VideoDataMessage,
            [frame as any]
        );
    },
    error: (e: Error) => {
        console.error(`Video decoder error (${quality}):`, e);
        self.postMessage({
            type: 'error',
            message: `${quality} decoder: ${e.message}`,
        } as ErrorMessage);
    },
});

const handleAudioOutput = (audioData: AudioData) => {
    const channelData: Float32Array[] = [];
    for (let i = 0; i < audioData.numberOfChannels; i++) {
        const channel = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(channel, { planeIndex: i });
        channelData.push(channel);
    }

    if (workletPort) {
        workletPort.postMessage(
            {
                type: "audioData",
                channelData: channelData,
                timestamp: audioData.timestamp,
                sampleRate: audioData.sampleRate,
                numberOfFrames: audioData.numberOfFrames,
                numberOfChannels: audioData.numberOfChannels,
            } as AudioDataMessage,
            channelData.map((c) => c.buffer),
        );
    }

    audioData.close();
};

// Opus audio decoder configuration (compatible with OpusDecoderInit)
const opusAudioInit = {
    output: handleAudioOutput,
    error: (e: string | Error) => {
        const message = typeof e === 'string' ? e : e.message;
        console.error("Opus decoder error:", message);
        self.postMessage({
            type: "error",
            message: message,
        } as ErrorMessage);
    },
};

// Message handler
self.onmessage = async function (e: MessageEvent<WorkerMessage>) {
    const { type, port, quality, readable, writable, channelName } = e.data as any;

    switch (type) {
        case 'init':
            await initializeDecoders();
            if (port instanceof MessagePort) workletPort = port;
            break;

        case 'attachStream':
            if (readable && writable && channelName) {
                console.warn(`[Publisher worker]: Attaching stream for ${channelName}`);
                attachWebTransportStream(channelName, readable, writable);
            }
            break;

        case 'toggleAudio':
            audioEnabled = !audioEnabled;
            self.postMessage({ type: 'audio-toggled', audioEnabled } as AudioToggledMessage);
            break;

        case 'switchBitrate':
            handleBitrateSwitch(quality);
            break;

        case 'reset':
            resetDecoders();
            break;

        case 'stop':
            stopAll();
            break;
    }
};

/**
 * Initialize decoders
 */
async function initializeDecoders(): Promise<void> {
    console.log('Initializing decoders...');
    videoDecoder360p = new VideoDecoder(createVideoInit('360p'));
    videoDecoder720p = new VideoDecoder(createVideoInit('720p'));
    currentVideoDecoder = videoDecoder360p;

    try {
        audioDecoder = new OpusAudioDecoder(opusAudioInit);
    } catch (error) {
        console.error('Failed to initialize OpusAudioDecoder:', error);
    }

    curVideoInterval = { speed: 0, rate: 1000 / 30 };
    curAudioInterval = { speed: 0, rate: 1000 / (48000 / 1024) };
}

/**
 * Attach WebTransport stream for a channel
 */
async function attachWebTransportStream(
    channelName: string,
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>
): Promise<void> {
    const reader = readable.getReader();
    const writer = writable.getWriter();

    channelStreams.set(channelName, { reader, writer });
    console.log(`Attached WebTransport stream for ${channelName}`);

    const initText = `subscribe:${channelName}`;
    console.log(`Sending init message for ${channelName}:`, initText);

    const initData = new TextEncoder().encode(initText);
    const len = initData.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(initData, 4);

    await writer.write(out);

    if (channelName.startsWith('cam_')) {
        readVideoStream(channelName, reader);
    } else if (channelName.startsWith('mic_')) {
        readAudioStream(reader);
    }
}

/**
 * Read video stream from WebTransport
 */
async function readVideoStream(
    channelName: string,
    reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
    console.warn(`Starting to read video stream: ${channelName}`);
    const quality: '360p' | '720p' = channelName.includes('360p') ? '360p' : '720p';

    const delimitedReader = new LengthDelimitedReader(reader);
    const textDecoder = new TextDecoder();

    try {
        while (true) {
            const message = await delimitedReader.readMessage();
            if (message === null) {
                console.log('Stream closed');
                break;
            }

            try {
                const text = textDecoder.decode(message);
                if (text.startsWith('{')) {
                    console.log('Received Video text message', text);
                    let dataJson: StreamConfig;
                    try {
                        dataJson = JSON.parse(text);
                    } catch (error) {
                        console.error('error while parse config', error);
                        continue;
                    }
                    console.log('Received video config', dataJson);
                    if (dataJson.type === 'StreamConfig') {
                        const cfg = dataJson.config;
                        const desc = base64ToUint8Array(cfg.description);
                        const videoConfig: VideoConfig = {
                            codec: cfg.codec,
                            codedWidth: cfg.codedWidth!,
                            codedHeight: cfg.codedHeight!,
                            frameRate: cfg.frameRate!,
                            description: desc,
                        };

                        if (quality === '360p') video360pConfig = videoConfig;
                        else video720pConfig = videoConfig;

                        configureVideoDecoders(quality);
                        continue;
                    }
                }
            } catch (e) {
                // Not a text message, continue to binary handling
            }

            handleVideoBinaryPacket(message.buffer);
        }
    } catch (error) {
        console.error('Stream error:', error);
    }
}

/**
 * Handle video binary packet
 */
function handleVideoBinaryPacket(dataBuffer: ArrayBufferLike): void {
    // Support ArrayBuffer and SharedArrayBuffer (ArrayBufferLike).
    const view = new Uint8Array(dataBuffer as ArrayBufferLike);
    const dataView = new DataView(view.buffer, view.byteOffset, view.byteLength);
    const timestamp = dataView.getUint32(0, false);
    const frameType = dataView.getUint8(4);
    // slice returns a new Uint8Array (backed by a normal ArrayBuffer)
    const data = view.slice(5);

    if (frameType !== 0 && frameType !== 1 && frameType !== 2 && frameType !== 3) {
        console.warn('Unknown video frame type:', frameType);
        console.warn('Data buffer:', dataBuffer);
        return;
    }

    if (frameType === 0 || frameType === 1) {
        // Video 360p
        const type: 'key' | 'delta' = frameType === 0 ? 'key' : 'delta';

        if (type === 'key') {
            keyFrameReceived = true;
        }

        if (keyFrameReceived && videoDecoder360p && video360pConfig) {
            if (videoDecoder360p.state === 'closed') {
                videoDecoder360p = new VideoDecoder(createVideoInit('360p'));
                videoDecoder360p.configure(video360pConfig);
            }
            const encodedChunk = new EncodedVideoChunk({
                timestamp: timestamp * 1000,
                type,
                data: data,
            });

            videoDecoder360p.decode(encodedChunk);
        }
        return;
    } else if (frameType === 2 || frameType === 3) {
        // Video 720p
        const type: 'key' | 'delta' = frameType === 2 ? 'key' : 'delta';

        if (type === 'key') {
            keyFrameReceived = true;
        }

        if (keyFrameReceived && videoDecoder720p && video720pConfig) {
            if (videoDecoder720p.state === 'closed') {
                videoDecoder720p = new VideoDecoder(createVideoInit('720p'));
                videoDecoder720p.configure(video720pConfig);
            }
            const encodedChunk = new EncodedVideoChunk({
                timestamp: timestamp * 1000,
                type,
                data: data,
            });

            videoDecoder720p.decode(encodedChunk);
        }
        return;
    }
}

/**
 * Read audio stream from WebTransport
 */
async function readAudioStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    console.warn(`Starting to read audio stream`);
    const delimitedReader = new LengthDelimitedReader(reader);
    const textDecoder = new TextDecoder();

    try {
        while (true) {
            const message = await delimitedReader.readMessage();
            if (message === null) {
                console.log('Stream closed');
                break;
            }

            try {
                const text = textDecoder.decode(message);

                if (text.startsWith('{')) {
                    console.log('receiver message in audio channel ', text);
                    try {
                        let dataJson: StreamConfig;
                        try {
                            dataJson = JSON.parse(text);
                        } catch (error) {
                            console.error('error while parse config', error);
                            continue;
                        }
                        console.log('received audio config', dataJson);
                        if (dataJson.type === 'StreamConfig') {
                            const cfg = dataJson.config;
                            const desc = base64ToUint8Array(cfg.description);

                            audioConfig = {
                                codec: cfg.codec,
                                sampleRate: cfg.sampleRate!,
                                numberOfChannels: cfg.numberOfChannels!,
                                description: desc,
                            };

                            if (audioDecoder) {
                                audioDecoder.configure(audioConfig);
                                try {
                                    const dataView = new DataView(desc.buffer);
                                    const timestamp = dataView.getUint32(0, false);
                                    const data = desc.slice(5);

                                    const chunk = new EncodedAudioChunk({
                                        timestamp: timestamp * 1000,
                                        type: 'key',
                                        data,
                                    });
                                    audioDecoder.decode(chunk);
                                } catch (error) {
                                    console.log('Error decoding first audio frame:', error);
                                }
                            }

                            continue;
                        }
                    } catch {
                        console.warn('Non-JSON text message');
                    }
                }
            } catch (e) {
                // Not a text message, continue to binary handling
            }

            if (audioEnabled) {
                handleAudioBinaryPacket(message.buffer);
            }
        }
    } catch (error) {
        console.error('Stream error:', error);
    }
}

/**
 * Handle audio binary packet
 */
function handleAudioBinaryPacket(dataBuffer: ArrayBufferLike): void {
    // Support ArrayBuffer and SharedArrayBuffer (ArrayBufferLike).
    const view = new Uint8Array(dataBuffer as ArrayBufferLike);
    const dataView = new DataView(view.buffer, view.byteOffset, view.byteLength);
    const timestamp = dataView.getUint32(0, false);
    const data = view.slice(5);

    const chunk = new EncodedAudioChunk({
        timestamp: timestamp * 1000,
        type: 'key',
        data,
    });

    try {
        if (audioDecoder) {
            audioDecoder.decode(chunk);
        }
    } catch (err) {
        console.error('Audio decode error:', err);
    }
}

/**
 * Configure video decoders
 */
function configureVideoDecoders(quality: '360p' | '720p'): void {
    const config = quality === '360p' ? video360pConfig : video720pConfig;
    if (!config) return;

    try {
        const decoder = quality === '360p' ? videoDecoder360p : videoDecoder720p;
        if (decoder && decoder.state === 'unconfigured') {
            decoder.configure(config);
            videoFrameRate = config.frameRate;
        }

        videoCodecReceived = true;
        self.postMessage({
            type: 'codecReceived',
            stream: 'video',
            video360pConfig,
            video720pConfig,
        } as CodecReceivedMessage);
    } catch (error) {
        console.error('Failed to configure video decoder:', error);
    }
}

/**
 * Handle bitrate switching between 360p and 720p
 */
async function handleBitrateSwitch(quality: '360p' | '720p'): Promise<void> {
    if (quality === currentQuality) {
        console.log(`[Bitrate] Already at ${quality}, no switch needed.`);
        return;
    }

    const currentStream = channelStreams.get(`cam_${currentQuality}`);
    const targetStream = channelStreams.get(`cam_${quality}`);

    if (!targetStream) {
        console.warn(`[Bitrate] Target stream cam_${quality} not attached.`);
        return;
    }

    try {
        const encoder = new TextEncoder();

        if (currentStream && currentStream.writer) {
            console.log(`[Bitrate] Sending "pause" to cam_${currentQuality}`);
            await currentStream.writer.write(encoder.encode('pause'));
        }

        if (targetStream && targetStream.writer) {
            console.log(`[Bitrate] Sending "resume" to cam_${quality}`);
            await targetStream.writer.write(encoder.encode('resume'));
        }

        currentQuality = quality;
        currentVideoDecoder = quality === '360p' ? videoDecoder360p : videoDecoder720p;
        keyFrameReceived = false;

        self.postMessage({
            type: 'bitrateChanged',
            quality,
        } as BitrateChangedMessage);

        console.log(`[Bitrate] Switched to ${quality}`);
    } catch (err) {
        const error = err as Error;
        console.error(`[Bitrate] Failed to switch to ${quality}:`, err);
        self.postMessage({
            type: 'error',
            message: `Failed to switch bitrate: ${error.message}`,
        } as ErrorMessage);
    }
}

/**
 * Reset decoders
 */
function resetDecoders(): void {
    if (videoDecoder360p) videoDecoder360p.reset();
    if (videoDecoder720p) videoDecoder720p.reset();
    if (audioDecoder) audioDecoder.reset();

    videoCodecReceived = false;
    audioCodecReceived = false;
    keyFrameReceived = false;

    if (videoIntervalID !== null) clearInterval(videoIntervalID);
    if (audioIntervalID !== null) clearInterval(audioIntervalID);

    self.postMessage({
        type: 'log',
        event: 'reset',
        message: 'Reset all decoders',
    } as LogMessage);
}

/**
 * Stop all operations
 */
function stopAll(): void {
    if (workletPort) {
        workletPort.postMessage({ type: 'stop' });
        workletPort = null;
    }

    for (const { reader, writer } of channelStreams.values()) {
        try {
            reader.cancel();
            writer.close();
        } catch {
            // Ignore errors
        }
    }

    channelStreams.clear();

    if (videoDecoder360p) {
        try {
            videoDecoder360p.close();
        } catch {
            // Ignore errors
        }
    }
    if (videoDecoder720p) {
        try {
            videoDecoder720p.close();
        } catch {
            // Ignore errors
        }
    }
    if (audioDecoder) {
        try {
            audioDecoder.close();
        } catch {
            // Ignore errors
        }
    }

    if (videoIntervalID !== null) clearInterval(videoIntervalID);
    if (audioIntervalID !== null) clearInterval(audioIntervalID);

    self.postMessage({
        type: 'log',
        event: 'stop',
        message: 'Stopped all media operations',
    } as LogMessage);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Length-delimited message reader for WebTransport streams
 */
class LengthDelimitedReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer: Uint8Array;

    constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
        this.reader = reader;
        this.buffer = new Uint8Array(0);
    }

    private appendBuffer(newData: Uint8Array): void {
        const combined = new Uint8Array(this.buffer.length + newData.length);
        combined.set(this.buffer);
        combined.set(newData, this.buffer.length);
        this.buffer = combined;
    }

    async readMessage(): Promise<Uint8Array | null> {
        while (true) {
            if (this.buffer.length >= 4) {
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4);
                const messageLength = view.getUint32(0, false);

                const totalLength = 4 + messageLength;
                if (this.buffer.length >= totalLength) {
                    const message = this.buffer.slice(4, totalLength);
                    this.buffer = this.buffer.slice(totalLength);
                    return message;
                }
            }

            const { value, done } = await this.reader.read();
            if (done) {
                if (this.buffer.length > 0) {
                    throw new Error('Stream ended with incomplete message');
                }
                return null;
            }

            this.appendBuffer(value);
        }
    }
}
