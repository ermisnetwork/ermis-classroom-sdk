/**
 * ermis-classroom-sdk v1.0.2
 * Ermis Classroom SDK for virtual classroom and meeting integration
 * 
 * @author Ermis Team <developer@ermis.network>
 * @license MIT
 * @homepage https://github.com/ermisnetwork/ermis-classroom-sdk#readme
 */
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
/**
 * Base EventEmitter class for handling events across the SDK
 */
class EventEmitter {
  constructor() {
    this._events = new Map();
  }
  on(event, listener) {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event).push(listener);
    return this;
  }
  off(event, listener) {
    if (!this._events.has(event)) return this;
    const listeners = this._events.get(event);
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    if (listeners.length === 0) {
      this._events.delete(event);
    }
    return this;
  }
  emit(event, ...args) {
    if (!this._events.has(event)) return false;
    const listeners = this._events.get(event);
    listeners.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
    return true;
  }
  once(event, listener) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }
  removeAllListeners(event) {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }
  listenerCount(event) {
    return this._events.has(event) ? this._events.get(event).length : 0;
  }
}
var EventEmitter$1 = EventEmitter;

/**
 * API Client for handling HTTP requests to Ermis Meeting API
 */
class ApiClient {
  constructor(config) {
    this.host = config.host || "daibo.ermis.network:9992";
    this.apiBaseUrl = config.apiUrl || `https://${this.host}/meeting`;
    this.jwtToken = null;
    this.userId = null;
  }

  /**
   * Set authentication token and user ID
   */
  setAuth(token, userId) {
    this.jwtToken = token;
    this.userId = userId;
  }

  /**
   * Generic API call method
   */
  async apiCall(endpoint, method = "GET", body = null) {
    if (!this.userId) {
      throw new Error("Please authenticate first");
    }
    if (!this.jwtToken) {
      throw new Error("JWT token not found");
    }
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.jwtToken}`,
        "Content-Type": "application/json"
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("API call failed:", error);
      throw error;
    }
  }

  /**
   * Get dummy token for authentication
   */
  async getDummyToken(userId) {
    const endpoint = "/get-token";
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sub: userId
      })
    };
    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Token request failed:", error);
      throw error;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(roomName, roomType = "main") {
    return await this.apiCall("/rooms", "POST", {
      room_name: roomName,
      room_type: roomType
    });
  }

  /**
   * List available rooms
   */
  async listRooms(page = 1, perPage = 20) {
    return await this.apiCall("/rooms/list", "POST", {
      list_query: {
        page,
        per_page: perPage,
        sort_by: "created_at",
        sort_order: "desc"
      },
      conditions: {
        is_active: true
      }
    });
  }

  /**
   * Get room details by ID
   */
  async getRoomById(roomId) {
    return await this.apiCall(`/rooms/${roomId}`);
  }

  /**
   * Join a room by room code
   */
  async joinRoom(roomCode, appName = "Ermis-Meeting") {
    return await this.apiCall("/rooms/join", "POST", {
      room_code: roomCode,
      app_name: appName
    });
  }

  /**
   * Create a sub room
   */
  async createSubRoom(parentRoomId, subRoomName, subRoomType = "breakout") {
    return await this.apiCall("/rooms", "POST", {
      room_name: subRoomName,
      room_type: subRoomType,
      parent_room_id: parentRoomId
    });
  }

  /**
   * Get sub rooms of a parent room
   */
  async getSubRooms(parentRoomId) {
    return await this.apiCall(`/rooms/${parentRoomId}/sub-rooms`);
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId, membershipId) {
    return await this.apiCall(`/rooms/${roomId}/members/${membershipId}`, "DELETE");
  }

  /**
   * Switch to sub room
   */
  async switchToSubRoom(roomId, subRoomCode) {
    return await this.apiCall("/rooms/switch", "POST", {
      room_id: roomId,
      sub_room_code: subRoomCode
    });
  }

  /**
   * Get room members
   */
  async getRoomMembers(roomId) {
    return await this.apiCall(`/rooms/${roomId}/members`);
  }

  /**
   * Update room settings
   */
  async updateRoom(roomId, updates) {
    return await this.apiCall(`/rooms/${roomId}`, "PATCH", updates);
  }

  /**
   * Delete/Close room
   */
  async deleteRoom(roomId) {
    return await this.apiCall(`/rooms/${roomId}`, "DELETE");
  }
}
var ApiClient$1 = ApiClient;

/**
 * Represents a participant in a meeting room
 */
class Participant extends EventEmitter$1 {
  constructor(config) {
    super();
    this.userId = config.userId;
    this.streamId = config.streamId;
    this.membershipId = config.membershipId;
    this.role = config.role || "participant";
    this.roomId = config.roomId;
    this.isLocal = config.isLocal || false;

    // Media state
    this.isAudioEnabled = true;
    this.isVideoEnabled = true;
    this.isPinned = false;

    // Media components
    this.publisher = null;
    this.subscriber = null;

    // Screen share state
    this.isScreenSharing = config.isScreenSharing || false;
    this.screenSubscriber = null;

    // Status
    this.connectionStatus = "disconnected"; // 'connecting', 'connected', 'disconnected', 'failed'
  }

  /**
   * Get display name with role
   */
  getDisplayName() {
    const roleText = this.role === "owner" ? " (Host)" : "";
    const localText = this.isLocal ? " (You)" : "";
    return `${this.userId}${roleText}${localText}`;
  }

  /**
   * Toggle microphone (local only)
   */
  async toggleMicrophone() {
    if (!this.isLocal || !this.publisher) return;
    try {
      await this.publisher.toggleMic();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("audioToggled", {
        participant: this,
        enabled: this.isAudioEnabled
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error,
        action: "toggleMicrophone"
      });
    }
  }

  /**
   * Toggle camera (local only)
   */
  async toggleCamera() {
    if (!this.isLocal || !this.publisher) return;
    try {
      await this.publisher.toggleCamera();
      this.isVideoEnabled = !this.isVideoEnabled;
      this.emit("videoToggled", {
        participant: this,
        enabled: this.isVideoEnabled
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error,
        action: "toggleCamera"
      });
    }
  }

  /**
   * Toggle remote participant's audio
   */
  async toggleRemoteAudio() {
    if (this.isLocal || !this.subscriber) return;
    try {
      await this.subscriber.toggleAudio();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("remoteAudioToggled", {
        participant: this,
        enabled: this.isAudioEnabled
      });
    } catch (error) {
      this.emit("error", {
        participant: this,
        error,
        action: "toggleRemoteAudio"
      });
    }
  }

  /**
   * Toggle pin status
   */
  togglePin() {
    if (!this.isLocal) {
      if (this.isPinned) {
        this.subscriber?.switchBitrate("360p");
        console.warn("Unpin participant, switch to low quality");
      } else {
        this.subscriber?.switchBitrate("720p");
        console.warn("Pin participant, switch to high quality");
      }
    }
    this.isPinned = !this.isPinned;
    this.emit("pinToggled", {
      participant: this,
      pinned: this.isPinned
    });
  }

  /**
   * Update connection status
   */
  setConnectionStatus(status) {
    this.connectionStatus = status;
    this.emit("statusChanged", {
      participant: this,
      status
    });
  }

  /**
   * Get status text for display
   */
  _getStatusText(status) {
    switch (status) {
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
      case "failed":
        return "Connection Failed";
      default:
        return status;
    }
  }

  /**
   * Set publisher instance
   */
  setPublisher(publisher) {
    this.publisher = publisher;
    if (publisher) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Set subscriber instance
   */
  setSubscriber(subscriber) {
    this.subscriber = subscriber;
    if (subscriber) {
      this.setConnectionStatus("connected");
    }
  }

  /**
   * Update microphone status from server event
   */
  updateMicStatus(enabled) {
    this.isAudioEnabled = enabled;
    this.emit("remoteAudioStatusChanged", {
      participant: this,
      enabled: this.isAudioEnabled
    });
  }

  /**
   * Update camera status from server event
   */
  updateCameraStatus(enabled) {
    this.isVideoEnabled = enabled;
    this.emit("remoteVideoStatusChanged", {
      participant: this,
      enabled: this.isVideoEnabled
    });
  }

  /**
   * Cleanup participant resources
   */
  cleanup() {
    // Stop media streams
    if (this.publisher) {
      this.publisher.stop();
      this.publisher = null;
    }
    if (this.subscriber) {
      this.subscriber.stop();
      this.subscriber = null;
    }

    // Stop screen subscriber
    if (this.screenSubscriber) {
      this.screenSubscriber.stop();
      this.screenSubscriber = null;
    }
    this.setConnectionStatus("disconnected");
    this.removeAllListeners();
    this.emit("cleanup", {
      participant: this
    });
  }

  /**
   * Get participant info
   */
  getInfo() {
    return {
      userId: this.userId,
      streamId: this.streamId,
      membershipId: this.membershipId,
      role: this.role,
      isLocal: this.isLocal,
      isAudioEnabled: this.isAudioEnabled,
      isVideoEnabled: this.isVideoEnabled,
      isPinned: this.isPinned,
      isScreenSharing: this.isScreenSharing,
      connectionStatus: this.connectionStatus
    };
  }
}
var Participant$1 = Participant;

/**
 * WebRTC Publisher Class
 * Handles video/audio streaming via WebTransport
 */
class Publisher extends EventEmitter$1 {
  constructor(options = {}) {
    super();

    // Validate required options
    if (!options.publishUrl) {
      throw new Error("publishUrl is required");
    }

    // Configuration
    this.publishUrl = options.publishUrl;
    this.streamType = options.streamType || "camera"; // 'camera' or 'display'
    this.streamId = options.streamId || "test_stream";

    // Video configuration
    this.currentConfig = {
      codec: "avc1.640c34",
      width: options.width || 1280,
      height: options.height || 720,
      framerate: options.framerate || 30,
      bitrate: options.bitrate || 1_500_000
    };

    // Audio configuration
    this.kSampleRate = 48000;
    this.opusBaseTime = 0;
    this.opusSamplesSent = 0;
    this.opusSamplesPerChunk = 960; // 20ms at 48kHz
    this.opusChunkCount = 0;

    // State variables
    this.stream = null;
    this.audioProcessor = null;
    this.videoProcessor = null;
    this.webTransport = null;
    this.isChannelOpen = false;
    this.sequenceNumber = 0;
    this.isPublishing = false;
    this.cameraEnabled = true;
    this.micEnabled = true;
    this.hasCamera = options.hasCamera !== undefined ? options.hasCamera : true;
    this.hasMic = options.hasMic !== undefined ? options.hasMic : true;

    // Callbacks
    this.onStatusUpdate = options.onStatusUpdate || ((message, isError) => console.log(message));
    this.onStreamStart = options.onStreamStart || (() => {});
    this.onStreamStop = options.onStreamStop || (() => {});
    this.onServerEvent = options.onServerEvent || (event => {});

    // Initialize modules
    this.wasmInitialized = false;
    this.wasmInitializing = false;
    this.wasmInitPromise = null;
    this.initAudioRecorder = null;
    this.WasmEncoder = null;

    // Stream management
    this.publishStreams = new Map(); // key: channelName, value: {writer, reader, configSent, config}
    this.videoEncoders = new Map();
    this.eventStream = null; // Dedicated event stream

    this.subStreams = [{
      name: "high",
      width: 1280,
      height: 720,
      bitrate: 800_000,
      framerate: 30,
      channelName: "cam_720p"
    },
    // {
    //   name: "low",
    //   width: 854,
    //   height: 480,
    //   bitrate: 500_000,
    //   framerate: 30,
    //   channelName: "cam_360p",
    // },
    {
      name: "low",
      width: 640,
      height: 360,
      bitrate: 400_000,
      framerate: 30,
      channelName: "cam_360p"
    }, {
      name: "screen",
      width: 1920,
      height: 1080,
      bitrate: 2_000_000,
      framerate: 30,
      channelName: "screen_share_1080p"
    }, {
      name: "microphone",
      channelName: "mic_48k"
    }];
  }
  async init() {
    await this.loadAllDependencies();
    this.onStatusUpdate("Publisher initialized successfully");
  }
  async loadAllDependencies() {
    try {
      if (!document.querySelector('script[src*="MSTP_polyfill.js"]')) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "../polyfills/MSTP_polyfill.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load MSTP polyfill"));
          document.head.appendChild(script);
        });
        console.log("Polyfill loaded successfully");
      }
      if (!this.wasmInitialized) {
        if (this.wasmInitializing && this.wasmInitPromise) {
          await this.wasmInitPromise;
        } else {
          this.wasmInitializing = true;
          const {
            default: init,
            WasmEncoder
          } = await Promise.resolve().then(function () { return raptorq_wasm; });
          this.WasmEncoder = WasmEncoder;
          this.wasmInitPromise = init("../raptorQ/raptorq_wasm_bg.wasm").then(() => {
            this.wasmInitialized = true;
            this.wasmInitializing = false;
            console.log("WASM encoder module loaded successfully");
          }).catch(err => {
            this.wasmInitializing = false;
            console.error("Failed to load WASM encoder module:", err);
            throw new Error("Failed to load WASM encoder module");
          });
          await this.wasmInitPromise;
        }
      }
      const opusModule = await import(`/opus_decoder/opusDecoder.js?t=${Date.now()}`);
      this.initAudioRecorder = opusModule.initAudioRecorder;
      console.log("Opus decoder module loaded successfully");
      this.onStatusUpdate("All dependencies loaded successfully");
    } catch (error) {
      this.onStatusUpdate(`Dependency loading error: ${error.message}`, true);
      throw error;
    }
  }
  async startPublishing() {
    if (this.isPublishing) {
      this.onStatusUpdate("Already publishing", true);
      return;
    }
    await this.init();

    // Setup WebTransport connection
    await this.setupConnection();
    try {
      // Get media stream based on type
      await this.getMediaStream();
      this.isPublishing = true;
      // Start streaming
      await this.startStreaming();
      this.onStreamStart();
      this.onStatusUpdate("Publishing started successfully");
    } catch (error) {
      this.onStatusUpdate(`Failed to start publishing: ${error.message}`, true);
      throw error;
    }
  }

  // Toggle camera
  async toggleCamera() {
    if (this.cameraEnabled) {
      await this.turnOffCamera();
    } else {
      await this.turnOnCamera();
    }
  }

  // Toggle mic
  async toggleMic() {
    if (this.micEnabled) {
      await this.turnOffMic();
    } else {
      await this.turnOnMic();
    }
  }

  // Turn off camera (stop encoding video frames)
  async turnOffCamera() {
    if (!this.cameraEnabled) return;
    this.cameraEnabled = false;
    this.onStatusUpdate("Camera turned off");

    // Send camera_off event to server
    await this.sendMeetingEvent("camera_off");
  }

  // Turn on camera (resume encoding video frames)
  async turnOnCamera() {
    if (this.cameraEnabled) return;
    this.cameraEnabled = true;
    this.onStatusUpdate("Camera turned on");

    // Send camera_on event to server
    await this.sendMeetingEvent("camera_on");
  }

  // Turn off mic (stop encoding audio chunks)
  async turnOffMic() {
    if (!this.micEnabled) return;
    this.micEnabled = false;
    this.onStatusUpdate("Mic turned off");

    // Send mic_off event to server
    await this.sendMeetingEvent("mic_off");
  }

  // Turn on mic (resume encoding audio chunks)
  async turnOnMic() {
    if (this.micEnabled) return;
    this.micEnabled = true;
    this.onStatusUpdate("Mic turned on");

    // Send mic_on event to server
    await this.sendMeetingEvent("mic_on");
  }

  /**
   * Send meeting control event to server
   */
  async sendMeetingEvent(eventType, targetStreamId = null) {
    if (!eventType) return;
    if (!this.isChannelOpen || !this.eventStream) {
      console.warn(`Skipping ${eventType} event: Event stream not ready`);
      return;
    }
    console.log("[Meeting Event] Sender stream ID:", this.streamId);
    const eventMessage = {
      type: eventType,
      sender_stream_id: this.streamId,
      timestamp: Date.now()
    };
    if ((eventType === "pin_for_everyone" || eventType === "unpin_for_everyone") && targetStreamId) {
      eventMessage.target_stream_id = targetStreamId;
    }
    try {
      await this.sendEvent(eventMessage);
      console.log(`Sent meeting event:`, eventMessage);
    } catch (error) {
      console.error(`Failed to send meeting event ${eventType}:`, error);
      this.onStatusUpdate(`Failed to notify server about ${eventType}`, true);
    }
  }
  async getMediaStream() {
    if (this.streamType === "camera") {
      const constraints = {
        audio: {
          sampleRate: this.kSampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        },
        video: {
          width: {
            ideal: this.currentConfig.width
          },
          height: {
            ideal: this.currentConfig.height
          },
          frameRate: {
            ideal: this.currentConfig.framerate
          }
        }
      };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        console.error("Error accessing media devices:", error);
      }
    } else if (this.streamType === "display") {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Handle user stopping screen share via browser UI
      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stop();
        };
      }
    }

    // Create video-only stream for display
    const videoOnlyStream = new MediaStream();
    const videoTracks = this.stream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoOnlyStream.addTrack(videoTracks[0]);
    }

    // Emit local stream ready event for app integration
    this.emit("localStreamReady", {
      stream: this.stream,
      // Full stream with audio + video
      videoOnlyStream: videoOnlyStream,
      // Video only stream
      streamType: this.streamType,
      streamId: this.streamId,
      config: this.currentConfig
    });
    this.onStatusUpdate(`${this.streamType} stream ready`);
  }
  initVideoEncoders() {
    this.subStreams.forEach(subStream => {
      if (!subStream.channelName.startsWith("mic")) {
        console.log(`Setting up encoder for ${subStream.name}`);
        const encoder = new VideoEncoder({
          output: (chunk, metadata) => this.handleVideoChunk(chunk, metadata, subStream.name, subStream.channelName),
          error: e => this.onStatusUpdate(`Encoder ${subStream.name} error: ${e.message}`, true)
        });
        this.videoEncoders.set(subStream.name, {
          encoder,
          channelName: subStream.channelName,
          config: {
            codec: this.currentConfig.codec,
            width: subStream.width,
            height: subStream.height,
            bitrate: subStream.bitrate,
            framerate: this.currentConfig.framerate,
            latencyMode: "realtime",
            hardwareAcceleration: "prefer-hardware"
          },
          metadataReady: false,
          videoDecoderConfig: null
        });
      }
    });
  }
  async setupConnection() {
    this.webTransport = new WebTransport(this.publishUrl);
    await this.webTransport.ready;
    console.log("WebTransport connected to server");
    await this.createEventStream();
    for (const subStream of this.subStreams) {
      if (!subStream.channelName.startsWith("screen")) {
        await this.createBidirectionalStream(subStream.channelName);
      }
    }
    this.isChannelOpen = true;
    this.onStatusUpdate("WebTransport connection established with event stream and media streams");
  }
  async createEventStream() {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;
    const writer = writable.getWriter();
    const reader = readable.getReader();
    this.eventStream = {
      writer,
      reader
    };
    console.log("WebTransport event stream established");
    const initData = new TextEncoder().encode("meeting_control");
    await this.sendOverEventStream(initData);

    // Setup reader cho event stream
    this.setupEventStreamReader(reader);
    await this.sendPublisherState();
    const workerInterval = new Worker("polyfills/intervalWorker.js");
    workerInterval.postMessage({
      interval: 1000
    });
    let lastPingTime = Date.now();
    workerInterval.onmessage = e => {
      const ping = new TextEncoder().encode("ping");
      this.sendOverEventStream(ping);
      if (Date.now() - lastPingTime > 1200) {
        console.warn("Ping delay detected, connection may be unstable");
      }
      lastPingTime = Date.now();
    };

    // setInterval(() => {
    //   const ping = new TextEncoder().encode("ping");
    //   this.sendOverEventStream(ping);
    //   console.log("Ping sent to server");
    // }, 500);
  }
  setupEventStreamReader(reader) {
    (async () => {
      try {
        while (true) {
          const {
            value,
            done
          } = await reader.read();
          if (done) {
            console.log("Event stream closed by server");
            break;
          }
          if (value) {
            const msg = new TextDecoder().decode(value);
            try {
              const event = JSON.parse(msg);
              this.onServerEvent(event);
            } catch (e) {
              console.log("Non-JSON event message:", msg);
            }
          }
        }
      } catch (err) {
        console.error("Error reading from event stream:", err);
      }
    })();
  }
  async sendOverEventStream(data) {
    if (!this.eventStream) {
      console.error("Event stream not available");
      return;
    }
    try {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const len = bytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(bytes, 4);
      await this.eventStream.writer.write(out);
    } catch (error) {
      console.error("Failed to send over event stream:", error);
      throw error;
    }
  }
  async sendEvent(eventData) {
    const eventJson = JSON.stringify(eventData);
    await this.sendOverEventStream(eventJson);
  }
  async sendPublisherState() {
    const stateEvent = {
      type: "PublisherState",
      streamId: this.streamId,
      hasCamera: this.hasCamera,
      hasMic: this.hasMic,
      cameraEnabled: this.hasCamera ? this.cameraEnabled : false,
      micEnabled: this.hasMic ? this.micEnabled : false,
      streamType: this.streamType,
      // 'camera' or 'display'
      timestamp: Date.now()
    };
    await this.sendEvent(stateEvent);
    this.onStatusUpdate("Publisher state sent to server");
  }
  async createBidirectionalStream(channelName) {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;
    const writer = writable.getWriter();
    const reader = readable.getReader();
    this.publishStreams.set(channelName, {
      writer,
      reader,
      configSent: false,
      config: null
    });
    console.log(`WebTransport bidirectional stream (${channelName}) established`);
    const initData = new TextEncoder().encode(channelName);
    await this.sendOverStream(channelName, initData);
    this.setupStreamReader(channelName, reader);
    console.log(`Stream created: ${channelName}`);
  }
  setupStreamReader(channelName, reader) {
    (async () => {
      try {
        while (true) {
          const {
            value,
            done
          } = await reader.read();
          if (done) {
            console.log(`Stream ${channelName} closed by server`);
            break;
          }
          if (value) {
            const msg = new TextDecoder().decode(value);
            if (msg.startsWith("ack:") || msg.startsWith("config:")) {
              console.log(`${channelName} received:`, msg);
            }
          }
        }
      } catch (err) {
        console.error(`Error reading from stream ${channelName}:`, err);
      }
    })();
  }
  async sendOverStream(channelName, frameBytes) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) {
      console.error(`Stream ${channelName} not found`);
      return;
    }
    try {
      const len = frameBytes.length;
      const out = new Uint8Array(4 + len);
      const view = new DataView(out.buffer);
      view.setUint32(0, len, false);
      out.set(frameBytes, 4);
      await streamData.writer.write(out);
    } catch (error) {
      console.error(`Failed to send over stream ${channelName}:`, error);
      throw error;
    }
  }
  async startStreaming() {
    // Start video capture
    await this.startVideoCapture();

    // Start audio streaming
    this.audioProcessor = await this.startOpusAudioStreaming();
  }
  async startVideoCapture() {
    if (!this.stream) {
      throw new Error("No media stream available");
    }
    this.initVideoEncoders();
    this.videoEncoders.forEach(encoderObj => {
      console.log(`Configuring encoder for ${encoderObj.channelName}`, encoderObj, "config", encoderObj.config);
      encoderObj.encoder.configure(encoderObj.config);
    });
    const triggerWorker = new Worker("polyfills/triggerWorker.js");
    triggerWorker.postMessage({
      frameRate: this.currentConfig.framerate
    });
    const track = this.stream.getVideoTracks()[0];
    console.log("Using video track:", track);
    this.videoProcessor = new MediaStreamTrackProcessor(track, triggerWorker, true);
    const reader = this.videoProcessor.readable.getReader();
    console.log("Video processor reader created:", reader);
    let frameCounter = 0;
    const cameraEncoders = Array.from(this.videoEncoders.entries()).filter(([_, obj]) => obj.channelName.startsWith("cam"));

    // Process video frames
    (async () => {
      try {
        while (this.isPublishing) {
          const result = await reader.read();
          if (result.done) break;
          const frame = result.value;
          if (!window.videoBaseTimestamp) {
            window.videoBaseTimestamp = frame.timestamp;
          }
          if (!this.cameraEnabled) {
            console.log("Camera disabled, skipping frame");
            frame.close();
            continue;
          }
          frameCounter++;
          const keyFrame = frameCounter % 30 === 0;
          for (let i = 0; i < cameraEncoders.length; i++) {
            const [quality, encoderObj] = cameraEncoders[i];
            const isLastEncoder = i === cameraEncoders.length - 1;
            if (encoderObj.encoder.encodeQueueSize <= 2) {
              const frameToEncode = isLastEncoder ? frame : new VideoFrame(frame);
              encoderObj.encoder.encode(frameToEncode, {
                keyFrame
              });
              frameToEncode.close();
            }
          }
        }
      } catch (error) {
        this.onStatusUpdate(`Video processing error: ${error.message}`, true);
        console.error("Video capture error:", error);
      }
    })();
  }
  async startOpusAudioStreaming() {
    if (!this.stream) {
      throw new Error("No media stream available");
    }
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error("No audio track found in stream");
    }
    const audioRecorderOptions = {
      encoderApplication: 2051,
      encoderComplexity: 0,
      encoderFrameSize: 20,
      timeSlice: 100
    };
    const audioRecorder = await this.initAudioRecorder(audioTrack, audioRecorderOptions);
    audioRecorder.ondataavailable = typedArray => this.handleOpusAudioChunk(typedArray, "mic_48k");
    await audioRecorder.start({
      timeSlice: audioRecorderOptions.timeSlice
    });
    return audioRecorder;
  }
  handleVideoChunk(chunk, metadata, quality, channelName) {
    const encoderObj = this.videoEncoders.get(quality);
    if (!encoderObj) return;
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;
    if (metadata && metadata.decoderConfig && !encoderObj.metadataReady) {
      encoderObj.videoDecoderConfig = {
        codec: metadata.decoderConfig.codec,
        codedWidth: metadata.decoderConfig.codedWidth,
        codedHeight: metadata.decoderConfig.codedHeight,
        frameRate: this.currentConfig.framerate,
        description: metadata.decoderConfig.description
      };
      encoderObj.metadataReady = true;
      console.warn("Video config ready for", channelName, encoderObj.videoDecoderConfig);
      this.sendStreamConfig(channelName, encoderObj.videoDecoderConfig, "video");
    }
    if (!streamData.configSent) return;
    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);
    let type;
    switch (channelName) {
      case "cam_360p":
        type = chunk.type === "key" ? 0 : 1;
        break;
      case "cam_720p":
        type = chunk.type === "key" ? 2 : 3;
        break;
      case "screen_share_1080p":
        type = chunk.type === "key" ? 4 : 5;
        break;
      default:
        type = 8;
      // other
    }
    // const type = chunk.type === "key" ? "video-key" : "video-delta";

    const packet = this.createPacketWithHeader(chunkData, chunk.timestamp, type);
    this.sendOverStream(channelName, packet);
    this.sequenceNumber++;
  }
  handleOpusAudioChunk(typedArray, channelName) {
    if (!this.micEnabled) return;
    if (!this.isChannelOpen || !typedArray || typedArray.byteLength === 0) return;
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;
    try {
      const dataArray = new Uint8Array(typedArray);
      // Check for Opus header "OggS"
      if (dataArray.length >= 4 && dataArray[0] === 79 && dataArray[1] === 103 && dataArray[2] === 103 && dataArray[3] === 83) {
        if (!streamData.configSent && !streamData.config) {
          const description = this.createPacketWithHeader(dataArray, performance.now() * 1000, 6);
          const audioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 1,
            description: description
          };
          streamData.config = audioConfig;
          this.sendStreamConfig(channelName, audioConfig, "audio");
        }

        // Initialize timing
        if (this.opusBaseTime === 0 && window.videoBaseTimestamp) {
          this.opusBaseTime = window.videoBaseTimestamp;
          window.audioStartPerfTime = performance.now();
          this.opusSamplesSent = 0;
          this.opusChunkCount = 0;
        } else if (this.opusBaseTime === 0 && !window.videoBaseTimestamp) {
          this.opusBaseTime = performance.now() * 1000;
          this.opusSamplesSent = 0;
          this.opusChunkCount = 0;
        }
        const timestamp = this.opusBaseTime + Math.floor(this.opusSamplesSent * 1000000 / this.kSampleRate);
        if (streamData.configSent) {
          const packet = this.createPacketWithHeader(dataArray, timestamp, 6);
          this.sendOverStream(channelName, packet);
        }
      }
    } catch (error) {
      console.error("Failed to send audio data:", error);
    }
  }
  async sendStreamConfig(channelName, config, mediaType) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData || streamData.configSent) return;
    try {
      let configPacket;
      if (mediaType === "video") {
        const vConfigUint8 = new Uint8Array(config.description);
        const vConfigBase64 = this.uint8ArrayToBase64(vConfigUint8);
        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "video",
          config: {
            codec: config.codec,
            codedWidth: config.codedWidth,
            codedHeight: config.codedHeight,
            frameRate: config.frameRate,
            quality: config.quality,
            description: vConfigBase64
          }
        };
      } else if (mediaType === "audio") {
        const aConfigBase64 = this.uint8ArrayToBase64(new Uint8Array(config.description));
        configPacket = {
          type: "StreamConfig",
          channelName: channelName,
          mediaType: "audio",
          config: {
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            description: aConfigBase64
          }
        };
      }
      console.log("send stream config", configPacket);
      const packet = new TextEncoder().encode(JSON.stringify(configPacket));
      await this.sendOverStream(channelName, packet);
      streamData.configSent = true;
      streamData.config = config;
      this.onStatusUpdate(`Config sent for stream: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send config for ${channelName}:`, error);
    }
  }
  createPacketWithHeader(data, timestamp, type) {
    let adjustedTimestamp = timestamp;
    if (window.videoBaseTimestamp) {
      adjustedTimestamp = timestamp - window.videoBaseTimestamp;
    }
    let safeTimestamp = Math.floor(adjustedTimestamp / 1000);
    if (safeTimestamp < 0) safeTimestamp = 0;
    const HEADER_SIZE = 5;
    const MAX_TS = 0xffffffff;
    const MIN_TS = 0;
    if (safeTimestamp > MAX_TS) safeTimestamp = MAX_TS;
    if (safeTimestamp < MIN_TS) safeTimestamp = MIN_TS;
    const packet = new Uint8Array(HEADER_SIZE + (data instanceof ArrayBuffer ? data.byteLength : data.length));
    // type mapping
    // video-360p-key = 0
    // video-360p-delta = 1
    // video-720p-key = 2
    // video-720p-delta = 3
    // video-1080p-key = 4
    // video-1080p-delta = 5
    // audio = 6
    // config = 7
    // other = 8

    packet[4] = type;
    const view = new DataView(packet.buffer, 0, 4);
    view.setUint32(0, safeTimestamp, false);
    packet.set(data instanceof ArrayBuffer ? new Uint8Array(data) : data, HEADER_SIZE);
    return packet;
  }
  uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  /**
   * Start screen sharing
   */
  async startShareScreen(stream) {
    if (!stream) {
      throw new Error("No stream provided for screen sharing");
    }
    this.screenStream = stream;
    this.isScreenSharing = true;
    const channelName = "screen_share_1080p";
    try {
      // Create WebTransport stream for screen share
      await this.createBidirectionalStream(channelName);

      // Send start_share_screen event
      const startEvent = {
        type: "start_share_screen",
        sender_stream_id: this.streamId
      };
      await this.sendEvent(startEvent);
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track found in screen share stream");
      }

      // Setup screen share video encoder
      const screenConfig = this.subStreams.find(s => s.channelName === channelName);
      const screenEncoder = new VideoEncoder({
        output: (chunk, metadata) => this.handleScreenVideoChunk(chunk, metadata, channelName),
        error: e => this.onStatusUpdate(`Screen encoder error: ${e.message}`, true)
      });
      const encoderConfig = {
        codec: this.currentConfig.codec,
        width: screenConfig.width,
        height: screenConfig.height,
        bitrate: screenConfig.bitrate,
        framerate: screenConfig.framerate,
        latencyMode: "realtime",
        hardwareAcceleration: "prefer-hardware"
      };
      screenEncoder.configure(encoderConfig);
      this.screenVideoEncoder = {
        encoder: screenEncoder,
        config: encoderConfig,
        metadataReady: false,
        videoDecoderConfig: null
      };

      // Setup screen share audio if available
      if (audioTrack) {
        const audioRecorderOptions = {
          encoderApplication: 2051,
          encoderComplexity: 0,
          encoderFrameSize: 20,
          timeSlice: 100
        };
        this.screenAudioRecorder = await this.initAudioRecorder(audioTrack, audioRecorderOptions);
        this.screenAudioRecorder.ondataavailable = typedArray => this.handleScreenAudioChunk(typedArray, channelName);
        await this.screenAudioRecorder.start({
          timeSlice: audioRecorderOptions.timeSlice
        });
        this.screenAudioBaseTime = 0;
        this.screenAudioSamplesSent = 0;
      }

      // Start video processing
      const triggerWorker = new Worker("polyfills/triggerWorker.js");
      triggerWorker.postMessage({
        frameRate: screenConfig.framerate
      });
      this.screenVideoProcessor = new MediaStreamTrackProcessor(videoTrack, triggerWorker, true);
      const reader = this.screenVideoProcessor.readable.getReader();
      let frameCounter = 0;

      // Handle video track ending
      videoTrack.onended = () => {
        this.stopShareScreen();
      };

      // Process screen share video frames
      (async () => {
        try {
          while (this.isScreenSharing) {
            const result = await reader.read();
            if (result.done) break;
            const frame = result.value;
            if (!window.screenBaseTimestamp) {
              window.screenBaseTimestamp = frame.timestamp;
            }
            frameCounter++;
            const keyFrame = frameCounter % 30 === 0;
            if (this.screenVideoEncoder.encoder.encodeQueueSize <= 2) {
              this.screenVideoEncoder.encoder.encode(frame, {
                keyFrame
              });
            }
            frame.close();
          }
        } catch (error) {
          this.onStatusUpdate(`Screen share video error: ${error.message}`, true);
          console.error("Screen share video error:", error);
        }
      })();
      this.onStatusUpdate("Screen sharing started");
    } catch (error) {
      this.onStatusUpdate(`Failed to start screen share: ${error.message}`, true);
      this.stopShareScreen();
      throw error;
    }
  }

  /**
   * Stop screen sharing
   */
  async stopShareScreen() {
    if (!this.isScreenSharing) {
      return;
    }
    try {
      this.isScreenSharing = false;
      const channelName = "screen_share_1080p";

      // Send stop event to server
      const stopEvent = {
        type: "stop_share_screen",
        sender_stream_id: this.streamId
      };
      await this.sendEvent(stopEvent);

      // Stop and close video encoder
      if (this.screenVideoEncoder && this.screenVideoEncoder.encoder) {
        if (this.screenVideoEncoder.encoder.state !== "closed") {
          await this.screenVideoEncoder.encoder.flush();
          this.screenVideoEncoder.encoder.close();
        }
        this.screenVideoEncoder = null;
      }

      // Stop audio recorder
      if (this.screenAudioRecorder && typeof this.screenAudioRecorder.stop === "function") {
        await this.screenAudioRecorder.stop();
        this.screenAudioRecorder = null;
      }

      // Close screen share stream
      const streamData = this.publishStreams.get(channelName);
      if (streamData && streamData.writer) {
        await streamData.writer.close();
        this.publishStreams.delete(channelName);
      }

      // Stop all tracks in screen stream
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
      }

      // Reset state
      this.screenAudioBaseTime = 0;
      this.screenAudioSamplesSent = 0;
      this.screenAudioConfig = null;
      window.screenBaseTimestamp = null;
      this.onStatusUpdate("Screen sharing stopped");
    } catch (error) {
      this.onStatusUpdate(`Error stopping screen share: ${error.message}`, true);
      throw error;
    }
  }

  /**
   * Handle screen share video chunks
   */
  handleScreenVideoChunk(chunk, metadata, channelName) {
    if (!this.screenVideoEncoder) return;
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;

    // Handle metadata
    if (metadata && metadata.decoderConfig && !this.screenVideoEncoder.metadataReady) {
      this.screenVideoEncoder.videoDecoderConfig = {
        codec: metadata.decoderConfig.codec,
        codedWidth: metadata.decoderConfig.codedWidth,
        codedHeight: metadata.decoderConfig.codedHeight,
        frameRate: this.screenVideoEncoder.config.framerate,
        description: metadata.decoderConfig.description
      };
      this.screenVideoEncoder.metadataReady = true;
      console.log("Screen video config ready:", this.screenVideoEncoder.videoDecoderConfig);
      this.sendScreenDecoderConfigs(channelName);
    }
    if (!streamData.configSent) return;
    const chunkData = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(chunkData);
    const type = chunk.type === "key" ? 4 : 5; // screen_share_1080p key/delta

    const packet = this.createPacketWithHeader(chunkData, chunk.timestamp, type);
    this.sendOverStream(channelName, packet);
  }

  /**
   * Handle screen share audio chunks
   */
  handleScreenAudioChunk(typedArray, channelName) {
    if (!this.isScreenSharing || !typedArray || typedArray.byteLength === 0) return;
    const streamData = this.publishStreams.get(channelName);
    if (!streamData) return;
    try {
      const dataArray = new Uint8Array(typedArray);

      // Check for Opus header
      if (dataArray.length >= 4 && dataArray[0] === 79 && dataArray[1] === 103 && dataArray[2] === 103 && dataArray[3] === 83) {
        if (!this.screenAudioConfig) {
          const description = this.createPacketWithHeader(dataArray, performance.now() * 1000, 6);
          this.screenAudioConfig = {
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 2,
            description: description
          };
          console.log("Screen audio config ready:", this.screenAudioConfig);
          this.sendScreenDecoderConfigs(channelName);
        }

        // Initialize timing
        if (this.screenAudioBaseTime === 0 && window.screenBaseTimestamp) {
          this.screenAudioBaseTime = window.screenBaseTimestamp;
          this.screenAudioSamplesSent = 0;
        } else if (this.screenAudioBaseTime === 0 && !window.screenBaseTimestamp) {
          this.screenAudioBaseTime = performance.now() * 1000;
          this.screenAudioSamplesSent = 0;
        }
        const timestamp = this.screenAudioBaseTime + Math.floor(this.screenAudioSamplesSent * 1000000 / 48000);
        if (streamData.configSent) {
          const packet = this.createPacketWithHeader(dataArray, timestamp, 6);
          this.sendOverStream(channelName, packet);
        }
        this.screenAudioSamplesSent += 960;
      }
    } catch (error) {
      console.error("Failed to send screen audio data:", error);
    }
  }

  /**
   * Send screen share decoder configs
   */
  async sendScreenDecoderConfigs(channelName) {
    const streamData = this.publishStreams.get(channelName);
    if (!streamData || streamData.configSent) return;
    const hasAudio = this.screenAudioRecorder !== null;
    const videoReady = this.screenVideoEncoder && this.screenVideoEncoder.metadataReady;
    const audioReady = !hasAudio || this.screenAudioConfig;
    if (!videoReady || !audioReady) {
      return;
    }
    try {
      const vConfigUint8 = new Uint8Array(this.screenVideoEncoder.videoDecoderConfig.description);
      const vConfigBase64 = this.uint8ArrayToBase64(vConfigUint8);
      const config = {
        type: "DecoderConfigs",
        channelName: channelName,
        videoConfig: {
          codec: this.screenVideoEncoder.videoDecoderConfig.codec,
          codedWidth: this.screenVideoEncoder.videoDecoderConfig.codedWidth,
          codedHeight: this.screenVideoEncoder.videoDecoderConfig.codedHeight,
          frameRate: this.screenVideoEncoder.videoDecoderConfig.frameRate,
          description: vConfigBase64
        }
      };
      if (this.screenAudioConfig) {
        const aConfigBase64 = this.uint8ArrayToBase64(new Uint8Array(this.screenAudioConfig.description));
        config.audioConfig = {
          codec: this.screenAudioConfig.codec,
          sampleRate: this.screenAudioConfig.sampleRate,
          numberOfChannels: this.screenAudioConfig.numberOfChannels,
          description: aConfigBase64
        };
      }
      console.log("Sending screen share decoder configs:", config);
      const packet = new TextEncoder().encode(JSON.stringify(config));
      await this.sendOverStream(channelName, packet);
      streamData.configSent = true;
      this.onStatusUpdate(`Screen share configs sent for: ${channelName}`);
    } catch (error) {
      console.error(`Failed to send screen share configs:`, error);
    }
  }
  async stop() {
    if (!this.isPublishing) {
      return;
    }
    try {
      this.isPublishing = false;

      // Stop screen sharing if active
      if (this.isScreenSharing) {
        await this.stopShareScreen();
      }

      // Close video encoders
      for (const [quality, encoderObj] of this.videoEncoders) {
        if (encoderObj.encoder && encoderObj.encoder.state !== "closed") {
          await encoderObj.encoder.flush();
          encoderObj.encoder.close();
        }
      }
      this.videoEncoders.clear();

      // Stop audio processor
      if (this.audioProcessor && typeof this.audioProcessor.stop === "function") {
        await this.audioProcessor.stop();
        this.audioProcessor = null;
      }

      // Close all streams
      for (const [channelName, streamData] of this.publishStreams) {
        if (streamData.writer) {
          await streamData.writer.close();
        }
      }
      this.publishStreams.clear();

      // Close event stream
      if (this.eventStream && this.eventStream.writer) {
        await this.eventStream.writer.close();
        this.eventStream = null;
      }

      // Close WebTransport
      if (this.webTransport) {
        this.webTransport.close();
        this.webTransport = null;
      }

      // Stop all tracks
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }

      // Reset state
      this.isChannelOpen = false;
      this.sequenceNumber = 0;
      this.opusBaseTime = 0;
      this.opusSamplesSent = 0;
      this.opusChunkCount = 0;

      // Clear global variables
      window.videoBaseTimestamp = null;
      window.audioStartPerfTime = null;
      this.onStreamStop();
      this.onStatusUpdate("Publishing stopped");
    } catch (error) {
      this.onStatusUpdate(`Error stopping publishing: ${error.message}`, true);
      throw error;
    }
  }

  // Getters for state
  get isActive() {
    return this.isPublishing;
  }
  get streamInfo() {
    return {
      streamType: this.streamType,
      config: this.currentConfig,
      sequenceNumber: this.sequenceNumber,
      activeStreams: Array.from(this.publishStreams.keys())
    };
  }
}

/**
 * Enhanced Subscriber class for receiving media streams
 * Refactored from EnhancedSubscriber with better structure
 */
class Subscriber extends EventEmitter$1 {
  constructor(config) {
    super();

    // Configuration
    this.streamId = config.streamId || "";
    this.roomId = config.roomId || "";
    this.host = config.host || "stream-gate.bandia.vn";
    this.isOwnStream = config.isOwnStream || false;

    // Media configuration
    this.mediaWorkerUrl = config.mediaWorkerUrl || "workers/media-worker-ab.js";
    this.audioWorkletUrl = config.audioWorkletUrl || "workers/audio-worklet1.js";
    this.mstgPolyfillUrl = config.mstgPolyfillUrl || "polyfills/MSTG_polyfill.js";

    // State
    this.isStarted = false;
    this.isAudioEnabled = true;
    this.connectionStatus = "disconnected"; // 'disconnected', 'connecting', 'connected', 'failed'

    // Media components
    this.worker = null;
    this.audioWorkletNode = null;
    this.videoGenerator = null;
    this.videoWriter = null;
    this.mediaStream = null;

    // Unique subscriber ID
    this.subscriberId = `subscriber_${this.streamId}_${Date.now()}`;

    // Audio mixer reference (will be set externally)
    this.audioMixer = null;
  }

  /**
   * Start the subscriber
   */
  async start() {
    if (this.isStarted) {
      throw new Error("Subscriber already started");
    }
    try {
      console.log("Starting subscriber:", this.subscriberId);
      this.emit("starting", {
        subscriber: this
      });
      this._updateConnectionStatus("connecting");
      const channel = new MessageChannel();
      await this._loadPolyfill();
      await this._initWorker(channel.port2);
      await this._initAudioSystem(channel.port1);
      this._initVideoSystem();
      this.isStarted = true;
      this._updateConnectionStatus("connected");
      this.emit("started", {
        subscriber: this
      });
    } catch (error) {
      this._updateConnectionStatus("failed");
      this.emit("error", {
        subscriber: this,
        error,
        action: "start"
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    try {
      this.emit("stopping", {
        subscriber: this
      });

      // Remove from audio mixer
      if (this.audioMixer) {
        this.audioMixer.removeSubscriber(this.subscriberId);
      }

      // Terminate worker
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      // Emit stream removal event for app integration
      if (this.mediaStream) {
        this.emit("streamRemoved", {
          streamId: this.streamId,
          subscriberId: this.subscriberId,
          roomId: this.roomId
        });
      }

      // Close video components
      this._cleanupVideoSystem();

      // Clear references
      this.audioWorkletNode = null;
      this.mediaStream = null;
      this.isStarted = false;
      this._updateConnectionStatus("disconnected");
      this.emit("stopped", {
        subscriber: this
      });
    } catch (error) {
      this.emit("error", {
        subscriber: this,
        error,
        action: "stop"
      });
    }
  }

  /**
   * Toggle audio on/off
   */
  async toggleAudio() {
    if (!this.isStarted || !this.worker) {
      throw new Error("Subscriber not started");
    }
    try {
      this.worker.postMessage({
        type: "toggleAudio"
      });
      this.isAudioEnabled = !this.isAudioEnabled;
      this.emit("audioToggled", {
        subscriber: this,
        enabled: this.isAudioEnabled
      });
      return this.isAudioEnabled;
    } catch (error) {
      this.emit("error", {
        subscriber: this,
        error,
        action: "toggleAudio"
      });
      throw error;
    }
  }

  /**
   * Set audio mixer reference
   */
  setAudioMixer(audioMixer) {
    this.audioMixer = audioMixer;
  }

  /**
   * Get subscriber info
   */
  getInfo() {
    return {
      subscriberId: this.subscriberId,
      streamId: this.streamId,
      roomId: this.roomId,
      host: this.host,
      isOwnStream: this.isOwnStream,
      isStarted: this.isStarted,
      isAudioEnabled: this.isAudioEnabled,
      connectionStatus: this.connectionStatus
    };
  }

  /**
   * Load MediaStreamTrackGenerator polyfill if needed
   */
  async _loadPolyfill() {
    if (!window.MediaStreamTrackGenerator) {
      try {
        await import(this.mstgPolyfillUrl);
      } catch (error) {
        console.warn("Failed to load MSTG polyfill:", error);
      }
    }
  }

  /**
   * Initialize media worker
   */
  async _initWorker(channelPort) {
    try {
      this.worker = new Worker(`${this.mediaWorkerUrl}?t=${Date.now()}`, {
        type: "module"
      });
      this.worker.onmessage = e => this._handleWorkerMessage(e);
      this.worker.onerror = error => {
        this.emit("error", {
          subscriber: this,
          error: new Error(`Media Worker error: ${error.message}`),
          action: "workerError"
        });
      };
      const mediaUrl = `wss://sfu-adaptive-bitrate.ermis-network.workers.dev/meeting/${this.roomId}/${this.streamId}`;
      console.log("try to init worker with url:", mediaUrl);
      this.worker.postMessage({
        type: "init",
        data: {
          mediaUrl
        },
        port: channelPort,
        quality: "360p" // default quality
      }, [channelPort]);
    } catch (error) {
      throw new Error(`Worker initialization failed: ${error.message}`);
    }
  }
  switchBitrate(quality) {
    // 360p | 720p
    if (this.worker) {
      this.worker.postMessage({
        type: "switchBitrate",
        quality
      });
    }
  }

  /**
   * Initialize audio system with mixer
   */
  async _initAudioSystem(channelPort) {
    try {
      // Skip audio setup for own stream to prevent echo
      if (this.isOwnStream) {
        this.emit("audioSkipped", {
          subscriber: this,
          reason: "Own stream - preventing echo"
        });
        return;
      }

      // Audio mixer should be set externally before starting
      if (this.audioMixer) {
        console.warn("Adding subscriber to audio mixer in new subscriber:", this.subscriberId);
        this.audioWorkletNode = await this.audioMixer.addSubscriber(this.subscriberId, this.audioWorkletUrl, this.isOwnStream, channelPort);
        if (this.audioWorkletNode) {
          this.audioWorkletNode.port.onmessage = event => {
            const {
              type,
              bufferMs,
              isPlaying,
              newBufferSize
            } = event.data;
            this.emit("audioStatus", {
              subscriber: this,
              type,
              bufferMs,
              isPlaying,
              newBufferSize
            });
          };
        }
      }
      this.emit("audioInitialized", {
        subscriber: this
      });
    } catch (error) {
      throw new Error(`Audio system initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize video system
   */
  _initVideoSystem() {
    try {
      if (typeof MediaStreamTrackGenerator === "function") {
        this.videoGenerator = new MediaStreamTrackGenerator({
          kind: "video"
        });
      } else {
        throw new Error("MediaStreamTrackGenerator not supported in this browser");
      }
      this.videoWriter = this.videoGenerator.writable;

      // Create MediaStream with video track only
      this.mediaStream = new MediaStream([this.videoGenerator]);

      // Emit remote stream ready event for app integration
      this.emit("remoteStreamReady", {
        stream: this.mediaStream,
        streamId: this.streamId,
        subscriberId: this.subscriberId,
        roomId: this.roomId,
        isOwnStream: this.isOwnStream
      });
      this.emit("videoInitialized", {
        subscriber: this
      });
    } catch (error) {
      throw new Error(`Video system initialization failed: ${error.message}`);
    }
  }

  /**
   * Cleanup video system
   */
  _cleanupVideoSystem() {
    try {
      // Close video writer
      if (this.videoWriter) {
        try {
          const writer = this.videoWriter.getWriter();
          writer.releaseLock();
        } catch (e) {
          // Writer might already be released
        }
        this.videoWriter = null;
      }

      // Stop video generator
      if (this.videoGenerator) {
        try {
          if (this.videoGenerator.stop) {
            this.videoGenerator.stop();
          }
        } catch (e) {
          // Generator might already be stopped
        }
        this.videoGenerator = null;
      }
    } catch (error) {
      console.warn("Error cleaning video system:", error);
    }
  }

  /**
   * Handle messages from media worker
   */
  _handleWorkerMessage(e) {
    const {
      type,
      frame,
      message,
      channelData,
      sampleRate,
      numberOfChannels,
      timeStamp,
      subscriberId,
      audioEnabled
    } = e.data;
    switch (type) {
      case "videoData":
        this._handleVideoData(frame);
        break;
      case "status":
        this.emit("status", {
          subscriber: this,
          message,
          isError: false
        });
        break;
      case "error":
        this.emit("status", {
          subscriber: this,
          message,
          isError: true
        });
        this.emit("error", {
          subscriber: this,
          error: new Error(message),
          action: "workerMessage"
        });
        break;
      case "audio-toggled":
        this.emit("audioToggled", {
          subscriber: this,
          enabled: audioEnabled
        });
        break;
      case "skipping":
        this.emit("frameSkipped", {
          subscriber: this
        });
        break;
      case "resuming":
        this.emit("frameResumed", {
          subscriber: this
        });
        break;
      default:
        console.log(`Unknown worker message type: ${type}`, e.data);
    }
  }

  /**
   * Handle video data from worker
   */
  async _handleVideoData(frame) {
    if (this.videoWriter && frame) {
      try {
        const writer = this.videoWriter.getWriter();
        await writer.write(frame);
        writer.releaseLock();
        this.emit("videoFrameProcessed", {
          subscriber: this
        });
      } catch (error) {
        this.emit("error", {
          subscriber: this,
          error: new Error(`Video write error: ${error.message}`),
          action: "videoWrite"
        });
      }
    }
  }

  /**
   * Update connection status
   */
  _updateConnectionStatus(status) {
    if (this.connectionStatus === status) return;
    const previousStatus = this.connectionStatus;
    this.connectionStatus = status;
    this.emit("connectionStatusChanged", {
      subscriber: this,
      status,
      previousStatus
    });
  }
}
var Subscriber$1 = Subscriber;

/**
 * AudioMixer Class for combining multiple subscriber audio streams
 * Provides centralized audio mixing and playback management
 */
class AudioMixer {
  constructor(config = {}) {
    this.audioContext = null;
    this.mixerNode = null;
    this.outputDestination = null;
    this.subscriberNodes = new Map(); // subscriberId -> AudioWorkletNode
    this.isInitialized = false;
    this.outputAudioElement = null;

    // Configuration
    this.masterVolume = config.masterVolume || 0.8;
    this.sampleRate = config.sampleRate || 48000;
    this.bufferSize = config.bufferSize || 256;
    this.enableEchoCancellation = config.enableEchoCancellation !== false;
    this.debug = config.debug || false;
  }

  /**
   * Initialize the audio mixer
   */
  async initialize() {
    if (this.isInitialized) {
      this._debug("AudioMixer already initialized");
      return;
    }
    try {
      // Create shared AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate,
        latencyHint: "interactive"
      });

      // Resume context if suspended (required by some browsers)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Create mixer node (GainNode to combine audio)
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = this.masterVolume;

      // Create output destination
      this.outputDestination = this.audioContext.createMediaStreamDestination();
      this.mixerNode.connect(this.outputDestination);

      // Create hidden audio element for mixed audio playback
      this.outputAudioElement = document.createElement("audio");
      this.outputAudioElement.autoplay = true;
      this.outputAudioElement.style.display = "none";
      this.outputAudioElement.setAttribute("playsinline", "");

      // Disable echo cancellation on output element
      if (this.enableEchoCancellation) {
        this.outputAudioElement.setAttribute("webkitAudioContext", "true");
      }
      document.body.appendChild(this.outputAudioElement);
      this.isInitialized = true;
      this._debug("AudioMixer initialized successfully");

      // Setup error handlers
      this._setupErrorHandlers();
    } catch (error) {
      console.error("Failed to initialize AudioMixer:", error);
      throw error;
    }
  }

  /**
   * Add a subscriber's audio stream to the mixer
   */
  async addSubscriber(subscriberId, audioWorkletUrl, isOwnAudio = false, channelWorkletPort) {
    console.warn(`Adding subscriber ${subscriberId} to audio mixer`);
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Skip adding own audio to prevent echo/feedback
    if (isOwnAudio) {
      this._debug(`Skipping own audio for subscriber ${subscriberId} to prevent echo`);
      return null;
    }

    // Check if subscriber already exists
    if (this.subscriberNodes.has(subscriberId)) {
      this._debug(`Subscriber ${subscriberId} already exists in mixer`);
      return this.subscriberNodes.get(subscriberId);
    }
    try {
      // Load audio worklet if not already loaded
      await this._loadAudioWorklet(audioWorkletUrl);

      // Create AudioWorkletNode for this subscriber
      const workletNode = new AudioWorkletNode(this.audioContext, "jitter-resistant-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      // Connect the port if provided
      if (channelWorkletPort) {
        workletNode.port.postMessage({
          type: "connectWorker",
          port: channelWorkletPort
        }, [channelWorkletPort]);
      }

      // Create gain node for individual volume control
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.0;

      // Connect: workletNode -> gainNode -> mixerNode
      workletNode.connect(gainNode);
      gainNode.connect(this.mixerNode);

      // Store reference with gain node
      this.subscriberNodes.set(subscriberId, {
        workletNode,
        gainNode,
        isActive: true,
        addedAt: Date.now()
      });

      // Update audio element source with mixed stream
      this._updateOutputAudio();

      // Setup message handler
      this._setupWorkletMessageHandler(subscriberId, workletNode);
      this._debug(`Added subscriber ${subscriberId} to audio mixer`);
      return workletNode;
    } catch (error) {
      console.error(`Failed to add subscriber ${subscriberId} to mixer:`, error);
      throw error;
    }
  }

  /**
   * Remove a subscriber from the mixer
   */
  removeSubscriber(subscriberId) {
    const subscriberData = this.subscriberNodes.get(subscriberId);
    if (!subscriberData) {
      this._debug(`Subscriber ${subscriberId} not found in mixer`);
      return false;
    }
    try {
      const {
        workletNode,
        gainNode
      } = subscriberData;

      // Disconnect nodes
      workletNode.disconnect();
      gainNode.disconnect();

      // Remove from map
      this.subscriberNodes.delete(subscriberId);

      // Update audio element if no more subscribers
      this._updateOutputAudio();
      this._debug(`Removed subscriber ${subscriberId} from audio mixer`);
      return true;
    } catch (error) {
      console.error(`Failed to remove subscriber ${subscriberId}:`, error);
      return false;
    }
  }

  /**
   * Set volume for a specific subscriber
   */
  setSubscriberVolume(subscriberId, volume) {
    const subscriberData = this.subscriberNodes.get(subscriberId);
    if (!subscriberData) {
      this._debug(`Subscriber ${subscriberId} not found for volume adjustment`);
      return false;
    }
    try {
      const normalizedVolume = Math.max(0, Math.min(1, volume));
      subscriberData.gainNode.gain.value = normalizedVolume;
      this._debug(`Set volume for subscriber ${subscriberId}: ${normalizedVolume}`);
      return true;
    } catch (error) {
      console.error(`Failed to set volume for subscriber ${subscriberId}:`, error);
      return false;
    }
  }

  /**
   * Mute/unmute a specific subscriber
   */
  setSubscriberMuted(subscriberId, muted) {
    return this.setSubscriberVolume(subscriberId, muted ? 0 : 1);
  }

  /**
   * Set master volume for all mixed audio
   */
  setMasterVolume(volume) {
    if (!this.mixerNode) return false;
    try {
      const normalizedVolume = Math.max(0, Math.min(1, volume));
      this.mixerNode.gain.value = normalizedVolume;
      this.masterVolume = normalizedVolume;
      this._debug(`Set master volume: ${normalizedVolume}`);
      return true;
    } catch (error) {
      console.error("Failed to set master volume:", error);
      return false;
    }
  }

  /**
   * Get mixed audio output stream
   */
  getOutputMediaStream() {
    if (!this.outputDestination) {
      this._debug("Output destination not initialized");
      return null;
    }
    return this.outputDestination.stream;
  }

  /**
   * Get current mixer statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      subscriberCount: this.subscriberNodes.size,
      masterVolume: this.masterVolume,
      audioContextState: this.audioContext?.state || "not-initialized",
      sampleRate: this.audioContext?.sampleRate || 0,
      subscribers: Array.from(this.subscriberNodes.entries()).map(([id, data]) => ({
        id,
        volume: data.gainNode.gain.value,
        isActive: data.isActive,
        addedAt: data.addedAt
      }))
    };
  }

  /**
   * Get list of subscriber IDs
   */
  getSubscriberIds() {
    return Array.from(this.subscriberNodes.keys());
  }

  /**
   * Check if subscriber exists in mixer
   */
  hasSubscriber(subscriberId) {
    return this.subscriberNodes.has(subscriberId);
  }

  /**
   * Suspend audio context (for battery saving)
   */
  async suspend() {
    if (this.audioContext && this.audioContext.state === "running") {
      await this.audioContext.suspend();
      this._debug("Audio context suspended");
    }
  }

  /**
   * Resume audio context
   */
  async resume() {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
      this._debug("Audio context resumed");
    }
  }

  /**
   * Cleanup mixer resources
   */
  async cleanup() {
    this._debug("Starting AudioMixer cleanup");
    try {
      // Remove audio element
      if (this.outputAudioElement) {
        this.outputAudioElement.srcObject = null;
        if (this.outputAudioElement.parentNode) {
          this.outputAudioElement.parentNode.removeChild(this.outputAudioElement);
        }
        this.outputAudioElement = null;
      }

      // Disconnect all subscribers
      for (const [subscriberId, subscriberData] of this.subscriberNodes) {
        try {
          const {
            workletNode,
            gainNode
          } = subscriberData;
          workletNode.disconnect();
          gainNode.disconnect();
        } catch (error) {
          console.error(`Error disconnecting subscriber ${subscriberId}:`, error);
        }
      }
      this.subscriberNodes.clear();

      // Disconnect mixer components
      if (this.mixerNode) {
        this.mixerNode.disconnect();
        this.mixerNode = null;
      }
      if (this.outputDestination) {
        this.outputDestination = null;
      }

      // Close audio context
      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close();
      }

      // Reset state
      this.audioContext = null;
      this.isInitialized = false;
      this._debug("AudioMixer cleanup completed");
    } catch (error) {
      console.error("Error during AudioMixer cleanup:", error);
    }
  }

  /**
   * Load audio worklet module
   */
  async _loadAudioWorklet(audioWorkletUrl) {
    console.warn("Loading audio worklet from:", audioWorkletUrl);
    try {
      await this.audioContext.audioWorklet.addModule(audioWorkletUrl);
      this._debug("Audio worklet loaded:", audioWorkletUrl);
    } catch (error) {
      // Worklet might already be loaded
      if (!error.message.includes("already been loaded")) {
        this._debug("Audio worklet load warning:", error.message);
      }
    }
  }

  /**
   * Update output audio element
   */
  _updateOutputAudio() {
    if (!this.outputAudioElement || !this.outputDestination) return;
    try {
      if (this.subscriberNodes.size > 0) {
        this.outputAudioElement.srcObject = this.outputDestination.stream;
      } else {
        this.outputAudioElement.srcObject = null;
      }
    } catch (error) {
      console.error("Failed to update output audio:", error);
    }
  }

  /**
   * Setup message handler for worklet node
   */
  _setupWorkletMessageHandler(subscriberId, workletNode) {
    workletNode.port.onmessage = event => {
      const {
        type,
        bufferMs,
        isPlaying,
        newBufferSize,
        error
      } = event.data;
      switch (type) {
        case "bufferStatus":
          this._debug(`Subscriber ${subscriberId} buffer: ${bufferMs}ms, playing: ${isPlaying}`);
          break;
        case "bufferSizeChanged":
          this._debug(`Subscriber ${subscriberId} buffer size changed: ${newBufferSize}`);
          break;
        case "error":
          console.error(`Subscriber ${subscriberId} worklet error:`, error);
          break;
        default:
          this._debug(`Subscriber ${subscriberId} worklet message:`, event.data);
      }
    };
    workletNode.port.onerror = error => {
      console.error(`Subscriber ${subscriberId} worklet port error:`, error);
    };
  }

  /**
   * Setup error handlers for audio context
   */
  _setupErrorHandlers() {
    if (!this.audioContext) return;
    this.audioContext.onstatechange = () => {
      this._debug(`Audio context state changed: ${this.audioContext.state}`);
      if (this.audioContext.state === "interrupted") {
        console.warn("Audio context was interrupted");
      }
    };

    // Listen for audio context suspend/resume events
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) ; else {
        // Page visible - resume context if needed
        await this.resume();
      }
    });
  }

  /**
   * Debug logging
   */
  _debug(...args) {
    if (this.debug) {
      console.log("[AudioMixer]", ...args);
    }
  }

  /**
   * Sleep utility for delays
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
var AudioMixer$1 = AudioMixer;

/**
 * Represents a meeting room
 */
class Room extends EventEmitter$1 {
  constructor(config) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.code = config.code;
    this.type = config.type || "main"; // 'main', 'breakout'
    this.parentRoomId = config.parentRoomId || null;
    this.ownerId = config.ownerId;
    this.isActive = false;

    // Configuration
    this.apiClient = config.apiClient;
    this.mediaConfig = config.mediaConfig;

    // Participants management
    this.participants = new Map(); // userId -> Participant
    this.localParticipant = null;

    // Sub rooms (for main rooms only)
    this.subRooms = new Map(); // subRoomId -> Room

    // Media management
    this.audioMixer = null;
    this.pinnedParticipant = null;

    // Connection info
    this.membershipId = null;
    this.streamId = null;

    // Chat management
    this.messages = [];
    this.typingUsers = new Map();
  }

  /**
   * Join this room
   */
  async join(userId) {
    if (this.isActive) {
      throw new Error("Already joined this room");
    }
    try {
      this.emit("joining", {
        room: this
      });
      console.log("Joining room with code", this.code);
      // Join via API
      const joinResponse = await this.apiClient.joinRoom(this.code);

      // Store connection info
      this.id = joinResponse.room_id;
      this.membershipId = joinResponse.id;
      this.streamId = joinResponse.stream_id;

      // Get room details and members
      const roomDetails = await this.apiClient.getRoomById(joinResponse.room_id);
      console.log("Joined room, details:", roomDetails);

      // Update room info
      this._updateFromApiData(roomDetails.room);

      // Setup participants
      await this._setupParticipants(roomDetails.participants, userId);

      // Setup media connections
      await this._setupMediaConnections();
      this.isActive = true;
      this.emit("joined", {
        room: this,
        participants: this.participants
      });
      return {
        room: this,
        localParticipant: this.localParticipant,
        participants: Array.from(this.participants.values())
      };
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "join"
      });
      throw error;
    }
  }

  /**
   * Leave this room
   */
  async leave() {
    if (!this.isActive) {
      return;
    }
    try {
      this.emit("leaving", {
        room: this
      });

      // Cleanup media connections
      await this._cleanupMediaConnections();

      // Cleanup participants
      this._cleanupParticipants();

      // Leave via API
      if (this.membershipId) {
        await this.apiClient.leaveRoom(this.id, this.membershipId);
      }
      this.isActive = false;
      this.emit("left", {
        room: this
      });
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "leave"
      });
      throw error;
    }
  }

  /**
   * Create a sub room (main room only)
   */
  async createSubRoom(config) {
    if (this.type !== "main") {
      throw new Error("Only main rooms can create sub rooms");
    }
    try {
      this.emit("creatingSubRoom", {
        room: this,
        config
      });

      // Create sub room via API
      const subRoomData = await this.apiClient.createSubRoom(this.id, config.name, config.type || "breakout");

      // Create sub room instance
      const subRoom = new Room({
        id: subRoomData.id,
        name: subRoomData.room_name,
        code: subRoomData.room_code,
        type: config.type || "breakout",
        parentRoomId: this.id,
        ownerId: subRoomData.user_id,
        apiClient: this.apiClient,
        mediaConfig: this.mediaConfig
      });

      // Store sub room
      this.subRooms.set(subRoom.id, subRoom);
      this.emit("subRoomCreated", {
        room: this,
        subRoom
      });
      return subRoom;
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "createSubRoom"
      });
      throw error;
    }
  }

  /**
   * Get all sub rooms
   */
  async getSubRooms() {
    if (this.type !== "main") {
      return [];
    }
    try {
      const subRoomsData = await this.apiClient.getSubRooms(this.id);

      // Update local sub rooms map
      for (const subRoomData of subRoomsData) {
        if (!this.subRooms.has(subRoomData.id)) {
          const subRoom = new Room({
            id: subRoomData.id,
            name: subRoomData.room_name,
            code: subRoomData.room_code,
            type: subRoomData.room_type,
            parentRoomId: this.id,
            ownerId: subRoomData.user_id,
            apiClient: this.apiClient,
            mediaConfig: this.mediaConfig
          });
          this.subRooms.set(subRoom.id, subRoom);
        }
      }
      return Array.from(this.subRooms.values());
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "getSubRooms"
      });
      throw error;
    }
  }

  /**
   * Switch to a sub room
   */
  async switchToSubRoom(subRoomCode) {
    try {
      this.emit("switchingToSubRoom", {
        room: this,
        subRoomCode
      });

      // Switch via API
      const switchResponse = await this.apiClient.switchToSubRoom(this.id, subRoomCode);

      // Cleanup current media connections but keep participants
      await this._cleanupMediaConnections();

      // Update connection info for new sub room
      this.membershipId = switchResponse.id;
      this.streamId = switchResponse.stream_id;

      // Setup media connections for sub room
      await this._setupMediaConnections();
      this.emit("switchedToSubRoom", {
        room: this,
        subRoomCode,
        response: switchResponse
      });
      return switchResponse;
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "switchToSubRoom"
      });
      throw error;
    }
  }

  /**
   * Return to main room from sub room
   */
  async returnToMainRoom() {
    if (!this.parentRoomId) {
      throw new Error("This is not a sub room");
    }
    try {
      this.emit("returningToMainRoom", {
        room: this
      });

      // Leave current sub room
      await this.leave();

      // The parent should handle rejoining main room
      this.emit("returnedToMainRoom", {
        room: this
      });
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "returnToMainRoom"
      });
      throw error;
    }
  }
  async sendMessage(text, metadata = {}) {
    if (!this.isActive) {
      throw new Error("Cannot send message: room is not active");
    }
    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot send message: publisher not available");
    }
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Message text is required and must be a non-empty string");
    }
    try {
      const messageId = this._generateMessageId();
      const message = {
        id: messageId,
        text: text.trim(),
        senderId: this.localParticipant.userId,
        senderName: metadata.senderName || this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
        metadata: metadata.customData || {}
      };
      const messageEvent = {
        type: "message",
        ...message
      };
      await this.localParticipant.publisher.sendEvent(messageEvent);
      this.messages.push(message);
      this.emit("messageSent", {
        room: this,
        message
      });
      return message;
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "sendMessage"
      });
      throw error;
    }
  }
  async deleteMessage(messageId) {
    if (!this.isActive) {
      throw new Error("Cannot delete message: room is not active");
    }
    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot delete message: publisher not available");
    }
    try {
      const deleteEvent = {
        type: "messageDelete",
        messageId,
        senderId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now()
      };
      await this.localParticipant.publisher.sendEvent(deleteEvent);
      this.messages = this.messages.filter(m => m.id !== messageId);
      this.emit("messageDeleted", {
        room: this,
        messageId
      });
      return true;
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "deleteMessage"
      });
      throw error;
    }
  }
  async updateMessage(messageId, newText, metadata = {}) {
    if (!this.isActive) {
      throw new Error("Cannot update message: room is not active");
    }
    if (!this.localParticipant?.publisher) {
      throw new Error("Cannot update message: publisher not available");
    }
    if (!newText || typeof newText !== "string" || newText.trim().length === 0) {
      throw new Error("New message text is required and must be a non-empty string");
    }
    try {
      const updateEvent = {
        type: "messageUpdate",
        messageId,
        text: newText.trim(),
        senderId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now(),
        metadata: metadata.customData || {}
      };
      await this.localParticipant.publisher.sendEvent(updateEvent);
      const messageIndex = this.messages.findIndex(m => m.id === messageId);
      if (messageIndex !== -1) {
        this.messages[messageIndex].text = newText.trim();
        this.messages[messageIndex].updatedAt = Date.now();
        this.messages[messageIndex].metadata = {
          ...this.messages[messageIndex].metadata,
          ...updateEvent.metadata
        };
      }
      this.emit("messageUpdated", {
        room: this,
        messageId,
        text: newText.trim()
      });
      return true;
    } catch (error) {
      this.emit("error", {
        room: this,
        error,
        action: "updateMessage"
      });
      throw error;
    }
  }
  async sendTypingIndicator(isTyping = true) {
    if (!this.isActive) {
      return;
    }
    if (!this.localParticipant?.publisher) {
      return;
    }
    try {
      const typingEvent = {
        type: isTyping ? "typingStart" : "typingStop",
        userId: this.localParticipant.userId,
        roomId: this.id,
        timestamp: Date.now()
      };
      await this.localParticipant.publisher.sendEvent(typingEvent);
    } catch (error) {
      console.error("Failed to send typing indicator:", error);
    }
  }
  getMessages(limit = 100) {
    return this.messages.slice(-limit);
  }
  getTypingUsers() {
    return Array.from(this.typingUsers.values());
  }
  clearMessages() {
    this.messages = [];
  }

  /**
   * Add a participant to the room
   */
  addParticipant(memberData, userId) {
    const isLocal = memberData.user_id === userId;
    const participant = new Participant$1({
      userId: memberData.user_id,
      streamId: memberData.stream_id,
      membershipId: memberData.id,
      role: memberData.role,
      roomId: this.id,
      isLocal
    });

    // Setup participant events
    this._setupParticipantEvents(participant);
    this.participants.set(participant.userId, participant);
    if (isLocal) {
      this.localParticipant = participant;
    }
    this.emit("participantAdded", {
      room: this,
      participant
    });
    return participant;
  }

  /**
   * Remove a participant from the room
   */
  removeParticipant(userId) {
    const participant = this.participants.get(userId);
    if (!participant) return null;

    // Cleanup participant
    participant.cleanup();

    // Remove from maps
    this.participants.delete(userId);
    if (this.localParticipant?.userId === userId) {
      this.localParticipant = null;
    }
    if (this.pinnedParticipant?.userId === userId) {
      this.pinnedParticipant = null;
    }
    this.emit("participantRemoved", {
      room: this,
      participant
    });
    return participant;
  }

  /**
   * Get a participant by user ID
   */
  getParticipant(userId) {
    return this.participants.get(userId);
  }

  /**
   * Get all participants
   */
  getParticipants() {
    return Array.from(this.participants.values());
  }

  /**
   * Pin a participant's video
   */
  // pinParticipant(userId) {
  //   const participant = this.participants.get(userId);
  //   if (!participant) return false;

  //   // Unpin current participant
  //   if (this.pinnedParticipant) {
  //     this.pinnedParticipant.isPinned = false;
  //   }

  //   // Pin new participant
  //   participant.isPinned = true;
  //   this.pinnedParticipant = participant;

  //   this.emit("participantPinned", { room: this, participant });

  //   return true;
  // }

  pinParticipant(userId) {
    const participant = this.participants.get(userId);
    if (!participant) return false;

    // Unpin current participant và move về sidebar
    if (this.pinnedParticipant && this.pinnedParticipant !== participant) {
      this.pinnedParticipant.isPinned = false;
    }

    // Pin new participant và move lên main
    participant.isPinned = true;
    this.pinnedParticipant = participant;
    this.emit("participantPinned", {
      room: this,
      participant
    });
    return true;
  }

  /**
   * Unpin currently pinned participant
   */
  // unpinParticipant() {
  //   if (!this.pinnedParticipant) return false;

  //   this.pinnedParticipant.isPinned = false;
  //   const unpinnedParticipant = this.pinnedParticipant;
  //   this.pinnedParticipant = null;

  //   this.emit("participantUnpinned", {
  //     room: this,
  //     participant: unpinnedParticipant,
  //   });

  //   return true;
  // }

  unpinParticipant() {
    if (!this.pinnedParticipant) return false;
    this.pinnedParticipant.isPinned = false;
    const unpinnedParticipant = this.pinnedParticipant;
    this.pinnedParticipant = null;

    // Auto-pin local participant nếu có
    if (this.localParticipant) {
      this.pinParticipant(this.localParticipant.userId);
    }
    this.emit("participantUnpinned", {
      room: this,
      participant: unpinnedParticipant
    });
    return true;
  }

  /**
   * Get room info
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      code: this.code,
      type: this.type,
      parentRoomId: this.parentRoomId,
      ownerId: this.ownerId,
      isActive: this.isActive,
      participantCount: this.participants.size,
      subRoomCount: this.subRooms.size,
      pinnedParticipant: this.pinnedParticipant?.userId || null
    };
  }

  /**
   * Setup participants from API data
   */
  async _setupParticipants(participantsData, userId) {
    for (const participantData of participantsData) {
      this.addParticipant(participantData, userId);
    }
  }

  /**
   * Setup media connections for all participants
   */
  async _setupMediaConnections() {
    // Initialize audio mixer
    if (!this.audioMixer) {
      this.audioMixer = new AudioMixer$1();
      await this.audioMixer.initialize();
    }

    // Setup publisher for local participant
    if (this.localParticipant) {
      await this._setupLocalPublisher();
    }

    // Setup subscribers for remote participants
    for (const participant of this.participants.values()) {
      if (!participant.isLocal) {
        await this._setupRemoteSubscriber(participant);
      }
    }

    // Setup stream event forwarding
    this._setupStreamEventForwarding();
  }

  /**
   * Setup publisher for local participant
   */
  async _setupLocalPublisher() {
    if (!this.localParticipant || !this.streamId) return;

    // Video rendering handled by app through stream events

    const publishUrl = `${this.mediaConfig.webtpUrl}/${this.id}/${this.streamId}`;
    console.log("trying to connect webtransport to", publishUrl);
    const publisher = new Publisher({
      publishUrl,
      streamType: "camera",
      streamId: this.streamId,
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 1_500_000,
      onStatusUpdate: (msg, isError) => {
        this.localParticipant.setConnectionStatus(isError ? "failed" : "connected");
      },
      onServerEvent: async event => {
        await this._handleServerEvent(event);
      }
    });

    // Setup stream event forwarding
    publisher.on("localStreamReady", data => {
      this.emit("localStreamReady", {
        ...data,
        participant: this.localParticipant.getInfo(),
        roomId: this.id
      });
    });
    await publisher.startPublishing();
    this.localParticipant.setPublisher(publisher);
  }

  /**
   * Setup subscriber for remote participant
   */
  async _setupRemoteSubscriber(participant) {
    const subscriber = new Subscriber$1({
      streamId: participant.streamId,
      roomId: this.id,
      host: this.mediaConfig.host,
      streamOutputEnabled: true,
      onStatus: (msg, isError) => {
        participant.setConnectionStatus(isError ? "failed" : "connected");
      },
      audioWorkletUrl: "workers/audio-worklet1.js",
      mstgPolyfillUrl: "polyfills/MSTG_polyfill.js"
    });
    // Add to audio mixer
    if (this.audioMixer) {
      subscriber.setAudioMixer(this.audioMixer);
    }

    // Setup stream event forwarding
    subscriber.on("remoteStreamReady", data => {
      this.emit("remoteStreamReady", {
        ...data,
        participant: participant.getInfo(),
        roomId: this.id
      });
    });

    // subscriber.on("streamRemoved", (data) => {
    //   this.emit("streamRemoved", {
    //     ...data,
    //     participant: participant.getInfo(),
    //     roomId: this.id
    //   });
    // });

    await subscriber.start();
    participant.setSubscriber(subscriber);
  }

  /**
   * Handle server events from publisher
   */
  async _handleServerEvent(event) {
    console.log("-----Received server event----", event);
    if (event.type === "join") {
      const joinedParticipant = event.participant;
      if (joinedParticipant.user_id === this.localParticipant?.userId) return;
      const participant = this.addParticipant({
        user_id: joinedParticipant.user_id,
        stream_id: joinedParticipant.stream_id,
        id: joinedParticipant.membership_id,
        role: joinedParticipant.role
      }, this.localParticipant?.userId);
      await this._setupRemoteSubscriber(participant);
    }
    if (event.type === "leave") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        this.removeParticipant(event.participant.user_id);
        if (!this.pinnedParticipant && this.localParticipant) {
          this.pinParticipant(this.localParticipant.userId);
        }
      }
    }
    if (event.type === "message") {
      const message = {
        id: event.id,
        text: event.text,
        senderId: event.senderId,
        senderName: event.senderName,
        roomId: event.roomId,
        timestamp: event.timestamp,
        metadata: event.metadata || {}
      };
      this.messages.push(message);
      const sender = this.getParticipant(event.senderId);
      this.emit("messageReceived", {
        room: this,
        message,
        sender: sender ? sender.getInfo() : null
      });
    }
    if (event.type === "messageDelete") {
      this.messages = this.messages.filter(m => m.id !== event.messageId);
      this.emit("messageDeleted", {
        room: this,
        messageId: event.messageId,
        senderId: event.senderId
      });
    }
    if (event.type === "messageUpdate") {
      const messageIndex = this.messages.findIndex(m => m.id === event.messageId);
      if (messageIndex !== -1) {
        this.messages[messageIndex].text = event.text;
        this.messages[messageIndex].updatedAt = event.timestamp;
        this.messages[messageIndex].metadata = {
          ...this.messages[messageIndex].metadata,
          ...event.metadata
        };
      }
      this.emit("messageUpdated", {
        room: this,
        messageId: event.messageId,
        text: event.text,
        senderId: event.senderId
      });
    }
    if (event.type === "typingStart") {
      if (event.userId !== this.localParticipant?.userId) {
        this.typingUsers.set(event.userId, {
          userId: event.userId,
          timestamp: event.timestamp
        });
        this.emit("typingStarted", {
          room: this,
          userId: event.userId,
          user: this.getParticipant(event.userId)?.getInfo()
        });
        setTimeout(() => {
          this.typingUsers.delete(event.userId);
          this.emit("typingStopped", {
            room: this,
            userId: event.userId
          });
        }, 5000);
      }
    }
    if (event.type === "typingStop") {
      if (event.userId !== this.localParticipant?.userId) {
        this.typingUsers.delete(event.userId);
        this.emit("typingStopped", {
          room: this,
          userId: event.userId,
          user: this.getParticipant(event.userId)?.getInfo()
        });
      }
    }
    if (event.type === "start_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        participant.isScreenSharing = true;
        this.emit("remoteScreenShareStarted", {
          room: this,
          participant
        });
      }
    }
    if (event.type === "stop_share_screen") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant && participant.userId !== this.localParticipant?.userId) {
        participant.isScreenSharing = false;
        this.emit("remoteScreenShareStopped", {
          room: this,
          participant
        });
      }
    }
    if (event.type === "mic_on") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        participant.updateMicStatus(true);
        this.emit("remoteAudioStatusChanged", {
          room: this,
          participant,
          enabled: true
        });
      }
    }
    if (event.type === "mic_off") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        participant.updateMicStatus(false);
        this.emit("remoteAudioStatusChanged", {
          room: this,
          participant,
          enabled: false
        });
      }
    }
    if (event.type === "camera_on") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        participant.updateCameraStatus(true);
        this.emit("remoteVideoStatusChanged", {
          room: this,
          participant,
          enabled: true
        });
      }
    }
    if (event.type === "camera_off") {
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        participant.updateCameraStatus(false);
        this.emit("remoteVideoStatusChanged", {
          room: this,
          participant,
          enabled: false
        });
      }
    }
    if (event.type === "pin_for_everyone") {
      console.log(`Pin for everyone event received:`, event.participant);
      const participant = this.participants.get(event.participant.user_id);
      if (participant) {
        this.pinParticipant(participant.userId);
        this.emit("participantPinnedForEveryone", {
          room: this,
          participant
        });
      }
    }
    if (event.type === "unpin_for_everyone") {
      console.log(`Unpin for everyone event received`);
      if (this.pinnedParticipant) {
        const participant = this.pinnedParticipant;
        this.unpinParticipant();
        this.emit("participantUnpinnedForEveryone", {
          room: this,
          participant
        });
      }
    }
  }
  _setupParticipantEvents(participant) {
    participant.on("pinToggled", ({
      participant: p,
      pinned
    }) => {
      if (pinned) {
        this.pinParticipant(p.userId);
      } else if (this.pinnedParticipant === p) {
        this.unpinParticipant();
      }
    });
    participant.on("error", ({
      participant: p,
      error,
      action
    }) => {
      this.emit("participantError", {
        room: this,
        participant: p,
        error,
        action
      });
    });
  }

  /**
   * Update room data from API response
   */
  _updateFromApiData(roomData) {
    this.name = roomData.room_name || this.name;
    this.ownerId = roomData.user_id || this.ownerId;
  }

  /**
   * Cleanup media connections
   */
  async _cleanupMediaConnections() {
    // Cleanup audio mixer
    if (this.audioMixer) {
      await this.audioMixer.cleanup();
      this.audioMixer = null;
    }

    // Cleanup all participants' media
    for (const participant of this.participants.values()) {
      if (participant.publisher) {
        participant.publisher.stop();
        participant.publisher = null;
      }
      if (participant.subscriber) {
        participant.subscriber.stop();
        participant.subscriber = null;
      }
    }
  }

  /**
   * Cleanup all participants
   */
  _cleanupParticipants() {
    for (const participant of this.participants.values()) {
      participant.cleanup();
    }
    this.participants.clear();
    this.localParticipant = null;
    this.pinnedParticipant = null;
    this.typingUsers.clear();
  }
  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Setup stream event forwarding for existing participants
   */
  _setupStreamEventForwarding() {
    // Setup for local participant if exists
    if (this.localParticipant && this.localParticipant.publisher) {
      this.localParticipant.publisher.on("localStreamReady", data => {
        this.emit("localStreamReady", {
          ...data,
          participant: this.localParticipant.getInfo(),
          roomId: this.id
        });
      });
    }

    // Setup for remote participants
    for (const participant of this.participants.values()) {
      if (participant.subscriber && !participant.isLocal) {
        participant.subscriber.on("remoteStreamReady", data => {
          this.emit("remoteStreamReady", {
            ...data,
            participant: participant.getInfo(),
            roomId: this.id
          });
        });

        // participant.subscriber.on("streamRemoved", (data) => {
        //   this.emit("streamRemoved", {
        //     ...data,
        //     participant: participant.getInfo(),
        //     roomId: this.id
        //   });
        // });
      }
    }
  }

  /**
   * Remove stream event forwarding
   */
  _removeStreamEventForwarding() {
    // Remove local participant events
    if (this.localParticipant && this.localParticipant.publisher) {
      this.localParticipant.publisher.removeAllListeners("localStreamReady");
    }

    // Remove remote participants events
    for (const participant of this.participants.values()) {
      if (participant.subscriber && !participant.isLocal) {
        participant.subscriber.removeAllListeners("remoteStreamReady");
        participant.subscriber.removeAllListeners("streamRemoved");
      }
    }
  }

  /**
   * Cleanup room resources
   */
  async cleanup() {
    if (this.isActive) {
      await this.leave();
    }

    // Cleanup sub rooms
    for (const subRoom of this.subRooms.values()) {
      await subRoom.cleanup();
    }
    this.subRooms.clear();
    this.removeAllListeners();
  }
}
var Room$1 = Room;

/**
 * SubRoom extends Room with additional functionality for breakout rooms
 */
class SubRoom extends Room$1 {
  constructor(config) {
    super({
      ...config,
      type: config.type || "breakout"
    });
    this.parentRoom = config.parentRoom; // Reference to parent Room instance
    this.maxParticipants = config.maxParticipants || 10;
    this.autoReturn = config.autoReturn || false; // Auto return to main room when empty
    this.duration = config.duration || null; // Duration in minutes, null = unlimited
    this.startTime = null;

    // Sub room specific state
    this.isTemporary = config.isTemporary || true;
    this.allowSelfAssign = config.allowSelfAssign || true;
    this._setupSubRoomEvents();
  }

  /**
   * Join the sub room from main room
   */
  async joinFromMain(userId) {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }
    try {
      this.emit("joiningFromMain", {
        subRoom: this,
        userId
      });

      // Pause main room media without leaving
      await this.parentRoom._pauseMediaConnections();

      // Join this sub room
      const joinResult = await this.join(userId);

      // Start duration timer if set
      if (this.duration && !this.startTime) {
        this.startTime = Date.now();
        this._startDurationTimer();
      }
      this.emit("joinedFromMain", {
        subRoom: this,
        userId,
        joinResult
      });
      return joinResult;
    } catch (error) {
      // Resume main room media on error
      if (this.parentRoom) {
        await this.parentRoom._resumeMediaConnections();
      }
      this.emit("error", {
        subRoom: this,
        error,
        action: "joinFromMain"
      });
      throw error;
    }
  }

  /**
   * Return to main room
   */
  async returnToMainRoom() {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }
    try {
      this.emit("returningToMain", {
        subRoom: this
      });

      // Leave sub room
      await this.leave();

      // Resume main room media
      await this.parentRoom._resumeMediaConnections();
      this.emit("returnedToMain", {
        subRoom: this
      });

      // Check if should cleanup empty room
      if (this.participants.size === 0 && this.autoReturn) {
        await this.cleanup();
      }
      return this.parentRoom;
    } catch (error) {
      this.emit("error", {
        subRoom: this,
        error,
        action: "returnToMainRoom"
      });
      throw error;
    }
  }

  /**
   * Switch to another sub room directly
   */
  async switchToSubRoom(targetSubRoom) {
    if (!this.parentRoom) {
      throw new Error("No parent room reference");
    }
    try {
      this.emit("switchingToSubRoom", {
        fromSubRoom: this,
        toSubRoom: targetSubRoom
      });

      // Leave current sub room
      await this.leave();

      // Join target sub room
      const joinResult = await targetSubRoom.joinFromMain(this.localParticipant?.userId);
      this.emit("switchedToSubRoom", {
        fromSubRoom: this,
        toSubRoom: targetSubRoom
      });
      return joinResult;
    } catch (error) {
      this.emit("error", {
        subRoom: this,
        error,
        action: "switchToSubRoom"
      });
      throw error;
    }
  }

  /**
   * Invite participant to this sub room
   */
  async inviteParticipant(userId) {
    try {
      // Send invitation via API (implementation depends on API support)
      const result = await this.apiClient.inviteToSubRoom(this.id, userId);
      this.emit("participantInvited", {
        subRoom: this,
        userId,
        result
      });
      return result;
    } catch (error) {
      this.emit("error", {
        subRoom: this,
        error,
        action: "inviteParticipant"
      });
      throw error;
    }
  }

  /**
   * Assign participant to this sub room (host action)
   */
  async assignParticipant(userId) {
    try {
      // Force assignment via API
      const result = await this.apiClient.assignToSubRoom(this.id, userId);
      this.emit("participantAssigned", {
        subRoom: this,
        userId,
        result
      });
      return result;
    } catch (error) {
      this.emit("error", {
        subRoom: this,
        error,
        action: "assignParticipant"
      });
      throw error;
    }
  }

  /**
   * Broadcast message to all participants
   */
  async broadcastMessage(message, type = "info") {
    try {
      const result = await this.apiClient.broadcastToSubRoom(this.id, message, type);
      this.emit("messageBroadcast", {
        subRoom: this,
        message,
        type,
        result
      });
      return result;
    } catch (error) {
      this.emit("error", {
        subRoom: this,
        error,
        action: "broadcastMessage"
      });
      throw error;
    }
  }

  /**
   * Get remaining time in minutes
   */
  getRemainingTime() {
    if (!this.duration || !this.startTime) {
      return null;
    }
    const elapsed = (Date.now() - this.startTime) / (1000 * 60); // in minutes
    const remaining = Math.max(0, this.duration - elapsed);
    return Math.ceil(remaining);
  }

  /**
   * Extend sub room duration
   */
  extendDuration(additionalMinutes) {
    if (!this.duration) {
      this.duration = additionalMinutes;
      this.startTime = Date.now();
    } else {
      this.duration += additionalMinutes;
    }
    this.emit("durationExtended", {
      subRoom: this,
      additionalMinutes,
      newDuration: this.duration
    });

    // Restart timer if needed
    if (this.startTime) {
      this._startDurationTimer();
    }
  }

  /**
   * Set participant limit
   */
  setMaxParticipants(limit) {
    this.maxParticipants = limit;
    this.emit("maxParticipantsChanged", {
      subRoom: this,
      maxParticipants: limit
    });

    // If over limit, may need to handle overflow
    if (this.participants.size > limit) {
      this.emit("participantLimitExceeded", {
        subRoom: this,
        current: this.participants.size,
        limit
      });
    }
  }

  /**
   * Check if sub room is full
   */
  isFull() {
    return this.participants.size >= this.maxParticipants;
  }

  /**
   * Check if sub room is empty
   */
  isEmpty() {
    return this.participants.size === 0;
  }

  /**
   * Check if sub room has expired
   */
  hasExpired() {
    if (!this.duration || !this.startTime) {
      return false;
    }
    const elapsed = (Date.now() - this.startTime) / (1000 * 60);
    return elapsed >= this.duration;
  }

  /**
   * Get sub room statistics
   */
  getStats() {
    return {
      ...this.getInfo(),
      maxParticipants: this.maxParticipants,
      duration: this.duration,
      remainingTime: this.getRemainingTime(),
      startTime: this.startTime,
      isFull: this.isFull(),
      isEmpty: this.isEmpty(),
      hasExpired: this.hasExpired(),
      isTemporary: this.isTemporary,
      allowSelfAssign: this.allowSelfAssign,
      autoReturn: this.autoReturn
    };
  }

  /**
   * Setup sub room specific events
   */
  _setupSubRoomEvents() {
    // Handle participant left
    this.on("participantRemoved", ({
      room,
      participant
    }) => {
      // Auto return to main room if empty and configured to do so
      if (this.isEmpty() && this.autoReturn && this.parentRoom) {
        setTimeout(() => {
          if (this.isEmpty()) {
            // Double check after delay
            this.cleanup();
          }
        }, 5000); // 5 second delay
      }
    });

    // Handle room expiry warnings
    if (this.duration) {
      // Warn 5 minutes before expiry
      const warningTime = Math.max(1, this.duration - 5);
      setTimeout(() => {
        if (this.isActive && !this.hasExpired()) {
          this.emit("expiryWarning", {
            subRoom: this,
            remainingMinutes: 5
          });
        }
      }, warningTime * 60 * 1000);
    }
  }

  /**
   * Start duration timer for automatic closure
   */
  _startDurationTimer() {
    if (this._durationTimer) {
      clearTimeout(this._durationTimer);
    }
    if (!this.duration) return;
    const remainingMs = this.getRemainingTime() * 60 * 1000;
    if (remainingMs <= 0) {
      this._handleExpiry();
      return;
    }
    this._durationTimer = setTimeout(() => {
      this._handleExpiry();
    }, remainingMs);
  }

  /**
   * Handle sub room expiry
   */
  async _handleExpiry() {
    this.emit("expired", {
      subRoom: this
    });

    // Notify all participants
    await this.broadcastMessage("Sub room session has expired. Returning to main room.", "warning");

    // Return all participants to main room
    const participants = Array.from(this.participants.values());
    for (const participant of participants) {
      if (participant.isLocal) {
        await this.returnToMainRoom();
      }
    }

    // Cleanup sub room
    await this.cleanup();
  }

  /**
   * Override cleanup to clear timers
   */
  async cleanup() {
    // Clear duration timer
    if (this._durationTimer) {
      clearTimeout(this._durationTimer);
      this._durationTimer = null;
    }

    // Remove from parent room's sub rooms map
    if (this.parentRoom) {
      this.parentRoom.subRooms.delete(this.id);
    }

    // Call parent cleanup
    await super.cleanup();
    this.emit("cleanedUp", {
      subRoom: this
    });
  }

  /**
   * Serialize sub room state for persistence or transfer
   */
  serialize() {
    return {
      ...this.getStats(),
      participantIds: Array.from(this.participants.keys()),
      parentRoomId: this.parentRoom?.id || this.parentRoomId,
      createdAt: this.startTime || Date.now()
    };
  }

  /**
   * Create sub room from serialized data
   */
  static fromSerializedData(data, parentRoom, apiClient, mediaConfig) {
    return new SubRoom({
      id: data.id,
      name: data.name,
      code: data.code,
      type: data.type,
      parentRoom,
      parentRoomId: data.parentRoomId,
      ownerId: data.ownerId,
      maxParticipants: data.maxParticipants,
      duration: data.duration,
      autoReturn: data.autoReturn,
      isTemporary: data.isTemporary,
      allowSelfAssign: data.allowSelfAssign,
      apiClient,
      mediaConfig
    });
  }
}
var SubRoom$1 = SubRoom;

/**
 * Main Ermis Classroom client
 */
class ErmisClient extends EventEmitter$1 {
  constructor(config = {}) {
    super();

    // Configuration
    this.config = {
      host: config.host || "daibo.ermis.network:9992",
      apiUrl: config.apiUrl || `https://${config.host || "daibo.ermis.network:9992"}/meeting`,
      webtpUrl: config.webtpUrl || "https://daibo.ermis.network:4458/meeting/wt",
      reconnectAttempts: config.reconnectAttempts || 3,
      reconnectDelay: config.reconnectDelay || 2000,
      debug: config.debug || false
    };

    // API client
    this.apiClient = new ApiClient$1({
      host: this.config.host,
      apiUrl: this.config.apiUrl
    });

    // State management
    this.state = {
      user: null,
      isAuthenticated: false,
      currentRoom: null,
      rooms: new Map(),
      // roomId -> Room
      connectionStatus: "disconnected" // 'disconnected', 'connecting', 'connected', 'failed'
    };

    // Media configuration
    this.mediaConfig = {
      host: this.config.host,
      webtpUrl: this.config.webtpUrl,
      defaultVideoConfig: {
        width: 1280,
        height: 720,
        framerate: 30,
        bitrate: 1_500_000
      },
      defaultAudioConfig: {
        sampleRate: 48000,
        channels: 2
      }
    };
    this._setupEventHandlers();
  }

  /**
   * Authenticate user
   */
  async authenticate(userId) {
    if (this.state.isAuthenticated && this.state.user?.id === userId) {
      return this.state.user;
    }
    try {
      this.emit("authenticating", {
        userId
      });
      this._setConnectionStatus("connecting");

      // Validate email format if it looks like email
      if (userId.includes("@")) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userId)) {
          throw new Error("Invalid email format");
        }
      }

      // Get authentication token
      const tokenResponse = await this.apiClient.getDummyToken(userId);

      // Set authentication in API client
      this.apiClient.setAuth(tokenResponse.access_token, userId);

      // Update state
      this.state.user = {
        id: userId,
        token: tokenResponse.access_token,
        authenticatedAt: Date.now()
      };
      this.state.isAuthenticated = true;
      this._setConnectionStatus("connected");
      this.emit("authenticated", {
        user: this.state.user
      });
      this._debug("User authenticated successfully:", userId);
      return this.state.user;
    } catch (error) {
      this._setConnectionStatus("failed");
      this.emit("authenticationFailed", {
        userId,
        error
      });
      this._debug("Authentication failed:", error);
      throw error;
    }
  }

  /**
  * Set authentication directly without calling API
  */
  manualAuthenticate(userId, token) {
    if (!userId || !token) {
      throw new Error("userId and token are required");
    }

    // Set auth to API client
    this.apiClient.setAuth(token, userId);

    // Update state
    this.state.user = {
      id: userId,
      token,
      authenticatedAt: Date.now()
    };
    this.state.isAuthenticated = true;

    // Update connection status
    this._setConnectionStatus("connected");

    // Emit event
    this.emit("authenticated", {
      user: this.state.user
    });
    this._debug("Auth set directly:", this.state.user);
  }

  /**
   * Logout user
   */
  async logout() {
    if (!this.state.isAuthenticated) {
      return;
    }
    try {
      this.emit("loggingOut", {
        user: this.state.user
      });

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Reset state
      this.state.user = null;
      this.state.isAuthenticated = false;
      this.state.currentRoom = null;
      this.state.rooms.clear();
      this._setConnectionStatus("disconnected");
      this.emit("loggedOut");
      this._debug("User logged out successfully");
    } catch (error) {
      this.emit("error", {
        error,
        action: "logout"
      });
      throw error;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(config) {
    this._ensureAuthenticated();
    try {
      this.emit("creatingRoom", {
        config
      });
      const roomData = await this.apiClient.createRoom(config.name, config.type);
      const room = new Room$1({
        id: roomData.id,
        name: roomData.room_name,
        code: roomData.room_code,
        type: config.type || "main",
        ownerId: roomData.user_id,
        apiClient: this.apiClient,
        mediaConfig: this.mediaConfig
      });
      this._setupRoomEvents(room);
      this.state.rooms.set(room.id, room);
      this.emit("roomCreated", {
        room
      });
      this._debug("Room created:", room.getInfo());

      // Auto-join if specified
      if (config.autoJoin !== false) {
        await this.joinRoom(room.code);
      }
      return room;
    } catch (error) {
      this.emit("error", {
        error,
        action: "createRoom"
      });
      throw error;
    }
  }

  /**
   * Join a room by code
   */
  async joinRoom(roomCode) {
    this._ensureAuthenticated();
    try {
      this.emit("joiningRoom", {
        roomCode
      });

      // Leave current room if any
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Try to find existing room instance first
      let room = Array.from(this.state.rooms.values()).find(r => r.code === roomCode);
      if (!room) {
        // Create new room instance
        room = new Room$1({
          code: roomCode,
          apiClient: this.apiClient,
          mediaConfig: this.mediaConfig
        });
        this._setupRoomEvents(room);
      }

      // Join the room
      const joinResult = await room.join(this.state.user.id);

      // Update state
      this.state.currentRoom = room;
      this.state.rooms.set(room.id, room);
      this.emit("roomJoined", {
        room,
        joinResult
      });
      this._debug("Joined room:", room.getInfo());
      return joinResult;
    } catch (error) {
      this.emit("error", {
        error,
        action: "joinRoom"
      });
      throw error;
    }
  }

  /**
   * Leave current room
   */
  async leaveRoom() {
    if (!this.state.currentRoom) {
      return;
    }
    try {
      const room = this.state.currentRoom;
      this.emit("leavingRoom", {
        room
      });
      await room.leave();
      this.state.currentRoom = null;
      this.emit("roomLeft", {
        room
      });
      this._debug("Left room:", room.getInfo());
    } catch (error) {
      this.emit("error", {
        error,
        action: "leaveRoom"
      });
      throw error;
    }
  }

  /**
   * Get available rooms
   */
  async getRooms(options = {}) {
    this._ensureAuthenticated();
    try {
      const response = await this.apiClient.listRooms(options.page || 1, options.perPage || 20);
      this.emit("roomsLoaded", {
        rooms: response.data || []
      });
      return response.data || [];
    } catch (error) {
      this.emit("error", {
        error,
        action: "getRooms"
      });
      throw error;
    }
  }

  /**
   * Get current room
   */
  getCurrentRoom() {
    return this.state.currentRoom;
  }

  /**
   * Get room by ID
   */
  getRoom(roomId) {
    return this.state.rooms.get(roomId);
  }

  /**
   * Create sub room in current room
   */
  async createSubRoom(config) {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to create sub rooms");
    }
    if (this.state.currentRoom.type !== "main") {
      throw new Error("Can only create sub rooms from main rooms");
    }
    try {
      this.emit("creatingSubRoom", {
        config,
        parentRoom: this.state.currentRoom
      });
      const subRoom = await this.state.currentRoom.createSubRoom(config);
      this.emit("subRoomCreated", {
        subRoom,
        parentRoom: this.state.currentRoom
      });
      this._debug("Sub room created:", subRoom.getInfo());
      return subRoom;
    } catch (error) {
      this.emit("error", {
        error,
        action: "createSubRoom"
      });
      throw error;
    }
  }

  /**
   * Join a sub room
   */
  async joinSubRoom(subRoomCode) {
    if (!this.state.currentRoom) {
      throw new Error("Must be in a main room to join sub rooms");
    }
    try {
      this.emit("joiningSubRoom", {
        subRoomCode,
        parentRoom: this.state.currentRoom
      });

      // Find sub room
      const subRooms = await this.state.currentRoom.getSubRooms();
      const subRoom = subRooms.find(sr => sr.code === subRoomCode);
      if (!subRoom) {
        throw new Error(`Sub room with code ${subRoomCode} not found`);
      }

      // Join sub room
      const joinResult = await subRoom.joinFromMain(this.state.user.id);
      this.emit("subRoomJoined", {
        subRoom,
        parentRoom: this.state.currentRoom
      });
      this._debug("Joined sub room:", subRoom.getInfo());
      return joinResult;
    } catch (error) {
      this.emit("error", {
        error,
        action: "joinSubRoom"
      });
      throw error;
    }
  }

  /**
   * Return to main room from sub room
   */
  async returnToMainRoom() {
    if (!this.state.currentRoom || this.state.currentRoom.type !== "breakout") {
      throw new Error("Must be in a sub room to return to main room");
    }
    try {
      this.emit("returningToMainRoom", {
        subRoom: this.state.currentRoom
      });
      const subRoom = this.state.currentRoom;
      const mainRoom = await subRoom.returnToMainRoom();
      this.state.currentRoom = mainRoom;
      this.emit("returnedToMainRoom", {
        mainRoom,
        previousSubRoom: subRoom
      });
      this._debug("Returned to main room from sub room");
      return mainRoom;
    } catch (error) {
      this.emit("error", {
        error,
        action: "returnToMainRoom"
      });
      throw error;
    }
  }

  /**
   * Switch between sub rooms
   */
  async switchSubRoom(targetSubRoomCode) {
    if (!this.state.currentRoom || this.state.currentRoom.type !== "breakout") {
      throw new Error("Must be in a sub room to switch to another sub room");
    }
    try {
      this.emit("switchingSubRoom", {
        fromSubRoom: this.state.currentRoom,
        targetSubRoomCode
      });
      const currentSubRoom = this.state.currentRoom;
      const parentRoom = currentSubRoom.parentRoom;

      // Find target sub room
      const subRooms = await parentRoom.getSubRooms();
      const targetSubRoom = subRooms.find(sr => sr.code === targetSubRoomCode);
      if (!targetSubRoom) {
        throw new Error(`Sub room with code ${targetSubRoomCode} not found`);
      }

      // Switch to target sub room
      const joinResult = await currentSubRoom.switchToSubRoom(targetSubRoom);
      this.state.currentRoom = targetSubRoom;
      this.emit("subRoomSwitched", {
        fromSubRoom: currentSubRoom,
        toSubRoom: targetSubRoom
      });
      this._debug("Switched sub rooms:", {
        from: currentSubRoom.getInfo(),
        to: targetSubRoom.getInfo()
      });
      return joinResult;
    } catch (error) {
      this.emit("error", {
        error,
        action: "switchSubRoom"
      });
      throw error;
    }
  }

  /**
   * Get client state
   */
  getState() {
    return {
      user: this.state.user,
      isAuthenticated: this.state.isAuthenticated,
      currentRoom: this.state.currentRoom?.getInfo() || null,
      connectionStatus: this.state.connectionStatus,
      roomCount: this.state.rooms.size
    };
  }

  /**
   * Get client configuration
   */
  getConfig() {
    return {
      ...this.config
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };

    // Update API client if needed
    if (newConfig.host || newConfig.apiUrl) {
      this.apiClient = new ApiClient$1({
        host: this.config.host,
        apiUrl: this.config.apiUrl
      });
      if (this.state.isAuthenticated) {
        this.apiClient.setAuth(this.state.user.token, this.state.user.id);
      }
    }
    this.emit("configUpdated", {
      config: this.config
    });
  }

  /**
   * Enable debug mode
   */
  enableDebug() {
    this.config.debug = true;
    this._debug("Debug mode enabled");
  }

  /**
   * Disable debug mode
   */
  disableDebug() {
    this.config.debug = false;
  }
  async sendMessage(text, metadata = {}) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }
    return await this.state.currentRoom.sendMessage(text, metadata);
  }
  async deleteMessage(messageId) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }
    return await this.state.currentRoom.deleteMessage(messageId);
  }
  async updateMessage(messageId, newText, metadata = {}) {
    if (!this.state.currentRoom) {
      throw new Error("No active room. Join a room first.");
    }
    return await this.state.currentRoom.updateMessage(messageId, newText, metadata);
  }
  async sendTypingIndicator(isTyping = true) {
    if (!this.state.currentRoom) {
      return;
    }
    return await this.state.currentRoom.sendTypingIndicator(isTyping);
  }
  getMessages(limit = 100) {
    if (!this.state.currentRoom) {
      return [];
    }
    return this.state.currentRoom.getMessages(limit);
  }
  getTypingUsers() {
    if (!this.state.currentRoom) {
      return [];
    }
    return this.state.currentRoom.getTypingUsers();
  }
  clearMessages() {
    if (!this.state.currentRoom) {
      return;
    }
    this.state.currentRoom.clearMessages();
  }

  /**
   * Cleanup client resources
   */
  async cleanup() {
    try {
      // Leave current room
      if (this.state.currentRoom) {
        await this.state.currentRoom.leave();
      }

      // Cleanup all rooms
      for (const room of this.state.rooms.values()) {
        await room.cleanup();
      }

      // Clear state
      this.state.rooms.clear();
      this.state.currentRoom = null;

      // Remove all listeners
      this.removeAllListeners();
      this._debug("Client cleanup completed");
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }

  /**
   * Setup event handlers for rooms
   */
  _setupRoomEvents(room) {
    // Forward room events to client
    const eventsToForward = ["roomJoined", "roomLeft", "participantAdded", "participantRemoved", "participantPinned", "participantUnpinned", "subRoomCreated", "localStreamReady", "remoteStreamReady", "streamRemoved", "audioToggled", "videoToggled", "messageSent", "messageReceived", "messageDeleted", "messageUpdated", "typingStarted", "typingStopped", "error"];
    eventsToForward.forEach(event => {
      room.on(event, data => {
        this.emit(event, data);
      });
    });
  }

  /**
   * Setup initial event handlers
   */
  _setupEventHandlers() {
    // Handle authentication token refresh
    this.on("authenticated", () => {
      // Could implement token refresh logic here
    });

    // Handle connection status changes
    this.on("connectionStatusChanged", ({
      status
    }) => {
      if (status === "failed" && this.config.reconnectAttempts > 0) {
        this._attemptReconnect();
      }
    });
  }

  /**
   * Attempt to reconnect
   */
  async _attemptReconnect() {
    let attempts = 0;
    while (attempts < this.config.reconnectAttempts) {
      try {
        attempts++;
        this._debug(`Reconnection attempt ${attempts}/${this.config.reconnectAttempts}`);
        await new Promise(resolve => setTimeout(resolve, this.config.reconnectDelay));
        if (this.state.user) {
          await this.authenticate(this.state.user.id);
          this._debug("Reconnection successful");
          return;
        }
      } catch (error) {
        this._debug(`Reconnection attempt ${attempts} failed:`, error.message);
      }
    }
    this.emit("reconnectionFailed");
    this._debug("All reconnection attempts failed");
  }

  /**
   * Set connection status
   */
  _setConnectionStatus(status) {
    if (this.state.connectionStatus !== status) {
      this.state.connectionStatus = status;
      this.emit("connectionStatusChanged", {
        status
      });
      this._debug("Connection status changed:", status);
    }
  }

  /**
   * Ensure user is authenticated
   */
  _ensureAuthenticated() {
    if (!this.state.isAuthenticated) {
      throw new Error("User must be authenticated first");
    }
  }

  /**
   * Debug logging
   */
  _debug(...args) {
    if (this.config.debug) {
      console.log("[ErmisClient]", ...args);
    }
  }
}
var ErmisClient$1 = ErmisClient;

/**
 * Ermis Classroom SDK
 * Main entry point for the SDK
 */


/**
 * SDK Version
 */
const VERSION = "1.0.0";

/**
 * Main SDK Class - Similar to LiveKit pattern
 */
class ErmisClassroom {
  /**
   * Create a new Ermis Classroom client
   * @param {Object} config - Configuration options
   * @returns {ErmisClient} - New client instance
   */
  static create(config = {}) {
    return new ErmisClient$1(config);
  }

  /**
   * Connect and authenticate user
   * @param {string} serverUrl - Server URL
   * @param {string} userId - User identifier
   * @param {Object} options - Connection options
   * @returns {Promise<ErmisClient>} - Connected client
   */
  static async connect(serverUrl, userId, options = {}) {
    const config = {
      host: serverUrl.replace(/^https?:\/\//, ""),
      ...options
    };
    const client = new ErmisClient$1(config);
    await client.authenticate(userId);
    return client;
  }

  /**
   * Get SDK version
   */
  static get version() {
    return VERSION;
  }

  /**
   * Get available events
   */
  static get events() {
    return {
      // Client events
      CLIENT_AUTHENTICATED: "authenticated",
      CLIENT_AUTHENTICATION_FAILED: "authenticationFailed",
      CLIENT_LOGGED_OUT: "loggedOut",
      CLIENT_CONNECTION_STATUS_CHANGED: "connectionStatusChanged",
      // Room events
      ROOM_CREATED: "roomCreated",
      ROOM_JOINED: "roomJoined",
      ROOM_LEFT: "roomLeft",
      // Participant events
      PARTICIPANT_ADDED: "participantAdded",
      PARTICIPANT_REMOVED: "participantRemoved",
      PARTICIPANT_PINNED: "participantPinned",
      PARTICIPANT_UNPINNED: "participantUnpinned",
      AUDIO_TOGGLED: "audioToggled",
      VIDEO_TOGGLED: "videoToggled",
      // Remote participant status events
      REMOTE_AUDIO_STATUS_CHANGED: "remoteAudioStatusChanged",
      REMOTE_VIDEO_STATUS_CHANGED: "remoteVideoStatusChanged",
      // Screen sharing events
      SCREEN_SHARE_STARTED: "screenShareStarted",
      SCREEN_SHARE_STOPPED: "screenShareStopped",
      REMOTE_SCREEN_SHARE_STARTED: "remoteScreenShareStarted",
      REMOTE_SCREEN_SHARE_STOPPED: "remoteScreenShareStopped",
      // Pin for everyone events
      PARTICIPANT_PINNED_FOR_EVERYONE: "participantPinnedForEveryone",
      PARTICIPANT_UNPINNED_FOR_EVERYONE: "participantUnpinnedForEveryone",
      // Sub room events
      SUB_ROOM_CREATED: "subRoomCreated",
      SUB_ROOM_JOINED: "subRoomJoined",
      SUB_ROOM_LEFT: "subRoomLeft",
      SUB_ROOM_SWITCHED: "subRoomSwitched",
      // Media stream events
      LOCAL_STREAM_READY: "localStreamReady",
      REMOTE_STREAM_READY: "remoteStreamReady",
      STREAM_REMOVED: "streamRemoved",
      // Chat events
      MESSAGE_SENT: "messageSent",
      MESSAGE_RECEIVED: "messageReceived",
      MESSAGE_DELETED: "messageDeleted",
      MESSAGE_UPDATED: "messageUpdated",
      TYPING_STARTED: "typingStarted",
      TYPING_STOPPED: "typingStopped",
      CHAT_HISTORY_LOADED: "chatHistoryLoaded",
      // Error events
      ERROR: "error"
    };
  }

  /**
   * Media device utilities
   */
  static get MediaDevices() {
    return {
      /**
       * Get available media devices
       */
      async getDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) {
          throw new Error("Media devices not supported");
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        return {
          cameras: devices.filter(d => d.kind === "videoinput"),
          microphones: devices.filter(d => d.kind === "audioinput"),
          speakers: devices.filter(d => d.kind === "audiooutput")
        };
      },
      /**
       * Get user media with constraints
       */
      async getUserMedia(constraints = {
        video: true,
        audio: true
      }) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia not supported");
        }
        return await navigator.mediaDevices.getUserMedia(constraints);
      },
      /**
       * Check for media permissions
       */
      async checkPermissions() {
        const permissions = {};
        if (navigator.permissions) {
          try {
            permissions.camera = await navigator.permissions.query({
              name: "camera"
            });
            permissions.microphone = await navigator.permissions.query({
              name: "microphone"
            });
          } catch (error) {
            console.warn("Permission check failed:", error);
          }
        }
        return permissions;
      }
    };
  }

  /**
   * Room types constants
   */
  static get RoomTypes() {
    return {
      MAIN: "main",
      BREAKOUT: "breakout",
      PRESENTATION: "presentation",
      DISCUSSION: "discussion"
    };
  }

  /**
   * Connection status constants
   */
  static get ConnectionStatus() {
    return {
      DISCONNECTED: "disconnected",
      CONNECTING: "connecting",
      CONNECTED: "connected",
      FAILED: "failed"
    };
  }

  /**
   * Participant roles constants
   */
  static get ParticipantRoles() {
    return {
      OWNER: "owner",
      MODERATOR: "moderator",
      PARTICIPANT: "participant",
      OBSERVER: "observer"
    };
  }
}

let wasm;
const cachedTextDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true
}) : {
  decode: () => {
    throw Error('TextDecoder not available');
  }
};
if (typeof TextDecoder !== 'undefined') {
  cachedTextDecoder.decode();
}
let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
let WASM_VECTOR_LEN = 0;
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
const WasmEncoderFinalization = typeof FinalizationRegistry === 'undefined' ? {
  register: () => {},
  unregister: () => {}
} : new FinalizationRegistry(ptr => wasm.__wbg_wasmencoder_free(ptr >>> 0, 1));
class WasmEncoder {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WasmEncoderFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wasmencoder_free(ptr, 0);
  }
  /**
   * @param {Uint8Array} data
   * @param {number} mtu
   */
  constructor(data, mtu) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wasmencoder_new(ptr0, len0, mtu);
    this.__wbg_ptr = ret >>> 0;
    WasmEncoderFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  /**
   * @param {number} repair_packets_count
   * @returns {Array<any>}
   */
  encode(repair_packets_count) {
    const ret = wasm.wasmencoder_encode(this.__wbg_ptr, repair_packets_count);
    return ret;
  }
  /**
   * @returns {number}
   */
  getMTU() {
    const ret = wasm.wasmencoder_getMTU(this.__wbg_ptr);
    return ret;
  }
  /**
   * @returns {Uint8Array}
   */
  getConfigBuffer() {
    const ret = wasm.wasmencoder_getConfigBuffer(this.__wbg_ptr);
    return ret;
  }
}
async function __wbg_load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get('Content-Type') != 'application/wasm') {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return {
        instance,
        module
      };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_buffer_609cc3eee51ed158 = function (arg0) {
    const ret = arg0.buffer;
    return ret;
  };
  imports.wbg.__wbg_length_a446193dc22c12f8 = function (arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_new_78feb108b6472713 = function () {
    const ret = new Array();
    return ret;
  };
  imports.wbg.__wbg_newwithbyteoffsetandlength_d97e637ebe145a9a = function (arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_newwithlength_a381634e90c276d4 = function (arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_push_737cfc8c1432c2c6 = function (arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
  };
  imports.wbg.__wbg_set_65595bdd868b3009 = function (arg0, arg1, arg2) {
    arg0.set(arg1, arg2 >>> 0);
  };
  imports.wbg.__wbindgen_init_externref_table = function () {
    const table = wasm.__wbindgen_export_0;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
  };
  imports.wbg.__wbindgen_memory = function () {
    const ret = wasm.memory;
    return ret;
  };
  imports.wbg.__wbindgen_throw = function (arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  return imports;
}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
async function __wbg_init(module_or_path) {
  if (wasm !== undefined) return wasm;
  if (typeof module_or_path !== 'undefined') {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({
        module_or_path
      } = module_or_path);
    } else {
      console.warn('using deprecated parameters for the initialization function; pass a single object instead');
    }
  }
  if (typeof module_or_path === 'undefined') {
    module_or_path = new URL('raptorq_wasm_bg.wasm', (typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('ermis-classroom.cjs.js', document.baseURI).href)));
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === 'string' || typeof Request === 'function' && module_or_path instanceof Request || typeof URL === 'function' && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  const {
    instance,
    module
  } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module);
}

var raptorq_wasm = /*#__PURE__*/Object.freeze({
  __proto__: null,
  WasmEncoder: WasmEncoder,
  default: __wbg_init
});

exports.ApiClient = ApiClient$1;
exports.ErmisClient = ErmisClient$1;
exports.EventEmitter = EventEmitter$1;
exports.Participant = Participant$1;
exports.Room = Room$1;
exports.SubRoom = SubRoom$1;
exports.VERSION = VERSION;
exports.default = ErmisClassroom;
//# sourceMappingURL=ermis-classroom.cjs.js.map
