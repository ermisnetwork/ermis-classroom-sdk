/**
 * TinyH264 WASM Decoder Wrapper
 * Wraps the tinyh264 decoder for use in the video codec polyfill
 */

import TinyH264Module from './TinyH264.js';
import TinyH264Decoder from './TinyH264Decoder.js';

/**
 * Simplified wrapper for TinyH264 decoder
 */
class TinyH264 {
    constructor() {
        this.decoder = null;
        this.module = null;
        this.ready = this._init();
        this.onPictureDecoded = null;
    }
    
    async _init() {
        this.module = await TinyH264Module();
        await this.module.ready;
        
        this.decoder = new TinyH264Decoder(this.module, (yuvData, width, height) => {
            if (this.onPictureDecoded) {
                // Split YUV420 planar data into Y, U, V planes
                const ySize = width * height;
                const uvSize = (width >> 1) * (height >> 1);
                
                const yPlane = yuvData.subarray(0, ySize);
                const uPlane = yuvData.subarray(ySize, ySize + uvSize);
                const vPlane = yuvData.subarray(ySize + uvSize, ySize + uvSize * 2);
                
                this.onPictureDecoded(yPlane, uPlane, vPlane, width, height);
            }
        });
        
        return this;
    }
    
    /**
     * Decode a NAL unit or Annex B stream
     * @param {Uint8Array|ArrayBuffer} nalUnit - The NAL unit(s) to decode
     */
    decode(nalUnit) {
        if (!this.decoder) {
            console.warn('TinyH264 decoder not ready');
            return;
        }
        
        if (nalUnit instanceof ArrayBuffer) {
            nalUnit = new Uint8Array(nalUnit);
        }
        
        // h264bsd may need multiple decode calls to process all NALs
        // Keep calling decode until no more data is consumed
        this.decoder.decode(nalUnit);
    }
    
    /**
     * Release decoder resources
     */
    release() {
        if (this.decoder) {
            this.decoder.release();
            this.decoder = null;
        }
    }
}

export default TinyH264;
export { TinyH264 };
