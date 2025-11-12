/**
 * Media Worker - WebSocket-based video and audio decoder worker
 * Handles media stream decoding using WebCodecs API
 */

import { OpusAudioDecoder } from "../opus_decoder/opusDecoder.js";
import "../polyfills/audioData.js";
import "../polyfills/encodedAudioChunk.js";

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

interface InitMessage {
    type: "init";
    data: {
        mediaUrl: string;
    };
    port?: MessagePort;
}

interface ToggleAudioMessage {
    type: "toggle-audio";
}

interface ResetMessage {
    type: "reset";
}

interface StopMessage {
    type: "stop";
}

type WorkerMessage =
    | InitMessage
    | ToggleAudioMessage
    | ResetMessage
    | StopMessage;

interface VideoDataMessage {
    type: "videoData";
    frame: VideoFrame;
}

interface AudioDataMessage {
    type: "audioData";
    channelData: Float32Array[];
    timestamp: number;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
}

interface LogMessage {
    type: "log";
    level: "info" | "error" | "warn";
    event: string;
    message: string;
}

interface CodecReceivedMessage {
    type: "codecReceived";
    stream: "video" | "audio" | "both";
    videoConfig?: VideoConfig;
    audioConfig?: AudioConfig;
}

interface AudioToggledMessage {
    type: "audio-toggled";
    audioEnabled: boolean;
}

interface ConnectionClosedMessage {
    type: "connectionClosed";
    stream: string;
    message: string;
}

interface ErrorMessage {
    type: "error";
    message: string;
}

interface StatusMessage {
    type: "status";
    message: string;
}

interface TotalViewerCountMessage {
    type: "TotalViewerCount";
    count: number;
}

// Worker state variables
let videoDecoder: VideoDecoder | null = null;
let audioDecoder: OpusAudioDecoder | null = null;
let mediaWebsocket: WebSocket | null = null;
let videoConfig: VideoConfig | null = null;
let videoFrameRate = 30;
let audioFrameRate = 46.875; // 48000 / 1024
let audioConfig: AudioConfig | null = null;
let videoFrameBuffer: EncodedVideoChunk[] = [];
let audioFrameBuffer: EncodedAudioChunk[] = [];
let curVideoInterval: { speed: number; rate: number } | null = null;
let curAudioInterval: { speed: number; rate: number } | null = null;
let videoIntervalID: number | null = null;
let audioIntervalID: number | null = null;
let workletPort: MessagePort | null = null;

let audioEnabled = true;
let mediaUrl: string | null = null;

let videoCodecReceived = false;
let audioCodecReceived = false;
let keyFrameReceived = false;

// Video decoder configuration
const videoInit: VideoDecoderInit = {
    output: (frame: VideoFrame) => {
        self.postMessage(
            {
                type: "videoData",
                frame: frame,
            } as VideoDataMessage,
            [frame as any],
        );
    },
    error: (e: Error) => {
        console.error("Video decoder error:", e);
        self.postMessage({
            type: "error",
            message: e.message,
        } as ErrorMessage);
    },
};

// Audio output handler (shared between decoders)
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
    const { type, data, port } = e.data as any;

    switch (type) {
        case "init":
            mediaUrl = data.mediaUrl;
            console.log("Media Worker: Initializing with stream url:", mediaUrl);
            await initializeDecoders();
            setupWebSocket();
            if (port && port instanceof MessagePort) {
                console.log("Media Worker: Received port to connect to Audio Worklet.");
                workletPort = port;
            }
            break;

        case "toggle-audio":
            audioEnabled = !audioEnabled;
            console.log(
                "Media Worker: Toggling audio. Now audioEnabled =",
                audioEnabled,
            );
            self.postMessage({
                type: "audio-toggled",
                audioEnabled,
            } as AudioToggledMessage);
            break;

        case "reset":
            console.log("Media Worker: Resetting decoders and buffers.");
            resetWebsocket();
            break;

        case "stop":
            console.log("Media Worker: Stopping all operations.");
            stop();
            break;
    }
};

/**
 * Initialize video and audio decoders
 */
async function initializeDecoders(): Promise<void> {
    self.postMessage({
        type: "log",
        level: "info",
        event: "init-decoders",
        message: "Initializing decoders",
    } as LogMessage);

    videoDecoder = new VideoDecoder(videoInit);

    try {
        audioDecoder = new OpusAudioDecoder(opusAudioInit);
        self.postMessage({
            type: "log",
            level: "info",
            event: "opus-decoder-init",
            message: "OpusAudioDecoder initialized successfully",
        } as LogMessage);
    } catch (error) {
        const err = error as Error;
        self.postMessage({
            type: "log",
            level: "error",
            event: "opus-decoder-init-fail",
            message: "Failed to initialize OpusAudioDecoder: " + err.message,
        } as LogMessage);
        console.error("Failed to initialize OpusAudioDecoder:", error);
    }
}

/**
 * Setup WebSocket connection
 */
function setupWebSocket(): void {
    if (!mediaUrl) return;

    mediaWebsocket = new WebSocket(mediaUrl);
    mediaWebsocket.binaryType = "arraybuffer";

    mediaWebsocket.onopen = () => {
        self.postMessage({
            type: "log",
            level: "info",
            event: "ws-connected",
            message: "media websocket Connected",
        } as LogMessage);
    };

    mediaWebsocket.onmessage = handleMediaWsMessage;
    mediaWebsocket.onclose = handleMediaWsClose;
}

/**
 * Handle WebSocket messages
 */
function handleMediaWsMessage(event: MessageEvent): void {
    if (typeof event.data === "string") {
        const dataJson = JSON.parse(event.data);

        if (dataJson.type === "TotalViewerCount") {
            console.log(
                "[Media worker]: TotalViewerCount received from websocket:",
                dataJson.total_viewers,
            );
            self.postMessage({
                type: "TotalViewerCount",
                count: dataJson.total_viewers,
            } as TotalViewerCountMessage);
            return;
        }

        if (
            dataJson.type === "DecoderConfigs" &&
            (!videoCodecReceived || !audioCodecReceived)
        ) {
            videoConfig = dataJson.videoConfig;
            audioConfig = dataJson.audioConfig;
            videoFrameRate = videoConfig!.frameRate;
            audioFrameRate = audioConfig!.sampleRate / 1024;

            videoConfig!.description = base64ToUint8Array(
                dataJson.videoConfig.description,
            );
            const audioConfigDescription = base64ToUint8Array(
                dataJson.audioConfig.description,
            );

            if (videoDecoder && videoConfig) {
                videoDecoder.configure(videoConfig);
            }

            if (audioDecoder && audioConfig) {
                audioConfig.description = audioConfigDescription;
                audioDecoder.configure(audioConfig);

                // Decode first audio frame to trigger audio decoder
                try {
                    const dataView = new DataView(audioConfigDescription.buffer);
                    const timestamp = dataView.getUint32(0, false);
                    const data = audioConfigDescription.slice(5);

                    const chunk = new EncodedAudioChunk({
                        timestamp: timestamp * 1000,
                        type: "key",
                        data,
                    });
                    audioDecoder.decode(chunk);
                    console.log("Decoded first audio frame to initialize decoder.");
                } catch (error) {
                    console.log("Error decoding first audio frame:", error);
                }
            }

            videoCodecReceived = true;
            audioCodecReceived = true;

            self.postMessage({
                type: "codecReceived",
                stream: "both",
                videoConfig,
                audioConfig,
            } as CodecReceivedMessage);
            return;
        }

        if (event.data === "publish") {
            if (videoDecoder) videoDecoder.reset();
            if (audioDecoder) audioDecoder.reset();
            videoCodecReceived = false;
            audioCodecReceived = false;
            return;
        }

        if (event.data === "ping") {
            return;
        }
    }

    // Handle binary data (video/audio frames)
    if (event.data instanceof ArrayBuffer) {
        const dataView = new DataView(event.data);
        const timestamp = dataView.getUint32(0, false);
        const frameType = dataView.getUint8(4);
        const data = event.data.slice(5);

        let type: "key" | "delta" | "audio" | "config" | "unknown";

        if (frameType === 0) type = "key";
        else if (frameType === 1) type = "delta";
        else if (frameType === 2) type = "audio";
        else if (frameType === 3) type = "config";
        else type = "unknown";

        if (type === "audio") {
            if (!audioEnabled) return;

            if (audioDecoder && audioDecoder.state === "closed" && audioConfig) {
                audioDecoder = new OpusAudioDecoder(opusAudioInit);
                audioDecoder.configure(audioConfig);
            }

            const chunk = new EncodedAudioChunk({
                timestamp: timestamp * 1000,
                type: "key",
                data,
            });

            if (audioDecoder) {
                audioDecoder.decode(chunk);
            }
            return;
        } else if (type === "key" || type === "delta") {
            if (type === "key") {
                keyFrameReceived = true;
            }

            if (keyFrameReceived) {
                if (videoDecoder && videoDecoder.state === "closed" && videoConfig) {
                    videoDecoder = new VideoDecoder(videoInit);
                    videoDecoder.configure(videoConfig);
                }

                const encodedChunk = new EncodedVideoChunk({
                    timestamp: timestamp * 1000,
                    type,
                    data,
                });

                if (videoDecoder) {
                    videoDecoder.decode(encodedChunk);
                }
            }
            return;
        } else if (type === "config") {
            console.warn("[Media worker]: Received config data (unexpected):", data);
            return;
        }
    }
}

/**
 * Handle WebSocket close event
 */
function handleMediaWsClose(): void {
    console.warn("Media WebSocket closed");
    self.postMessage({
        type: "connectionClosed",
        stream: "media",
        message: "Media WebSocket closed",
    } as ConnectionClosedMessage);
}

/**
 * Reset WebSocket and decoders
 */
function resetWebsocket(): void {
    // Close existing WebSocket
    if (mediaWebsocket && mediaWebsocket.readyState !== WebSocket.CLOSED) {
        try {
            mediaWebsocket.close();
        } catch (e) {
            // Ignore errors
        }
        mediaWebsocket = null;
    }

    // Reset decoders
    if (videoDecoder) {
        videoDecoder.reset();
    }
    if (audioDecoder) {
        audioDecoder.reset();
    }

    videoCodecReceived = false;
    audioCodecReceived = false;
    keyFrameReceived = false;
    videoFrameBuffer = [];
    audioFrameBuffer = [];

    if (videoIntervalID !== null) {
        clearInterval(videoIntervalID);
    }
    if (audioIntervalID !== null) {
        clearInterval(audioIntervalID);
    }

    setupWebSocket();

    self.postMessage({
        type: "log",
        level: "info",
        event: "reset",
        message: "Resetting decoders and buffers",
    } as LogMessage);
}

/**
 * Stop all operations
 */
function stop(): void {
    if (workletPort) {
        workletPort.postMessage({ type: "stop" });
        workletPort = null;
    }

    if (mediaWebsocket) {
        try {
            mediaWebsocket.close();
        } catch (e) {
            // Ignore errors
        }
        mediaWebsocket = null;
    }

    if (videoDecoder) {
        try {
            videoDecoder.close();
        } catch (e) {
            // Ignore errors
        }
        videoDecoder = null;
    }

    if (audioDecoder) {
        try {
            audioDecoder.close();
        } catch (e) {
            // Ignore errors
        }
        audioDecoder = null;
    }

    videoFrameBuffer = [];
    audioFrameBuffer = [];

    if (videoIntervalID !== null) {
        clearInterval(videoIntervalID);
    }
    if (audioIntervalID !== null) {
        clearInterval(audioIntervalID);
    }

    videoCodecReceived = false;
    audioCodecReceived = false;
    keyFrameReceived = false;

    self.postMessage({
        type: "log",
        level: "info",
        event: "stop",
        message: "Stopped all media operations",
    } as LogMessage);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}
