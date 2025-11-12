/**
 * Type declarations for opusDecoder.js
 * Provides TypeScript types for Opus audio encoding and decoding functionality
 */

/**
 * Ensures the Recorder.js script is loaded
 * @returns Promise that resolves when the Recorder.js script is loaded
 */
export function ensureRecorderScriptLoaded(): Promise<void>;

/**
 * Options for initializing an audio recorder
 */
export interface AudioRecorderOptions {
    /** Monitor gain level (0-1) */
    monitorGain?: number;
    /** Recording gain level (0-1) */
    recordingGain?: number;
    /** Number of audio channels (1 for mono, 2 for stereo) */
    numberOfChannels?: number;
    /** Encoder sample rate in Hz */
    encoderSampleRate?: number;
    /** Encoder bit rate in bits per second */
    encoderBitRate?: number;
    /** Encoder application mode (2048=Voice, 2049=Audio, 2051=Low Delay) */
    encoderApplication?: number;
    /** Encoder complexity (0-10) */
    encoderComplexity?: number;
    /** Encoder frame size in milliseconds */
    encoderFrameSize?: number;
    /** Time slice for data chunks in milliseconds */
    timeSlice?: number;
    /** Whether to stream pages */
    streamPages?: boolean;
    /** Maximum frames per page */
    maxFramesPerPage?: number;
}

/**
 * Recorder instance returned by initAudioRecorder
 */
export interface Recorder {
    /** Callback fired when recording starts */
    onstart: (() => void) | null;
    /** Callback fired when recording stops */
    onstop: (() => void) | null;
    /** Callback fired when recording is paused */
    onpause: (() => void) | null;
    /** Callback fired when recording is resumed */
    onresume: (() => void) | null;
    /** Start recording */
    start(): void;
    /** Stop recording */
    stop(): void;
    /** Pause recording */
    pause(): void;
    /** Resume recording */
    resume(): void;
}

/**
 * Initialize an audio recorder with the given audio stream
 * @param audioStream - MediaStream to record from
 * @param options - Optional configuration options
 * @returns Promise that resolves to a Recorder instance
 */
export function initAudioRecorder(
    audioStream: MediaStream,
    options?: AudioRecorderOptions
): Promise<Recorder>;

/**
 * Configuration options for OpusAudioDecoder
 */
export interface OpusDecoderConfig {
    /** Sample rate for output audio */
    sampleRate?: number;
    /** Number of audio channels */
    numberOfChannels?: number;
}

/**
 * Initialization options for OpusAudioDecoder
 */
export interface OpusDecoderInit {
    /** Callback function to receive decoded audio data */
    output: (audioData: AudioData) => void;
    /** Error callback function */
    error?: (error: string | Error) => void;
}

/**
 * Audio chunk to be decoded
 */
export interface OpusAudioChunk {
    /** Opus encoded audio data */
    data?: ArrayBuffer;
    /** Timestamp in microseconds */
    timestamp: number;
    /** Duration in microseconds */
    duration?: number | null;
    /** Size of the encoded data in bytes */
    byteLength: number;
    /** Copy data to a target array */
    copyTo(destination: Uint8Array): void;
}/**
 * Opus Audio Decoder class
 * Decodes Opus-encoded audio data to PCM audio using a Web Worker
 */
export class OpusAudioDecoder {
    /** Current state of the decoder */
    state: "unconfigured" | "configured" | "closed";
    /** Output callback for decoded audio data */
    output: (audioData: AudioData) => void;
    /** Error callback */
    error: (error: string | Error) => void;
    /** Sample rate for output audio */
    sampleRate: number;
    /** Number of audio channels */
    numberOfChannels: number;

    /**
     * Create a new OpusAudioDecoder instance
     * @param init - Initialization options with output and error callbacks
     */
    constructor(init: OpusDecoderInit);

    /**
     * Configure the decoder with specified parameters
     * @param config - Configuration options
     * @returns Promise that resolves to true if successfully configured
     */
    configure(config?: OpusDecoderConfig): Promise<boolean>;

    /**
     * Decode an Opus audio chunk
     * @param chunk - Audio chunk to decode with data, timestamp, and duration
     */
    decode(chunk: OpusAudioChunk): void;

    /**
     * Flush any buffered audio data
     * @returns Promise that resolves when flush is complete
     */
    flush(): Promise<void>;

    /**
     * Reset the decoder state
     * @returns Promise that resolves when reset is complete
     */
    reset(): Promise<void>;

    /**
     * Close the decoder and release resources
     * @returns Promise that resolves when close is complete
     */
    close(): Promise<void>;
}
