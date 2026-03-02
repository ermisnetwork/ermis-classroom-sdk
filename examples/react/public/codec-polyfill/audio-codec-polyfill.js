/**
 * Audio Codec Polyfill
 * Provides AAC encoding/decoding with native WebCodecs or WASM fallback
 * 
 * Uses:
 * - Encoder: FDK-AAC compiled to WASM (./fdk-aac/fdk-aac-encoder.js)
 * - Decoder: FAAD2 compiled to WASM (./faad2/faad2-decoder.js)
 */

// Import WASM encoder/decoder wrappers
import { FdkAacEncoder } from './fdk-aac/fdk-aac-encoder.js';
import { Faad2Decoder } from './faad2/faad2-decoder.js';

// Feature detection
const HAS_AUDIO_ENCODER = typeof AudioEncoder !== 'undefined';
const HAS_AUDIO_DECODER = typeof AudioDecoder !== 'undefined';

let aacEncoderSupported = null;
let aacDecoderSupported = null;

/**
 * Check if native AAC encoding is supported
 */
export async function isNativeAACEncoderSupported() {
    if (aacEncoderSupported !== null) return aacEncoderSupported;
    
    if (!HAS_AUDIO_ENCODER) {
        aacEncoderSupported = false;
        return false;
    }
    
    try {
        const support = await AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2', // AAC-LC
            sampleRate: 48000,
            numberOfChannels: 2,
            bitrate: 128000,
        });
        aacEncoderSupported = support.supported;
    } catch (e) {
        aacEncoderSupported = false;
    }
    
    return aacEncoderSupported;
}

/**
 * Check if native AAC decoding is supported
 */
export async function isNativeAACDecoderSupported() {
    if (aacDecoderSupported !== null) return aacDecoderSupported;
    
    if (!HAS_AUDIO_DECODER) {
        aacDecoderSupported = false;
        return false;
    }
    
    try {
        const support = await AudioDecoder.isConfigSupported({
            codec: 'mp4a.40.2',
            sampleRate: 48000,
            numberOfChannels: 2,
        });
        aacDecoderSupported = support.supported;
    } catch (e) {
        aacDecoderSupported = false;
    }
    
    return aacDecoderSupported;
}

/**
 * Native AAC Encoder using WebCodecs AudioEncoder
 */
export class NativeAACEncoder {
    constructor(config = {}) {
        this.config = config;
        this.encoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        
        const encoderConfig = {
            codec: 'mp4a.40.2', // AAC-LC
            sampleRate: this.config.sampleRate || 48000,
            numberOfChannels: this.config.numberOfChannels || 2,
            bitrate: this.config.bitrate || 128000,
        };
        
        this.encoder = new AudioEncoder({
            output: (chunk, metadata) => {
                if (this.onOutput) {
                    this.onOutput(chunk, metadata);
                }
            },
            error: (e) => {
                console.error('NativeAACEncoder error:', e);
                if (this.onError) {
                    this.onError(e);
                }
            },
        });
        
        await this.encoder.configure(encoderConfig);
        this.configured = true;
        console.log('[AudioCodec] Using native AAC encoder');
    }
    
    /**
     * Encode audio data
     * @param {AudioData} audioData - The audio data to encode
     */
    encode(audioData) {
        if (!this.configured || this.encoder.state !== 'configured') {
            console.warn('Audio encoder not configured');
            return;
        }
        
        this.encoder.encode(audioData);
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
 * Native AAC Decoder using WebCodecs AudioDecoder
 */
export class NativeAACDecoder {
    constructor() {
        this.decoder = null;
        this.onOutput = null;
        this.onError = null;
        this.configured = false;
    }
    
    async configure(config) {
        const decoderConfig = {
            codec: config.codec || 'mp4a.40.2',
            sampleRate: config.sampleRate || 48000,
            numberOfChannels: config.numberOfChannels || 2,
        };
        
        // Add description (AudioSpecificConfig) if provided.
        // CRITICAL: Chrome's native AudioDecoder.configure() requires description
        // as an ArrayBuffer containing raw AudioSpecificConfig (ASC), NOT an
        // MPEG-4 ES Descriptor wrapper.  Some sources (e.g. native AudioEncoder
        // decoderConfig, or server-side repackaging) deliver the ASC inside a
        // full ES_Descriptor (tag 0x03).  Detect and unwrap automatically.
        if (config.description) {
            let descBuf; // ArrayBuffer
            const desc = config.description;
            if (desc instanceof ArrayBuffer) {
                descBuf = desc;
            } else if (desc instanceof Uint8Array) {
                descBuf = desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength);
            } else if (ArrayBuffer.isView(desc)) {
                descBuf = desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength);
            } else {
                descBuf = desc;
            }

            // ── Unwrap ES Descriptor if present ──────────────────────────
            // ES_Descriptor starts with tag 0x03.  Inside it, tag 0x04 is
            // DecoderConfigDescriptor, and inside that, tag 0x05 is
            // DecoderSpecificInfo whose payload is the raw ASC.
            const descBytes = new Uint8Array(descBuf);
            if (descBytes.length > 2 && descBytes[0] === 0x03) {
                const asc = this._extractASCFromEsds(descBytes);
                if (asc) {
                    console.log('[NativeAACDecoder] Unwrapped ES Descriptor → raw ASC:',
                        Array.from(asc).map(b => b.toString(16).padStart(2, '0')).join(' '),
                        'length:', asc.length);
                    descBuf = asc.buffer.slice(asc.byteOffset, asc.byteOffset + asc.byteLength);
                } else {
                    console.warn('[NativeAACDecoder] ES Descriptor detected but failed to extract ASC, using as-is');
                }
            }

            decoderConfig.description = descBuf;
            console.log(
                '[NativeAACDecoder] ASC description:',
                Array.from(new Uint8Array(decoderConfig.description))
                    .map(b => b.toString(16).padStart(2, '0')).join(' '),
                'length:', decoderConfig.description.byteLength,
            );
        }
        
        this.decoder = new AudioDecoder({
            output: (audioData) => {
                if (this.onOutput) {
                    this.onOutput(audioData);
                }
            },
            error: (e) => {
                console.error('[NativeAACDecoder] Decoder error callback:', e);
                if (this.onError) {
                    this.onError(e);
                }
            },
        });
        
        await this.decoder.configure(decoderConfig);
        
        // Verify configure succeeded — some implementations fail silently
        if (this.decoder.state !== 'configured') {
            const errMsg = `[NativeAACDecoder] configure() failed — state is '${this.decoder.state}' instead of 'configured'`;
            console.error(errMsg);
            throw new Error(errMsg);
        }
        
        this.configured = true;
        console.log('[AudioCodec] Using native AAC decoder, state:', this.decoder.state,
            'config:', decoderConfig.codec, decoderConfig.sampleRate + 'Hz',
            decoderConfig.numberOfChannels + 'ch');
    }
    
    /**
     * Decode an encoded audio chunk
     * @param {EncodedAudioChunk|Object} chunk - The chunk to decode
     */
    decode(chunk) {
        if (!this.configured || this.decoder.state !== 'configured') {
            console.warn('[NativeAACDecoder] decoder not ready, configured:', this.configured,
                'state:', this.decoder?.state);
            return;
        }
        
        // Convert plain object to EncodedAudioChunk if needed
        if (!(chunk instanceof EncodedAudioChunk)) {
            // Ensure data is an ArrayBuffer or typed array for EncodedAudioChunk
            let chunkData = chunk.data;
            if (chunkData instanceof Uint8Array && chunkData.byteOffset !== 0) {
                // Slice to get an isolated copy if it's a view into a shared buffer
                chunkData = chunkData.slice();
            }
            chunk = new EncodedAudioChunk({
                type: chunk.type || 'key',
                timestamp: chunk.timestamp,
                data: chunkData,
            });
        }
        
        try {
            this.decoder.decode(chunk);
        } catch (e) {
            console.error('[NativeAACDecoder] decode() threw:', e,
                'chunk byteLength:', chunk.byteLength,
                'timestamp:', chunk.timestamp,
                'decoder state:', this.decoder.state);
        }
    }
    
    async flush() {
        if (this.decoder && this.decoder.state === 'configured') {
            await this.decoder.flush();
        }
    }

    /**
     * Extract raw AudioSpecificConfig from an MPEG-4 ES Descriptor (esds).
     * Layout: tag 0x03 (ES_Descriptor)
     *           → tag 0x04 (DecoderConfigDescriptor)
     *             → tag 0x05 (DecoderSpecificInfo) = raw ASC bytes
     * @param {Uint8Array} data - Full ES Descriptor bytes
     * @returns {Uint8Array|null} Raw ASC, or null on parse failure
     */
    _extractASCFromEsds(data) {
        let i = 0;
        const readTag = () => {
            if (i >= data.length) return null;
            const tag = data[i++];
            // Length uses variable-length encoding: 0x80 bytes extend, last byte < 0x80
            let len = 0;
            for (let j = 0; j < 4 && i < data.length; j++) {
                const b = data[i++];
                len = (len << 7) | (b & 0x7F);
                if ((b & 0x80) === 0) break;
            }
            return { tag, len };
        };

        // Tag 0x03: ES_Descriptor
        const esDesc = readTag();
        if (!esDesc || esDesc.tag !== 0x03) return null;
        i += 3; // skip ES_ID (2) + flags (1)

        // Tag 0x04: DecoderConfigDescriptor
        const dcDesc = readTag();
        if (!dcDesc || dcDesc.tag !== 0x04) return null;
        i += 13; // skip objectTypeIndication(1) + streamType(1) + bufferSizeDB(3) + maxBitrate(4) + avgBitrate(4)

        // Tag 0x05: DecoderSpecificInfo → this IS the raw ASC
        const dsi = readTag();
        if (!dsi || dsi.tag !== 0x05) return null;
        if (i + dsi.len > data.length) return null;

        return data.slice(i, i + dsi.len);
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
 * WASM AAC Encoder using FDK-AAC
 * Wraps the FdkAacEncoder to provide a WebCodecs-like interface
 */
export class WasmAACEncoder {
    constructor(config = {}) {
        this.config = config;
        this.configured = false;
        this.fdkEncoder = null;
        this.onOutput = null;
        this.onError = null;
        this.sampleRate = 48000;
        this.numberOfChannels = 2;
        this.timestampCounter = 0;
        this.decoderConfigSent = false;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        this.sampleRate = this.config.sampleRate || 48000;
        this.numberOfChannels = this.config.numberOfChannels || 2;
        const bitrate = this.config.bitrate || 128000;
        
        try {
            this.fdkEncoder = new FdkAacEncoder();
            await this.fdkEncoder.init({
                sampleRate: this.sampleRate,
                channels: this.numberOfChannels,
                bitrate: bitrate,
            });
            
            this.configured = true;
            console.log('[AudioCodec] Using WASM AAC encoder (FDK-AAC)');
        } catch (e) {
            console.error('[WasmAACEncoder] Failed to initialize:', e);
            if (this.onError) {
                this.onError(e);
            }
            throw e;
        }
    }
    
    /**
     * Encode audio data
     * @param {AudioData} audioData - The audio data to encode
     */
    encode(audioData) {
        if (!this.configured || !this.fdkEncoder) {
            console.warn('WASM Audio encoder not configured');
            return;
        }
        
        try {
            // Extract PCM data from AudioData
            const numFrames = audioData.numberOfFrames;
            const inputChannels = audioData.numberOfChannels;
            const encoderChannels = this.numberOfChannels;
            
            // Get planar data and interleave to match encoder's channel config
            const interleaved = new Float32Array(numFrames * encoderChannels);
            
            for (let ch = 0; ch < encoderChannels; ch++) {
                const channelData = new Float32Array(numFrames);
                // If input has fewer channels, duplicate the last channel
                const srcChannel = Math.min(ch, inputChannels - 1);
                audioData.copyTo(channelData, { planeIndex: srcChannel, format: 'f32-planar' });
                for (let i = 0; i < numFrames; i++) {
                    interleaved[i * encoderChannels + ch] = channelData[i];
                }
            }
            
            // Encode - may need multiple calls to produce output
            // The encoder accumulates samples until it has a full frame
            let offset = 0;
            const frameSize = this.fdkEncoder.getFrameLength() * encoderChannels;
            
            while (offset < interleaved.length) {
                // Use slice() instead of subarray() — iOS Safari's WASM runtime
                // rejects TypedArray views with non-zero byteOffset when passed
                // into WASM memory. slice() creates a fresh ArrayBuffer at byteOffset=0.
                const remaining = interleaved.slice(offset);
                const encodedData = this.fdkEncoder.encode(remaining);
                
                // Move offset by the amount consumed
                offset += Math.min(frameSize, remaining.length);
                
                if (encodedData && encodedData.length > 0 && this.onOutput) {
                    // Create a fake EncodedAudioChunk-like object
                    const chunk = {
                        type: 'key',
                        timestamp: this.timestampCounter,
                        duration: (this.fdkEncoder.getFrameLength() / this.sampleRate) * 1_000_000,
                        byteLength: encodedData.length,
                        data: encodedData,
                        copyTo: (dest) => {
                            if (dest instanceof ArrayBuffer) {
                                new Uint8Array(dest).set(encodedData);
                            } else {
                                dest.set(encodedData);
                            }
                        }
                    };
                    
                    // Send decoder config on first output
                    const metadata = {};
                    if (!this.decoderConfigSent) {
                        const asc = this.fdkEncoder.getAudioSpecificConfig();
                        metadata.decoderConfig = {
                            codec: 'mp4a.40.2',
                            sampleRate: this.sampleRate,
                            numberOfChannels: this.numberOfChannels,
                            description: asc,
                        };
                        this.decoderConfigSent = true;
                    }
                    
                    this.timestampCounter += chunk.duration;
                    this.onOutput(chunk, metadata);
                }
            }
        } catch (e) {
            console.error('[WasmAACEncoder] Encode error:', e);
            if (this.onError) {
                this.onError(e);
            }
        }
    }
    
    async flush() {
        if (!this.fdkEncoder) return;
        
        try {
            const encodedData = this.fdkEncoder.flush();
            if (encodedData && encodedData.length > 0 && this.onOutput) {
                const chunk = {
                    type: 'key',
                    timestamp: this.timestampCounter,
                    byteLength: encodedData.length,
                    data: encodedData,
                    copyTo: (dest) => {
                        if (dest instanceof ArrayBuffer) {
                            new Uint8Array(dest).set(encodedData);
                        } else {
                            dest.set(encodedData);
                        }
                    }
                };
                this.onOutput(chunk, {});
            }
        } catch (e) {
            console.error('[WasmAACEncoder] Flush error:', e);
        }
    }
    
    close() {
        if (this.fdkEncoder) {
            this.fdkEncoder.close();
            this.fdkEncoder = null;
        }
        this.configured = false;
        this.decoderConfigSent = false;
    }
    
    get state() {
        return this.configured ? 'configured' : 'closed';
    }
    
    get encodeQueueSize() {
        return 0; // WASM encoder is synchronous
    }
}

/**
 * WASM AAC Decoder using FAAD2
 * Wraps the Faad2Decoder to provide a WebCodecs-like interface
 */
export class WasmAACDecoder {
    constructor() {
        this.configured = false;
        this.faadDecoder = null;
        this.onOutput = null;
        this.onError = null;
        this.sampleRate = 48000;
        this.numberOfChannels = 2;
    }
    
    async configure(config) {
        this.sampleRate = config.sampleRate || 48000;
        this.numberOfChannels = config.numberOfChannels || 2;
        
        // Need AudioSpecificConfig (description) to initialize
        if (!config.description) {
            throw new Error('WasmAACDecoder requires description (AudioSpecificConfig) in config');
        }
        
        try {
            this.faadDecoder = new Faad2Decoder();
            
            // Convert description to Uint8Array if needed
            let asc;
            if (config.description instanceof Uint8Array) {
                asc = config.description;
            } else if (config.description instanceof ArrayBuffer) {
                asc = new Uint8Array(config.description);
            } else {
                asc = new Uint8Array(config.description);
            }
            
            await this.faadDecoder.init(asc);
            
            // Update sample rate and channels from decoder
            this.sampleRate = this.faadDecoder.getSampleRate() || this.sampleRate;
            this.numberOfChannels = this.faadDecoder.getChannels() || this.numberOfChannels;
            
            this.configured = true;
            console.log('[AudioCodec] Using WASM AAC decoder (FAAD2)');
        } catch (e) {
            console.error('[WasmAACDecoder] Failed to initialize:', e);
            if (this.onError) {
                this.onError(e);
            }
            throw e;
        }
    }
    
    /**
     * Decode an encoded audio chunk
     * @param {EncodedAudioChunk|Object} chunk - The chunk to decode
     */
    decode(chunk) {
        if (!this.configured || !this.faadDecoder) {
            console.warn('WASM Audio decoder not configured');
            return;
        }
        
        try {
            // Get the encoded data
            let data;
            if (chunk.data instanceof Uint8Array) {
                data = chunk.data;
            } else if (typeof chunk.copyTo === 'function') {
                data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
            } else {
                data = new Uint8Array(chunk.data);
            }
            
            // Decode
            const pcmData = this.faadDecoder.decode(data);
            
            if (pcmData && pcmData.length > 0 && this.onOutput) {
                // Create AudioData-like object
                const numChannels = this.faadDecoder.getChannels();
                const sampleRate = this.faadDecoder.getSampleRate();
                const numFrames = pcmData.length / numChannels;
                
                // Convert interleaved to planar for AudioData compatibility
                const planarData = new Float32Array(pcmData.length);
                for (let ch = 0; ch < numChannels; ch++) {
                    for (let i = 0; i < numFrames; i++) {
                        planarData[ch * numFrames + i] = pcmData[i * numChannels + ch];
                    }
                }
                
                // Try to create a real AudioData if available
                if (typeof AudioData !== 'undefined') {
                    try {
                        const audioData = new AudioData({
                            format: 'f32-planar',
                            sampleRate: sampleRate,
                            numberOfFrames: numFrames,
                            numberOfChannels: numChannels,
                            timestamp: chunk.timestamp || 0,
                            data: planarData,
                        });
                        this.onOutput(audioData);
                    } catch (e) {
                        // Fallback to plain object
                        this.onOutput({
                            format: 'f32-planar',
                            sampleRate: sampleRate,
                            numberOfFrames: numFrames,
                            numberOfChannels: numChannels,
                            timestamp: chunk.timestamp || 0,
                            data: planarData,
                            copyTo: (dest, options = {}) => {
                                const ch = options.planeIndex || 0;
                                const offset = ch * numFrames;
                                dest.set(planarData.subarray(offset, offset + numFrames));
                            },
                            close: () => {}
                        });
                    }
                } else {
                    // No AudioData available, use plain object
                    this.onOutput({
                        format: 'f32-planar',
                        sampleRate: sampleRate,
                        numberOfFrames: numFrames,
                        numberOfChannels: numChannels,
                        timestamp: chunk.timestamp || 0,
                        data: planarData,
                        copyTo: (dest, options = {}) => {
                            const ch = options.planeIndex || 0;
                            const offset = ch * numFrames;
                            dest.set(planarData.subarray(offset, offset + numFrames));
                        },
                        close: () => {}
                    });
                }
            }
        } catch (e) {
            console.error('[WasmAACDecoder] Decode error:', e);
            if (this.onError) {
                this.onError(e);
            }
        }
    }
    
    async flush() {
        // FAAD2 doesn't have a flush operation
    }
    
    close() {
        if (this.faadDecoder) {
            this.faadDecoder.close();
            this.faadDecoder = null;
        }
        this.configured = false;
    }
    
    get state() {
        return this.configured ? 'configured' : 'closed';
    }
    
    get decodeQueueSize() {
        return 0; // WASM decoder is synchronous
    }
}

/**
 * Auto-selecting AAC Encoder
 * Uses native WebCodecs if available, falls back to WASM
 */
export class AACEncoder {
    constructor(config = {}) {
        this.config = config;
        this.encoder = null;
        this.isNative = false;
    }
    
    async configure(config) {
        this.config = { ...this.config, ...config };
        
        const nativeSupported = await isNativeAACEncoderSupported();
        
        if (nativeSupported && !this.config.forceWasm) {
            this.encoder = new NativeAACEncoder(this.config);
            this.isNative = true;
        } else {
            this.encoder = new WasmAACEncoder(this.config);
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
    
    encode(audioData) {
        return this.encoder?.encode(audioData);
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
 * Auto-selecting AAC Decoder
 * Uses native WebCodecs if available, falls back to WASM
 */
export class AACDecoder {
    constructor(config = {}) {
        this.config = config;
        this.decoder = null;
        this.isNative = false;
        this.audioContext = null;
    }
    
    async configure(config) {
        config = { ...this.config, ...config };
        const nativeSupported = await isNativeAACDecoderSupported();
        
        if (nativeSupported && !config.forceWasm) {
            this.decoder = new NativeAACDecoder();
            this.isNative = true;
        } else {
            this.decoder = new WasmAACDecoder();
            this.isNative = false;
        }
        
        // Forward callbacks
        this.decoder.onOutput = this._onOutput;
        this.decoder.onError = this._onError;
        
        await this.decoder.configure(config);
    }
    
    set onOutput(callback) {
        this._onOutput = callback;
        if (this.decoder) this.decoder.onOutput = callback;
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
        return this.decoder?.decode(chunk);
    }
    
    flush() {
        return this.decoder?.flush();
    }
    
    close() {
        this.decoder?.close();
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
    HAS_AUDIO_ENCODER,
    HAS_AUDIO_DECODER,
};

export default {
    AACEncoder,
    AACDecoder,
    NativeAACEncoder,
    NativeAACDecoder,
    WasmAACEncoder,
    WasmAACDecoder,
    isNativeAACEncoderSupported,
    isNativeAACDecoderSupported,
};
