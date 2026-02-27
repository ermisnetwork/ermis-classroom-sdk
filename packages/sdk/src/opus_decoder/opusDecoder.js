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
      console.log("Reusing existing AudioContext, state:", context.state,
        "sampleRate:", context.sampleRate);
      // On iOS Safari, the existing AudioContext may have a different sample
      // rate (e.g. 44100 on older iPads).  Recorder.js resamples internally,
      // but log the mismatch for debugging.
      if (context.sampleRate !== finalOptions.encoderSampleRate) {
        console.warn(`[AudioRecorder] AudioContext sampleRate (${context.sampleRate}) != encoderSampleRate (${finalOptions.encoderSampleRate}). Recorder.js will resample.`);
      }
    } else {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext({
        sampleRate: finalOptions.encoderSampleRate,
      });
      // iOS Safari might not honour the requested sample rate
      if (context.sampleRate !== finalOptions.encoderSampleRate) {
        console.warn(`[AudioRecorder] Created AudioContext sampleRate (${context.sampleRate}) != requested (${finalOptions.encoderSampleRate})`);
      }
    }

    // Ensure AudioContext is running (iOS Safari requires a user gesture
    // to resume; if the context is still suspended, audio data will not
    // flow to the encoder).
    if (context.state === 'suspended') {
      try {
        await context.resume();
        console.log("[AudioRecorder] AudioContext resumed, state:", context.state);
      } catch (err) {
        console.warn("[AudioRecorder] Failed to resume AudioContext:", err);
      }
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

    // WASM readiness tracking for worker/port modes.
    // The decoder worker sends a null message when its WASM module has loaded.
    // Until that signal arrives, decode() buffers messages to avoid dropping
    // the crucial OpusHead page.
    this._wasmReady = false;
    this._wasmReadyResolve = null;
    this._wasmReadyPromise = new Promise(resolve => {
      this._wasmReadyResolve = resolve;
    });
    this._pendingDecodes = [];
    this._wasmReadyTimeout = null;
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

      // Store external decoder port if provided (from main thread for iOS 15 compatibility)
      if (config.decoderPort) {
        this._externalDecoderPort = config.decoderPort;
      }

      // If already configured, skip re-initialization.
      // Re-running _configureInlineDecoder() would eval the WASM a second time,
      // corrupting the first OggOpusDecoder instance's decoderBuffer.
      if (this.state === 'configured') {
        return true;
      }

      // 1. If an external decoder port was provided (for iOS 15 where nested
      //    workers are not supported), use it — the actual Worker was created
      //    on the main thread and messages are relayed through this port.
      if (this._externalDecoderPort) {
        console.log('[Opus Decoder] configure: using external decoder port (main-thread bridge)');
        return await this._configurePortDecoder(this._externalDecoderPort);
      }

      // 2. If Worker is available in this context, use nested worker
      if (typeof Worker !== 'undefined') {
        return await this._configureWorkerDecoder();
      }

      // 3. Fallback to inline decoder
      console.warn('[Opus Decoder] Worker not available and no external port, using inline decoder');
      return await this._configureInlineDecoder();
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
            // Nested workers supported
            return false; // Nested workers work
          } catch (e) {
            URL.revokeObjectURL(testUrl);
            console.log('[Opus Decoder] No nested worker support, using inline decoder');
            return true; // Nested workers don't work - iOS 15
          }
        } catch (e) {
          console.log('[Opus Decoder] Nested worker test error:', e.message);
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
      // absolute URL
    } else {
      workerUrl = `../opus_decoder/decoderWorker.min.js?t=${timestamp}`;
      // relative URL
    }

    console.log("[OpusDecoder] Worker URL", workerUrl);
    
    try {
      this.decoderWorker = new Worker(workerUrl);
      console.log("[OpusDecoder] DecoderWorker created successfully", this.decoderWorker);
      // Worker created successfully
    } catch (workerError) {
      console.warn('[Opus Decoder] Worker creation failed, falling back to inline decoder:', workerError.message);
      return await this._configureInlineDecoder();
    }

    const initMsg = {
      command: "init",
      decoderSampleRate: this.sampleRate,
      outputBufferSampleRate: this.sampleRate,
      numberOfChannels: this.numberOfChannels,
    };

    // Set up message handler for decoded audio output
    this.decoderWorker.onmessage = (e) => {
      // First message from worker (null) signals WASM is loaded and ready.
      if (!this._wasmReady) {
        this._wasmReady = true;
        console.log('[Opus Decoder] Decoder worker WASM ready (worker mode), flushing',
          this._pendingDecodes.length, 'buffered decodes');
        if (this._wasmReadyResolve) {
          this._wasmReadyResolve();
          this._wasmReadyResolve = null;
        }
        if (this._wasmReadyTimeout) {
          clearTimeout(this._wasmReadyTimeout);
          this._wasmReadyTimeout = null;
        }
        // Re-send init to ensure it is processed
        this.decoderWorker.postMessage(initMsg);
        // Flush buffered decode commands
        for (const pending of this._pendingDecodes) {
          this.decoderWorker.postMessage(pending.msg, pending.transfer);
        }
        this._pendingDecodes = [];
      }

      if (e.data === null) {
        return;
      } else if (e.data && e.data.length) {
        this._handleDecodedAudio(e.data);
      }
    };

    this.decoderWorker.onerror = (e) => {
      console.error('[Opus Decoder] decoderWorker error:', e.message);
      this.error(`Decoder worker error: ${e.message}`);
    };

    // Send init command to decoder worker
    this.decoderWorker.postMessage(initMsg);

    // Timeout: if the worker never sends a ready signal, mark ready after 5s
    this._wasmReadyTimeout = setTimeout(() => {
      if (!this._wasmReady) {
        console.warn('[Opus Decoder] WASM ready timeout (5s) on worker mode, flushing pending decodes');
        this._wasmReady = true;
        if (this._wasmReadyResolve) {
          this._wasmReadyResolve();
          this._wasmReadyResolve = null;
        }
        for (const pending of this._pendingDecodes) {
          this.decoderWorker.postMessage(pending.msg, pending.transfer);
        }
        this._pendingDecodes = [];
      }
    }, 5000);

    this.state = "configured";
    this.baseTimestamp = 0;
    this.isSetBaseTimestamp = false;
    this.lastDuration = 0;
    log("Opus decoder initialized and configured (worker mode)");
    return true;
  }

  /**
   * Configure decoder using an external MessagePort that is relayed to a
   * decoder Worker created on the main thread.  This avoids nested workers
   * which are unsupported on iOS 15 Safari.
   * @private
   * @param {MessagePort} port
   */
  async _configurePortDecoder(port) {
    this.decoderWorker = port;

    const initMsg = {
      command: "init",
      decoderSampleRate: this.sampleRate,
      outputBufferSampleRate: this.sampleRate,
      numberOfChannels: this.numberOfChannels,
    };

    port.onmessage = (e) => {
      // The first message from the decoder worker (typically null) signals
      // that its WASM module has loaded and it is ready to process commands.
      if (!this._wasmReady) {
        this._wasmReady = true;
        console.log('[Opus Decoder] Decoder worker WASM ready (port bridge), flushing',
          this._pendingDecodes.length, 'buffered decodes');
        if (this._wasmReadyResolve) {
          this._wasmReadyResolve();
          this._wasmReadyResolve = null;
        }
        if (this._wasmReadyTimeout) {
          clearTimeout(this._wasmReadyTimeout);
          this._wasmReadyTimeout = null;
        }
        // Re-send init to ensure it is processed (the first init may have
        // arrived before the worker's onmessage handler was set up).
        port.postMessage(initMsg);
        // Flush buffered decode commands (e.g. the OpusHead page)
        for (const pending of this._pendingDecodes) {
          port.postMessage(pending.msg, pending.transfer);
        }
        this._pendingDecodes = [];
      }

      if (e.data === null) {
        return;
      } else if (e.data && e.data.length) {
        this._handleDecodedAudio(e.data);
      }
    };

    // Send init command to decoder worker (via relayed port)
    port.postMessage(initMsg);

    // Timeout: if the worker never sends a ready signal, mark ready after 5s
    // and flush pending decodes so audio is not permanently blocked.
    this._wasmReadyTimeout = setTimeout(() => {
      if (!this._wasmReady) {
        console.warn('[Opus Decoder] WASM ready timeout (5s) on port bridge, flushing pending decodes');
        this._wasmReady = true;
        if (this._wasmReadyResolve) {
          this._wasmReadyResolve();
          this._wasmReadyResolve = null;
        }
        for (const pending of this._pendingDecodes) {
          port.postMessage(pending.msg, pending.transfer);
        }
        this._pendingDecodes = [];
      }
    }, 5000);

    this.state = "configured";
    this.baseTimestamp = 0;
    this.isSetBaseTimestamp = false;
    this.lastDuration = 0;
    log("Opus decoder initialized and configured (port bridge mode)");
    return true;
  }

  /**
   * Configure decoder using inline fetch + eval (iOS 15 fallback)
   * importScripts is NOT available in ES module workers, so we use fetch + eval
   * @private
   */
  async _configureInlineDecoder() {
    console.log('[Opus Decoder] Using inline decoder (iOS 15 fallback)');

    try {
      const timestamp = Date.now();
      const baseUrl = typeof self !== 'undefined' && self.location ? self.location.origin : '';
      const decoderJsUrl = `${baseUrl}/opus_decoder/decoderWorker.min.js?t=${timestamp}`;
      const decoderWasmUrl = `${baseUrl}/opus_decoder/decoderWorker.min.wasm?t=${timestamp}`;

      // Fetch both JS and WASM in parallel

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

      console.log('[Opus Decoder] Inline decoder: JS', scriptContent.length, 'bytes, WASM', wasmBinary.byteLength, 'bytes');

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

      // Script evaluated

      // Wait for WASM module to be ready with timeout
      if (tempModule.mainReady) {
        const readyTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('WASM mainReady timeout (10s)')), 10000)
        );
        await Promise.race([tempModule.mainReady, readyTimeout]);
        // WASM ready
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
      
      // OggOpusDecoder instance created
      
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
      // Inline decoder already awaited WASM — mark ready immediately
      this._wasmReady = true;
      if (this._wasmReadyResolve) {
        this._wasmReadyResolve();
        this._wasmReadyResolve = null;
      }
      this.state = "configured";
      this.baseTimestamp = 0;
      this.isSetBaseTimestamp = false;
      this.lastDuration = 0;

      log("Opus decoder initialized and configured (inline mode for iOS 15)");
      return true;
    } catch (err) {
      console.error('[Opus Decoder] Inline decoder setup failed:', err.message);
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
      console.warn('[Opus Decoder] decode() called but decoder not ready, state:', this.state);
      return;
    }
    
    // Check we have either worker or inline decoder
    if (!this.decoderWorker && !this.useInlineDecoder) {
      console.warn('[Opus Decoder] decode() called but no decoder available');
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

      // Must allocate a fresh Uint8Array per packet — the buffer is transferred
      // (detached) when postMessage()-ing to the decoder worker, so we cannot reuse it.
      const encodedData = new Uint8Array(chunk.byteLength);
      chunk.copyTo(encodedData);

      if (this.frameCounter <= 2) {
        console.log('[Opus Decoder] decode #' + (this.frameCounter + 1),
          'len:', encodedData.length, 'mode:', this.useInlineDecoder ? 'inline' : 'worker',
          'wasmReady:', this._wasmReady);
      }

      if (this.useInlineDecoder && this.inlineDecoder) {
        // Inline decoder mode for iOS 15
        this.inlineDecoder.decode(encodedData);
      } else if (this.decoderWorker) {
        // If WASM is not ready yet, buffer the decode command so the crucial
        // OpusHead page is not lost.  It will be flushed when the worker
        // signals readiness (or after the 5 s timeout).
        if (!this._wasmReady) {
          console.warn('[Opus Decoder] WASM not ready, buffering decode #' +
            (this._pendingDecodes.length + 1), 'len:', encodedData.length);
          this._pendingDecodes.push({
            msg: { command: "decode", pages: encodedData },
            transfer: [encodedData.buffer],
          });
          this.frameCounter++;
          return;
        }

        if (this.frameCounter <= 2) {
          console.log('[Opus Decoder] send to worker decode #' + (this.frameCounter + 1),
            'len:', encodedData.length);
        }
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
      console.error('[Opus Decoder] Opus decode error:', err);
      this.error(`Opus decoding error: ${err.message || err}`);
    }
  }

  /**
   * Wait for the decoder worker's WASM module to be ready.
   * Resolves immediately for inline decoders.  For worker/port modes,
   * resolves when the first message (null) arrives from the decoder worker
   * or after timeoutMs, whichever comes first.
   *
   * @param {number} timeoutMs - Maximum wait time in milliseconds (default 5000)
   * @returns {Promise<void>}
   */
  waitForReady(timeoutMs = 5000) {
    if (this._wasmReady || this.useInlineDecoder) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        console.warn('[Opus Decoder] waitForReady timeout (' + timeoutMs + 'ms)');
        resolve();
      }, timeoutMs);

      this._wasmReadyPromise.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Process decoded audio data
   * @private
   * @param {Array<Float32Array>} audioBuffers - Decoded audio buffers
   */
  _handleDecodedAudio(audioBuffers) {
    if (!audioBuffers || !audioBuffers.length) return;

    if (!this._decodedFrameCount) this._decodedFrameCount = 0;
    this._decodedFrameCount++;
    if (this._decodedFrameCount <= 20) {
      console.log('[Opus Decoder] decoded frame#:', this._decodedFrameCount,
        'ch:', audioBuffers.length, 'frames:', audioBuffers[0]?.length);
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
    if (this._wasmReadyTimeout) {
      clearTimeout(this._wasmReadyTimeout);
      this._wasmReadyTimeout = null;
    }
    this._pendingDecodes = [];
    if (this.decoderWorker) {
      // Worker has terminate(), MessagePort has close()
      if (typeof this.decoderWorker.terminate === 'function') {
        this.decoderWorker.terminate();
      } else if (typeof this.decoderWorker.close === 'function') {
        this.decoderWorker.close();
      }
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