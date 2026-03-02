/**
 * FDK-AAC WASM Encoder Wrapper
 * High-level JavaScript API for AAC encoding using FDK-AAC compiled to WebAssembly
 */

let wasmModule = null;
let wasmReady = false;
let wasmLoadingPromise = null;

// Get the base URL for loading WASM files
function getBaseUrl() {
    // Get the directory containing this script
    if (import.meta.url) {
        return new URL('./', import.meta.url).href;
    }
    return './';
}

// Load the WASM module
async function loadWasmModule() {
    if (wasmReady) return wasmModule;
    if (wasmLoadingPromise) return wasmLoadingPromise;
    
    wasmLoadingPromise = (async () => {
        const baseUrl = getBaseUrl();
        const jsUrl = baseUrl + 'fdk_aac_encoder.js';
        const wasmUrl = baseUrl + 'fdk_aac_encoder.wasm';
        
        // Load the Emscripten JS file
        const response = await fetch(jsUrl);
        const scriptText = await response.text();
        
        // Evaluate the script to get createFdkAacEncoder
        // The script defines: var createFdkAacEncoder = ...
        const createFn = new Function(scriptText + '\nreturn createFdkAacEncoder;')();
        
        // Initialize the module
        wasmModule = await createFn({
            locateFile: (path) => {
                if (path.endsWith('.wasm')) {
                    return wasmUrl;
                }
                return baseUrl + path;
            }
        });
        
        wasmReady = true;
        console.log('[FdkAacEncoder] WASM module loaded');
        return wasmModule;
    })();
    
    return wasmLoadingPromise;
}

/**
 * FDK-AAC WASM Encoder
 * Encodes PCM audio to AAC using the FDK-AAC library
 */
export class FdkAacEncoder {
    constructor() {
        this.module = null;
        this.configured = false;
        this.sampleRate = 48000;
        this.channels = 2;
        this.bitrate = 128000;
        this.frameLength = 1024;
        this.inputBuffer = null;
        this.inputBufferPtr = null;
        this.inputSamplesAccumulated = 0;
        this.ascData = null;
    }
    
    /**
     * Initialize the encoder
     * @param {Object} config - Encoder configuration
     * @param {number} config.sampleRate - Audio sample rate (default: 48000)
     * @param {number} config.channels - Number of audio channels (1 or 2, default: 2)
     * @param {number} config.bitrate - Target bitrate in bits/second (default: 128000)
     * @returns {Promise<void>}
     */
    async init(config = {}) {
        this.module = await loadWasmModule();
        
        this.sampleRate = config.sampleRate || 48000;
        this.channels = config.channels || 2;
        this.bitrate = config.bitrate || 128000;
        
        // Initialize the encoder
        const result = this.module._aac_encoder_init(
            this.sampleRate,
            this.channels,
            this.bitrate
        );
        
        if (result !== 0) {
            throw new Error(`Failed to initialize AAC encoder: error code ${result}`);
        }
        
        // Get frame length
        this.frameLength = this.module._aac_encoder_get_frame_length();
        
        // Get AudioSpecificConfig
        const ascPtr = this.module._aac_encoder_get_asc();
        const ascSize = this.module._aac_encoder_get_asc_size();
        this.ascData = new Uint8Array(this.module.HEAPU8.buffer, ascPtr, ascSize).slice();
        
        // Allocate input buffer (frame length * channels * 2 bytes per sample)
        const inputBufferSize = this.frameLength * this.channels * 2;
        this.inputBufferPtr = this.module._malloc(inputBufferSize);
        this.inputBuffer = new Int16Array(
            this.module.HEAP16.buffer,
            this.inputBufferPtr,
            this.frameLength * this.channels
        );
        
        this.inputSamplesAccumulated = 0;
        this.configured = true;
        
        console.log(`[FdkAacEncoder] Initialized: ${this.sampleRate}Hz, ${this.channels}ch, ${this.bitrate}bps, frameLength=${this.frameLength}`);
        console.log(`[FdkAacEncoder] ASC: ${Array.from(this.ascData).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    
    /**
     * Get the AudioSpecificConfig (decoder configuration)
     * @returns {Uint8Array} AudioSpecificConfig bytes
     */
    getAudioSpecificConfig() {
        return this.ascData;
    }
    
    /**
     * Get the frame length in samples per channel
     * @returns {number}
     */
    getFrameLength() {
        return this.frameLength;
    }
    
    /**
     * Encode PCM samples
     * @param {Int16Array|Float32Array} samples - Interleaved PCM samples
     * @returns {Uint8Array|null} Encoded AAC frame, or null if more samples needed
     */
    encode(samples) {
        if (!this.configured) {
            throw new Error('Encoder not configured');
        }
        
        // Convert Float32 to Int16 if needed
        let int16Samples;
        if (samples instanceof Float32Array) {
            int16Samples = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) {
                const s = Math.max(-1, Math.min(1, samples[i]));
                int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
        } else {
            int16Samples = samples;
        }
        
        // Number of samples needed for a full frame (total samples, not per channel)
        const samplesNeeded = this.frameLength * this.channels;
        
        // Accumulate samples
        const spaceAvailable = samplesNeeded - this.inputSamplesAccumulated;
        const samplesToCopy = Math.min(int16Samples.length, spaceAvailable);
        
        // Copy to WASM memory - need to refresh the view in case memory grew
        this.inputBuffer = new Int16Array(
            this.module.HEAP16.buffer,
            this.inputBufferPtr,
            this.frameLength * this.channels
        );
        
        this.inputBuffer.set(
            int16Samples.subarray(0, samplesToCopy),
            this.inputSamplesAccumulated
        );
        this.inputSamplesAccumulated += samplesToCopy;
        
        // Check if we have enough for a frame
        if (this.inputSamplesAccumulated < samplesNeeded) {
            return null; // Need more samples
        }
        
        // Encode the frame
        const outputSize = this.module._aac_encoder_encode(
            this.inputBufferPtr,
            samplesNeeded
        );
        
        if (outputSize < 0) {
            throw new Error(`AAC encoding failed: error code ${outputSize}`);
        }
        
        // Reset accumulator
        this.inputSamplesAccumulated = 0;
        
        // Handle any remaining samples from input
        if (samplesToCopy < int16Samples.length) {
            const remaining = int16Samples.subarray(samplesToCopy);
            // Refresh buffer view again
            this.inputBuffer = new Int16Array(
                this.module.HEAP16.buffer,
                this.inputBufferPtr,
                this.frameLength * this.channels
            );
            this.inputBuffer.set(remaining, 0);
            this.inputSamplesAccumulated = remaining.length;
        }
        
        if (outputSize === 0) {
            return null; // Encoder buffering
        }
        
        // Get output data
        const outputPtr = this.module._aac_encoder_get_output();
        const result = new Uint8Array(this.module.HEAPU8.buffer, outputPtr, outputSize).slice();
        return result;
    }
    
    /**
     * Encode planar audio data (separate arrays per channel)
     * @param {Float32Array[]} planarData - Array of channel data
     * @returns {Uint8Array|null}
     */
    encodePlanar(planarData) {
        // Interleave the channels
        const numFrames = planarData[0].length;
        const numChannels = planarData.length;
        const interleaved = new Float32Array(numFrames * numChannels);
        
        for (let i = 0; i < numFrames; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                interleaved[i * numChannels + ch] = planarData[ch][i];
            }
        }
        
        return this.encode(interleaved);
    }
    
    /**
     * Flush the encoder (call at end of stream)
     * @returns {Uint8Array|null}
     */
    flush() {
        if (!this.configured) return null;
        
        const outputSize = this.module._aac_encoder_flush();
        if (outputSize <= 0) return null;
        
        const outputPtr = this.module._aac_encoder_get_output();
        return new Uint8Array(this.module.HEAPU8.buffer, outputPtr, outputSize).slice();
    }
    
    /**
     * Close the encoder and free resources
     */
    close() {
        if (this.module && this.inputBufferPtr) {
            this.module._free(this.inputBufferPtr);
            this.inputBufferPtr = null;
        }
        
        if (this.module) {
            this.module._aac_encoder_close();
        }
        
        this.configured = false;
        this.inputBuffer = null;
        this.inputSamplesAccumulated = 0;
    }
}

// Export for direct use
export default FdkAacEncoder;
