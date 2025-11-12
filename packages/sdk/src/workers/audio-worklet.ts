/**
 * JitterResistantProcessor - Audio Worklet Processor for handling audio playback with jitter resistance
 * This processor buffers incoming audio data and manages playback to prevent audio glitches
 */

/// <reference path="./worklet.d.ts" />

export interface AudioBufferStatus {
    type: "bufferStatus";
    bufferMs: number;
    isPlaying: boolean;
    bufferSamples: number;
}

export interface PlaybackStartedMessage {
    type: "playbackStarted";
}

export interface UnderrunMessage {
    type: "underrun";
    newBufferSize: number;
}

export interface AudioDataMessage {
    type: "audioData";
    channelData: Float32Array[];
    timestamp: number;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
}

export interface ConnectWorkerMessage {
    type: "connectWorker";
    port: MessagePort;
}

export interface ResetMessage {
    type: "reset";
}

export interface SetBufferSizeMessage {
    type: "setBufferSize";
    data: number;
}

type IncomingMessage =
    | ConnectWorkerMessage
    | ResetMessage
    | SetBufferSizeMessage;
type WorkerMessage = AudioDataMessage;

class JitterResistantProcessor extends AudioWorkletProcessor {
    private audioBuffers: number[][] = [];
    private bufferSize = 2048;
    private minBuffer = 2048;
    private maxBuffer = 8192;
    private isPlaying = false;
    private fadeInSamples = 0;
    private sampleRate = 48000;
    private numberOfChannels = 2;
    private fadeInLength = 480;
    private adaptiveBufferSize: number;
    private workerPort: MessagePort | null = null;

    constructor() {
        super();

        this.adaptiveBufferSize = this.bufferSize;

        this.port.onmessage = (event: MessageEvent<IncomingMessage>) => {
            const { type } = event.data;

            if (type === "connectWorker") {
                const connectMessage = event.data as ConnectWorkerMessage;
                this.workerPort = connectMessage.port;

                if (this.workerPort) {
                    this.workerPort.onmessage = (
                        workerEvent: MessageEvent<WorkerMessage>,
                    ) => {
                        const {
                            type: workerType,
                            channelData: receivedChannelDataBuffers,
                            sampleRate: workerSampleRate,
                            numberOfChannels: workerChannels,
                        } = workerEvent.data;

                        if (workerType === "audioData") {
                            if (
                                this.sampleRate !== workerSampleRate ||
                                this.numberOfChannels !== workerChannels
                            ) {
                                this.sampleRate = workerSampleRate;
                                this.numberOfChannels = workerChannels;
                                this.fadeInLength = Math.round(workerSampleRate / 100);
                                this.resizeBuffers(workerChannels);
                                console.log(
                                    `Processor configured from worker: ${workerSampleRate}Hz, ${workerChannels} channels.`,
                                );
                            }

                            this.addAudioData(receivedChannelDataBuffers);
                        }
                    };
                }
                console.log("Worker port connected to AudioWorklet");
            } else if (type === "reset") {
                this.reset();
            } else if (type === "setBufferSize") {
                const bufferMessage = event.data as SetBufferSizeMessage;
                this.adaptiveBufferSize = Math.max(
                    this.minBuffer,
                    Math.min(this.maxBuffer, bufferMessage.data),
                );
            }
        };
    }

    /**
     * Resizes the buffer arrays to match the number of channels
     */
    private resizeBuffers(numberOfChannels: number): void {
        this.audioBuffers = [];
        for (let i = 0; i < numberOfChannels; i++) {
            this.audioBuffers.push([]);
        }
    }

    /**
     * Adds planar channel data directly to separate channel buffers
     */
    private addAudioData(channelData: Float32Array[]): void {
        if (
            !channelData ||
            channelData.length === 0 ||
            channelData[0].length === 0
        ) {
            return;
        }

        const numChannels = channelData.length;

        // Ensure we have enough buffer arrays
        while (this.audioBuffers.length < numChannels) {
            this.audioBuffers.push([]);
        }

        // Add data directly to each channel buffer
        for (let ch = 0; ch < numChannels; ch++) {
            const channelArray = Array.from(channelData[ch]);
            this.audioBuffers[ch].push(...channelArray);
        }

        // Trim buffers if they grow too large
        if (this.audioBuffers[0] && this.audioBuffers[0].length > this.maxBuffer) {
            const excess = this.audioBuffers[0].length - this.maxBuffer;
            for (let ch = 0; ch < this.audioBuffers.length; ch++) {
                this.audioBuffers[ch].splice(0, excess);
            }
        }

        // Start playback if buffer has reached the adaptive threshold
        const currentBufferSize = this.audioBuffers[0]
            ? this.audioBuffers[0].length
            : 0;
        if (!this.isPlaying && currentBufferSize >= this.adaptiveBufferSize) {
            this.isPlaying = true;
            this.fadeInSamples = 0;
            this.port.postMessage({
                type: "playbackStarted",
            } as PlaybackStartedMessage);
        }
    }

    /**
     * Resets the processor to its initial state
     */
    private reset(): void {
        for (let ch = 0; ch < this.audioBuffers.length; ch++) {
            this.audioBuffers[ch] = [];
        }
        this.isPlaying = false;
        this.fadeInSamples = 0;
        this.adaptiveBufferSize = this.bufferSize;
        console.log("Audio processor reset.");
    }

    /**
     * Main processing loop called by the audio engine
     */
    process(
        _inputs: Float32Array[][],
        outputs: Float32Array[][],
        _parameters: Record<string, Float32Array>,
    ): boolean {
        const output = outputs[0];
        const outputChannels = output.length;
        const outputLength = output[0].length;

        // Calculate and report buffer health
        const bufferFrames = this.audioBuffers[0] ? this.audioBuffers[0].length : 0;
        const bufferMs = (bufferFrames / this.sampleRate) * 1000;

        this.port.postMessage({
            type: "bufferStatus",
            bufferMs,
            isPlaying: this.isPlaying,
            bufferSamples: bufferFrames,
        } as AudioBufferStatus);

        // Check for buffer underrun
        if (!this.isPlaying || bufferFrames < outputLength) {
            if (this.isPlaying) {
                this.isPlaying = false;
                // Adaptively increase buffer size on underrun
                this.adaptiveBufferSize = Math.min(
                    this.maxBuffer,
                    this.adaptiveBufferSize * 1.5,
                );
                this.port.postMessage({
                    type: "underrun",
                    newBufferSize: this.adaptiveBufferSize,
                } as UnderrunMessage);
            }
            // Output silence if there's not enough data
            for (let channel = 0; channel < outputChannels; channel++) {
                output[channel].fill(0);
            }
            return true;
        }

        // Copy data from planar buffers to output buffers
        for (let channel = 0; channel < outputChannels; channel++) {
            if (
                channel < this.audioBuffers.length &&
                this.audioBuffers[channel].length >= outputLength
            ) {
                for (let i = 0; i < outputLength; i++) {
                    // Apply fade-in to prevent clicks
                    let fadeMultiplier = 1.0;
                    if (this.fadeInSamples < this.fadeInLength) {
                        fadeMultiplier = this.fadeInSamples / this.fadeInLength;
                        if (channel === 0) {
                            this.fadeInSamples++;
                        }
                    }

                    output[channel][i] = this.audioBuffers[channel][i] * fadeMultiplier;
                }
            } else {
                output[channel].fill(0);
            }
        }

        // Remove processed samples from buffers
        for (let ch = 0; ch < this.audioBuffers.length; ch++) {
            this.audioBuffers[ch].splice(0, outputLength);
        }

        // Adaptively decrease buffer size if consistently too full
        if (bufferFrames > this.adaptiveBufferSize * 2) {
            this.adaptiveBufferSize = Math.max(
                this.minBuffer,
                this.adaptiveBufferSize * 0.95,
            );
        }

        return true;
    }
}

registerProcessor("jitter-resistant-processor", JitterResistantProcessor);
