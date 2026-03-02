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
  }

  /**
   * Called per audio rendering quantum (128 frames by spec).
   * @param {Float32Array[][]} inputs - inputs[0] is the first input, each
   *   element is a channel array.
   */
  process(inputs, _outputs, _params) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Slice each channel so we can transfer to main thread without copy.
    const channelData = [];
    const transferable = [];
    for (let ch = 0; ch < input.length; ch++) {
      const buf = input[ch].slice(); // always 128 Float32 samples
      channelData.push(buf);
      transferable.push(buf.buffer);
    }

    this.port.postMessage({ channelData }, transferable);
    return true; // keep processor alive
  }
}

registerProcessor("aac-capture-processor", AACCaptureProcessor);
