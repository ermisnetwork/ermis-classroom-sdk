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
    // Store audio samples in planar format - separate arrays for each channel
    this.audioBuffers = []; // Array of arrays, one per channel
    this.bufferSize = 2048; // ~42ms at 48kHz — baseline target
    this.minBuffer = 2048; // Start playback after ~42ms of data
    this.maxBuffer = 14400; // ~300ms max — absorb network lag spikes
    this.isPlaying = false;
    this.sampleRate = 48000; // Default sample rate, updated on first data packet
    this.numberOfChannels = 2; // Default channels, updated on first data packet
    this.adaptiveBufferSize = this.bufferSize;

    // ── Underrun grace period ──
    // Allow up to GRACE_BLOCKS consecutive empty blocks before declaring underrun.
    // A single missing audio packet (~20ms) spans ~1 process() block at 128 samples;
    // 2-block grace absorbs it without stopping playback.
    this.GRACE_BLOCKS = 2;
    this.emptyBlockCount = 0;

    // ── Adaptive decay ──
    // After stable playback (no underruns for DECAY_INTERVAL blocks),
    // shrink adaptiveBufferSize 10% toward baseline to reduce latency.
    this.DECAY_INTERVAL = 1875; // ~5s at 128 samples/block, 48kHz
    this.blocksSinceUnderrun = 0;

    // ── Micro-crossfade: 1ms ──
    // Only activates on resume after real underrun (not during normal playback).
    // 1ms is below human temporal resolution for loudness (~10-20ms) so it's
    // completely inaudible, but prevents the click from silence→audio transition.
    this.MICRO_FADE_LEN = 48; // ~1ms at 48kHz
    this.microFadePos = -1;   // -1 = inactive
    this.useMicroFade = false; // Set false to disable all volume modification

    console.log('[Audio Worklet] AudioWorklet loaded');
    let counter = 0;
    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      const { type, data, sampleRate, numberOfChannels, port } = event.data;
      if (type === "connectWorker") {
        console.log('[Audio Worklet] connectWorker, workerPort:', port);
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
            // Send diagnostics back to main thread for first few frames
            if (counter <= 3) {
              const ch0 = receivedChannelDataBuffers ? receivedChannelDataBuffers[0] : null;
              this.port.postMessage({
                type: "workletDiag",
                frame: counter,
                hasData: !!receivedChannelDataBuffers,
                channels: receivedChannelDataBuffers ? receivedChannelDataBuffers.length : 0,
                ch0Length: ch0 ? ch0.length : 0,
                ch0ByteLen: ch0 && ch0.buffer ? ch0.buffer.byteLength : 0,
                bufferSize: this.audioBuffers[0] ? this.audioBuffers[0].length : 0,
              });
            }

            if (
              this.sampleRate !== workerSampleRate ||
              this.numberOfChannels !== workerChannels
            ) {
              this.sampleRate = workerSampleRate;
              this.numberOfChannels = workerChannels;
              this.MICRO_FADE_LEN = Math.round(workerSampleRate / 1000); // 1ms
              this.resizeBuffers(workerChannels);
            }

            this.addAudioData(receivedChannelDataBuffers);

            // Report after adding data (first few frames)
            if (counter <= 3) {
              this.port.postMessage({
                type: "workletDiag",
                frame: counter,
                phase: "afterAdd",
                bufferSize: this.audioBuffers[0] ? this.audioBuffers[0].length : 0,
                isPlaying: this.isPlaying,
              });
            }
          }
        };
        // Confirm port connection back to main thread
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

  /**
   * Resizes the buffer arrays to match the number of channels
   * @param {number} numberOfChannels - Number of audio channels
   */
  resizeBuffers(numberOfChannels) {
    this.audioBuffers = [];
    for (let i = 0; i < numberOfChannels; i++) {
      this.audioBuffers.push([]);
    }
  }

  /**
   * Adds planar channel data directly to separate channel buffers.
   */
  addAudioData(channelData) {
    if (
      !channelData ||
      channelData.length === 0 ||
      channelData[0].length === 0
    ) {
      return;
    }

    const numChannels = channelData.length;

    while (this.audioBuffers.length < numChannels) {
      this.audioBuffers.push([]);
    }

    for (let ch = 0; ch < numChannels; ch++) {
      const channelArray = Array.from(channelData[ch]);
      this.audioBuffers[ch].push(...channelArray);
    }

    // Trim buffers if they grow too large
    if (this.audioBuffers[0] && this.audioBuffers[0].length > this.maxBuffer) {
      const excess = this.audioBuffers[0].length - this.maxBuffer;
      for (let ch = 0; ch < this.audioBuffers.length; ch++) {
        this.audioBuffers[ch].splice(0, excess);
      }
    }

    // Start playback if the buffer has reached the adaptive threshold
    const currentBufferSize = this.audioBuffers[0]
      ? this.audioBuffers[0].length
      : 0;
    if (!this.isPlaying && currentBufferSize >= this.adaptiveBufferSize) {
      this.isPlaying = true;
      this.emptyBlockCount = 0;
      // Activate 1ms micro-crossfade to prevent click on resume
      this.microFadePos = 0;
      this.port.postMessage({ type: "playbackStarted" });
    }
  }

  /**
   * Resets the processor to its initial state.
   */
  reset() {
    for (let ch = 0; ch < this.audioBuffers.length; ch++) {
      this.audioBuffers[ch] = [];
    }
    this.isPlaying = false;
    this.emptyBlockCount = 0;
    this.blocksSinceUnderrun = 0;
    this.microFadePos = -1;
    this.adaptiveBufferSize = this.bufferSize;
    proxyConsole.log("Audio processor reset.");
  }

  /**
   * Main processing loop.
   * Samples are output at original level. Only a 1ms (~48 sample) micro-crossfade
   * is applied when resuming after a real underrun — inaudible to humans but
   * prevents the click artifact from a sudden silence→audio transition.
   */
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannels = output.length;
    const outputLength = output[0].length;

    const bufferFrames = this.audioBuffers[0] ? this.audioBuffers[0].length : 0;

    // ── Not yet playing: wait for buffer to fill ──
    if (!this.isPlaying) {
      for (let channel = 0; channel < outputChannels; channel++) {
        output[channel].fill(0);
      }
      return true;
    }

    // ── Buffer too low for this block ──
    if (bufferFrames < outputLength) {
      this.emptyBlockCount++;

      if (this.emptyBlockCount <= this.GRACE_BLOCKS) {
        // Grace period: output silence but DON'T stop playback
        for (let channel = 0; channel < outputChannels; channel++) {
          output[channel].fill(0);
        }
        return true;
      }

      // Real underrun: exceeded grace period → stop playback
      this.isPlaying = false;
      this.emptyBlockCount = 0;
      this.blocksSinceUnderrun = 0;
      this.adaptiveBufferSize = Math.min(
        Math.ceil(this.adaptiveBufferSize * 1.5),
        this.maxBuffer
      );
      this.port.postMessage({
        type: "underrun",
        newBufferSize: this.adaptiveBufferSize,
      });
      for (let channel = 0; channel < outputChannels; channel++) {
        output[channel].fill(0);
      }
      return true;
    }

    // ── We have data: reset grace counter ──
    this.emptyBlockCount = 0;
    this.blocksSinceUnderrun++;

    // ── Adaptive decay: shrink buffer threshold toward baseline when stable ──
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

    // ── Copy samples to output ──
    // During micro-crossfade (first 1ms after resume), apply a tiny ramp
    // to prevent click. After that, samples pass through unmodified.
    for (let channel = 0; channel < outputChannels; channel++) {
      if (
        channel < this.audioBuffers.length &&
        this.audioBuffers[channel].length >= outputLength
      ) {
        if (this.useMicroFade && this.microFadePos >= 0 && this.microFadePos < this.MICRO_FADE_LEN) {
          // Micro-crossfade active (1ms ramp — inaudible)
          for (let i = 0; i < outputLength; i++) {
            if (this.microFadePos < this.MICRO_FADE_LEN) {
              output[channel][i] = this.audioBuffers[channel][i] * (this.microFadePos / this.MICRO_FADE_LEN);
              if (channel === 0) this.microFadePos++;
            } else {
              output[channel][i] = this.audioBuffers[channel][i];
            }
          }
        } else {
          // Direct copy — zero modification
          for (let i = 0; i < outputLength; i++) {
            output[channel][i] = this.audioBuffers[channel][i];
          }
          if (this.microFadePos >= this.MICRO_FADE_LEN) this.microFadePos = -1;
        }
      } else {
        output[channel].fill(0);
      }
    }

    // Remove the processed samples
    for (let ch = 0; ch < this.audioBuffers.length; ch++) {
      this.audioBuffers[ch].splice(0, outputLength);
    }

    // Aggressively drain if buffer is too full to prevent latency buildup
    if (bufferFrames > this.maxBuffer) {
      const excess = bufferFrames - this.bufferSize;
      for (let ch = 0; ch < this.audioBuffers.length; ch++) {
        this.audioBuffers[ch].splice(0, excess);
      }
    }

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
