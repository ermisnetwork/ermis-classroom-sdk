/**
 * Video Codec Polyfill
 * Provides H.264 encoding/decoding with native WebCodecs or WASM fallback
 */

import { WebGLRenderer, hasMediaStreamTrackGenerator, hasWebGL2 } from './webgl-renderer.js';

// Feature detection
const HAS_VIDEO_ENCODER = typeof VideoEncoder !== 'undefined';
const HAS_VIDEO_DECODER = typeof VideoDecoder !== 'undefined';

let h264EncoderSupported = null;
let h264DecoderSupported = null;

/**
 * Check if native H.264 encoding is supported
 */
export async function isNativeH264EncoderSupported() {
    if (h264EncoderSupported !== null) return h264EncoderSupported;
    
    if (!HAS_VIDEO_ENCODER) {
        h264EncoderSupported = false;
        return false;
    }
    
    try {
        const support = await VideoEncoder.isConfigSupported({
            codec: 'avc1.42001f', // Baseline profile, level 3.1
            width: 640,
            height: 480,
            bitrate: 1_000_000,
            framerate: 30,
        });
        h264EncoderSupported = support.supported;
    } catch (e) {
        h264EncoderSupported = false;
    }
    
    return h264EncoderSupported;
}

/**
 * Check if native H.264 decoding is supported
 */
export async function isNativeH264DecoderSupported() {
    if (h264DecoderSupported !== null) return h264DecoderSupported;
    
    if (!HAS_VIDEO_DECODER) {
        console.log('[isNativeH264DecoderSupported] No VideoDecoder API');
        h264DecoderSupported = false;
        return false;
    }
    
    try {
        const support = await VideoDecoder.isConfigSupported({
            codec: 'avc1.42001f',
        });
        h264DecoderSupported = support.supported;
    } catch (e) {
        console.error('[isNativeH264DecoderSupported] Error:', e);
        h264DecoderSupported = false;
    }
    
    return h264DecoderSupported;
}

/**
 * Native H.264 Encoder using WebCodecs VideoEncoder
 */
export class NativeH264Encoder {
    constructor(config) {
        this.config = config;
        this.encoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
        this.frameCount = 0;
        this.keyFrameInterval = config.keyFrameInterval || 120;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        
        const encoderConfig = {
            codec: 'avc1.42001f', // Baseline profile, level 3.1 (supports 720p)
            width: this.config.width,
            height: this.config.height,
            bitrate: this.config.bitrate || 2_000_000,
            framerate: this.config.framerate || 30,
            latencyMode: 'realtime',
            avc: { format: 'annexb' }, // Annex B format - SPS/PPS inline with start codes
        };
        
        // Add hardware acceleration preference
        if (this.config.hardwareAcceleration) {
            encoderConfig.hardwareAcceleration = this.config.hardwareAcceleration;
        }
        
        this.encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                if (this.onOutput) {
                    this.onOutput(chunk, metadata);
                }
            },
            error: (e) => {
                console.error('NativeH264Encoder error:', e);
                if (this.onError) {
                    this.onError(e);
                }
            },
        });
        
        await this.encoder.configure(encoderConfig);
        this.configured = true;
        console.log('[VideoCodec] Using native H.264 encoder');
    }
    
    /**
     * Encode a VideoFrame
     * @param {VideoFrame} frame - The frame to encode
     * @param {boolean} forceKeyFrame - Force a keyframe
     */
    encode(frame, forceKeyFrame = false) {
        if (!this.configured || this.encoder.state !== 'configured') {
            console.warn('Encoder not configured');
            return;
        }
        
        const keyFrame = forceKeyFrame || (this.frameCount % this.keyFrameInterval === 0);
        this.encoder.encode(frame, { keyFrame });
        this.frameCount++;
    }
    
    async flush() {
        if (this.encoder && this.encoder.state === 'configured') {
            await this.encoder.flush();
        }
    }
    
    close() {
        if (this.encoder) {
            this.encoder.close();
            this.encoder = null;
        }
        this.configured = false;
    }
    
    get state() {
        return this.encoder ? this.encoder.state : 'closed';
    }
    
    get encodeQueueSize() {
        return this.encoder ? this.encoder.encodeQueueSize : 0;
    }
}

/**
 * Native H.264 Decoder using WebCodecs VideoDecoder
 */
export class NativeH264Decoder {
    constructor() {
        this.decoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
    }
    
    async configure(config) {
        const decoderConfig = {
            codec: config.codec || 'avc1.42001f', // Baseline profile, level 3.1
        };
        
        // Use Annex B format by default or if explicitly requested
        if (config.avc?.format === 'annexb' || !config.description) {
            decoderConfig.avc = { format: 'annexb' };
            console.log('[VideoCodec] Using native H.264 decoder (annexb mode)');
        } else if (config.description) {
            // Use AVC format with description (for non-annexb streams)
            decoderConfig.description = config.description;
            console.log('[VideoCodec] Using native H.264 decoder (avc mode with description)');
        }
        
        this.decoder = new VideoDecoder({
            output: (frame) => {
                if (this.onOutput) {
                    this.onOutput(frame);
                }
            },
            error: (e) => {
                console.error('NativeH264Decoder error:', e);
                if (this.onError) {
                    this.onError(e);
                }
            },
        });
        
        await this.decoder.configure(decoderConfig);
        this.configured = true;
    }
    
    /**
     * Decode an encoded video chunk
     * @param {EncodedVideoChunk|Object} chunk - The chunk to decode
     */
    decode(chunk) {
        if (!this.configured || this.decoder.state !== 'configured') {
            console.warn('Decoder not configured, state:', this.decoder?.state);
            return;
        }
        
        // Convert plain object to EncodedVideoChunk if needed
        if (!(chunk instanceof EncodedVideoChunk)) {
            // Validate data
            const data = chunk.data;
            if (!data || data.length === 0) {
                console.warn('NativeH264Decoder: empty data, skipping');
                return;
            }
            
            chunk = new EncodedVideoChunk({
                type: chunk.type || 'delta',
                timestamp: chunk.timestamp,
                data: data,
            });
        }
        
        try {
            this.decoder.decode(chunk);
        } catch (e) {
            console.error('NativeH264Decoder decode() threw:', e);
            if (this.onError) this.onError(e);
        }
    }
    
    async flush() {
        if (this.decoder && this.decoder.state === 'configured') {
            await this.decoder.flush();
        }
    }
    
    close() {
        if (this.decoder) {
            this.decoder.close();
            this.decoder = null;
        }
        this.configured = false;
    }
    
    get state() {
        return this.decoder ? this.decoder.state : 'closed';
    }
    
    get decodeQueueSize() {
        return this.decoder ? this.decoder.decodeQueueSize : 0;
    }
}

/**
 * WASM H.264 Encoder using x264-simd
 * Outputs raw NAL units for streaming with SIMD acceleration
 */
export class WasmH264Encoder {
    constructor(config) {
        this.config = config;
        this.encoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
        this.frameCount = 0;
        this.keyFrameInterval = config.keyFrameInterval || 60;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        
        try {
            // Dynamically import the x264 WASM encoder
            const { X264WasmEncoder } = await import('./x264-encoder/x264-encoder-wrapper.js');
            this.encoder = new X264WasmEncoder();
            
            // Forward callbacks
            this.encoder.onOutput = (chunk, metadata) => {
                if (this.onOutput) this.onOutput(chunk, metadata);
            };
            this.encoder.onError = (e) => {
                if (this.onError) this.onError(e);
            };
            
            await this.encoder.configure({
                width: this.config.width,
                height: this.config.height,
                framerate: this.config.framerate || 30,
                bitrate: this.config.bitrate || 2_000_000,
                keyFrameInterval: this.keyFrameInterval,
            });
            
            this.configured = true;
            console.log('[VideoCodec] Using WASM H.264 encoder (x264-simd)');
        } catch (e) {
            console.error('Failed to initialize WASM H.264 encoder:', e);
            if (this.onError) this.onError(e);
            throw e;
        }
    }
    
    /**
     * Encode a frame (ImageData, VideoFrame, or ImageData-like object from iOS 15 fallback)
     * @param {ImageData|VideoFrame|Object} frame - The frame to encode
     * @param {boolean} forceKeyFrame - Force a keyframe
     */
    async encode(frame, forceKeyFrame = false) {
        if (!this.configured || !this.encoder) {
            console.warn('WASM Encoder not configured');
            return;
        }
        
        // Helper function to resize ImageData if needed
        const resizeImageData = (imageData, targetWidth, targetHeight) => {
            if (imageData.width === targetWidth && imageData.height === targetHeight) {
                return imageData;
            }
            
            // Create source canvas
            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = imageData.width;
            srcCanvas.height = imageData.height;
            const srcCtx = srcCanvas.getContext('2d', {willReadFrequently: true});
            srcCtx.putImageData(imageData, 0, 0);
            
            // Create target canvas and resize
            const dstCanvas = document.createElement('canvas');
            dstCanvas.width = targetWidth;
            dstCanvas.height = targetHeight;
            const dstCtx = dstCanvas.getContext('2d', {willReadFrequently: true});
            dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
            
            return dstCtx.getImageData(0, 0, targetWidth, targetHeight);
        };
        
        // Pass ImageData directly to the x264 encoder
        // The x264 wrapper handles ImageData natively and preserves width/height
        if (frame instanceof ImageData) {
            const resized = resizeImageData(frame, this.config.width, this.config.height);
            this.encoder.encode(resized, forceKeyFrame);
            this.frameCount++;
            return;
        }
        
        // Handle iOS 15 fallback: ImageData-like object from MSTP_polyfill
        // Format: {type: 'imagedata', data: Uint8ClampedArray, width, height, timestamp}
        if (frame && frame.type === 'imagedata' && frame.data) {
            const imageData = new ImageData(
                new Uint8ClampedArray(frame.data),
                frame.width,
                frame.height
            );
            const resized = resizeImageData(imageData, this.config.width, this.config.height);
            this.encoder.encode(resized, forceKeyFrame);
            this.frameCount++;
            return;
        }
        
        // For VideoFrame, convert to ImageData
        if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
            // Create a canvas to extract ImageData with correct dimensions
            const width = frame.displayWidth;
            const height = frame.displayHeight;
            
            // iOS 15 fallback: use regular canvas if OffscreenCanvas unavailable
            let canvas, ctx;
            if (typeof OffscreenCanvas !== 'undefined') {
                canvas = new OffscreenCanvas(width, height);
                ctx = canvas.getContext('2d');
            } else {
                canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                ctx = canvas.getContext('2d', {willReadFrequently: true});
            }
            
            ctx.drawImage(frame, 0, 0);
            let imageData = ctx.getImageData(0, 0, width, height);
            
            // Resize if dimensions don't match encoder config
            if (width !== this.config.width || height !== this.config.height) {
                imageData = resizeImageData(imageData, this.config.width, this.config.height);
            }
            
            this.encoder.encode(imageData, forceKeyFrame);
            this.frameCount++;
            return;
        }
        
        console.error('Unsupported frame type:', typeof frame, frame);
    }
    
    async flush() {
        if (this.encoder) {
            await this.encoder.flush();
        }
    }
    
    close() {
        if (this.encoder) {
            this.encoder.close();
            this.encoder = null;
        }
        this.configured = false;
    }
    
    get state() {
        return this.configured ? 'configured' : 'closed';
    }
    
    get encodeQueueSize() {
        return 0; // WASM encoder is synchronous
    }
}

/**
 * Shared singleton WASM module for TinyH264 — avoids loading WASM multiple times
 * within the same worker context, which is critical for Safari 15 memory limits.
 * Each worker has its own module scope so this is safe (no cross-worker sharing).
 */
let _sharedTinyH264Module = null;
let _sharedTinyH264ModuleLoading = null;

async function _getSharedTinyH264Module() {
    if (_sharedTinyH264Module) return _sharedTinyH264Module;
    if (_sharedTinyH264ModuleLoading) return _sharedTinyH264ModuleLoading;
    _sharedTinyH264ModuleLoading = (async () => {
        const { default: TinyH264Module } = await import('./h264-decoder/TinyH264.js');
        const mod = await TinyH264Module();
        _sharedTinyH264Module = mod;
        _sharedTinyH264ModuleLoading = null;
        return mod;
    })();
    return _sharedTinyH264ModuleLoading;
}

/**
 * WASM H.264 Decoder using tinyh264
 * Outputs YUV420 which can be rendered with WebGLRenderer
 */
export class WasmH264Decoder {
    constructor() {
        this.decoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
        this.width = 0;
        this.height = 0;
        this.sps = null;
        this.pps = null;
        this.nalLengthSize = 4; // Default for AVC format
        this.outputRGBA = false; // Output RGBA instead of YUV420
        // Reusable decode buffer to avoid per-frame allocation (Safari 15 GC pressure)
        this._decodeBuffer = null;
        this._decodeBufferSize = 0;
        // Preallocated YUV output buffers — reused every frame to eliminate 3 allocs/frame
        this._yBuf = null;
        this._uBuf = null;
        this._vBuf = null;
        this._yuvWidth = 0;
        this._yuvHeight = 0;
    }
    
    async configure(config) {
        // Set output format preference
        this.outputRGBA = config.outputRGBA || false;
        
        console.log('[WasmH264Decoder] configure called', config);

        if (this.decoder) {
             console.log('[WasmH264Decoder] Already initialized, skipping WASM reload');
             if (config.description) {
                 this._parseAVCConfig(config.description);
             }
             return;
        }

        try {
            // Use shared singleton WASM module to avoid loading WASM multiple times
            // in the same worker (critical for Safari 15 ~150MB memory limit).
            const [wasmModule, { default: TinyH264Decoder }] = await Promise.all([
                _getSharedTinyH264Module(),
                import('./h264-decoder/TinyH264Decoder.js')
            ]);
            // wasmModule is the shared TinyH264 WASM instance
            
            // Create decoder wrapper with WASM module and output callback
            this.decoder = new TinyH264Decoder(wasmModule, (yuvData, width, height) => {
                if (this.onOutput) {
                    // Extract Y/U/V planes from packed YUV420 buffer
                    const ySize = width * height;
                    const uvSize = (width * height) / 4;
                    const yPlane = yuvData.subarray(0, ySize);
                    const uPlane = yuvData.subarray(ySize, ySize + uvSize);
                    const vPlane = yuvData.subarray(ySize + uvSize, ySize + 2 * uvSize);
                    
                    // Convert to RGBA if requested, otherwise output YUV for WebGL
                    if (this.outputRGBA) {
                        const rgba = this._convertYUV420toRGBA(yPlane, uPlane, vPlane, width, height);
                        this.onOutput({
                            format: 'rgba',
                            data: rgba,
                            width,
                            height,
                            timestamp: Date.now(),
                        });
                    } else {
                        // Reuse preallocated YUV planes to avoid 3 new Uint8Array() per frame
                        // (30fps × 5 workers = 450 allocations/s eliminated)
                        if (this._yuvWidth !== width || this._yuvHeight !== height) {
                            // Resolution changed (or first frame) — allocate new buffers
                            this._yuvWidth = width;
                            this._yuvHeight = height;
                            this._yBuf = new Uint8Array(width * height);
                            this._uBuf = new Uint8Array((width * height) >> 2);
                            this._vBuf = new Uint8Array((width * height) >> 2);
                        }
                        // Copy into preallocated buffers
                        this._yBuf.set(yPlane);
                        this._uBuf.set(uPlane);
                        this._vBuf.set(vPlane);
                        this.onOutput({
                            format: 'yuv420',
                            yPlane: this._yBuf,
                            uPlane: this._uBuf,
                            vPlane: this._vBuf,
                            width,
                            height,
                            timestamp: Date.now(),
                        });
                    }
                }
            });

            // Parse AVCDecoderConfigurationRecord if provided
            // We store SPS/PPS but don't send them yet - they'll be prepended to keyframes
            if (config.description) {
                this._parseAVCConfig(config.description);
            }
            
            this.configured = true;
        } catch (e) {
            console.error('[WasmH264Decoder] Failed to initialize WASM H.264 decoder:', e);
            if (this.onError) this.onError(e);
            throw e;
        }
    }
    
    /**
     * Parse AVCDecoderConfigurationRecord
     */
    _parseAVCConfig(data) {
        // Handle ArrayBuffer or Uint8Array
        const view = data instanceof ArrayBuffer 
            ? new Uint8Array(data) 
            : (data instanceof Uint8Array ? data : new Uint8Array(data));
        
        if (view.length < 7) {
            return;
        }
        
        
        let offset = 5; // Skip configurationVersion, profile, compat, level, lengthSizeMinusOne
        
        this.nalLengthSize = (view[4] & 0x03) + 1;
        
        // Parse SPS
        const numSPS = view[offset++] & 0x1f;
        
        for (let i = 0; i < numSPS && offset + 2 <= view.length; i++) {
            const spsLen = (view[offset] << 8) | view[offset + 1];
            offset += 2;
            if (offset + spsLen <= view.length) {
                this.sps = view.slice(offset, offset + spsLen);
                offset += spsLen;
            }
        }
        
        // Parse PPS
        if (offset < view.length) {
            const numPPS = view[offset++];
            
            for (let i = 0; i < numPPS && offset + 2 <= view.length; i++) {
                const ppsLen = (view[offset] << 8) | view[offset + 1];
                offset += 2;
                if (offset + ppsLen <= view.length) {
                    this.pps = view.slice(offset, offset + ppsLen);
                    offset += ppsLen;
                }
            }
        }
        
        if (!this.sps || !this.pps) {
            console.error('[WasmH264Decoder] Failed to extract SPS/PPS from AVCConfig');
        }
    }
    
    /**
     * Convert AVC format to Annex B format
     * Returns array of individual NAL units (without start codes)
     */
    _avcToAnnexB(data) {
        const nalUnits = [];
        let offset = 0;
        
        while (offset + this.nalLengthSize <= data.length) {
            // Read NAL length (big-endian)
            let nalLen = 0;
            for (let i = 0; i < this.nalLengthSize; i++) {
                nalLen = (nalLen << 8) | data[offset + i];
            }
            
            offset += this.nalLengthSize;
            
            // Sanity check
            if (nalLen <= 0 || offset + nalLen > data.length) {
                console.warn('[WasmH264Decoder] Invalid NAL length:', nalLen, 'at offset', offset - this.nalLengthSize, 'data.length=', data.length);
                break;
            }
            
            // Extract NAL unit
            const nalData = data.slice(offset, offset + nalLen);
            const nalType = nalData[0] & 0x1f;

            // Skip SEI (6), AUD (9), and filler (12) NAL units that h264bsd might not handle well
            if (nalType !== 6 && nalType !== 9 && nalType !== 12) {
                nalUnits.push(nalData);
            } else if (this.frameCount <= 3) {
                console.log(`[WasmH264Decoder] Skipping NAL type ${nalType}`);
            }
            
            offset += nalLen;
        }
        
        return nalUnits;
    }
    
    /**
     * Decode NAL units
     * @param {Object} chunk - Object with data property containing NAL units
     */
    decode(chunk) {
        if (!this.configured) {
            console.warn('[WasmH264Decoder] WASM Decoder not configured');
            return;
        }
        
        try {
            let data;
            
            // Debug: log chunk type at the very beginning
            const isEncodedVideoChunk = typeof EncodedVideoChunk !== 'undefined' && chunk instanceof EncodedVideoChunk;
            // Debug disabled for performance
            
            // Handle EncodedVideoChunk (native WebCodecs type)
            if (isEncodedVideoChunk) {
                // Reuse decode buffer to avoid per-frame allocation (Safari 15 GC pressure)
                if (!this._decodeBuffer || this._decodeBufferSize < chunk.byteLength) {
                    this._decodeBufferSize = chunk.byteLength * 2; // Add headroom
                    this._decodeBuffer = new ArrayBuffer(this._decodeBufferSize);
                }
                chunk.copyTo(this._decodeBuffer);
                data = new Uint8Array(this._decodeBuffer, 0, chunk.byteLength);
            } else if (chunk.data) {
                // Handle plain object with data property
                data = chunk.data instanceof ArrayBuffer 
                    ? new Uint8Array(chunk.data) 
                    : (chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data));
            } else {
                console.warn('[WasmH264Decoder] Invalid chunk format, no data');
                return;
            }
            
            // Skip empty data
            if (!data || data.length === 0) {
                // Don't spam console for empty frames
                return;
            }
            
            if (!this.frameCount) this.frameCount = 0;
            this.frameCount++;
            
            // Debug logging for first frames
            // Debug disabled for performance
            
            // Check if this is Annex B format (has start codes)
            const hasStartCode = data.length > 4 && data[0] === 0 && data[1] === 0 && 
                (data[2] === 1 || (data[2] === 0 && data[3] === 1));
            
            if (hasStartCode) {
                // Already Annex B format - feed directly
                this.decoder.decode(data);
            } else if (data.length > this.nalLengthSize) {
                // This is AVC format - extract NAL units and convert
                const nalUnits = this._avcToAnnexB(data);
                
                // Build Annex B stream, prepending SPS/PPS for keyframes if needed
                const isKeyframe = chunk.type === 'key';
                const allNals = [];
                
                if (isKeyframe && this.sps && this.pps) {
                    const hasSpsPps = nalUnits.some(nal => (nal[0] & 0x1f) === 7);
                    if (!hasSpsPps) {
                        allNals.push(this.sps);
                        allNals.push(this.pps);
                    }
                }
                
                allNals.push(...nalUnits);
                
                // Build single Annex B buffer
                let totalSize = 0;
                for (const nal of allNals) {
                    totalSize += 4 + nal.length;
                }
                
                const annexB = new Uint8Array(totalSize);
                let offset = 0;
                for (const nal of allNals) {
                    annexB[offset++] = 0;
                    annexB[offset++] = 0;
                    annexB[offset++] = 0;
                    annexB[offset++] = 1;
                    annexB.set(nal, offset);
                    offset += nal.length;
                }
                
                this.decoder.decode(annexB);
            } else {
                // Data too short - skip silently
            }
        } catch (e) {
            console.error('WASM decode error:', e);
            if (this.onError) this.onError(e);
        }
    }
    
    async flush() {
        // tinyh264 doesn't have explicit flush
    }
    
    close() {
        if (this.decoder) {
            this.decoder = null;
        }
        this.configured = false;
    }
    
    /**
     * Convert YUV420 to RGBA
     * BT.601 color conversion
     */
    _convertYUV420toRGBA(yPlane, uPlane, vPlane, width, height) {
        const rgba = new Uint8Array(width * height * 4);
        const uvWidth = width >> 1;
        
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const yIndex = j * width + i;
                const uvIndex = (j >> 1) * uvWidth + (i >> 1);
                
                const y = yPlane[yIndex];
                const u = uPlane[uvIndex] - 128;
                const v = vPlane[uvIndex] - 128;
                
                // BT.601 conversion
                let r = y + 1.402 * v;
                let g = y - 0.344136 * u - 0.714136 * v;
                let b = y + 1.772 * u;
                
                // Clamp to 0-255
                r = r < 0 ? 0 : (r > 255 ? 255 : r);
                g = g < 0 ? 0 : (g > 255 ? 255 : g);
                b = b < 0 ? 0 : (b > 255 ? 255 : b);
                
                const rgbaIndex = yIndex * 4;
                rgba[rgbaIndex] = r;
                rgba[rgbaIndex + 1] = g;
                rgba[rgbaIndex + 2] = b;
                rgba[rgbaIndex + 3] = 255;
            }
        }
        
        return rgba;
    }
    
    get state() {
        return this.configured ? 'configured' : 'closed';
    }
    
    get decodeQueueSize() {
        return 0; // WASM decoder is synchronous
    }
}

/**
 * Auto-selecting H.264 Encoder
 * Uses native WebCodecs if available, falls back to WASM
 */
export class H264Encoder {
    constructor(config = {}) {
        this.config = config;
        this.encoder = null;
        this.isNative = false;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        
        const nativeSupported = await isNativeH264EncoderSupported();
        
        if (nativeSupported && !this.config.forceWasm) {
            this.encoder = new NativeH264Encoder(this.config);
            this.isNative = true;
        } else {
            this.encoder = new WasmH264Encoder(this.config);
            this.isNative = false;
        }
        
        // Forward callbacks
        this.encoder.onOutput = this.onOutput;
        this.encoder.onError = this.onError;
        
        await this.encoder.configure(this.config);
    }
    
    set onOutput(callback) {
        this._onOutput = callback;
        if (this.encoder) this.encoder.onOutput = callback;
    }
    
    get onOutput() {
        return this._onOutput;
    }
    
    set onError(callback) {
        this._onError = callback;
        if (this.encoder) this.encoder.onError = callback;
    }
    
    get onError() {
        return this._onError;
    }
    
    encode(frame, forceKeyFrame = false) {
        return this.encoder?.encode(frame, forceKeyFrame);
    }
    
    flush() {
        return this.encoder?.flush();
    }
    
    close() {
        this.encoder?.close();
    }
    
    get state() {
        return this.encoder?.state || 'unconfigured';
    }
    
    get encodeQueueSize() {
        return this.encoder?.encodeQueueSize || 0;
    }
    
    get usingNative() {
        return this.isNative;
    }
}

/**
 * Auto-selecting H.264 Decoder
 * Uses native WebCodecs if available, falls back to WASM
 */
export class H264Decoder {
    constructor(config = {}) {
        this.config = config;
        this.decoder = null;
        this.isNative = false;
        this.renderer = null;
    }
    
    async configure(config, canvas = null) {
        config = { ...this.config, ...config };
        const nativeSupported = await isNativeH264DecoderSupported();
        
        if (nativeSupported && !config.forceWasm) {
            this.decoder = new NativeH264Decoder();
            this.isNative = true;
        } else {
            this.decoder = new WasmH264Decoder();
            this.isNative = false;
            
            // WASM decoder outputs YUV, need renderer
            if (canvas) {
                this.renderer = new WebGLRenderer(canvas);
            }
        }
        
        // Forward callbacks, wrapping for WASM YUV output
        if (this.isNative) {
            this.decoder.onOutput = this._onOutput;
        } else {
            this.decoder.onOutput = (yuvFrame) => {
                if (this.renderer) {
                    this.renderer.renderYUV420(
                        yuvFrame.yPlane,
                        yuvFrame.uPlane,
                        yuvFrame.vPlane,
                        yuvFrame.width,
                        yuvFrame.height
                    );
                }
                if (this._onOutput) {
                    this._onOutput(yuvFrame);
                }
            };
        }
        
        this.decoder.onError = this._onError;
        
        await this.decoder.configure(config);
    }
    
    set onOutput(callback) {
        this._onOutput = callback;
        if (this.decoder && this.isNative) {
            this.decoder.onOutput = callback;
        }
    }
    
    get onOutput() {
        return this._onOutput;
    }
    
    set onError(callback) {
        this._onError = callback;
        if (this.decoder) this.decoder.onError = callback;
    }
    
    get onError() {
        return this._onError;
    }
    
    decode(chunk) {
        if (!this.decoder) {
            console.warn('[H264Decoder] decode() called but this.decoder is null/undefined!');
            return;
        }
        return this.decoder.decode(chunk);
    }
    
    flush() {
        return this.decoder?.flush();
    }
    
    close() {
        this.decoder?.close();
        this.renderer?.destroy();
    }
    
    get state() {
        return this.decoder?.state || 'unconfigured';
    }
    
    get decodeQueueSize() {
        return this.decoder?.decodeQueueSize || 0;
    }
    
    get usingNative() {
        return this.isNative;
    }
}

// Export feature detection utilities
export {
    HAS_VIDEO_ENCODER,
    HAS_VIDEO_DECODER,
    hasMediaStreamTrackGenerator,
    hasWebGL2,
};

export default {
    H264Encoder,
    H264Decoder,
    NativeH264Encoder,
    NativeH264Decoder,
    WasmH264Encoder,
    WasmH264Decoder,
    isNativeH264EncoderSupported,
    isNativeH264DecoderSupported,
};
