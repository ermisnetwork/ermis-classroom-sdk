/// <reference lib="webworker" />

/**
 * Media Worker with ArrayBuffer support - WebSocket-based video and audio decoder worker
 * Handles media stream decoding with multi-quality support (360p/720p/screen share)
 */

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

interface InitMessage {
    type: 'init';
    data: {
        mediaUrl: string;
    };
    port?: MessagePort;
    quality?: '360p' | '720p';
    isShare?: boolean;
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
    | ToggleAudioMessage
    | SwitchBitrateMessage
    | ResetMessage
    | StopMessage;

interface VideoDataMessage {
    type: 'videoData';
    frame: VideoFrame;
    quality: '360p' | '720p' | 'screen';
}

interface AudioDataMessage {
    type: 'audioData';
    channelData: Float32Array[];
    timestamp: number;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
}

interface LogMessage {
    type: 'log';
    level: 'info' | 'error' | 'warn';
    event: string;
    message: string;
}

interface CodecReceivedMessage {
    type: 'codecReceived';
    stream: 'video' | 'audio' | 'both' | 'screen';
    video360pConfig?: VideoConfig;
    video720pConfig?: VideoConfig;
    screenShareConfig?: VideoConfig;
    audioConfig?: AudioConfig;
}

interface AudioToggledMessage {
    type: 'audio-toggled';
    audioEnabled: boolean;
}

interface BitrateChangedMessage {
    type: 'bitrateChanged';
    quality: '360p' | '720p';
}

interface ConnectionClosedMessage {
    type: 'connectionClosed';
    stream: string;
    message: string;
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

interface StatusMessage {
    type: 'status';
    message: string;
}

interface TotalViewerCountMessage {
    type: 'TotalViewerCount';
    count: number;
}

// Worker state variables
let videoDecoderFor360p: VideoDecoder | null = null;
let videoDecoderFor720p: VideoDecoder | null = null;
let videoDecoderForScreenShare: VideoDecoder | null = null;
let currentVideoDecoder: VideoDecoder | null = null;
let currentQuality: '360p' | '720p' | 'screen' = '360p';
let audioDecoder: OpusAudioDecoder | null = null;
let mediaWebsocket: WebSocket | null = null;
let video360pConfig: VideoConfig | null = null;
let video720pConfig: VideoConfig | null = null;
let screenShareConfig: VideoConfig | null = null;
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

let isScreenSharing = false;

// Video decoder factory
const createVideoInit = (quality: '360p' | '720p' | 'screen'): VideoDecoderInit => ({
    output: (frame: VideoFrame) => {
        self.postMessage(
            {
                type: 'videoData',
                frame: frame,
                quality: quality,
            } as VideoDataMessage,
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
    const { type, data, port, quality, isShare } = e.data as any;

    switch (type) {
        case 'init':
            mediaUrl = data.mediaUrl;
            console.log('Media Worker: Initializing with stream url:', mediaUrl);
            isScreenSharing = isShare || false;
            await initializeDecoders(isScreenSharing);
            setupWebSocket(quality);
            if (port && port instanceof MessagePort) {
                console.log('Media Worker: Received port to connect to Audio Worklet.');
                workletPort = port;
            }
            break;

        case 'toggleAudio':
            audioEnabled = !audioEnabled;
            console.log('Media Worker: Toggling audio. Now audioEnabled =', audioEnabled);
            self.postMessage({
                type: 'audio-toggled',
                audioEnabled,
            } as AudioToggledMessage);
            break;

        case 'switchBitrate':
            handleBitrateSwitch(quality);
            break;

        case 'reset':
            console.log('Media Worker: Resetting decoders and buffers.');
            resetWebsocket();
            break;

        case 'stop':
            console.log('Media Worker: Stopping all operations.');
            stop();
            break;
    }
};

/**
 * Initialize video and audio decoders
 */
async function initializeDecoders(isScreenSharing = false): Promise<void> {
    self.postMessage({
        type: 'log',
        level: 'info',
        event: 'init-decoders',
        message: 'Initializing decoders',
    } as LogMessage);

    // Initialize video decoders
    if (isScreenSharing) {
        videoDecoderForScreenShare = new VideoDecoder(createVideoInit('screen'));
        currentVideoDecoder = videoDecoderForScreenShare;
    } else {
        videoDecoderFor360p = new VideoDecoder(createVideoInit('360p'));
        videoDecoderFor720p = new VideoDecoder(createVideoInit('720p'));
        currentVideoDecoder = videoDecoderFor360p;
    }

    try {
        audioDecoder = new OpusAudioDecoder(opusAudioInit);
        self.postMessage({
            type: 'log',
            level: 'info',
            event: 'opus-decoder-init',
            message: 'OpusAudioDecoder initialized successfully',
        } as LogMessage);
    } catch (error) {
        const err = error as Error;
        self.postMessage({
            type: 'log',
            level: 'error',
            event: 'opus-decoder-init-fail',
            message: 'Failed to initialize OpusAudioDecoder: ' + err.message,
        } as LogMessage);
        console.error('Failed to initialize OpusAudioDecoder:', error);
    }
}

/**
 * Setup WebSocket connection
 */
function setupWebSocket(initialQuality: '360p' | '720p' = '360p'): void {
    if (!mediaUrl) return;

    mediaWebsocket = new WebSocket(mediaUrl);
    mediaWebsocket.binaryType = 'arraybuffer';

    mediaWebsocket.onopen = () => {
        if (!isScreenSharing && mediaWebsocket) {
            mediaWebsocket.send(JSON.stringify({ quality: initialQuality }));
        }
        self.postMessage({
            type: 'log',
            level: 'info',
            event: 'ws-connected',
            message: 'media websocket Connected',
        } as LogMessage);
    };

    mediaWebsocket.onmessage = handleMediaWsMessage;
    mediaWebsocket.onclose = handleMediaWsClose;
}

/**
 * Handle bitrate switching
 */
function handleBitrateSwitch(quality: '360p' | '720p'): void {
    if (mediaWebsocket && mediaWebsocket.readyState === WebSocket.OPEN) {
        const message = { quality };
        console.log(`Switching bitrate to ${quality}, message:`, message);
        mediaWebsocket.send(JSON.stringify(message));

        // Switch decoder
        if (quality === '360p') {
            currentVideoDecoder = videoDecoderFor360p;
            currentQuality = '360p';
        } else if (quality === '720p') {
            currentVideoDecoder = videoDecoderFor720p;
            currentQuality = '720p';
        }

        // Reset keyframe flag to wait for new keyframe
        keyFrameReceived = false;

        self.postMessage({
            type: 'log',
            level: 'info',
            event: 'bitrate-switched',
            message: `Switched to ${quality}`,
        } as LogMessage);

        self.postMessage({
            type: 'bitrateChanged',
            quality: quality,
        } as BitrateChangedMessage);
    } else {
        console.error('WebSocket not ready for bitrate switch');
    }
}

/**
 * Handle WebSocket messages
 */
function handleMediaWsMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
        const dataJson = JSON.parse(event.data);

        if (dataJson.type === 'TotalViewerCount') {
            console.log(
                '[Media worker]: TotalViewerCount received from websocket:',
                dataJson.total_viewers
            );
            self.postMessage({
                type: 'TotalViewerCount',
                count: dataJson.total_viewers,
            } as TotalViewerCountMessage);
            return;
        }

        if (
            dataJson.type === 'DecoderConfigs' &&
            (!videoCodecReceived || !audioCodecReceived)
        ) {
            if (isScreenSharing) {
                screenShareConfig = dataJson.videoConfig;
                if (!screenShareConfig) {
                    console.error('Screen share config is missing');
                    return;
                }
                videoFrameRate = screenShareConfig.frameRate;
                screenShareConfig.description = ensureUint8Array(
                    screenShareConfig.description as any
                );
                if (videoDecoderForScreenShare) {
                    videoDecoderForScreenShare.configure(screenShareConfig);
                    currentVideoDecoder = videoDecoderForScreenShare;
                    currentQuality = 'screen';
                }
            } else {
                video360pConfig = dataJson.video360pConfig;
                video720pConfig = dataJson.video720pConfig;
                if (!video360pConfig || !video720pConfig) {
                    console.error('Video configs are missing');
                    return;
                }
                videoFrameRate = video360pConfig.frameRate;

                video360pConfig.description = ensureUint8Array(video360pConfig.description as any);
                video720pConfig.description = ensureUint8Array(video720pConfig.description as any);

                if (videoDecoderFor360p) {
                    videoDecoderFor360p.configure(video360pConfig);
                }
                if (videoDecoderFor720p) {
                    videoDecoderFor720p.configure(video720pConfig);
                }
            }

            audioConfig = dataJson.audioConfig;
            if (!audioConfig) {
                console.error('Audio config is missing');
                return;
            }
            audioFrameRate = audioConfig.sampleRate / 1024;
            const audioConfigDescription = ensureUint8Array(audioConfig.description as any);
            audioConfig.description = audioConfigDescription;

            if (audioDecoder) {
                audioDecoder.configure(audioConfig);

                // Decode first audio frame to initialize decoder
                try {
                    const dataView = new DataView(audioConfigDescription.buffer);
                    const timestamp = dataView.getUint32(0, false);
                    const data = audioConfigDescription.slice(5);

                    const chunk = new EncodedAudioChunk({
                        timestamp: timestamp * 1000,
                        type: 'key',
                        data,
                    });
                    audioDecoder.decode(chunk);
                    console.log('Decoded first audio frame to initialize decoder.');
                } catch (error) {
                    console.log('Error decoding first audio frame:', error);
                }
            }

            videoCodecReceived = true;
            audioCodecReceived = true;

            if (isScreenSharing) {
                self.postMessage({
                    type: 'codecReceived',
                    stream: 'screen',
                    screenShareConfig,
                    audioConfig,
                } as CodecReceivedMessage);
            } else {
                self.postMessage({
                    type: 'codecReceived',
                    stream: 'both',
                    video360pConfig,
                    video720pConfig,
                    audioConfig,
                } as CodecReceivedMessage);
            }
            return;
        }

        if (event.data === 'publish') {
            if (videoDecoderFor360p) videoDecoderFor360p.reset();
            if (videoDecoderFor720p) videoDecoderFor720p.reset();
            if (audioDecoder) audioDecoder.reset();
            videoCodecReceived = false;
            audioCodecReceived = false;
            keyFrameReceived = false;
            return;
        }

        if (event.data === 'ping') {
            return;
        }
    }

    // Handle binary data (video/audio frames)
    if (event.data instanceof ArrayBuffer) {
        const dataView = new DataView(event.data);
        const timestamp = dataView.getUint32(0, false);
        const frameType = dataView.getUint8(4);
        const data = event.data.slice(5);

        // Frame type mapping:
        // video-360p-key = 0
        // video-360p-delta = 1
        // video-720p-key = 2
        // video-720p-delta = 3
        // video-1080p-key = 4
        // video-1080p-delta = 5
        // audio = 6
        // config = 7
        // other = 8

        if (frameType === 6) {
            // Audio frame
            if (!audioEnabled) return;

            if (audioDecoder && audioDecoder.state === 'closed' && audioConfig) {
                audioDecoder = new OpusAudioDecoder(opusAudioInit);
                audioDecoder.configure(audioConfig);
            }

            const chunk = new EncodedAudioChunk({
                timestamp: timestamp * 1000,
                type: 'key',
                data,
            });

            if (audioDecoder) {
                audioDecoder.decode(chunk);
            }
            return;
        } else if (frameType === 0 || frameType === 1) {
            // Video 360p
            const type: 'key' | 'delta' = frameType === 0 ? 'key' : 'delta';

            if (type === 'key') {
                keyFrameReceived = true;
            }

            if (keyFrameReceived && videoDecoderFor360p && video360pConfig) {
                if (videoDecoderFor360p.state === 'closed') {
                    videoDecoderFor360p = new VideoDecoder(createVideoInit('360p'));
                    videoDecoderFor360p.configure(video360pConfig);
                }

                const encodedChunk = new EncodedVideoChunk({
                    timestamp: timestamp * 1000,
                    type,
                    data,
                });

                videoDecoderFor360p.decode(encodedChunk);
            }
            return;
        } else if (frameType === 2 || frameType === 3) {
            // Video 720p
            const type: 'key' | 'delta' = frameType === 2 ? 'key' : 'delta';

            if (type === 'key') {
                keyFrameReceived = true;
            }

            if (keyFrameReceived && videoDecoderFor720p && video720pConfig) {
                if (videoDecoderFor720p.state === 'closed') {
                    videoDecoderFor720p = new VideoDecoder(createVideoInit('720p'));
                    videoDecoderFor720p.configure(video720pConfig);
                }

                const encodedChunk = new EncodedVideoChunk({
                    timestamp: timestamp * 1000,
                    type,
                    data,
                });

                videoDecoderFor720p.decode(encodedChunk);
            }
            return;
        } else if (frameType === 4 || frameType === 5) {
            // Screen share
            const type: 'key' | 'delta' = frameType === 4 ? 'key' : 'delta';

            if (type === 'key') {
                keyFrameReceived = true;
            }

            if (keyFrameReceived && videoDecoderForScreenShare && screenShareConfig) {
                if (videoDecoderForScreenShare.state === 'closed') {
                    videoDecoderForScreenShare = new VideoDecoder(createVideoInit('screen'));
                    videoDecoderForScreenShare.configure(screenShareConfig);
                }

                const encodedChunk = new EncodedVideoChunk({
                    timestamp: timestamp * 1000,
                    type,
                    data,
                });

                videoDecoderForScreenShare.decode(encodedChunk);
            }
            return;
        } else if (frameType === 7) {
            // Config data
            console.warn('[Media worker]: Received config data (unexpected):', data);
            return;
        }
    }
}

/**
 * Handle WebSocket close event
 */
function handleMediaWsClose(): void {
    console.warn('Media WebSocket closed');
    self.postMessage({
        type: 'connectionClosed',
        stream: 'media',
        message: 'Media WebSocket closed',
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
    if (videoDecoderFor360p) {
        videoDecoderFor360p.reset();
    }
    if (videoDecoderFor720p) {
        videoDecoderFor720p.reset();
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
        type: 'log',
        level: 'info',
        event: 'reset',
        message: 'Resetting decoders and buffers',
    } as LogMessage);
}

/**
 * Stop all operations
 */
function stop(): void {
    if (workletPort) {
        workletPort.postMessage({ type: 'stop' });
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

    if (videoDecoderFor360p) {
        try {
            videoDecoderFor360p.close();
        } catch (e) {
            // Ignore errors
        }
        videoDecoderFor360p = null;
    }

    if (videoDecoderFor720p) {
        try {
            videoDecoderFor720p.close();
        } catch (e) {
            // Ignore errors
        }
        videoDecoderFor720p = null;
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
        type: 'log',
        level: 'info',
        event: 'stop',
        message: 'Stopped all media operations',
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

/**
 * Ensure value is Uint8Array, converting from base64 string if needed
 */
function ensureUint8Array(value: string | Uint8Array): Uint8Array {
    return typeof value === 'string' ? base64ToUint8Array(value) : value;
}
