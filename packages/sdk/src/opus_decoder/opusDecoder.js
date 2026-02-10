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

export async function initAudioRecorder(audioStream, options = {}, existingAudioContext = null) {
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
    encoderBitRate: 64000,
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

    // Reuse existing AudioContext if provided (required for iOS 15 where
    // AudioContext.resume() must be called within the user gesture handler).
    // If not provided, create a new one (default behavior for other browsers).
    let context;
    if (existingAudioContext && existingAudioContext.state !== 'closed') {
      context = existingAudioContext;
      console.log("Reusing existing AudioContext, state:", context.state);
    } else {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext({
        sampleRate: finalOptions.encoderSampleRate,
      });
    }

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
      // Update configuration
      if (config.sampleRate) {
        this.sampleRate = config.sampleRate;
      }

      if (config.numberOfChannels) {
        this.numberOfChannels = config.numberOfChannels;
      }

      // If already configured, skip re-initialization.
      // Re-running _configureInlineDecoder() would eval the WASM a second time,
      // corrupting the first OggOpusDecoder instance's decoderBuffer.
      if (this.state === 'configured') {
        console.log('[iOS15 Audio DEBUG] Decoder already configured, skipping re-init');
        return true;
      }

      // iOS 15 Fix: Detect iOS 15 Safari which doesn't support nested workers
      const isIOS15Safari = this._isIOS15Safari();
      console.log('[iOS15 Audio DEBUG] isIOS15Safari:', isIOS15Safari);

      if (isIOS15Safari) {
        // Use inline decoder via importScripts for iOS 15
        return await this._configureInlineDecoder();
      } else {
        // Use nested worker for other browsers
        return await this._configureWorkerDecoder();
      }
    } catch (err) {
      this.error(`Error initializing decoder: ${err.message}`);
      this.state = "unconfigured";
      return false;
    }
  }

  /**
   * Detect iOS 15 Safari
   * @private
   */
  _isIOS15Safari() {
    // In worker context, check for iOS Safari features
    if (typeof self !== 'undefined') {
      const ua = self.navigator?.userAgent || '';
      // Check for iOS Safari (not Chrome on iOS)
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in self);
      const isSafari = /Safari/.test(ua) && !/Chrome|CriOS/.test(ua);
      
      // iOS 15 specific check - check if nested Worker is NOT supported
      // Try to detect by checking for specific iOS 15 features or lack of nested worker support
      if (isIOS && isSafari) {
        // Test if Worker constructor works in worker context
        try {
          // Check if we can create a minimal test worker
          const testBlob = new Blob([''], { type: 'application/javascript' });
          const testUrl = URL.createObjectURL(testBlob);
          try {
            const testWorker = new Worker(testUrl);
            testWorker.terminate();
            URL.revokeObjectURL(testUrl);
            console.log('[iOS15 Audio DEBUG] Nested Worker test: PASSED');
            return false; // Nested workers work
          } catch (e) {
            URL.revokeObjectURL(testUrl);
            console.log('[iOS15 Audio DEBUG] Nested Worker test: FAILED -', e.message);
            return true; // Nested workers don't work - iOS 15
          }
        } catch (e) {
          console.log('[iOS15 Audio DEBUG] Nested Worker test error:', e.message);
          return true; // Assume iOS 15 if test fails
        }
      }
    }
    return false;
  }

  /**
   * Configure decoder using nested Worker (normal path)
   * @private
   */
  async _configureWorkerDecoder() {
    const timestamp = Date.now();
    let workerUrl;
    
    // Construct absolute URL for worker
    if (typeof self !== 'undefined' && self.location) {
      const baseUrl = self.location.origin;
      workerUrl = `${baseUrl}/opus_decoder/decoderWorker.min.js?t=${timestamp}`;
      console.log('[iOS15 Audio DEBUG] Using absolute worker URL:', workerUrl);
    } else {
      workerUrl = `../opus_decoder/decoderWorker.min.js?t=${timestamp}`;
      console.log('[iOS15 Audio DEBUG] Using relative worker URL:', workerUrl);
    }
    
    try {
      this.decoderWorker = new Worker(workerUrl);
      console.log('[iOS15 Audio DEBUG] Worker created successfully');
    } catch (workerError) {
      console.error('[iOS15 Audio DEBUG] Worker creation failed:', workerError.message);
      // Fall back to inline decoder
      console.log('[iOS15 Audio DEBUG] Falling back to inline decoder');
      return await this._configureInlineDecoder();
    }

    // iOS 15 Debug: Track worker messages
    let workerMessageCount = 0;

    // Set up message handler for decoded audio output
    this.decoderWorker.onmessage = (e) => {
      workerMessageCount++;
      if (workerMessageCount <= 5 || workerMessageCount % 100 === 0) {
        console.log('[iOS15 Audio DEBUG] decoderWorker.onmessage #' + workerMessageCount, 
          'data type:', typeof e.data, 
          'is array:', Array.isArray(e.data),
          'length:', e.data?.length);
      }

      if (e.data === null) {
        return;
      } else if (e.data && e.data.length) {
        this._handleDecodedAudio(e.data);
      }
    };

    this.decoderWorker.onerror = (e) => {
      console.error('[iOS15 Audio DEBUG] decoderWorker.onerror:', e.message, e.filename, e.lineno);
      this.error(`Decoder worker error: ${e.message}`);
    };

    console.log('[iOS15 Audio DEBUG] Sending init command to decoder worker');
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
    log("Opus decoder initialized and configured (worker mode)");
    return true;
  }

  /**
   * Configure decoder using inline fetch + eval (iOS 15 fallback)
   * importScripts is NOT available in ES module workers, so we use fetch + eval
   * @private
   */
  async _configureInlineDecoder() {
    console.log('[iOS15 Audio DEBUG] Using inline decoder (fetch + eval) for iOS 15 compatibility');

    try {
      const timestamp = Date.now();
      const baseUrl = typeof self !== 'undefined' && self.location ? self.location.origin : '';
      const decoderJsUrl = `${baseUrl}/opus_decoder/decoderWorker.min.js?t=${timestamp}`;
      const decoderWasmUrl = `${baseUrl}/opus_decoder/decoderWorker.min.wasm?t=${timestamp}`;

      console.log('[iOS15 Audio DEBUG] Fetching decoder script:', decoderJsUrl);
      console.log('[iOS15 Audio DEBUG] Fetching WASM binary:', decoderWasmUrl);

      // Fetch both JS and WASM in parallel
      const [jsResponse, wasmResponse] = await Promise.all([
        fetch(decoderJsUrl),
        fetch(decoderWasmUrl),
      ]);

      if (!jsResponse.ok) {
        throw new Error(`Failed to fetch decoder JS: ${jsResponse.status}`);
      }
      if (!wasmResponse.ok) {
        throw new Error(`Failed to fetch decoder WASM: ${wasmResponse.status}`);
      }

      const [scriptContent, wasmBinary] = await Promise.all([
        jsResponse.text(),
        wasmResponse.arrayBuffer(),
      ]);

      console.log('[iOS15 Audio DEBUG] Decoder script fetched, size:', scriptContent.length);
      console.log('[iOS15 Audio DEBUG] WASM binary fetched, size:', wasmBinary.byteLength);

      // Pre-load WASM binary into Module so the eval'd script does not
      // need to fetch it (URL resolution is broken in eval/new Function context).
      // Also provide locateFile so any other asset lookups resolve correctly.
      const opusDecoderBasePath = `${baseUrl}/opus_decoder/`;
      const tempModule = {
        wasmBinary: wasmBinary,
        locateFile: (filename) => opusDecoderBasePath + filename,
      };

      // Evaluate the script in current context
      const evalFunction = new Function('Module', scriptContent);
      evalFunction(tempModule);

      console.log('[iOS15 Audio DEBUG] Script evaluated, Module keys:', Object.keys(tempModule));

      // Wait for WASM module to be ready with timeout
      if (tempModule.mainReady) {
        const readyTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('WASM mainReady timeout (10s)')), 10000)
        );
        await Promise.race([tempModule.mainReady, readyTimeout]);
        console.log('[iOS15 Audio DEBUG] Module.mainReady resolved');
      }
      
      // Store reference to the loaded module
      this.opusModule = tempModule;
      
      // Check if OggOpusDecoder is available
      if (!tempModule.OggOpusDecoder) {
        throw new Error('OggOpusDecoder not found in loaded module');
      }
      
      // Create inline decoder instance
      this.inlineDecoder = new tempModule.OggOpusDecoder({
        decoderSampleRate: this.sampleRate,
        outputBufferSampleRate: this.sampleRate,
        numberOfChannels: this.numberOfChannels,
        bufferLength: 4096,
      }, tempModule);
      
      console.log('[iOS15 Audio DEBUG] OggOpusDecoder instance created');
      
      // Override the sendToOutputBuffers method to call our handler
      const self_decoder = this;
      this.inlineDecoder.sendToOutputBuffers = function(data) {
        // Convert interleaved data to channel arrays
        const numChannels = this.numberOfChannels;
        const numFrames = data.length / numChannels;
        const channels = [];
        
        for (let c = 0; c < numChannels; c++) {
          channels.push(new Float32Array(numFrames));
        }
        
        for (let i = 0; i < numFrames; i++) {
          for (let c = 0; c < numChannels; c++) {
            channels[c][i] = data[i * numChannels + c];
          }
        }
        
        self_decoder._handleDecodedAudio(channels);
      };
      
      this.useInlineDecoder = true;
      this.state = "configured";
      this.baseTimestamp = 0;
      this.isSetBaseTimestamp = false;
      this.lastDuration = 0;
      
      log("Opus decoder initialized and configured (inline mode for iOS 15)");
      return true;
    } catch (err) {
      console.error('[iOS15 Audio DEBUG] Inline decoder setup failed:', err.message);
      this.error(`Inline decoder setup failed: ${err.message}`);
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
    // Check if decoder is ready - support both worker and inline modes
    if (this.state !== "configured") {
      console.warn('[iOS15 Audio DEBUG] decode() called but decoder not ready, state:', this.state);
      return;
    }
    
    // Check we have either worker or inline decoder
    if (!this.decoderWorker && !this.useInlineDecoder) {
      console.warn('[iOS15 Audio DEBUG] decode() called but no decoder available');
      return;
    }

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

      // iOS 15 Debug: Log decode calls
      if (this.frameCounter <= 5 || this.frameCounter % 100 === 0) {
        console.log('[iOS15 Audio DEBUG] Sending decode command #' + (this.frameCounter + 1), 
          'dataLen:', encodedData.length, 'mode:', this.useInlineDecoder ? 'inline' : 'worker');
      }

      if (this.useInlineDecoder && this.inlineDecoder) {
        // Inline decoder mode for iOS 15
        this.inlineDecoder.decode(encodedData);
      } else if (this.decoderWorker) {
        // Worker mode for other browsers
        this.decoderWorker.postMessage(
          {
            command: "decode",
            pages: encodedData,
          },
          [encodedData.buffer]
        );
      }

      this.frameCounter++;
    } catch (err) {
      console.error('[iOS15 Audio DEBUG] Opus decode error:', err);
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

    // iOS 15 Debug: Track decoded audio output
    if (!this._decodedFrameCount) this._decodedFrameCount = 0;
    this._decodedFrameCount++;
    if (this._decodedFrameCount <= 5 || this._decodedFrameCount % 100 === 0) {
      console.log('[iOS15 Audio DEBUG] OpusDecoder output, frame#:', this._decodedFrameCount, 
        'channels:', audioBuffers.length, 'frames:', audioBuffers[0]?.length);
    }

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