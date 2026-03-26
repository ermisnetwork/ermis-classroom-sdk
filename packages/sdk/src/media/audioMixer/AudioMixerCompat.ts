/**
 * AudioMixerCompat — iOS 15 compatible AudioMixer
 *
 * Uses MediaStreamAudioDestinationNode + <audio> element playback chain
 * in addition to direct audioContext.destination connection.
 * This dual-output approach is needed on iOS 15 Safari where the
 * <audio> element may be required for reliable audio output after
 * user interaction resume.
 *
 * Differences from AudioMixer:
 * - Adds outputDestination (MediaStreamAudioDestinationNode)
 * - Creates hidden <audio> element for playback
 * - _updateOutputAudio() manages audio element play/pause
 * - _ensureAudioElementPlaying() re-plays on user interaction
 */

import type {
  AudioMixerConfig,
  AudioMixerStats,
  AudioWorkletMessage,
  SubscriberAudioNode,
} from "../../types/media/audioMixer.types";
import { log } from "../../utils";

export class AudioMixerCompat {
  private audioContext: AudioContext | null = null;
  private mixerNode: GainNode | null = null;
  private outputDestination: MediaStreamAudioDestinationNode | null = null;
  private subscriberNodes = new Map<string, SubscriberAudioNode>();
  private isInitialized = false;
  private outputAudioElement: HTMLAudioElement | null = null;
  private loadedWorklets = new Set<string>();

  // iOS Safari user-interaction resume handler
  private _boundResumeOnInteraction: (() => void) | null = null;

  // Configuration
  private masterVolume: number;
  private sampleRate: number;
  private enableEchoCancellation: boolean;
  private debug: boolean;

  constructor(config: AudioMixerConfig = {}) {
    this.masterVolume = config.masterVolume ?? 1.0;
    this.sampleRate = config.sampleRate ?? 48000;
    this.enableEchoCancellation = config.enableEchoCancellation ?? true;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize the audio mixer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this._debug("AudioMixerCompat already initialized");
      return;
    }

    try {
      // Create shared AudioContext
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({
        sampleRate: this.sampleRate,
        latencyHint: "interactive" as AudioContextLatencyCategory,
      });

      // Resume context if suspended (required by some browsers).
      if (this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume();
        } catch {
          // Will be retried on user interaction
        }
      }
      if (this.audioContext.state !== "running") {
        log("[AudioMixerCompat] AudioContext not running (state:", this.audioContext.state, ") — waiting for user interaction");
      }

      // Create mixer node (GainNode to combine audio)
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = this.masterVolume;

      // Create output destination
      this.outputDestination = this.audioContext.createMediaStreamDestination();
      this.mixerNode.connect(this.outputDestination);

      // Not using direct connection to speakers on iOS <= 15
      // this.audioContext.destination.channelCount = Math.min(
      //   2,
      //   this.audioContext.destination.maxChannelCount,
      // );
      // this.mixerNode.connect(this.audioContext.destination);

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
      this._debug("AudioMixerCompat initialized successfully");

      // Setup error handlers
      this._setupErrorHandlers();
    } catch (error) {
      console.error("Failed to initialize AudioMixerCompat:", error);
      throw error;
    }
  }

  /**
   * Add a subscriber's audio stream to the mixer
   */
  async addSubscriber(
    subscriberId: string,
    audioWorkletUrl: string,
    isOwnAudio = false,
    channelWorkletPort?: MessagePort,
  ): Promise<AudioWorkletNode | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Skip adding own audio to prevent echo/feedback
    if (isOwnAudio) {
      this._debug(
        `Skipping own audio for subscriber ${subscriberId} to prevent echo`,
      );
      return null;
    }

    // Check if subscriber already exists
    if (this.subscriberNodes.has(subscriberId)) {
      this._debug(`Subscriber ${subscriberId} already exists in mixer`);
      return this.subscriberNodes.get(subscriberId)?.workletNode ?? null;
    }

    if (!this.audioContext) {
      throw new Error("AudioContext not initialized");
    }

    try {
      // Load audio worklet if not already loaded
      await this._loadAudioWorklet(audioWorkletUrl);

      // Create AudioWorkletNode for this subscriber
      const workletNode = new AudioWorkletNode(
        this.audioContext,
        "jitter-resistant-processor",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        },
      );

      // Connect the port if provided
      if (channelWorkletPort) {
        log('[AudioMixerCompat] Connecting channelWorkletPort for:', subscriberId);
        workletNode.port.postMessage(
          { type: "connectWorker", port: channelWorkletPort },
          [channelWorkletPort],
        );
      } else {
        console.warn('[AudioMixerCompat] No channelWorkletPort provided for:', subscriberId);
      }

      // Create gain node for individual volume control
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.0;

      // Connect: workletNode -> gainNode -> mixerNode
      workletNode.connect(gainNode);
      if (this.mixerNode) {
        gainNode.connect(this.mixerNode);
      }

      // Store reference with gain node
      this.subscriberNodes.set(subscriberId, {
        workletNode,
        gainNode,
        isActive: true,
        addedAt: Date.now(),
      });

      // Update audio element source with mixed stream
      this._updateOutputAudio();

      // Setup message handler
      this._setupWorkletMessageHandler(subscriberId, workletNode);

      this._debug(`Added subscriber ${subscriberId} to audio mixer`);
      return workletNode;
    } catch (error) {
      console.error(
        `Failed to add subscriber ${subscriberId} to mixer:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Remove a subscriber from the mixer
   */
  removeSubscriber(subscriberId: string): boolean {
    const subscriberData = this.subscriberNodes.get(subscriberId);
    if (!subscriberData) {
      this._debug(`Subscriber ${subscriberId} not found in mixer`);
      return false;
    }

    try {
      const { workletNode, gainNode } = subscriberData;

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
  setSubscriberVolume(subscriberId: string, volume: number): boolean {
    const subscriberData = this.subscriberNodes.get(subscriberId);
    if (!subscriberData) {
      this._debug(`Subscriber ${subscriberId} not found for volume adjustment`);
      return false;
    }

    try {
      const normalizedVolume = Math.max(0, Math.min(1, volume));
      subscriberData.gainNode.gain.value = normalizedVolume;

      this._debug(
        `Set volume for subscriber ${subscriberId}: ${normalizedVolume}`,
      );
      return true;
    } catch (error) {
      console.error(
        `Failed to set volume for subscriber ${subscriberId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Mute/unmute a specific subscriber
   */
  setSubscriberMuted(subscriberId: string, muted: boolean): boolean {
    return this.setSubscriberVolume(subscriberId, muted ? 0 : 1);
  }

  /**
   * Set master volume for all mixed audio
   */
  setMasterVolume(volume: number): boolean {
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
  getOutputMediaStream(): MediaStream | null {
    if (!this.outputDestination) {
      this._debug("Output destination not initialized");
      return null;
    }
    return this.outputDestination.stream;
  }

  /**
   * Get current mixer statistics
   */
  getStats(): AudioMixerStats {
    return {
      isInitialized: this.isInitialized,
      subscriberCount: this.subscriberNodes.size,
      masterVolume: this.masterVolume,
      audioContextState: (this.audioContext?.state ??
        "closed") as AudioContextState,
      sampleRate: this.audioContext?.sampleRate ?? 0,
      subscribers: Array.from(this.subscriberNodes.entries()).map(
        ([id, data]) => ({
          id,
          volume: data.gainNode.gain.value,
          isActive: data.isActive,
          addedAt: data.addedAt,
        }),
      ),
    };
  }

  /**
   * Get list of subscriber IDs
   */
  getSubscriberIds(): string[] {
    return Array.from(this.subscriberNodes.keys());
  }

  /**
   * Check if subscriber exists in mixer
   */
  hasSubscriber(subscriberId: string): boolean {
    return this.subscriberNodes.has(subscriberId);
  }

  /**
   * Suspend audio context (for battery saving)
   */
  async suspend(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "running") {
      await this.audioContext.suspend();
      this._debug("Audio context suspended");
    }
  }

  /**
   * Resume audio context
   */
  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
      this._debug("Audio context resumed");
    }
  }

  /**
   * Cleanup mixer resources
   */
  async cleanup(): Promise<void> {
    this._debug("Starting AudioMixerCompat cleanup");

    try {
      // Remove user-interaction listeners
      this._removeInteractionListeners();

      // Remove audio element
      if (this.outputAudioElement) {
        this.outputAudioElement.srcObject = null;
        if (this.outputAudioElement.parentNode) {
          this.outputAudioElement.parentNode.removeChild(
            this.outputAudioElement,
          );
        }
        this.outputAudioElement = null;
      }

      // Disconnect all subscribers
      for (const [subscriberId, subscriberData] of this.subscriberNodes) {
        try {
          const { workletNode, gainNode } = subscriberData;
          workletNode.disconnect();
          gainNode.disconnect();
        } catch (error) {
          console.error(
            `Error disconnecting subscriber ${subscriberId}:`,
            error,
          );
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
      this.loadedWorklets.clear();

      this._debug("AudioMixerCompat cleanup completed");
    } catch (error) {
      console.error("Error during AudioMixerCompat cleanup:", error);
    }
  }

  /**
   * Load audio worklet module
   */
  private async _loadAudioWorklet(audioWorkletUrl: string): Promise<void> {
    if (!this.audioContext) {
      throw new Error("AudioContext not initialized");
    }

    // Check if already loaded
    if (this.loadedWorklets.has(audioWorkletUrl)) {
      this._debug("Audio worklet already loaded:", audioWorkletUrl);
      return;
    }

    try {
      await this.audioContext.audioWorklet.addModule(audioWorkletUrl);
      this.loadedWorklets.add(audioWorkletUrl);
      this._debug("Audio worklet loaded:", audioWorkletUrl);
    } catch (error) {
      // Worklet might already be loaded
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("already been loaded")) {
        this._debug("Audio worklet load warning:", errorMessage);
      } else {
        this.loadedWorklets.add(audioWorkletUrl);
      }
    }
  }

  /**
   * Update output audio element
   */
  private _updateOutputAudio(): void {
    if (!this.outputAudioElement || !this.outputDestination) return;

    try {
      if (this.subscriberNodes.size > 0) {
        this.outputAudioElement.srcObject = this.outputDestination.stream;

        // Explicitly try to play and catch autoplay errors
        const playPromise = this.outputAudioElement.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('[AudioMixerCompat] Audio play() blocked:', err.name, err.message,
              '— will retry after user interaction');
            this._addInteractionListeners();
          });
        }
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
  private _setupWorkletMessageHandler(
    subscriberId: string,
    workletNode: AudioWorkletNode,
  ): void {
    workletNode.port.onmessage = (event: MessageEvent<AudioWorkletMessage>) => {
      const { type, bufferMs, isPlaying, newBufferSize, error } = event.data;

      switch (type) {
        case "bufferStatus":
          this._debug(
            `Subscriber ${subscriberId} buffer: ${bufferMs}ms, playing: ${isPlaying}`,
          );
          break;
        case "bufferSizeChanged":
          this._debug(
            `Subscriber ${subscriberId} buffer size changed: ${newBufferSize}`,
          );
          break;
        case "workletDiag":
          log(`[AudioWorklet Diag] ${subscriberId}:`, event.data);
          break;
        case "error":
          console.error(`Subscriber ${subscriberId} worklet error:`, error);
          break;
        default:
          break;
      }
    };
  }

  /**
   * Setup error handlers for audio context.
   */
  private _setupErrorHandlers(): void {
    if (!this.audioContext) return;

    // Monitor state changes
    this.audioContext.onstatechange = () => {
      const state = this.audioContext?.state;
      this._debug(`Audio context state changed: ${state}`);

      if (state === "interrupted") {
        console.warn("[AudioMixerCompat] Audio context interrupted — attempting resume");
        this.audioContext?.resume().catch(() => { });
      }

      if (state === "running") {
        this._ensureAudioElementPlaying();
        this._removeInteractionListeners();
      }
    };

    // Resume when page becomes visible again
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) {
        await this.resume();
        this._ensureAudioElementPlaying();
      }
    });

    // Resume on user interaction (critical for iOS Safari)
    this._addInteractionListeners();
  }

  /**
   * Add user-interaction event listeners that resume the AudioContext.
   */
  private _addInteractionListeners(): void {
    if (this._boundResumeOnInteraction) return;

    this._boundResumeOnInteraction = () => {
      if (!this.audioContext) return;
      if (
        this.audioContext.state === "suspended" ||
        this.audioContext.state === ("interrupted" as AudioContextState)
      ) {
        log("[AudioMixerCompat] User interaction detected — resuming AudioContext");
        this.audioContext.resume()
          .then(() => {
            log("[AudioMixerCompat] AudioContext resumed successfully, state:", this.audioContext?.state);
            this._ensureAudioElementPlaying();
            if (this.audioContext?.state === "running") {
              this._removeInteractionListeners();
            }
          })
          .catch((err) => {
            console.warn("[AudioMixerCompat] AudioContext resume failed:", err);
          });
      } else if (this.audioContext.state === "running") {
        this._ensureAudioElementPlaying();
        this._removeInteractionListeners();
      }
    };

    const events = ["click", "touchstart", "touchend", "keydown"];
    for (const evt of events) {
      document.addEventListener(evt, this._boundResumeOnInteraction, { capture: true });
    }
  }

  /**
   * Remove user-interaction listeners once AudioContext is running.
   */
  private _removeInteractionListeners(): void {
    if (!this._boundResumeOnInteraction) return;

    const events = ["click", "touchstart", "touchend", "keydown"];
    for (const evt of events) {
      document.removeEventListener(evt, this._boundResumeOnInteraction, { capture: true });
    }
    this._boundResumeOnInteraction = null;
  }

  /**
   * Make sure the audio element is playing.
   */
  private _ensureAudioElementPlaying(): void {
    if (!this.outputAudioElement || !this.outputDestination) return;
    if (this.subscriberNodes.size === 0) return;

    // Re-assign srcObject in case it was cleared
    if (!this.outputAudioElement.srcObject) {
      this.outputAudioElement.srcObject = this.outputDestination.stream;
    }

    const playPromise = this.outputAudioElement.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        this._debug("Audio play() deferred:", err.name);
      });
    }
  }

  /**
   * Debug logging
   */
  private _debug(...args: any[]): void {
    if (this.debug) {
      log("[AudioMixerCompat]", ...args);
    }
  }
}

export default AudioMixerCompat;
