/**
 * FAAD2 WASM Decoder Wrapper
 * High-level JavaScript API for AAC decoding using FAAD2 compiled to WebAssembly
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
        const jsUrl = baseUrl + 'faad2_decoder.js';
        const wasmUrl = baseUrl + 'faad2_decoder.wasm';
        
        // Load the Emscripten JS file
        const response = await fetch(jsUrl);
        const scriptText = await response.text();
        
        // Evaluate the script to get createFaad2Decoder
        // The script defines: var createFaad2Decoder = ...
        const createFn = new Function(scriptText + '\nreturn createFaad2Decoder;')();
        
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
        console.log('[Faad2Decoder] WASM module loaded');
        return wasmModule;
    })();
    
    return wasmLoadingPromise;
}

/**
 * FAAD2 WASM Decoder
 * Decodes AAC audio to PCM using the FAAD2 library
 */
export class Faad2Decoder {
    constructor() {
        this.module = null;
        this.configured = false;
        this.sampleRate = 0;
        this.channels = 0;
        this.inputBufferPtr = null;
        this.inputBufferSize = 0;
    }
    
    /**
     * Initialize the decoder with AudioSpecificConfig
     * @param {Uint8Array} audioSpecificConfig - The ASC from the encoder
     * @returns {Promise<void>}
     */
    async init(audioSpecificConfig) {
        this.module = await loadWasmModule();
        
        // Allocate buffer for ASC
        const ascPtr = this.module._malloc(audioSpecificConfig.length);
        this.module.HEAPU8.set(audioSpecificConfig, ascPtr);
        
        // Initialize decoder
        const result = this.module._aac_decoder_init(ascPtr, audioSpecificConfig.length);
        
        this.module._free(ascPtr);
        
        if (result !== 0) {
            throw new Error(`Failed to initialize AAC decoder: error code ${result}`);
        }
        
        // Get configured parameters
        this.sampleRate = this.module._aac_decoder_get_sample_rate();
        this.channels = this.module._aac_decoder_get_channels();
        
        // Allocate input buffer (max AAC frame ~6144 bits/channel * 8 channels = ~6KB)
        this.inputBufferSize = 8192;
        this.inputBufferPtr = this.module._malloc(this.inputBufferSize);
        
        this.configured = true;
        
        console.log(`[Faad2Decoder] Initialized: ${this.sampleRate}Hz, ${this.channels}ch`);
    }
    
    /**
     * Get the sample rate
     * @returns {number}
     */
    getSampleRate() {
        return this.sampleRate;
    }
    
    /**
     * Get the number of channels
     * @returns {number}
     */
    getChannels() {
        return this.channels;
    }
    
    /**
     * Decode an AAC frame
     * @param {Uint8Array} aacFrame - The encoded AAC frame
     * @returns {Float32Array|null} Decoded PCM samples (interleaved), or null on error
     */
    decode(aacFrame) {
        if (!this.configured) {
            throw new Error('Decoder not configured');
        }
        
        if (aacFrame.length > this.inputBufferSize) {
            throw new Error(`AAC frame too large: ${aacFrame.length} > ${this.inputBufferSize}`);
        }
        
        // Copy input to WASM memory
        this.module.HEAPU8.set(aacFrame, this.inputBufferPtr);
        
        // Decode
        const numSamples = this.module._aac_decoder_decode(
            this.inputBufferPtr,
            aacFrame.length
        );
        
        if (numSamples < 0) {
            const errMsg = this.module.UTF8ToString(
                this.module._aac_decoder_get_error_message(numSamples)
            );
            console.error(`[Faad2Decoder] Decode error: ${errMsg}`);
            return null;
        }
        
        if (numSamples === 0) {
            // Priming frame - no output yet (normal for first AAC frame)
            return null;
        }
        
        // Get output (already in float format)
        const outputPtr = this.module._aac_decoder_get_output();
        return new Float32Array(
            this.module.HEAPF32.buffer,
            outputPtr,
            numSamples
        ).slice();
    }
    
    /**
     * Decode and return planar audio (separate arrays per channel)
     * @param {Uint8Array} aacFrame
     * @returns {Float32Array[]|null}
     */
    decodePlanar(aacFrame) {
        const interleaved = this.decode(aacFrame);
        if (!interleaved) return null;
        
        const channels = this.channels;
        const samplesPerChannel = interleaved.length / channels;
        const planar = [];
        
        for (let ch = 0; ch < channels; ch++) {
            const channelData = new Float32Array(samplesPerChannel);
            for (let i = 0; i < samplesPerChannel; i++) {
                channelData[i] = interleaved[i * channels + ch];
            }
            planar.push(channelData);
        }
        
        return planar;
    }
    
    /**
     * Close the decoder and free resources
     */
    close() {
        if (this.module && this.inputBufferPtr) {
            this.module._free(this.inputBufferPtr);
            this.inputBufferPtr = null;
        }
        
        if (this.module) {
            this.module._aac_decoder_close();
        }
        
        this.configured = false;
        this.sampleRate = 0;
        this.channels = 0;
    }
}

// Export for direct use
export default Faad2Decoder;
