const proxyConsole = {
  log: (...args) => console.log('[AudioWorklet]', ...args),
  error: (...args) => console.error('[AudioWorklet]', ...args),
  warn: (...args) => console.warn('[AudioWorklet]', ...args),
  debug: (...args) => console.debug('[AudioWorklet]', ...args),
  info: (...args) => console.info('[AudioWorklet]', ...args),
  trace: () => {},
  group: () => {},
  groupEnd: () => {},
};

class JitterResistantProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; // ~85ms at 48kHz — larger buffer reduces crackling on Android
    this.minBuffer = 4096; // Start playback after ~85ms of data
    this.maxBuffer = 14400; // ~300ms max — absorb network lag spikes
    this.isPlaying = false;
    this.sampleRate = 48000;
    this.numberOfChannels = 2;
    this.adaptiveBufferSize = this.bufferSize;

    // ── Ring buffer per channel (Float32Array for O(1) ops) ──
    this._rings = [];      // Float32Array[] — one per channel
    this._ringCap = this.maxBuffer + 1024; // extra headroom
    this._writePos = 0;    // shared write cursor
    this._readPos = 0;     // shared read cursor
    this._count = 0;       // samples currently buffered

    // ── Underrun grace period ──
    this.GRACE_BLOCKS = 2;
    this.emptyBlockCount = 0;

    // ── Adaptive decay ──
    this.DECAY_INTERVAL = 1875; // ~5s at 128 samples/block, 48kHz
    this.blocksSinceUnderrun = 0;

    // ── Crossfade: always-on ──
    this.FADE_LEN = 64;
    this.fadeInRemaining = 0;

    // ── Resampling (Android 44.1kHz/48kHz fix) ──
    this._sourceSampleRate = 0;       // decoded audio rate (e.g. 48000)
    this._outputSampleRate = globalThis.sampleRate || 48000; // hardware rate
    this._resampleRatio = 1.0;        // source/output (>1 when 48k→44.1k)
    this._needsResample = false;
    this._resampleFrac = 0.0;         // fractional position accumulator

    let counter = 0;
    this.port.onmessage = (event) => {
      const { type, data, port } = event.data;
      if (type === "connectWorker") {
        this.workerPort = port;

        this.workerPort.onmessage = (workerEvent) => {
          const {
            type: workerType,
            channelData: receivedChannelDataBuffers,
            sampleRate: workerSampleRate,
            numberOfChannels: workerChannels,
          } = workerEvent.data;

          if (workerType === "audioData") {
            counter++;
            if (counter <= 3) {
              const ch0 = receivedChannelDataBuffers ? receivedChannelDataBuffers[0] : null;
              this.port.postMessage({
                type: "workletDiag",
                frame: counter,
                hasData: !!receivedChannelDataBuffers,
                channels: receivedChannelDataBuffers ? receivedChannelDataBuffers.length : 0,
                ch0Length: ch0 ? ch0.length : 0,
                ch0ByteLen: ch0 && ch0.buffer ? ch0.buffer.byteLength : 0,
                bufferSize: this._count,
              });
            }

            if (
              this.sampleRate !== workerSampleRate ||
              this.numberOfChannels !== workerChannels
            ) {
              this.sampleRate = workerSampleRate;
              this.numberOfChannels = workerChannels;
              this.FADE_LEN = Math.max(48, Math.round(workerSampleRate / 750));
              this._initRings(workerChannels);
            }

            // Detect sample rate mismatch for resampling (Android fix)
            if (this._sourceSampleRate !== workerSampleRate) {
              this._sourceSampleRate = workerSampleRate;
              this._outputSampleRate = globalThis.sampleRate || 48000;
              this._resampleRatio = this._sourceSampleRate / this._outputSampleRate;
              this._needsResample = Math.abs(this._resampleRatio - 1.0) > 0.001;
              this._resampleFrac = 0.0;
              if (this._needsResample) {
                proxyConsole.log(
                  `Resampling enabled: source=${this._sourceSampleRate}Hz → output=${this._outputSampleRate}Hz (ratio=${this._resampleRatio.toFixed(4)})`
                );
              }
            }

            this.addAudioData(receivedChannelDataBuffers);

            if (counter <= 3) {
              this.port.postMessage({
                type: "workletDiag",
                frame: counter,
                phase: "afterAdd",
                bufferSize: this._count,
                isPlaying: this.isPlaying,
              });
            }
          }
        };
        this.port.postMessage({ type: "workletDiag", event: "workerPortConnected" });
      } else if (type === "reset") {
        this.reset();
      } else if (type === "setBufferSize") {
        this.adaptiveBufferSize = Math.max(
          this.minBuffer,
          Math.min(this.maxBuffer, data)
        );
      }
    };
  }

  /** Initialize ring buffers for N channels */
  _initRings(numChannels) {
    this._rings = [];
    for (let i = 0; i < numChannels; i++) {
      this._rings.push(new Float32Array(this._ringCap));
    }
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0;
  }

  /**
   * Adds planar channel data to ring buffers — O(numSamples), no array shifts.
   */
  addAudioData(channelData) {
    if (!channelData || channelData.length === 0 || channelData[0].length === 0) {
      return;
    }

    const numSamples = channelData[0].length;
    const numChannels = channelData.length;

    // Lazy-init rings on first data
    if (this._rings.length < numChannels) {
      this._initRings(numChannels);
    }

    // How many samples we can accept
    const space = this._ringCap - this._count;
    const toWrite = Math.min(numSamples, space);

    for (let ch = 0; ch < numChannels; ch++) {
      const ring = this._rings[ch];
      const src = channelData[ch];
      let wp = this._writePos;
      for (let i = 0; i < toWrite; i++) {
        ring[wp] = src[i];
        wp = (wp + 1) % this._ringCap;
      }
    }
    this._writePos = (this._writePos + toWrite) % this._ringCap;
    this._count += toWrite;

    // Trim if over maxBuffer: crossfade to avoid clicks
    if (this._count > this.maxBuffer) {
      this._trimWithCrossfade();
    }

    // Start playback if buffer threshold reached
    if (!this.isPlaying && this._count >= this.adaptiveBufferSize) {
      this.isPlaying = true;
      this.emptyBlockCount = 0;
      this.fadeInRemaining = this.FADE_LEN;
      this.port.postMessage({ type: "playbackStarted" });
    }
  }

  reset() {
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0;
    this.isPlaying = false;
    this.emptyBlockCount = 0;
    this.blocksSinceUnderrun = 0;
    this.fadeInRemaining = 0;
    this.adaptiveBufferSize = this.bufferSize;
    proxyConsole.log("Audio processor reset.");
  }

  _trimWithCrossfade() {
    const excess = this._count - this.maxBuffer;
    if (excess <= 0) return;
    const fadeLen = Math.min(this.FADE_LEN, this.maxBuffer);
    const newReadPos = (this._readPos + excess) % this._ringCap;
    for (let ch = 0; ch < this._rings.length; ch++) {
      const ring = this._rings[ch];
      for (let i = 0; i < fadeLen; i++) {
        const fadeOut = 1.0 - (i / fadeLen);
        const fadeIn = i / fadeLen;
        const oldIdx = (this._readPos + i) % this._ringCap;
        const newIdx = (newReadPos + i) % this._ringCap;
        ring[newIdx] = ring[oldIdx] * fadeOut + ring[newIdx] * fadeIn;
      }
    }
    this._readPos = newReadPos;
    this._count = this.maxBuffer;
  }

  _applyFadeIn(output, outputChannels, outputLength) {
    if (this.fadeInRemaining <= 0) return;
    const fadeStart = this.FADE_LEN - this.fadeInRemaining;
    for (let ch = 0; ch < outputChannels; ch++) {
      for (let i = 0; i < outputLength && (fadeStart + i) < this.FADE_LEN; i++) {
        output[ch][i] *= (fadeStart + i) / this.FADE_LEN;
      }
    }
    this.fadeInRemaining = Math.max(0, this.fadeInRemaining - outputLength);
  }

  _applyFadeOut(output, outputChannels, sampleCount) {
    const fadeLen = Math.min(this.FADE_LEN, sampleCount);
    const fadeStart = sampleCount - fadeLen;
    for (let ch = 0; ch < outputChannels; ch++) {
      for (let i = 0; i < fadeLen; i++) {
        output[ch][fadeStart + i] *= 1.0 - (i / fadeLen);
      }
    }
  }

  _softClip(output, outputChannels, length) {
    const THRESHOLD = 0.85;
    const INV_THRESHOLD = 1.0 / THRESHOLD;
    for (let ch = 0; ch < outputChannels; ch++) {
      const buf = output[ch];
      for (let i = 0; i < length; i++) {
        const s = buf[i];
        if (s > THRESHOLD) {
          buf[i] = THRESHOLD + (1.0 - THRESHOLD) * Math.tanh((s - THRESHOLD) * INV_THRESHOLD);
        } else if (s < -THRESHOLD) {
          buf[i] = -THRESHOLD - (1.0 - THRESHOLD) * Math.tanh((-s - THRESHOLD) * INV_THRESHOLD);
        }
      }
    }
  }

  /**
   * Main processing loop — O(outputLength) per call, no array shifts.
   */
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannels = output.length;
    const outputLength = output[0].length;
    const bufferFrames = this._count;

    // ── Not yet playing ──
    if (!this.isPlaying) {
      for (let channel = 0; channel < outputChannels; channel++) {
        output[channel].fill(0);
      }
      return true;
    }

    // ── Buffer too low ──
    if (bufferFrames < outputLength) {
      this.emptyBlockCount++;
      if (this.emptyBlockCount <= this.GRACE_BLOCKS) {
        for (let channel = 0; channel < outputChannels; channel++) {
          output[channel].fill(0);
        }
        return true;
      }
      // Real underrun — output remaining with fade-out
      if (bufferFrames > 0) {
        for (let channel = 0; channel < outputChannels; channel++) {
          const ring = channel < this._rings.length ? this._rings[channel] : null;
          if (ring) {
            let rp = this._readPos;
            for (let i = 0; i < bufferFrames; i++) {
              output[channel][i] = ring[rp];
              rp = (rp + 1) % this._ringCap;
            }
            for (let i = bufferFrames; i < outputLength; i++) {
              output[channel][i] = 0;
            }
          } else {
            output[channel].fill(0);
          }
        }
        this._applyFadeOut(output, outputChannels, bufferFrames);
        this._readPos = (this._readPos + bufferFrames) % this._ringCap;
        this._count = 0;
      } else {
        for (let channel = 0; channel < outputChannels; channel++) {
          output[channel].fill(0);
        }
      }
      this.isPlaying = false;
      this.emptyBlockCount = 0;
      this.blocksSinceUnderrun = 0;
      this.adaptiveBufferSize = Math.min(
        Math.ceil(this.adaptiveBufferSize * 1.5),
        this.maxBuffer
      );
      this.port.postMessage({ type: "underrun", newBufferSize: this.adaptiveBufferSize });
      return true;
    }

    // ── Data available ──
    this.emptyBlockCount = 0;
    this.blocksSinceUnderrun++;

    // ── Adaptive decay ──
    if (
      this.blocksSinceUnderrun > 0 &&
      this.blocksSinceUnderrun % this.DECAY_INTERVAL === 0 &&
      this.adaptiveBufferSize > this.bufferSize
    ) {
      const prev = this.adaptiveBufferSize;
      this.adaptiveBufferSize = Math.max(
        this.bufferSize,
        Math.floor(this.adaptiveBufferSize * 0.9)
      );
      if (this.adaptiveBufferSize !== prev) {
        this.port.postMessage({
          type: "bufferDecay",
          newBufferSize: this.adaptiveBufferSize,
        });
      }
    }

    // ── Copy from ring buffer to output ──
    if (this._needsResample) {
      // ── Resampling path: linear interpolation ──
      // Read ceil(outputLength * ratio) source samples, interpolate to outputLength outputs.
      // This corrects pitch when hardware runs at different rate (e.g. 44.1kHz vs 48kHz source).
      const ratio = this._resampleRatio;
      let frac = this._resampleFrac;
      const sourceSamplesNeeded = Math.ceil(outputLength * ratio + 1);

      // Ensure we have enough source samples
      if (this._count < sourceSamplesNeeded) {
        // Not enough for resampled output — output silence, treat as underrun
        for (let channel = 0; channel < outputChannels; channel++) {
          output[channel].fill(0);
        }
        return true;
      }

      for (let channel = 0; channel < outputChannels; channel++) {
        const ring = channel < this._rings.length ? this._rings[channel] : null;
        if (ring) {
          let localFrac = (channel === 0) ? frac : this._resampleFrac;
          for (let i = 0; i < outputLength; i++) {
            const srcPos = Math.floor(localFrac);
            const t = localFrac - srcPos; // interpolation coefficient [0,1)
            const idx0 = (this._readPos + srcPos) % this._ringCap;
            const idx1 = (this._readPos + srcPos + 1) % this._ringCap;
            // Linear interpolation: sample = s0 + t * (s1 - s0)
            output[channel][i] = ring[idx0] + t * (ring[idx1] - ring[idx0]);
            localFrac += ratio;
          }
          if (channel === 0) frac = localFrac;
        } else {
          output[channel].fill(0);
        }
      }

      // Advance read pointer by actual source samples consumed
      const consumed = Math.floor(frac);
      this._readPos = (this._readPos + consumed) % this._ringCap;
      this._count -= consumed;
      this._resampleFrac = frac - consumed; // keep fractional remainder
      this._applyFadeIn(output, outputChannels, outputLength);
    } else {
      // ── Direct copy path (no resampling needed) — O(outputLength), no shifts ──
      for (let channel = 0; channel < outputChannels; channel++) {
        const ring = channel < this._rings.length ? this._rings[channel] : null;
        let rp = this._readPos;
        if (ring) {
          for (let i = 0; i < outputLength; i++) {
            output[channel][i] = ring[rp];
            rp = (rp + 1) % this._ringCap;
          }
        } else {
          output[channel].fill(0);
        }
      }
      this._readPos = (this._readPos + outputLength) % this._ringCap;
      this._count -= outputLength;
      this._applyFadeIn(output, outputChannels, outputLength);
    }

    // Trim if buffer too full — crossfade to avoid clicks
    if (this._count > this.maxBuffer) {
      this._trimWithCrossfade();
    }

    // Soft clip to prevent digital distortion
    this._softClip(output, outputChannels, outputLength);

    return true;
  }
}

registerProcessor("jitter-resistant-processor", JitterResistantProcessor);

/**
 * AudioCaptureProcessor - Captures audio chunks and sends them to main thread
 * Used for AAC encoding where we need raw PCM data
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; // Consistent with previous ScriptProcessor usage
    this.bufferCount = 0;
    // We'll capture planar data for stereo (2 channels)
    this.buffers = [[], []]; 
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numberOfChannels = input.length;

    // Process each channel
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputChannel = input[channel];
      
      // Ensure we have a buffer for this channel
      if (!this.buffers[channel]) {
        this.buffers[channel] = [];
      }

      // Add new samples to buffer - iterate manually for performance in worklet
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffers[channel].push(inputChannel[i]);
      }
    }

    // Check if we have enough data to send a chunk (using channel 0 as reference)
    if (this.buffers[0].length >= this.bufferSize) {
      this.flush();
    }

    return true; // Keep processor alive
  }

  flush() {
    const channelCount = this.buffers.length;
    const planarData = [];
    const bufferLength = this.buffers[0].length;

    // Convert accumulated samples to Float32Arrays for transport
    for (let channel = 0; channel < channelCount; channel++) {
      // If a channel is missing data (e.g. mono source going to stereo), pad with silent
      if (!this.buffers[channel] || this.buffers[channel].length < bufferLength) {
         planarData.push(new Float32Array(bufferLength));
      } else {
         planarData.push(new Float32Array(this.buffers[channel]));
      }
      // Reset buffer
      this.buffers[channel] = [];
    }

    // Send to main thread
    this.port.postMessage({
      type: 'audioData',
      planarData: planarData
    }, planarData.map(buffer => buffer.buffer)); // Transfer buffers for performance
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
