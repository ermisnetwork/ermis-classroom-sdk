/**
 * Audio Worklet — Lite version for iOS 15 and older Safari.
 *
 * Uses pre-allocated Float32Arrays with a read pointer instead of
 * JS array splice.  Every operation is O(1) per sample — no array
 * shifts, no GC pressure, no modulo-per-sample ring buffer math.
 *
 * Processor name is the same ("jitter-resistant-processor") so the
 * AudioMixer can use either worklet file transparently.
 */

class JitterResistantProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = 48000;
    this.numberOfChannels = 2;

    // ── Buffer config ──
    this.bufferSize = 6144;       // start-playback threshold
    this.minBuffer = 6144;
    this.maxBuffer = 19200;
    this.adaptiveBufferSize = this.bufferSize;

    // ── Pre-allocated planar buffers ──
    this._capacity = this.maxBuffer + 4096; // headroom
    this._bufs = [];        // Float32Array per channel
    this._writePos = 0;
    this._readPos = 0;

    this.isPlaying = false;
    this.fadeInSamples = 0;
    this.fadeInLength = 480; // 10ms at 48kHz

    this._initBuffers(this.numberOfChannels);

    let counter = 0;
    this.port.onmessage = (event) => {
      try {
        const { type, data, port } = event.data;
        if (type === "connectWorker") {
          this.workerPort = port;

          this.workerPort.onmessage = (workerEvent) => {
            try {
              const msg = workerEvent.data;
              if (!msg) return;

              if (msg.type === "audioData") {
                const channelData = msg.channelData;
                counter++;
                if (counter <= 3) {
                  this.port.postMessage({
                    type: "workletDiag",
                    frame: counter,
                    hasData: !!channelData,
                    channels: channelData ? channelData.length : 0,
                    buffered: this._count(),
                  });
                }

                if (msg.sampleRate && msg.numberOfChannels) {
                  if (
                    this.sampleRate !== msg.sampleRate ||
                    this.numberOfChannels !== msg.numberOfChannels
                  ) {
                    this.sampleRate = msg.sampleRate;
                    this.numberOfChannels = msg.numberOfChannels;
                    this.fadeInLength = Math.round(msg.sampleRate / 100);
                    this._initBuffers(msg.numberOfChannels);
                  }
                }

                this._addAudioData(channelData);
              }
            } catch (e) { /* swallow */ }
          };
          this.port.postMessage({ type: "workletDiag", event: "workerPortConnected" });
        } else if (type === "reset") {
          this._reset();
        } else if (type === "setBufferSize") {
          this.adaptiveBufferSize = Math.max(
            this.minBuffer,
            Math.min(this.maxBuffer, data)
          );
        }
      } catch (e) { /* swallow */ }
    };
  }

  /** Number of samples currently buffered */
  _count() {
    return this._writePos - this._readPos;
  }

  /** Allocate planar Float32Array buffers */
  _initBuffers(numChannels) {
    this._bufs = [];
    for (let i = 0; i < numChannels; i++) {
      this._bufs.push(new Float32Array(this._capacity));
    }
    this._writePos = 0;
    this._readPos = 0;
  }

  /**
   * Compact: shift data to front when readPos is high.
   * Uses copyWithin — single memcpy, no GC.
   */
  _compact() {
    if (this._readPos < this._capacity / 2) return; // not worth it yet
    const count = this._count();
    for (let ch = 0; ch < this._bufs.length; ch++) {
      this._bufs[ch].copyWithin(0, this._readPos, this._writePos);
    }
    this._readPos = 0;
    this._writePos = count;
  }

  /** Add decoded PCM data to buffers */
  _addAudioData(channelData) {
    try {
      if (!channelData || !channelData.length) return;
      const first = channelData[0];
      if (!first || !first.length) return;

      const numSamples = first.length;
      const numChannels = channelData.length;

      // Grow channel count if needed
      while (this._bufs.length < numChannels) {
        this._bufs.push(new Float32Array(this._capacity));
      }

      // Compact if running out of write space
      if (this._writePos + numSamples > this._capacity) {
        this._compact();
      }

      // Still no space after compact → drop oldest (re-fade)
      if (this._writePos + numSamples > this._capacity) {
        const need = (this._writePos + numSamples) - this._capacity;
        this._readPos += need;
        this.fadeInSamples = 0; // re-fade to smooth discontinuity
        this._compact();
      }

      // Copy incoming data
      const wp = this._writePos;
      for (let ch = 0; ch < numChannels; ch++) {
        const src = channelData[ch];
        if (!src) continue;
        this._bufs[ch].set(src, wp);
      }
      this._writePos += numSamples;

      // Trim if over maxBuffer
      const count = this._count();
      if (count > this.maxBuffer) {
        this._readPos += (count - this.maxBuffer);
        this.fadeInSamples = 0; // re-fade
      }

      // Start playback
      if (!this.isPlaying && this._count() >= this.adaptiveBufferSize) {
        this.isPlaying = true;
        this.fadeInSamples = 0;
        this.port.postMessage({ type: "playbackStarted" });
      }
    } catch (e) { /* swallow */ }
  }

  _reset() {
    this._readPos = 0;
    this._writePos = 0;
    this.isPlaying = false;
    this.fadeInSamples = 0;
    this.adaptiveBufferSize = this.bufferSize;
  }

  process(inputs, outputs, parameters) {
    try {
      const output = outputs[0];
      if (!output || !output.length || !output[0]) return true;

      const outputChannels = output.length;
      const outputLength = output[0].length;
      const buffered = this._count();

      // Not playing or underrun → silence
      if (!this.isPlaying || buffered < outputLength) {
        if (this.isPlaying && buffered < outputLength) {
          this.isPlaying = false;
          this.adaptiveBufferSize = Math.min(
            this.maxBuffer,
            Math.round(this.adaptiveBufferSize * 1.5)
          );
        }
        for (let ch = 0; ch < outputChannels; ch++) {
          output[ch].fill(0);
        }
        return true;
      }

      // Copy from pre-allocated buffers — O(1) read via pointer
      const rp = this._readPos;
      for (let ch = 0; ch < outputChannels; ch++) {
        const src = ch < this._bufs.length ? this._bufs[ch] : null;
        if (src) {
          for (let i = 0; i < outputLength; i++) {
            let s = src[rp + i];
            // Fade-in
            if (this.fadeInSamples < this.fadeInLength) {
              s *= (this.fadeInSamples / this.fadeInLength);
              if (ch === 0) this.fadeInSamples++;
            }
            // Hard clamp [-1, 1]
            if (s > 1.0) s = 1.0;
            else if (s < -1.0) s = -1.0;
            output[ch][i] = s;
          }
        } else {
          output[ch].fill(0);
        }
      }

      // Advance read pointer — O(1), no splice!
      this._readPos += outputLength;

      // Adaptive decay
      if (this._count() > this.adaptiveBufferSize * 2) {
        this.adaptiveBufferSize = Math.max(
          this.minBuffer,
          Math.round(this.adaptiveBufferSize * 0.95)
        );
      }

      return true;
    } catch (e) {
      try {
        const out = outputs[0];
        if (out) for (let ch = 0; ch < out.length; ch++) if (out[ch]) out[ch].fill(0);
      } catch (_) {}
      return true;
    }
  }
}

registerProcessor("jitter-resistant-processor", JitterResistantProcessor);

/**
 * AudioCaptureProcessor
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffers = [[], []];
  }

  process(inputs, outputs, parameters) {
    try {
      const input = inputs[0];
      if (!input || input.length === 0) return true;

      for (let ch = 0; ch < input.length; ch++) {
        const src = input[ch];
        if (!src) continue;
        if (!this.buffers[ch]) this.buffers[ch] = [];
        for (let i = 0; i < src.length; i++) {
          this.buffers[ch].push(src[i]);
        }
      }

      if (this.buffers[0] && this.buffers[0].length >= this.bufferSize) {
        this.flush();
      }
    } catch (e) {}
    return true;
  }

  flush() {
    try {
      const channelCount = this.buffers.length;
      const planarData = [];
      const bufferLength = this.buffers[0] ? this.buffers[0].length : 0;
      if (bufferLength === 0) return;

      for (let ch = 0; ch < channelCount; ch++) {
        if (!this.buffers[ch] || this.buffers[ch].length < bufferLength) {
          planarData.push(new Float32Array(bufferLength));
        } else {
          planarData.push(new Float32Array(this.buffers[ch]));
        }
        this.buffers[ch] = [];
      }

      this.port.postMessage({
        type: 'audioData',
        planarData: planarData
      }, planarData.map(b => b.buffer));
    } catch (e) {}
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
