/**
 * x264 WASM Encoder Wrapper
 * High-level JavaScript API for the x264 WASM encoder
 * 
 * Supports automatic fallback to non-SIMD WASM for iOS 15 Safari
 */

let wasmModule = null;
let moduleLoading = null;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

// SIMD detection - iOS 15 Safari does not support WASM SIMD
let simdSupported = null;

/**
 * Detect WebAssembly SIMD support
 * @returns {boolean} true if SIMD is supported
 */
function detectSimdSupport() {
    if (simdSupported !== null) return simdSupported;
    
    try {
        // Try to compile a minimal SIMD module
        // This uses the v128.const instruction which requires SIMD support
        const simdTest = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, // WASM magic
            0x01, 0x00, 0x00, 0x00, // version 1
            0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section: () -> v128
            0x03, 0x02, 0x01, 0x00, // function section
            0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, // code section with v128.const
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x0b // end
        ]);
        new WebAssembly.Module(simdTest);
        simdSupported = true;
        console.log('[X264Wasm] SIMD support detected');
    } catch (e) {
        simdSupported = false;
        console.log('[X264Wasm] SIMD not supported, will use non-SIMD fallback');
    }
    
    return simdSupported;
}

// Use public folder paths - these files are copied to public/ during build
// Paths for SIMD and non-SIMD versions
const simdWasmPath = '/codec-polyfill/x264-encoder/x264_encoder.wasm';
const simdJsPath = '/codec-polyfill/x264-encoder/x264_encoder.js';
const nosimdWasmPath = '/codec-polyfill/x264-encoder/x264_encoder_nosimd.wasm';
const nosimdJsPath = '/codec-polyfill/x264-encoder/x264_encoder_nosimd.js';

// Static version string — intentionally NOT Date.now().
// Using Date.now() as cache buster breaks Service Worker caching and forces
// a fresh WASM download on every worker startup, causing OOM on Safari 15
// when 5 workers each download + compile the same 640KB WASM module.
// Bump this version manually when the WASM binary changes.
const cacheBuster = `?v=1`;

/**
 * Get the appropriate WASM paths based on SIMD support
 */
function getWasmPaths() {
    const useSimd = detectSimdSupport();
    return {
        jsPath: useSimd ? simdJsPath : nosimdJsPath,
        wasmPath: useSimd ? simdWasmPath : nosimdWasmPath,
        useSimd
    };
}

/**
 * Preload the WASM module in the background
 * Call this early (e.g., on page load) to avoid loading delays when encoding starts
 */
export async function preloadModule() {
    try {
        await loadModule();
        return true;
    } catch (e) {
        console.warn('[X264Wasm] Preload failed (will retry when needed):', e.message);
        return false;
    }
}

/**
 * Check if the module is already loaded
 */
export function isModuleLoaded() {
    return wasmModule !== null;
}

/**
 * Load the WASM module with retry logic
 */
async function loadModule() {
    if (wasmModule) return wasmModule;
    if (moduleLoading) return moduleLoading;
    
    moduleLoading = (async () => {
        let lastError = null;
        const { jsPath, wasmPath, useSimd } = getWasmPaths();
        
        for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
            try {
                console.log(`[X264Wasm] Loading attempt ${attempt}/${MAX_LOAD_ATTEMPTS}...`);
                console.log('[X264Wasm] JS path:', jsPath, useSimd ? '(SIMD)' : '(non-SIMD)');
                console.log('[X264Wasm] WASM path:', wasmPath);
                
                // Check if already loaded
                if (wasmModule) return wasmModule;
                
                // Fetch and evaluate the Emscripten JS file (same approach as fdk-aac)
                console.log('[X264Wasm] Fetching script...');
                const response = await fetch(jsPath + cacheBuster);
                if (!response.ok) {
                    throw new Error(`Failed to fetch: HTTP ${response.status}`);
                }
                const scriptText = await response.text();
                console.log('[X264Wasm] Script fetched, size:', scriptText.length);
                
                // Use Function constructor to evaluate and get the factory
                // The script defines: var X264EncoderModule = (...)
                const createFn = new Function(scriptText + '\nreturn X264EncoderModule;')();
                console.log('[X264Wasm] Factory created:', typeof createFn);
                
                if (typeof createFn !== 'function') {
                    throw new Error(`X264EncoderModule is ${typeof createFn}, expected function`);
                }
                
                // Initialize the WASM module
                console.log('[X264Wasm] Initializing WASM module...');
                wasmModule = await createFn({
                    locateFile: (path) => {
                        if (path.endsWith('.wasm')) {
                            console.log('[X264Wasm] locateFile:', path, '->', wasmPath);
                            return wasmPath + cacheBuster;
                        }
                        return path;
                    }
                });
                
                console.log('[X264Wasm] Module initialized successfully', useSimd ? '(SIMD)' : '(non-SIMD)');
                return wasmModule;
            } catch (e) {
                lastError = e;
                console.error(`[X264Wasm] Load attempt ${attempt} failed:`, e.message);
                
                if (attempt < MAX_LOAD_ATTEMPTS) {
                    const delay = 200 * Math.pow(2, attempt - 1);
                    console.log(`[X264Wasm] Retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        
        // All attempts failed
        moduleLoading = null;
        throw new Error(`Failed to load x264 WASM module after ${MAX_LOAD_ATTEMPTS} attempts: ${lastError?.message}`);
    })();
    
    return moduleLoading;
}

/**
 * x264 WASM Encoder class
 */
export class X264WasmEncoder {
    constructor() {
        this.module = null;
        this.configured = false;
        this.width = 0;
        this.height = 0;
        this.rgbaBuffer = null;
        this.rgbaPtr = 0;
        this.onOutput = null;
        this.onError = null;
        this.frameCount = 0;
        this.keyFrameInterval = 60;
    }
    
    /**
     * Configure the encoder
     * @param {Object} config - Encoder configuration
     * @param {number} config.width - Frame width
     * @param {number} config.height - Frame height
     * @param {number} [config.framerate=30] - Frames per second
     * @param {number} [config.bitrate=2000000] - Bitrate in bps
     * @param {number} [config.keyFrameInterval=60] - Keyframe interval
     */
    async configure(config) {
        this.module = await loadModule();
        
        this.width = config.width;
        this.height = config.height;
        this.keyFrameInterval = config.keyFrameInterval || 60;
        
        const fps = config.framerate || config.fps || 30;
        const bitrateKbps = Math.floor((config.bitrate || 2000000) / 1000);
        
        // Create encoder
        const result = this.module._x264_encoder_create(
            this.width,
            this.height,
            fps,
            bitrateKbps,
            this.keyFrameInterval
        );
        
        if (result !== 0) {
            const error = new Error('Failed to create x264 encoder');
            if (this.onError) this.onError(error);
            throw error;
        }
        
        // Allocate RGBA buffer in WASM memory
        const rgbaSize = this.width * this.height * 4;
        this.rgbaPtr = this.module._malloc(rgbaSize);
        this.rgbaBuffer = new Uint8Array(this.module.HEAPU8.buffer, this.rgbaPtr, rgbaSize);
        
        this.configured = true;
        console.log('[X264Wasm] Encoder configured:', config);
    }
    
    /**
     * Encode a frame
     * @param {ImageData|Uint8Array|Uint8ClampedArray} frame - RGBA frame data
     * @param {boolean} [forceKeyFrame=false] - Force a keyframe
     */
    encode(frame, forceKeyFrame = false) {
        if (!this.configured) {
            console.warn('X264 WASM encoder not configured');
            return;
        }
        
        // Get RGBA data
        let rgbaData;
        let frameWidth, frameHeight;
        if (frame instanceof ImageData) {
            rgbaData = frame.data;
            frameWidth = frame.width;
            frameHeight = frame.height;
        } else if (frame instanceof Uint8Array || frame instanceof Uint8ClampedArray) {
            rgbaData = frame;
            frameWidth = this.width;
            frameHeight = this.height;
        } else {
            console.error('Unsupported frame type');
            return;
        }
        
        // Check for dimension mismatch
        if (frameWidth !== this.width || frameHeight !== this.height) {
            console.error(`Frame dimension mismatch: expected ${this.width}x${this.height}, got ${frameWidth}x${frameHeight}`);
            return;
        }
        
        // Refresh buffer view in case WASM memory grew
        const rgbaSize = this.width * this.height * 4;
        if (rgbaData.length !== rgbaSize) {
            console.error(`Frame size mismatch: expected ${rgbaSize}, got ${rgbaData.length}`);
            return;
        }
        this.rgbaBuffer = new Uint8Array(this.module.HEAPU8.buffer, this.rgbaPtr, rgbaSize);
        
        // Copy to WASM memory
        this.rgbaBuffer.set(rgbaData);
        
        // Encode
        const nalSize = this.module._x264_encoder_encode_rgba(
            this.rgbaPtr,
            forceKeyFrame ? 1 : 0
        );
        
        if (nalSize < 0) {
            const error = new Error('x264 encoding failed');
            if (this.onError) this.onError(error);
            return;
        }
        
        if (nalSize === 0) {
            // No output yet (buffering)
            return;
        }
        
        // Get encoded data
        const nalBufferPtr = this.module._x264_encoder_get_buffer();
        const isKeyframe = this.module._x264_encoder_is_keyframe() !== 0;
        const nalData = new Uint8Array(nalSize);
        nalData.set(new Uint8Array(this.module.HEAPU8.buffer, nalBufferPtr, nalSize));
        
        // Create chunk-like object
        const chunk = {
            type: isKeyframe ? 'key' : 'delta',
            timestamp: this.frameCount * (1000000 / 30), // microseconds
            data: nalData,
            byteLength: nalSize,
            copyTo: function(dest) {
                dest.set(this.data);
            }
        };
        
        this.frameCount++;
        
        // For the first keyframe, extract SPS/PPS as description
        const metadata = {};
        if (isKeyframe && this.frameCount === 1) {
            // SPS/PPS are at the beginning of the first keyframe in Annex B format
            // For now, we'll send the whole NAL as description since it contains SPS/PPS
            metadata.decoderConfig = {
                codec: 'avc1.42001f',
                description: this._extractParameterSets(nalData)
            };
        }
        
        if (this.onOutput) {
            this.onOutput(chunk, metadata);
        }
    }
    
    /**
     * Extract SPS/PPS from Annex B NAL units
     * @param {Uint8Array} nalData - Annex B NAL data
     * @returns {Uint8Array} - AVCDecoderConfigurationRecord
     */
    _extractParameterSets(nalData) {
        // Find all start code positions
        const startPositions = [];
        let i = 0;
        
        while (i < nalData.length - 2) {
            if (nalData[i] === 0 && nalData[i + 1] === 0) {
                if (i + 3 < nalData.length && nalData[i + 2] === 0 && nalData[i + 3] === 1) {
                    startPositions.push({ pos: i, len: 4 });
                    i += 4;
                } else if (nalData[i + 2] === 1) {
                    startPositions.push({ pos: i, len: 3 });
                    i += 3;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        
        // Extract NAL units
        const nals = [];
        for (let idx = 0; idx < startPositions.length; idx++) {
            const start = startPositions[idx];
            const nalStart = start.pos + start.len;
            const nalEnd = idx + 1 < startPositions.length 
                ? startPositions[idx + 1].pos 
                : nalData.length;
            
            if (nalStart < nalEnd) {
                const nalUnit = nalData.slice(nalStart, nalEnd);
                if (nalUnit.length > 0) {
                    const nalType = nalUnit[0] & 0x1f;
                    nals.push({ type: nalType, data: nalUnit });
                }
            }
        }
        
        // Find SPS (type 7) and PPS (type 8)
        const sps = nals.find(n => n.type === 7);
        const pps = nals.find(n => n.type === 8);
        
        if (!sps || !pps) {
            console.warn('[X264Wasm] Could not find SPS/PPS in NAL data, NAL types found:', nals.map(n => n.type));
            return nalData; // Return raw data as fallback
        }
        
        // Build AVCDecoderConfigurationRecord
        // See ISO/IEC 14496-15 section 5.2.4.1
        const configRecord = new Uint8Array(11 + sps.data.length + pps.data.length);
        let offset = 0;
        
        configRecord[offset++] = 1; // configurationVersion
        configRecord[offset++] = sps.data[1]; // AVCProfileIndication
        configRecord[offset++] = sps.data[2]; // profile_compatibility
        configRecord[offset++] = sps.data[3]; // AVCLevelIndication
        configRecord[offset++] = 0xff; // lengthSizeMinusOne (3, so 4-byte length)
        
        // SPS
        configRecord[offset++] = 0xe1; // numOfSequenceParameterSets (1)
        configRecord[offset++] = (sps.data.length >> 8) & 0xff;
        configRecord[offset++] = sps.data.length & 0xff;
        configRecord.set(sps.data, offset);
        offset += sps.data.length;
        
        // PPS
        configRecord[offset++] = 1; // numOfPictureParameterSets
        configRecord[offset++] = (pps.data.length >> 8) & 0xff;
        configRecord[offset++] = pps.data.length & 0xff;
        configRecord.set(pps.data, offset);
        
        return configRecord;
    }
    
    /**
     * Flush the encoder
     */
    async flush() {
        if (!this.configured) return;
        
        let nalSize;
        while ((nalSize = this.module._x264_encoder_flush()) > 0) {
            const nalBufferPtr = this.module._x264_encoder_get_buffer();
            const isKeyframe = this.module._x264_encoder_is_keyframe() !== 0;
            const nalData = new Uint8Array(nalSize);
            nalData.set(new Uint8Array(this.module.HEAPU8.buffer, nalBufferPtr, nalSize));
            
            const chunk = {
                type: isKeyframe ? 'key' : 'delta',
                timestamp: this.frameCount * (1000000 / 30),
                data: nalData,
                byteLength: nalSize,
                copyTo: function(dest) {
                    dest.set(this.data);
                }
            };
            
            this.frameCount++;
            
            if (this.onOutput) {
                this.onOutput(chunk, {});
            }
        }
    }
    
    /**
     * Close the encoder and free resources
     */
    close() {
        if (this.module && this.rgbaPtr) {
            this.module._free(this.rgbaPtr);
            this.rgbaPtr = 0;
        }
        
        if (this.module) {
            this.module._x264_encoder_destroy();
        }
        
        this.configured = false;
    }
    
    get state() {
        return this.configured ? 'configured' : 'closed';
    }
    
    get encodeQueueSize() {
        return 0; // Synchronous encoder
    }
}

export default X264WasmEncoder;
