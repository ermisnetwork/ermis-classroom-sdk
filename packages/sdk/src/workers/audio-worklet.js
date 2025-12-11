const proxyConsole = {
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  info: () => {},
  trace: () => {},
  group: () => {},
  groupEnd: () => {},
};

class JitterResistantProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Store audio samples in planar format - separate arrays for each channel
    this.audioBuffers = []; // Array of arrays, one per channel
    this.bufferSize = 2048; // Target buffer size in frames
    this.minBuffer = 2048; // Minimum buffer before playback starts
    this.maxBuffer = 8192; // Maximum buffer size to prevent memory issues
    this.isPlaying = false;
    this.fadeInSamples = 0;
    this.sampleRate = 48000; // Default sample rate, updated on first data packet
    this.numberOfChannels = 2; // Default channels, updated on first data packet
    this.fadeInLength = 480; // 10ms fade-in at 48kHz to prevent clicks
    this.adaptiveBufferSize = this.bufferSize;

    let counter = 0;
    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      const { type, data, sampleRate, numberOfChannels, port } = event.data;
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
            if (
              this.sampleRate !== workerSampleRate ||
              this.numberOfChannels !== workerChannels
            ) {
              this.sampleRate = workerSampleRate;
              this.numberOfChannels = workerChannels;
              this.fadeInLength = Math.round(workerSampleRate / 100);
              this.resizeBuffers(workerChannels);
              proxyConsole.log(
                `Processor configured from worker: ${workerSampleRate}Hz, ${workerChannels} channels.`
              );
            }

            this.addAudioData(receivedChannelDataBuffers);
          }
        };
        proxyConsole.log("Worker port connected to AudioWorklet");
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
    // Clear existing buffers
    this.audioBuffers = [];
    // Create a separate buffer for each channel
    for (let i = 0; i < numberOfChannels; i++) {
      this.audioBuffers.push([]);
    }
  }

  /**
   * Adds planar channel data directly to separate channel buffers.
   * @param {Array<Float32Array>} channelData - An array where each element is a Float32Array
   * representing a channel's audio samples.
   */
  addAudioData(channelData) {
    // Ensure there's data to process
    if (
      !channelData ||
      channelData.length === 0 ||
      channelData[0].length === 0
    ) {
      return;
    }

    const numSamples = channelData[0].length;
    const numChannels = channelData.length;

    // Ensure we have enough buffer arrays
    while (this.audioBuffers.length < numChannels) {
      this.audioBuffers.push([]);
    }

    // Add data directly to each channel buffer
    for (let ch = 0; ch < numChannels; ch++) {
      // Convert Float32Array to regular array and append
      const channelArray = Array.from(channelData[ch]);
      this.audioBuffers[ch].push(...channelArray);
    }

    // Trim buffers if they grow too large (check first channel as reference)
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
      this.fadeInSamples = 0; // Reset fade-in for smooth start
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
    this.fadeInSamples = 0;
    this.adaptiveBufferSize = this.bufferSize;
    proxyConsole.log("Audio processor reset.");
  }

  /**
   * Main processing loop called by the audio engine.
   * @param {Array<Array<Float32Array>>} inputs - Input audio data (not used in this processor)
   * @param {Array<Array<Float32Array>>} outputs - Output audio buffers to be filled
   * @param {Object} parameters - Audio parameters from the AudioWorkletGlobalScope
   * @returns {boolean} - Returns true to keep the processor alive.
   */
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannels = output.length;
    const outputLength = output[0].length; // Samples per channel for this block

    // Calculate and report buffer health (use first channel as reference)
    const bufferFrames = this.audioBuffers[0] ? this.audioBuffers[0].length : 0;
    const bufferMs = (bufferFrames / this.sampleRate) * 1000;
    this.port.postMessage({
      type: "bufferStatus",
      bufferMs: bufferMs,
      isPlaying: this.isPlaying,
      bufferSamples: bufferFrames,
    });

    // Check for buffer underrun
    if (!this.isPlaying || bufferFrames < outputLength) {
      if (this.isPlaying) {
        this.isPlaying = false;
        // Adaptively increase buffer size on underrun to be more resilient
        this.adaptiveBufferSize = Math.min(
          this.maxBuffer,
          this.adaptiveBufferSize * 1.5
        );
        this.port.postMessage({
          type: "underrun",
          newBufferSize: this.adaptiveBufferSize,
        });
      }
      // Output silence if there's not enough data
      for (let channel = 0; channel < outputChannels; channel++) {
        output[channel].fill(0);
      }
      return true; // Keep processor alive
    }

    // Copy data directly from planar buffers to output buffers
    for (let channel = 0; channel < outputChannels; channel++) {
      // If we have data for this channel, use it; otherwise output silence
      if (
        channel < this.audioBuffers.length &&
        this.audioBuffers[channel].length >= outputLength
      ) {
        for (let i = 0; i < outputLength; i++) {
          // Apply fade-in when playback starts or resumes to prevent clicks
          let fadeMultiplier = 1.0;
          if (this.fadeInSamples < this.fadeInLength) {
            fadeMultiplier = this.fadeInSamples / this.fadeInLength;
            if (channel === 0) {
              // Only increment once per frame
              this.fadeInSamples++;
            }
          }

          output[channel][i] = this.audioBuffers[channel][i] * fadeMultiplier;
        }
      } else {
        // Output silence for missing channels
        output[channel].fill(0);
      }
    }

    // Remove the processed samples from the beginning of each channel buffer
    for (let ch = 0; ch < this.audioBuffers.length; ch++) {
      this.audioBuffers[ch].splice(0, outputLength);
    }

    // Adaptively decrease the buffer size if it's consistently too full
    if (bufferFrames > this.adaptiveBufferSize * 2) {
      this.adaptiveBufferSize = Math.max(
        this.minBuffer,
        this.adaptiveBufferSize * 0.95
      );
    }

    return true;
  }
}

registerProcessor("jitter-resistant-processor", JitterResistantProcessor);
