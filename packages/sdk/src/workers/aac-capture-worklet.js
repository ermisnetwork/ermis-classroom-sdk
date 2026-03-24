/**
 * aac-capture-worklet.js
 *
 * AudioWorkletProcessor that captures raw PCM frames from the microphone
 * and forwards them to the AACEncoderManager via the node's MessagePort.
 *
 * Design goals:
 *  - Send Float32 planar data (one array per channel) every quantum (128 frames).
 *  - Zero-copy: slice() each channel buffer so the main thread owns it and we
 *    can transfer the buffers as Transferables for maximum performance.
 *  - The manager accumulates quanta until it has a full AAC frame (1024 samples)
 *    before calling the WASM/native encoder.
 */

class AACCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 1024;
    this.buffers = [];
    this.offset = 0;
  }

  process(inputs, _outputs, _params) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = input.length;
    const inputLen = input[0].length;

    if (this.buffers.length < numChannels) {
      for (let i = 0; i < numChannels; i++) {
        this.buffers.push(new Float32Array(this.frameSize));
      }
    }

    for (let ch = 0; ch < numChannels; ch++) {
      this.buffers[ch].set(input[ch], this.offset);
    }
    this.offset += inputLen;

    if (this.offset >= this.frameSize) {
      const channelData = [];
      const transferable = [];
      
      for (let ch = 0; ch < numChannels; ch++) {
        const buf = this.buffers[ch].slice(); 
        channelData.push(buf);
        transferable.push(buf.buffer);
      }
      
      this.port.postMessage({ channelData }, transferable);
      this.offset = 0;
    }

    return true; 
  }
}

registerProcessor("aac-capture-processor", AACCaptureProcessor);
