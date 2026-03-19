import EventEmitter from "../../../events/EventEmitter";
import { globalEventBus, GlobalEvents } from "../../../events/GlobalEventBus";
import { ChannelName, FrameType, getStreamPriority } from "../../../types/media/publisher.types";
import type {
  StreamData,
  ServerEvent,
} from "../../../types/media/publisher.types";
import { PacketBuilder } from "../../shared/utils/PacketBuilder";
import type { RaptorQConfig } from "../../shared/utils/PacketBuilder";
import { FrameTypeHelper } from "../../shared/utils/FrameTypeHelper";
import { LengthDelimitedReader } from "../../shared/utils/LengthDelimitedReader";
import CommandSender, { PublisherState } from "../ClientCommand";
import { log } from "../../../utils";
import type { WebRTCManager } from "./WebRTCManager";
import { GopStreamSender, type StreamDataGop } from "./GopStreamSender";
import { AudioStreamSender, type StreamDataAudio } from "./AudioStreamSender";
import { AudioDatagramSender } from "./AudioDatagramSender";
import { VideoSendStrategy } from "../strategies/VideoSendStrategy";
import { AudioSendStrategy } from "../strategies/AudioSendStrategy";
import { CongestionController, CongestionLevel } from "../controllers/CongestionController";
import { SendGate } from "../controllers/SendGate";
import { TRANSPORT, FEC, WEBRTC_BUFFER } from "../../../constants/transportConstants";

// Default publisher state - will be updated by Publisher
const DEFAULT_PUBLISHER_STATE: PublisherState = {
  hasMic: false,
  hasCamera: false,
  isMicOn: false,
  isCameraOn: false,
};

/** Result returned by the FEC encode worker for a single packet. */
interface FecEncodeResult {
  fecPacketBuffers: ArrayBuffer[];
  raptorQConfig: RaptorQConfig;
}

// StreamManager-specific config types
export interface VideoConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  frameRate: number;
  quality?: number;
  description?: AllowSharedBufferSource;
}

export interface AudioConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: AllowSharedBufferSource;
}

/**
 * StreamManager - Manages media streams for both WebTransport and WebRTC
 *
 * Responsibilities:
 * - Create and manage bidirectional streams (WebTransport)
 * - Create and manage data channels (WebRTC)
 * - Send video/audio chunks over appropriate transport
 * - Handle stream/channel lifecycle
 */
export class StreamManager extends EventEmitter<{
  sendError: { channelName: ChannelName; error: unknown };
  streamReady: { channelName: ChannelName };
  configSent: { channelName: ChannelName };
  serverEvent: ServerEvent; // Events received from server
  connectionQuality: {
    level: CongestionLevel;
    previousLevel: CongestionLevel;
    videoPaused: boolean;
    latencyEMA: number;
  };
}> {
  private streams = new Map<ChannelName, StreamData>();
  private isWebRTC: boolean;
  private sequenceNumbers = new Map<ChannelName, number>(); // Per-channel sequence numbers
  private dcMsgQueues = new Map<ChannelName, Uint8Array[]>(); // Per-channel message queues
  private dcPacketSendTime = new Map<ChannelName, number>(); // Per-channel send timing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private webTransport: any | null = null;
  // WebRTC manager reference for creating screen share data channels
  private webRtcManager: WebRTCManager | null = null;
  // private peerConnection: RTCPeerConnection | null = null;

  // FEC/RaptorQ worker — offloads synchronous WASM encoding off the main thread
  private fecWorker: Worker | null = null;
  private fecWorkerReady = false;
  private fecWorkerReadyPromise: Promise<void> | null = null;
  private _fecRequestId = 0;
  private _fecCallbacks = new Map<
    number,
    { resolve: (r: FecEncodeResult) => void; reject: (e: Error) => void }
  >();
  private commandSender: CommandSender | null;
  public streamId: string;
  private publisherState: PublisherState = { ...DEFAULT_PUBLISHER_STATE };
  private gopSenders = new Map<ChannelName, StreamDataGop>();
  private audioSenders = new Map<ChannelName, StreamDataAudio>();
  private readonly defaultGopSize = TRANSPORT.VIDEO_GOP_SIZE;
  private gopSizeMap = new Map<ChannelName, number>();
  private readonly AUDIO_BATCH_SIZE = TRANSPORT.AUDIO_BATCH_SIZE;

  // --- Congestion controller (progressive degradation) ---
  private _congestionController: CongestionController;
  private _sendGate: SendGate;


  // Platform detection — Android MIC needs GOP batching to avoid backpressure
  private readonly isAndroid: boolean;
  // Hybrid mode: audio channels use WebRTC, video uses WebTransport
  private readonly isHybrid: boolean;

  // Media send strategies (separated video / audio logic)
  private videoStrategy: VideoSendStrategy;
  private audioStrategy: AudioSendStrategy;

  // Audio datagrams (unreliable, low-latency path)
  private readonly useAudioDatagrams: boolean;
  private datagramSender: AudioDatagramSender | null = null;

  constructor(isWebRTC: boolean = false, streamID?: string, isHybrid: boolean = false, useAudioDatagrams: boolean = false, useSendGate: boolean = false, disableCongestionControl: boolean = false) {
    super();
    this.isWebRTC = isWebRTC;
    this.isHybrid = isHybrid;
    this.useAudioDatagrams = useAudioDatagrams;
    this.streamId = streamID || "default_stream";
    this.isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    this._congestionController = new CongestionController(disableCongestionControl);
    log(`[StreamManager] isAndroid: ${this.isAndroid}, isHybrid: ${this.isHybrid}`);

    if (isWebRTC) {
      // Eagerly start the FEC worker so WASM is loaded before the first packet
      this.initFecWorker().catch((err) => {
        console.error('[StreamManager] FEC worker initialization failed:', err);
      });
    }

    // In hybrid mode, command sender uses WebTransport (meeting_control stays on WT)
    this.commandSender = isWebRTC ? new CommandSender({
      protocol: "webrtc",
      sendDataFn: this.sendViaDataChannel.bind(this),
    }) : new CommandSender({
      protocol: "webtransport",
      sendDataFn: this.sendViaWebTransport.bind(this),
    });

    // Initialize send gate (virtual queue) and media send strategies
    this._sendGate = new SendGate(this._congestionController);
    const sendPacket = this.sendPacket.bind(this);
    const getSeq = this.getAndIncrementSequence.bind(this);

    this.videoStrategy = new VideoSendStrategy(
      this.gopSenders,
      sendPacket,
      getSeq,
      isWebRTC,
      this.gopSizeMap,
      this.defaultGopSize,
      useSendGate ? this._sendGate : undefined,
    );

    // In hybrid mode, audio takes the WebRTC (sendPacket fallback) path
    // even though isWebRTC is false for the overall StreamManager
    this.audioStrategy = new AudioSendStrategy(
      this.audioSenders,
      sendPacket,
      getSeq,
      isWebRTC || isHybrid, // hybrid audio → WebRTC DataChannel path
      this.isAndroid,
      this.AUDIO_BATCH_SIZE,
    );
  }

  /**
   * Set the publisher state (mic/camera availability and on/off status)
   * This should be called by Publisher before streams are initialized
   */
  setPublisherState(state: Partial<PublisherState>): void {
    this.publisherState = { ...this.publisherState, ...state };
    log("[StreamManager] Publisher state updated:", this.publisherState);
  }

  /**
   * Get the current publisher state
   */
  getPublisherState(): PublisherState {
    return { ...this.publisherState };
  }

  /**
   * Set per-channel GOP sizes from SubStream configurations.
   * The gopSizeMap is shared by reference with VideoSendStrategy,
   * so this must be called before media starts flowing.
   *
   * @param subStreams - Array of SubStream configs containing optional gopSize
   */
  setGopSizeMap(subStreams: { channelName: ChannelName; gopSize?: number }[]): void {
    for (const sub of subStreams) {
      if (sub.gopSize !== undefined) {
        this.gopSizeMap.set(sub.channelName as ChannelName, sub.gopSize);
      }
    }
    log("[StreamManager] GOP size map set:", Object.fromEntries(this.gopSizeMap));
  }

  /**
   * Set WebRTC manager reference for creating screen share data channels
   * This should be called by Publisher after WebRTCManager is initialized
   */
  setWebRTCManager(manager: WebRTCManager): void {
    this.webRtcManager = manager;
    log("[StreamManager] WebRTC manager reference set");
  }

  /**
   * Stop heartbeat interval
   * Should be called during cleanup to prevent errors after connection closes
   */
  stopHeartbeat(): void {
    if (this.commandSender) {
      this.commandSender.stopHeartbeat();
      log("[StreamManager] Heartbeat stopped");
    }
  }

  /**
   * Initialize the FEC encode worker.
   * The worker loads RaptorQ WASM internally and signals readiness via a
   * "ready" message.  Subsequent calls return the same Promise.
   */
  private initFecWorker(): Promise<void> {
    if (this.fecWorkerReadyPromise) {
      return this.fecWorkerReadyPromise;
    }

    this.fecWorkerReadyPromise = new Promise<void>((resolve, reject) => {
      const timestamp = Date.now();
      this.fecWorker = new Worker(
        `/workers/raptorq-fec-worker.js?t=${timestamp}`,
        { type: 'module' },
      );

      this.fecWorker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        switch (data.type) {
          case 'ready':
            this.fecWorkerReady = true;
            log('[StreamManager] FEC worker ready');
            resolve();
            break;

          case 'encoded': {
            const cb = this._fecCallbacks.get(data.requestId);
            if (cb) {
              this._fecCallbacks.delete(data.requestId);
              cb.resolve({
                fecPacketBuffers: data.fecPacketBuffers,
                raptorQConfig: data.raptorQConfig,
              });
            }
            break;
          }

          case 'error': {
            const cb = data.requestId !== undefined
              ? this._fecCallbacks.get(data.requestId)
              : undefined;
            if (cb) {
              this._fecCallbacks.delete(data.requestId);
              cb.reject(new Error(data.message));
            } else {
              // Worker-level error (e.g. WASM init failure)
              console.error('[StreamManager] FEC worker error:', data.message);
              reject(new Error(data.message));
            }
            break;
          }

          default:
            break;
        }
      };

      this.fecWorker.onerror = (e: ErrorEvent) => {
        console.error('[StreamManager] FEC worker script error:', e.message);
        reject(new Error(e.message));
      };
    });

    return this.fecWorkerReadyPromise;
  }

  /**
   * Initialize FEC worker for hybrid mode.
   * Called by Publisher when audio channels will use WebRTC DataChannels.
   * In pure WebRTC mode this is done eagerly in the constructor;
   * in hybrid mode it must be called explicitly since isWebRTC is false.
   */
  async initFecWorkerForHybrid(): Promise<void> {
    return this.initFecWorker();
  }

  /**
   * Offload RaptorQ FEC encoding to the worker thread.
   * Returns the array of encoded FEC packet buffers and the RaptorQ config
   * needed to build the on-wire packet headers.
   */
  private encodeWithFecWorker(
    packet: Uint8Array,
    chunkSize: number,
    redundancy: number,
  ): Promise<FecEncodeResult> {
    return new Promise<FecEncodeResult>((resolve, reject) => {
      const requestId = this._fecRequestId++;
      this._fecCallbacks.set(requestId, { resolve, reject });

      // slice() gives us a fresh ArrayBuffer with byteOffset === 0 that is
      // safe to transfer (avoids aliasing issues with shared backing buffers).
      const packetBuffer = packet.slice().buffer;

      this.fecWorker!.postMessage(
        { type: 'encode', requestId, packet: packetBuffer, chunkSize, redundancy },
        [packetBuffer],
      );
    });
  }

  /**
   * Initialize WebTransport streams
   */
  async initWebTransportStreams(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webTransport: any,
    channelNames: ChannelName[],
  ): Promise<void> {
    this.webTransport = webTransport;

    for (const channelName of channelNames) {
      await this.createBidirectionalStream(channelName);

      if (this.isAudioChannel(channelName)) {
        // Audio channels use AudioStreamSender
        const audioSender = new AudioStreamSender(this.webTransport, this.streamId, this._congestionController);
        this.audioSenders.set(channelName, {
          batchId: 0,
          audioSender,
          currentBatchFrames: 0,
        });
      } else {
        // Video channels use GopStreamSender
        const gopSender = new GopStreamSender(
          this.webTransport, this.streamId,
          this._congestionController,
        );
        this.gopSenders.set(channelName, {
          gopId: 0,
          gopSender,
          currentGopFrames: 0,
        });
      }
    }

    log(
      `[StreamManager] Initialized ${channelNames.length} WebTransport streams`,
    );

    // --- Audio datagrams: create sender and rebuild strategy ---
    if (this.useAudioDatagrams && !this.isWebRTC) {
      this.datagramSender = new AudioDatagramSender(webTransport);
      const sendPacket = this.sendPacket.bind(this);
      const getSeq = this.getAndIncrementSequence.bind(this);
      this.audioStrategy = new AudioSendStrategy(
        this.audioSenders,
        sendPacket,
        getSeq,
        this.isWebRTC || this.isHybrid,
        this.isAndroid,
        this.AUDIO_BATCH_SIZE,
        this.datagramSender,
      );
      log('[StreamManager] Audio datagrams ENABLED — audio will use unreliable datagrams');
    }
  }

  /**
   * Add additional stream (e.g., for screen sharing)
   * Public method to create streams dynamically
   */
  async addStream(channelName: ChannelName): Promise<void> {
    if (this.streams.has(channelName)) {
      log(`[StreamManager] Stream ${channelName} already exists`);
      return;
    }

    // In hybrid mode, route hybrid audio channels (MIC, screen share audio)
    // to WebRTC DataChannel; everything else goes to WebTransport.
    const useWebRTC = this.isWebRTC || (this.isHybrid && this.isHybridAudioChannel(channelName));

    if (useWebRTC) {
      // Create WebRTC data channel
      await this.createDataChannelForScreenShare(channelName);
    } else {
      // Create WebTransport bidirectional stream
      await this.createBidirectionalStream(channelName);
      // Also create stream sender so media goes through uni-streams (not bidi)
      if (this.webTransport) {
        if (this.isAudioChannel(channelName) && !this.audioSenders.has(channelName)) {
          const audioSender = new AudioStreamSender(this.webTransport, this.streamId, this._congestionController);
          this.audioSenders.set(channelName, {
            batchId: 0,
            audioSender,
            currentBatchFrames: 0,
          });
          log(`[StreamManager] Created audio sender for dynamically added channel: ${channelName}`);
        } else if (!this.isAudioChannel(channelName) && !this.gopSenders.has(channelName)) {
          const gopSender = new GopStreamSender(
            this.webTransport, this.streamId,
            this._congestionController,
          );
          this.gopSenders.set(channelName, {
            gopId: 0,
            gopSender,
            currentGopFrames: 0,
          });
          log(`[StreamManager] Created GOP sender for dynamically added channel: ${channelName}`);
        }
      }
    }
  }

  /**
   * Create WebRTC data channel for screen share streams
   * Creates a new peer connection specifically for screen share
   */
  private async createDataChannelForScreenShare(channelName: ChannelName): Promise<void> {
    if (!this.webRtcManager) {
      throw new Error("WebRTC manager not set. Call setWebRTCManager() first.");
    }

    try {
      log(`[StreamManager] Creating WebRTC data channel for screen share: ${channelName}`);

      // Use WebRTCManager to create new connection for screen share channel
      await this.webRtcManager.connectMultipleChannels([channelName], this);

      log(`[StreamManager] Created WebRTC data channel for screen share: ${channelName}`);
    } catch (error) {
      console.error(`[StreamManager] Failed to create data channel for ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Create WebTransport bidirectional stream
   */
  private async createBidirectionalStream(
    channelName: ChannelName,
  ): Promise<void> {
    if (!this.webTransport) {
      throw new Error("WebTransport not initialized");
    }

    try {
      const stream = await this.webTransport.createBidirectionalStream();
      const readable = stream.readable;
      const writable = stream.writable;

      const writer = writable.getWriter();
      const reader = readable.getReader();

      this.streams.set(channelName, {
        writer,
        reader,
        configSent: false,
        config: null,
        metadataReady: false,
        videoDecoderConfig: null,
      });

      // Initialize channel stream with server
      await this.sendInitChannelStream(channelName);

      // Setup event reader for MEETING_CONTROL channel
      if (channelName === ChannelName.MEETING_CONTROL) {
        const streamData = this.streams.get(channelName);
        // Use the publisher state set by Publisher
        // In hybrid mode, defer publisher_state until WebRTC channels are also connected
        // (see sendDeferredPublisherState called from Publisher after connectMultipleChannels)
        if (streamData && !this.isHybrid) {
          this.commandSender?.sendPublisherState(streamData, this.publisherState);
          log("[StreamManager] Sent initial publisher state (WebTransport):", this.publisherState);
          this.commandSender?.startHeartbeat(streamData);
        }
        this.setupEventStreamReader(reader);
      }

      log(
        `[StreamManager] Created bidirectional stream for ${channelName}`,
      );
      this.emit("streamReady", { channelName });
    } catch (error) {
      console.error(
        `[StreamManager] Failed to create stream for ${channelName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Send init channel stream command to server
   */
  private async sendInitChannelStream(channelName: ChannelName): Promise<void> {
    const command = {
      type: "init_channel_stream",
      data: {
        channel: channelName,
      },
    };

    const commandJson = JSON.stringify(command);
    const commandBytes = new TextEncoder().encode(commandJson);

    const streamData = this.streams.get(channelName);
    if (!streamData || !streamData.writer) {
      throw new Error(`Stream ${channelName} not ready for init`);
    }

    // Send with length-delimited format
    const len = commandBytes.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(commandBytes, 4);

    await streamData.writer.write(out.slice());
    log(`[StreamManager] Sent init_channel_stream for ${channelName}`);
  }

  /**
   * Setup event stream reader for receiving server events (WebTransport)
   * Only for MEETING_CONTROL channel
   */
  private setupEventStreamReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): void {
    const delimitedReader = new LengthDelimitedReader(reader);

    // Start reading loop in background
    (async () => {
      try {
        log(`[StreamManager] Starting event reader`);

        while (true) {
          const message = await delimitedReader.readMessage();

          if (message === null) {
            log(`[StreamManager] Event stream ended`);
            break;
          }

          // Decode and parse message
          const messageStr = new TextDecoder().decode(message);

          try {
            const event = JSON.parse(messageStr);

            // Intercept connection_stats — feed to congestion controller, don't emit globally
            if (event.type === 'connection_stats') {
              this._congestionController.updateFromServerStats(event);
              continue;
            }

            if (event.type !== 'pong') {
              log(`[StreamManager] Received server event:`, event);
            }

            // Emit to global event bus
            globalEventBus.emit(GlobalEvents.SERVER_EVENT, event);
          } catch (e) {
            log(
              `[StreamManager] Non-JSON event message:`,
              messageStr,
            );
          }
        }
      } catch (err) {
        console.error(
          `[StreamManager] Error reading event stream:`,
          err,
        );
      }
    })();
  }

  /**
   * Setup event data channel listener for receiving server events (WebRTC)
   * Only for MEETING_CONTROL channel
   * Uses StreamManager's streams map to get data channel by channel name
   */
   private setupEventDataChannelListener(channelName: ChannelName): void {
    const streamData = this.streams.get(channelName);
    if (!streamData || !streamData.dataChannel) {
      console.error(`[StreamManager] Cannot setup event listener: data channel not found for ${channelName}`);
      return;
    }

    const dataChannel = streamData.dataChannel;

    dataChannel.onmessage = (event) => {
      const data = event.data;
      try {
        const messageStr = new TextDecoder().decode(data);
        const serverEvent = JSON.parse(messageStr);

        // Skip logging noisy high-frequency events
        if (serverEvent.type !== 'pong') {
          log(`[StreamManager] Received server event via data channel (${channelName}):`, serverEvent);
        }

        // Emit to global event bus
        globalEventBus.emit(GlobalEvents.SERVER_EVENT, serverEvent);
      } catch (e) {
        log(`[StreamManager] Error parsing server event from ${channelName}:`, e);
      }
    };

    log(`[StreamManager] Setup event listener for data channel ${channelName}`);
  }

  /**
   * Create WebRTC data channel (public method for direct use, same as JS)
   */
  async createDataChannelDirect(channelName: ChannelName, peerConnection: RTCPeerConnection): Promise<void> {
    log(`[StreamManager] Creating data channel: ${channelName}`);

    let ordered = false;
    if (channelName === ChannelName.MEETING_CONTROL) {
      ordered = true;
    }

    // Use id: 0 like JS - each channel has separate peer connection
    const dataChannel = peerConnection.createDataChannel(channelName, {
      ordered,
      id: 0,
      negotiated: true,
    });

    log(`[StreamManager] Data channel created for ${channelName}, readyState: ${dataChannel.readyState}`);

    const bufferAmounts = WEBRTC_BUFFER;

    if (channelName.includes("1080p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.HIGH;
    } else if (channelName.includes("720p")) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    } else if (channelName.includes("360p") || channelName === ChannelName.MIC_48K) {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.LOW;
    } else {
      dataChannel.bufferedAmountLowThreshold = bufferAmounts.MEDIUM;
    }

    dataChannel.onbufferedamountlow = () => {
      const queue = this.getQueue(channelName);

      while (
        queue.length > 0 &&
        dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold
      ) {
        const packet = queue.shift();
        if (packet) {
          dataChannel.send(packet.slice());
          this.dcPacketSendTime.set(channelName, performance.now());
        }
      }
    };

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onerror = (error) => {
      console.error(`[StreamManager] Data channel ${channelName} error:`, error);
    };

    dataChannel.onclose = () => {
      log(`[StreamManager] Data channel ${channelName} closed`);
    };

    dataChannel.onopen = async () => {
      log(`[StreamManager] Data channel ${channelName} OPENED! readyState: ${dataChannel.readyState}`);

      // Match JS Publisher exactly
      this.streams.set(channelName, {
        id: 0,
        dataChannel,
        dataChannelReady: true,
        configSent: false,
        config: null,
      } as any);

      // Emit streamReady event for this channel
      this.emit("streamReady", { channelName });

      if (channelName === ChannelName.MEETING_CONTROL) {
        // Use the publisher state set by Publisher
        const streamData = this.streams.get(channelName);
        if (streamData) {
          try {
            await this.commandSender?.sendPublisherState(streamData, this.publisherState);
            log("[StreamManager] Sent initial publisher state (WebRTC):", this.publisherState);
          } catch (err) {
            console.error("[StreamManager] Failed to send publisher state in onopen:", err);
          }

          try {
            const dummyEvent = {
              type: "custom",
              sender_stream_id: this.streamId,
              target: {
                type: "room"
              },
              value: {
                action: "play_sound",
                volume: 0.7
              }
            };
            await this.commandSender?.sendEvent(streamData, dummyEvent);
          } catch (err) {
            console.error("[StreamManager] Failed to send dummy event in onopen:", err);
          }

          // Start heartbeat for WebRTC meeting_control channel
          log("[StreamManager] Starting heartbeat for WebRTC meeting_control channel");
          this.commandSender?.startHeartbeat(streamData);
        }

        // Setup event listener using channel name from streams map
        this.setupEventDataChannelListener(channelName);
      }

      log(`WebRTC data channel (${channelName}) established`);
    };

    // Monitor ICE connection state for debugging
    peerConnection.oniceconnectionstatechange = () => {
      log(`[StreamManager] ${channelName} ICE connection state: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'failed') {
        console.error(`[StreamManager] ${channelName} ICE connection FAILED!`);
      }
    };
  }

  async sendCustomEvent(targets: string[], value: any,): Promise<void> {
    let target: any;
    if (targets.length === 0) {
      target = { type: "room" }
    } else {
      target = { type: "group", ids: targets };
    };

    let streamData = this.streams.get(ChannelName.MEETING_CONTROL);

    if (!streamData) {
      log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} not ready yet for custom event, waiting...`);
      try {
        streamData = await this.waitForStream(ChannelName.MEETING_CONTROL);
        log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} is now ready for custom event`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${ChannelName.MEETING_CONTROL}:`, error);
        return;
      }
    }

    const event = {
      type: "custom",
      sender_stream_id: this.streamId,
      target,
      value
    };
    await this.commandSender?.sendEvent(streamData, event);
  }
  /**
   * Send video chunk.
   * Delegates actual send logic to VideoSendStrategy.
   */
  async sendVideoChunk(
    channelName: ChannelName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: EncodedVideoChunk | any,
    _metadata?: EncodedVideoChunkMetadata,
  ): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) return;

    // Skip if config not sent yet
    if (!streamData.configSent) return;

    await this.videoStrategy.send(channelName, chunk, _metadata);
  }

  /**
   * Send audio chunk.
   * Handles transport-level readiness checks, then delegates to AudioSendStrategy.
   */
  async sendAudioChunk(
    channelName: ChannelName,
    audioData: Uint8Array,
    timestamp: number,
  ): Promise<void> {
    let streamData = this.streams.get(channelName);

    // Wait for stream to be ready if not yet available (fixes Safari timing issue)
    if (!streamData) {
      try {
        streamData = await this.waitForStream(channelName, TRANSPORT.CONFIG_WAIT_TIMEOUT);
        log(`[StreamManager] Stream ${channelName} is now ready for audio`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${channelName} for audio:`, error);
        return;
      }
    }

    // Additional check for WebRTC DataChannel readiness (Safari fix)
    if (this.isWebRTC && streamData.dataChannel) {
      if (streamData.dataChannel.readyState !== "open") {
        log(`[StreamManager] sendAudioChunk: DataChannel ${channelName} not open yet, state: ${streamData.dataChannel.readyState}`);
        return;
      }
    }

    // Skip if config not sent yet
    if (!streamData.configSent) {
      log(`[StreamManager] sendAudioChunk: Config not sent yet for ${channelName}`);
      return;
    }

    await this.audioStrategy.send(channelName, audioData, timestamp);
  }

  /**
   * Send configuration data (EXACT copy from JS handleVideoChunk logic)
   */
  async sendConfig(
    channelName: ChannelName,
    config: VideoConfig | AudioConfig,
    mediaType: "video" | "audio",
  ): Promise<void> {
    let streamData = this.streams.get(channelName);
    log(`[StreamManager] sendConfig for ${channelName}, streamData:`, streamData, "config", config);

    if (!streamData) {
      log(`[StreamManager] Stream ${channelName} not ready yet for config, waiting...`);
      try {
        streamData = await this.waitForStream(channelName);
        log(`[StreamManager] Stream ${channelName} is now ready for config`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${channelName} for config:`, error);
        return;
      }
    }

    let configPacket: any;

    if (mediaType === "video") {
      const vConfig = config as VideoConfig;
      configPacket = {
        type: "StreamConfig",
        channelName: channelName,
        mediaType: "video",
        config: {
          codec: vConfig.codec,
          codedWidth: vConfig.codedWidth,
          codedHeight: vConfig.codedHeight,
          frameRate: vConfig.frameRate,
          quality: vConfig.quality,
          description: (vConfig as any).description
            ? this.arrayBufferToBase64((vConfig as any).description)
            : null,
        },
      };
    } else {
      const aConfig = config as AudioConfig;

      // Convert Uint8Array description to base64 string
      let descriptionBase64 = null;
      if ((aConfig as any).description) {
        const desc = (aConfig as any).description;
        // Handle both Uint8Array and ArrayBuffer
        const uint8Array = desc instanceof Uint8Array
          ? desc
          : new Uint8Array(desc);
        descriptionBase64 = this.arrayBufferToBase64(uint8Array.buffer);
      }

      configPacket = {
        type: "StreamConfig",
        channelName: channelName,
        mediaType: "audio",
        config: {
          codec: aConfig.codec,
          sampleRate: aConfig.sampleRate,
          numberOfChannels: aConfig.numberOfChannels,
          description: descriptionBase64,
        },
      };
    }

    // In hybrid mode, audio channels use WebRTC DataChannels.
    // Send config directly to the DataChannel WITHOUT FEC encoding to guarantee
    // it arrives before any audio frames (FEC encoding is async via worker).
    // The WebRTC backend parses non-FEC PKT_PUBLISHER_COMMAND as raw UTF-8 JSON.
    // Packet format: [chunkId:4][fecMarker:1=0x00][packetType:1=0xff][json_bytes]
    const isHybridAudio = this.isHybrid && this.isHybridAudioChannel(channelName);
    if (isHybridAudio && streamData.dataChannel && streamData.dataChannelReady) {
      const configJson = JSON.stringify({ type: "media_config", data: JSON.stringify(configPacket) });
      const jsonBytes = new TextEncoder().encode(configJson);
      const sequenceNumber = this.getAndIncrementSequence(channelName);
      // Build raw DataChannel packet: [chunkId:4][fecMarker:1][packetType:1][payload]
      const raw = new Uint8Array(4 + 1 + 1 + jsonBytes.length);
      const dv = new DataView(raw.buffer);
      dv.setUint32(0, sequenceNumber, false); // chunkId
      raw[4] = 0x00; // fecMarker = not FEC
      raw[5] = 0xff; // packetType = PUBLISHER_COMMAND
      raw.set(jsonBytes, 6);
      streamData.dataChannel.send(raw);
    } else if (!isHybridAudio) {
      this.commandSender?.sendMediaConfig(channelName, streamData, JSON.stringify(configPacket));
    }


    streamData.configSent = true;
    streamData.config = config as any;

    log(`[StreamManager] Config sent for ${channelName}`);
    log(`[StreamManager] Config packet:`, configPacket);
    this.emit("configSent", { channelName });
  }

  /**
   * Wait for a stream to be ready
   */
  private waitForStream(channelName: ChannelName, timeout: number = TRANSPORT.STREAM_WAIT_TIMEOUT): Promise<StreamData> {
    return new Promise((resolve, reject) => {
      // Check if already ready
      const existingStream = this.streams.get(channelName);
      if (existingStream) {
        resolve(existingStream);
        return;
      }

      const timeoutId = setTimeout(() => {
        this.off("streamReady", handleStreamReady);
        reject(new Error(`Timeout waiting for stream ${channelName} to be ready`));
      }, timeout);

      const handleStreamReady = (event: { channelName: ChannelName }) => {
        if (event.channelName === channelName) {
          clearTimeout(timeoutId);
          this.off("streamReady", handleStreamReady);
          const streamData = this.streams.get(channelName);
          if (streamData) {
            resolve(streamData);
          } else {
            reject(new Error(`Stream ${channelName} not found after ready event`));
          }
        }
      };

      this.on("streamReady", handleStreamReady);
    });
  }

  /**
   * Send event message
   */
  async sendEvent(eventData: object): Promise<void> {
    let streamData = this.streams.get(ChannelName.MEETING_CONTROL);

    if (!streamData) {
      log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} not ready yet, waiting...`);
      try {
        streamData = await this.waitForStream(ChannelName.MEETING_CONTROL);
        log(`[StreamManager] Stream ${ChannelName.MEETING_CONTROL} is now ready`);
      } catch (error) {
        console.warn(`[StreamManager] Failed to wait for stream ${ChannelName.MEETING_CONTROL}:`, error);
        return;
      }
    }

    this.commandSender?.sendEvent(streamData, eventData);
  }

  /**
   * Send raw data over a specific channel
   * Generic method for sending arbitrary data
   *
   * @param channelName - Channel to send data on
   * @param data - Data to send (will be JSON stringified if object)
   */
  async sendData(channelName: ChannelName, data: unknown): Promise<void> {
    let dataBytes: Uint8Array;

    // Convert data to bytes
    if (data instanceof Uint8Array) {
      dataBytes = data;
    } else if (data instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(data);
    } else if (typeof data === "string") {
      dataBytes = new TextEncoder().encode(data);
    } else {
      // Assume it's an object, stringify it
      const jsonString = JSON.stringify(data);
      dataBytes = new TextEncoder().encode(jsonString);
    }

    // Create packet with EVENT frame type for generic data
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    const packet = PacketBuilder.createPacket(
      dataBytes,
      Date.now(),
      FrameType.EVENT,
      sequenceNumber,
    );

    await this.sendPacket(channelName, packet, FrameType.EVENT);
  }

  /**
   * Send packet over transport.
   * In hybrid mode, route based on the stream's transport type
   * (DataChannel for audio, WebTransport writer for video).
   */
  private async sendPacket(
    channelName: ChannelName,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      log(`[StreamManager] Stream ${channelName} not found`);
      throw new Error(`Stream ${channelName} not found`);
    }

    try {
      // In hybrid mode, check per-stream transport type.
      // Audio channels have dataChannel set, video channels have writer set.
      const useDataChannel = this.isWebRTC || (this.isHybrid && !!streamData.dataChannel);
      if (useDataChannel) {
        await this.sendViaDataChannel(channelName, streamData, packet, frameType);
      } else {
        await this.sendViaWebTransport(streamData, packet);
      }
    } catch (error) {
      this.emit("sendError", { channelName, error });
      throw error;
    }
  }

  /**
   * Send via WebTransport stream
   */
  private async sendViaWebTransport(
    streamData: StreamData,
    packet: Uint8Array,
  ): Promise<void> {
    if (!streamData.writer) {
      throw new Error("Stream writer not available");
    }

    if (streamData.writer.desiredSize !== null && streamData.writer.desiredSize <= 0) {
      return;
    }

    // Wrap packet with length-delimited format (4 bytes length prefix)
    const len = packet.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false); // 4 bytes length prefix
    out.set(packet, 4); // Copy packet after length prefix

    // Ensure the Uint8Array is backed by a regular ArrayBuffer (not SharedArrayBuffer)
    const dataToWrite = out.slice();
    await streamData.writer.write(dataToWrite);
  }

  /**
   * Send via WebRTC data channel with FEC encoding (EXACT copy from JS Publisher.sendOverDataChannel)
   */
  private async sendViaDataChannel(
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType,
  ): Promise<void> {
    const dataChannel = streamData.dataChannel;
    const dataChannelReady = streamData.dataChannelReady;

    if (!dataChannelReady || !dataChannel || dataChannel.readyState !== "open") {
      console.warn("DataChannel not ready");
      return;
    }

    try {
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const sequenceNumber = view.getUint32(0, false);

      const needFecEncode = frameType !== FrameType.EVENT && frameType !== FrameType.AUDIO;

      const transportPacketType = FrameTypeHelper.getTransportPacketType(frameType);

      if (needFecEncode) {
        // Ensure the FEC worker is ready (it should already be if WebRTC was
        // used from the start, but guard here in case init raced ahead).
        if (!this.fecWorkerReady) {
          await this.initFecWorker();
        }

        const MAX_MTU = FEC.MAX_MTU;
        const MIN_MTU = FEC.MIN_MTU;
        const MIN_CHUNKS = FEC.MIN_CHUNKS;
        const MAX_REDUNDANCY = FEC.MAX_REDUNDANCY;
        const MIN_REDUNDANCY = FEC.MIN_REDUNDANCY;
        const REDUNDANCY_RATIO = FEC.REDUNDANCY_RATIO;

        let MTU = Math.ceil(packet.length / MIN_CHUNKS);

        if (MTU < MIN_MTU) {
          MTU = MIN_MTU;
        } else if (MTU > MAX_MTU) {
          MTU = MAX_MTU;
        }

        const totalPackets = Math.ceil(packet.length / (MTU - 20));
        let redundancy = Math.ceil(totalPackets * REDUNDANCY_RATIO);

        if (redundancy < MIN_REDUNDANCY) {
          redundancy = MIN_REDUNDANCY;
        } else if (redundancy > MAX_REDUNDANCY) {
          redundancy = MAX_REDUNDANCY;
        }

        if (frameType === FrameType.CONFIG) {
          redundancy = FEC.CONFIG_REDUNDANCY;
        }

        const HEADER_SIZE = FEC.HEADER_SIZE;
        const chunkSize = MTU - HEADER_SIZE;

        // Offload the synchronous WASM encoding to the FEC worker
        const { fecPacketBuffers, raptorQConfig } = await this.encodeWithFecWorker(
          packet,
          chunkSize,
          redundancy,
        );

        for (const buffer of fecPacketBuffers) {
          const fecPacket = new Uint8Array(buffer);
          const wrapper = PacketBuilder.createFECPacket(
            fecPacket,
            sequenceNumber,
            transportPacketType,
            raptorQConfig,
          );
          this.sendOrQueue(channelName, dataChannel, wrapper);
        }

        return;
      }

      const wrapper = PacketBuilder.createRegularPacket(
        packet,
        sequenceNumber,
        transportPacketType,
      );
      this.sendOrQueue(channelName, dataChannel, wrapper);
    } catch (error) {
      console.error("Failed to send over DataChannel:", error);
    }
  }

  /**
   * Send packet or add to queue if buffer is full (EXACT copy from JS)
   */
  private sendOrQueue(
    channelName: ChannelName,
    dataChannel: RTCDataChannel,
    packet: Uint8Array,
  ): void {
    const queue = this.getQueue(channelName);

    if (
      dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold &&
      queue.length === 0
    ) {
      // JS sends packet directly - TypeScript requires slice() for type safety
      dataChannel.send(packet.slice());
    } else {
      queue.push(packet);
    }
  }

  /**
   * Get message queue for a channel (EXACT copy from JS)
   */
  private getQueue(channelName: ChannelName): Uint8Array[] {
    if (!this.dcMsgQueues.has(channelName)) {
      this.dcMsgQueues.set(channelName, []);
    }
    return this.dcMsgQueues.get(channelName)!;
  }

  /**
   * Check if stream is ready
   */
  isStreamReady(channelName: ChannelName): boolean {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      return false;
    }

    if (this.isWebRTC) {
      return streamData.dataChannelReady === true;
    }

    return streamData.writer !== null;
  }



  /**
   * Wait for a stream to be ready (data channel open for WebRTC)
   * @param channelName - Channel to wait for
   * @param timeout - Timeout in milliseconds (default 10000ms)
   */
  async waitForStreamReady(channelName: ChannelName, timeout: number = TRANSPORT.STREAM_WAIT_TIMEOUT): Promise<void> {
    const streamData = this.streams.get(channelName);

    // For WebTransport, stream is ready when writer is available (already sync)
    if (!this.isWebRTC) {
      if (streamData?.writer) {
        return;
      }
      // Wait for stream to be created
      await this.waitForStream(channelName, timeout);
      return;
    }

    // For WebRTC, need to wait for data channel to be open
    if (streamData?.dataChannel?.readyState === "open") {
      log(`[StreamManager] Stream ${channelName} already ready`);
      return;
    }

    log(`[StreamManager] Waiting for stream ${channelName} to be ready...`);

    // Wait for streamReady event which fires on dataChannel.onopen
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off("streamReady", handleStreamReady);
        reject(new Error(`Timeout waiting for stream ${channelName} to be ready`));
      }, timeout);

      const handleStreamReady = (event: { channelName: ChannelName }) => {
        if (event.channelName === channelName) {
          clearTimeout(timeoutId);
          this.off("streamReady", handleStreamReady);
          log(`[StreamManager] Stream ${channelName} is now ready`);
          resolve();
        }
      };

      // Check if already ready (race condition check)
      const existingStream = this.streams.get(channelName);
      if (existingStream?.dataChannel?.readyState === "open") {
        clearTimeout(timeoutId);
        log(`[StreamManager] Stream ${channelName} was already ready`);
        resolve();
        return;
      }

      this.on("streamReady", handleStreamReady);
    });
  }

  /**
   * Check if config has been sent
   */
  isConfigSent(channelName: ChannelName): boolean {
    const streamData = this.streams.get(channelName);
    return streamData?.configSent === true;
  }

  /**
   * Get stream data
   */
  getStream(channelName: ChannelName): StreamData | undefined {
    return this.streams.get(channelName);
  }

  /**
   * Reset configSent flag for a channel
   * Used when reconnecting streams after unban for WebRTC
   * This allows resending config without closing the data channel
   */
  resetConfigSent(channelName: ChannelName): void {
    const streamData = this.streams.get(channelName);
    if (streamData) {
      streamData.configSent = false;
      log(`[StreamManager] Config reset for ${channelName}`);
    }
  }

  /**
   * Send publisher state + start heartbeat on the meeting_control channel.
   * Called by Publisher in hybrid mode AFTER WebRTC channels are connected,
   * so the server only learns about audio channels when their configs can be registered.
   */
  sendDeferredPublisherState(): void {
    const streamData = this.streams.get(ChannelName.MEETING_CONTROL);
    if (!streamData) {
      console.warn("[StreamManager] Cannot send deferred publisher state — meeting_control not ready");
      return;
    }
    this.commandSender?.sendPublisherState(streamData, this.publisherState);
    log("[StreamManager] Sent deferred publisher state (hybrid):", this.publisherState);
    this.commandSender?.startHeartbeat(streamData);
  }

  /**
   * Close specific stream
   */
  async closeStream(channelName: ChannelName): Promise<void> {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
      return;
    }

    try {
      if (this.isWebRTC && streamData.dataChannel) {
        streamData.dataChannel.close();
      } else if (streamData.writer) {
        await streamData.writer.close();
      }

      this.streams.delete(channelName);
      log(`[StreamManager] Closed stream ${channelName}`);
    } catch (error) {
      console.error(
        `[StreamManager] Error closing stream ${channelName}:`,
        error,
      );
    }
  }

  /**
   * Check if a channel name corresponds to an audio channel.
   */
  private isAudioChannel(channelName: ChannelName): boolean {
    return (
      channelName === ChannelName.MIC_48K ||
      channelName === ChannelName.SCREEN_SHARE_AUDIO ||
      channelName === ChannelName.LIVESTREAM_AUDIO
    );
  }

  /**
   * Check if a channel should use WebRTC in hybrid mode.
   * MIC_48K + SCREEN_SHARE_AUDIO — livestream audio stays on WebTransport.
   */
  private isHybridAudioChannel(channelName: ChannelName): boolean {
    return (
      channelName === ChannelName.MIC_48K ||
      channelName === ChannelName.SCREEN_SHARE_AUDIO
    );
  }

  // --- Congestion controller ---

  /** Expose the congestion controller for VideoProcessor to subscribe. */
  get congestionController(): CongestionController {
    return this._congestionController;
  }

  /** Public accessor for CongestionController (used by Publisher for WebRTC stats). */
  getCongestionController(): CongestionController {
    return this._congestionController;
  }

  /** Current congestion level (0-4). */
  get congestionLevel(): CongestionLevel {
    return this._congestionController.level;
  }

  /**
   * Cleanup all stream senders (both video GOP and audio senders).
   * Should be called when connection closes to prevent LocallyClosed errors.
   */
  cleanupStreamSenders(): void {
    for (const [channelName, gopData] of this.gopSenders) {
      gopData.gopSender.cleanup();
      log(`[StreamManager] Cleaned up GOP sender for ${channelName}`);
    }
    this.gopSenders.clear();

    for (const [channelName, audioData] of this.audioSenders) {
      audioData.audioSender.cleanup();
      log(`[StreamManager] Cleaned up audio sender for ${channelName}`);
    }
    this.audioSenders.clear();

    // Cleanup datagram sender
    if (this.datagramSender) {
      this.datagramSender.cleanup();
      this.datagramSender = null;
    }

    // Stop congestion controller timers
    this._congestionController.dispose();
  }

  /**
   * Close all streams
   */
  async closeAll(): Promise<void> {
    // Cleanup stream senders first to prevent LocallyClosed errors
    this.cleanupStreamSenders();

    const closePromises: Promise<void>[] = [];

    for (const channelName of this.streams.keys()) {
      closePromises.push(this.closeStream(channelName));
    }

    await Promise.all(closePromises);
    this.streams.clear();

    // Terminate FEC worker and reject any pending encode promises
    if (this.fecWorker) {
      for (const [, cb] of this._fecCallbacks) {
        cb.reject(new Error('StreamManager closed'));
      }
      this._fecCallbacks.clear();
      this.fecWorker.terminate();
      this.fecWorker = null;
      this.fecWorkerReady = false;
      this.fecWorkerReadyPromise = null;
      log('[StreamManager] FEC worker terminated');
    }
    log("[StreamManager] All streams closed");
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalStreams: number;
    activeStreams: number;
    sequenceNumbers: Record<string, number>;
    streams: Record<string, { ready: boolean; configSent: boolean }>;
  } {
    const stats: Record<string, { ready: boolean; configSent: boolean }> = {};
    const sequences: Record<string, number> = {};

    for (const [channelName, streamData] of this.streams.entries()) {
      stats[channelName] = {
        ready: this.isStreamReady(channelName),
        configSent: streamData.configSent,
      };
      sequences[channelName] = this.sequenceNumbers.get(channelName) || 0;
    }

    return {
      totalStreams: this.streams.size,
      activeStreams: Array.from(this.streams.values()).filter((s) =>
        this.isWebRTC ? s.dataChannelReady : s.writer !== null,
      ).length,
      sequenceNumbers: sequences,
      streams: stats,
    };
  }

  /**
   * Create packet with header for audio config description
   */
  public createAudioConfigPacket(
    channelName: ChannelName,
    data: Uint8Array,
  ): Uint8Array {
    const timestamp = performance.now() * 1000;
    const sequenceNumber = this.getAndIncrementSequence(channelName);
    return PacketBuilder.createPacket(
      data,
      timestamp,
      FrameType.AUDIO,
      sequenceNumber,
    );
  }

  /**
   * Get and increment sequence number for a channel
   * @param channelName - Channel name
   * @returns Current sequence number
   */
  private getAndIncrementSequence(channelName: ChannelName): number {
    if (!this.sequenceNumbers.has(channelName)) {
      this.sequenceNumbers.set(channelName, 0);
    }
    const current = this.sequenceNumbers.get(channelName)!;
    this.sequenceNumbers.set(channelName, current + 1);
    return current;
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Reset sequence numbers for all channels
   */
  resetSequenceNumbers(): void {
    this.sequenceNumbers.clear();
  }

  /**
   * Get active channel names
   */
  getActiveChannels(): ChannelName[] {
    return Array.from(this.streams.keys());
  }
}
