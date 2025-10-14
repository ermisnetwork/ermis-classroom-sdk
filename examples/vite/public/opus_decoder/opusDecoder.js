let recorderScriptLoaded = false;
let recorderScriptLoading = false;
let recorderScriptLoadPromise = null;
let configNumberOfChannels = 1; // Default to stereo

console.log(
  "[Opus Decoder] Initializing OpusAudioDecoder module, version 1.0.0"
);

/**
 * Ensures the Recorder.js script is loaded
 * @returns {Promise} - Resolves when the Recorder.js script is loaded
 */
export async function ensureRecorderScriptLoaded() {
  if (recorderScriptLoaded) {
    return Promise.resolve();
  }

  if (recorderScriptLoading && recorderScriptLoadPromise) {
    return recorderScriptLoadPromise;
  }

  recorderScriptLoading = true;
  recorderScriptLoadPromise = new Promise((resolve, reject) => {
    if (typeof window.Recorder !== "undefined") {
      recorderScriptLoaded = true;
      recorderScriptLoading = false;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `/opus_decoder/recorder.min.js?t=${Date.now()}`;

    script.onload = () => {
      recorderScriptLoaded = true;
      recorderScriptLoading = false;
      console.log("Recorder.js loaded successfully");
      resolve();
    };

    script.onerror = (err) => {
      recorderScriptLoading = false;
      console.error("Failed to load Recorder.js:", err);
      reject(
        new Error(
          "Failed to load Recorder.js. Please ensure the file exists at /opus_decoder/recorder.min.js"
        )
      );
    };

    document.head.appendChild(script);
  });

  return recorderScriptLoadPromise;
}

export async function initAudioRecorder(audioStream, options = {}) {
  try {
    await ensureRecorderScriptLoaded();
  } catch (err) {
    console.error("Error loading Recorder.js:", err);
    throw err;
  }

  const defaultOptions = {
    monitorGain: 0,
    recordingGain: 1,
    numberOfChannels: configNumberOfChannels,
    // numberOfChannels: 2,
    encoderSampleRate: 48000,
    encoderBitRate: 32000,
    encoderApplication: 2051, // 2048=Voice, 2049=Audio, 2051=Low Delay
    encoderComplexity: 0,
    encoderFrameSize: 20,
    timeSlice: 100, // ms
    streamPages: true,
    maxFramesPerPage: 1,
  };

  const finalOptions = { ...defaultOptions, ...options };

  if (typeof Recorder === "undefined") {
    throw new Error("Recorder.js not loaded! ");
  }

  if (!Recorder.isRecordingSupported()) {
    throw new Error("Browser does not support recording");
  }

  try {
    // const audioStream = new MediaStream([source]);
    console.log("Using provided MediaStreamTrack");

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext({
      sampleRate: finalOptions.encoderSampleRate,
    });

    const sourceNode = context.createMediaStreamSource(audioStream);

    const recorderOptions = {
      monitorGain: finalOptions.monitorGain,
      recordingGain: finalOptions.recordingGain,
      numberOfChannels: finalOptions.numberOfChannels,
      encoderSampleRate: finalOptions.encoderSampleRate,
      encoderPath: `/opus_decoder/encoderWorker.min.js?t=${Date.now()}`,
      sourceNode: sourceNode,
      streamPages: finalOptions.streamPages,
      encoderFrameSize: finalOptions.encoderFrameSize,
      encoderBitRate: finalOptions.encoderBitRate,
      encoderApplication: finalOptions.encoderApplication,
      encoderComplexity: finalOptions.encoderComplexity,
      maxFramesPerPage: finalOptions.maxFramesPerPage,
    };
    console.log("Recorder options:", recorderOptions);

    const recorder = new Recorder(recorderOptions);

    recorder.onstart = () => console.log("Recorder started");
    recorder.onstop = () => console.log("Recorder stopped");
    recorder.onpause = () => console.log("Recorder paused");
    recorder.onresume = () => console.log("Recorder resumed");

    return recorder;
  } catch (err) {
    console.error("Error initializing recorder:", err);
    throw err;
  }
}

function log(message, ...args) {
  if (args.length === 0) {
    console.log(`[Opus Decoder] ${message}`);
  } else {
    console.log(`[Opus Decoder] ${message}`, ...args);
  }
}

class OpusAudioDecoder {
  /**
   * @param {Object} init - Initialization options
   * @param {Function} init.output - Callback function to receive decoded audio data
   * @param {Function} init.error - Error callback function (optional)
   */
  constructor(init) {
    this.output = init.output;
    this.error = init.error || console.error;
    this.state = "unconfigured";
    this.frameCounter = 0;
    this.decoderWorker = null;

    // Timing parameters
    this.sampleRate = 48000;
    this.numberOfChannels = configNumberOfChannels;
    this.counter = 0;

    // Timestamp management - consistent with AAC decoder
    this.baseTimestamp = 0;
    this.isSetBaseTimestamp = false;
    this.lastAudioTimestamp = 0;
    this.lastDuration = 0;
    this.audioStartTimestamp = 0;
  }

  /**
   * Configure the decoder
   * @param {Object} config - Configuration options
   * @param {number} config.sampleRate - Sample rate for output (optional)
   * @param {number} config.numberOfChannels - Number of channels (optional)
   * @returns {boolean} - True if successfully configured
   */
  async configure(config = {}) {
    try {
      // await ensureRecorderScriptLoaded();
      // Update configuration
      if (config.sampleRate) {
        this.sampleRate = config.sampleRate;
      }

      if (config.numberOfChannels) {
        this.numberOfChannels = config.numberOfChannels;
      }

      // Initialize decoder worker
      const workerUrl = `../opus_decoder/decoderWorker.min.js?t=${Date.now()}`;
      this.decoderWorker = new Worker(workerUrl);

      this.decoderWorker.onmessage = (e) => {
        if (e.data === null) {
          // Chunk processed
          return;
        } else if (e.data && e.data.length) {
          this._handleDecodedAudio(e.data);
        }
      };

      this.decoderWorker.onerror = (e) => {
        this.error(`Decoder worker error: ${e.message}`);
      };

      // Initialize decoder
      this.decoderWorker.postMessage({
        command: "init",
        decoderSampleRate: this.sampleRate,
        outputBufferSampleRate: this.sampleRate,
        numberOfChannels: this.numberOfChannels,
      });

      this.state = "configured";
      this.baseTimestamp = 0;
      this.isSetBaseTimestamp = false;
      this.lastDuration = 0;
      log("Opus decoder initialized and configured");
      return true;
    } catch (err) {
      this.error(`Error initializing decoder: ${err.message}`);
      this.state = "unconfigured";
      return false;
    }
  }

  /**
   * Decode an Opus audio chunk
   * @param {Object} chunk - Audio chunk to decode
   * @param {ArrayBuffer} chunk.data - Opus encoded audio data
   * @param {number} chunk.timestamp - Timestamp in microseconds
   * @param {number} chunk.duration - Duration in microseconds (optional)
   */
  decode(chunk) {
    // this.counter++;
    if (this.state !== "configured") {
      log("Decoder not configured, cannot decode chunk");
      this.error("Decoder not configured");
      return;
    }

    // if (this.frameCounter < 10 || this.frameCounter % 100 === 0) {
    //   log(
    //     `Decoding chunk: ${this.frameCounter}, Timestamp: ${chunk.timestamp}`
    //   );
    // }

    try {
      // Initialize base timestamp on first packet
      if (!this.isSetBaseTimestamp) {
        this.baseTimestamp = chunk.timestamp;
        this.lastAudioTimestamp = this.baseTimestamp;
        this.isSetBaseTimestamp = true;
        this.lastDuration = 0;
      }

      // Store timestamp and duration
      this.currentTimestamp = chunk.timestamp;
      this.currentDuration = chunk.duration || 20000; // default to 20ms if not specified

      const encodedData = new Uint8Array(chunk.byteLength);
      chunk.copyTo(encodedData);

      // Send data to decoder worker
      this.decoderWorker.postMessage(
        {
          command: "decode",
          pages: encodedData,
        },
        [encodedData.buffer]
      );

      this.frameCounter++;
    } catch (err) {
      log("Opus decoding error:", err);
      this.error(`Opus decoding error: ${err.message || err}`);
    }
  }

  /**
   * Process decoded audio data
   * @private
   * @param {Array<Float32Array>} audioBuffers - Decoded audio buffers
   */
  _handleDecodedAudio(audioBuffers) {
    if (!audioBuffers || !audioBuffers.length) return;

    try {
      const numberOfFrames = audioBuffers[0].length;
      const duration = (numberOfFrames / this.sampleRate) * 1_000_000;

      // Update timestamp tracking
      if (!this.lastAudioTimestamp) {
        this.lastAudioTimestamp = this.baseTimestamp;
      } else {
        this.lastAudioTimestamp += this.lastDuration || duration;
      }
      this.lastDuration = duration;

      const audioTimestamp = this.lastAudioTimestamp;

      // Convert channel arrays to a planar buffer
      const planarBuffer = combinePlanar(audioBuffers);

      // Create AudioData object with timestamp and duration
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: this.sampleRate,
        numberOfChannels: this.numberOfChannels,
        numberOfFrames: numberOfFrames,
        timestamp: audioTimestamp,
        duration: this.currentDuration,
        data: planarBuffer,
      });

      // Send to output callback
      this.output(audioData);
    } catch (err) {
      this.error(`Error creating AudioData: ${err.message}`);
    }
  }

  /**
   * Flush any buffered audio data
   * @returns {Promise} - Resolves when flush is complete
   */
  flush() {
    return Promise.resolve();
  }

  /**
   * Reset the decoder state
   * @returns {Promise} - Resolves when reset is complete
   */
  reset() {
    this.baseTimestamp = 0;
    this.isSetBaseTimestamp = false;
    this.lastDuration = 0;
    this.frameCounter = 0;
    this.lastAudioTimestamp = 0;
    this.audioStartTimestamp = 0;
    this.counter = 0;
    return Promise.resolve();
  }

  /**
   * Close the decoder and release resources
   * @returns {Promise} - Resolves when close is complete
   */
  close() {
    if (this.decoderWorker) {
      this.decoderWorker.terminate();
      this.decoderWorker = null;
    }
    this.state = "closed";
    return Promise.resolve();
  }
}

/**
 * Kết hợp mảng Float32Array channels thành một buffer planar liên tục
 * @param {Float32Array[]} channels - Mảng các kênh audio
 * @returns {Float32Array} - Float32Array chứa dữ liệu planar
 */
function combinePlanar(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("Input must be a non-empty array of Float32Array channels");
  }

  const numChannels = channels.length;
  const numFrames = channels[0].length;

  for (let i = 1; i < numChannels; i++) {
    if (channels[i].length !== numFrames) {
      throw new Error("All channels must have the same number of frames");
    }
  }

  const planar = new Float32Array(numChannels * numFrames);

  for (let c = 0; c < numChannels; c++) {
    planar.set(channels[c], c * numFrames);
  }

  return planar;
}

// if (typeof self !== "undefined") {
//   self.OpusAudioDecoder = OpusAudioDecoder;
// }
export { OpusAudioDecoder };
