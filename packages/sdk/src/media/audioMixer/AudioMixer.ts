/**
 * AudioMixer Class for combining multiple subscriber audio streams
 * Provides centralized audio mixing and playback management
 */

import type {
  AudioMixerConfig,
  AudioMixerStats,
  AudioWorkletMessage,
  SubscriberAudioNode,
} from "../../types/media/audioMixer.types";
import { log } from "../../utils";

export class AudioMixer {
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
    this.masterVolume = config.masterVolume ?? 0.8;
    this.sampleRate = config.sampleRate ?? 48000;
    this.enableEchoCancellation = config.enableEchoCancellation ?? true;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize the audio mixer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this._debug("AudioMixer already initialized");
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
      // On iOS Safari this call may silently fail if not inside a user
      // gesture — _setupErrorHandlers() will register interaction listeners
      // as a fallback.
      if (this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume();
        } catch {
          // Will be retried on user interaction
        }
      }
      // After resume attempt, check if context is actually running.
      // On iOS Safari it may still be suspended if no user gesture occurred.
      if (this.audioContext.state !== "running") {
        log("[AudioMixer] AudioContext not running (state:", this.audioContext.state, ") — waiting for user interaction");
      }

      // Create mixer node (GainNode to combine audio)
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = this.masterVolume;

      // Create output destination
      this.outputDestination = this.audioContext.createMediaStreamDestination();
      this.mixerNode.connect(this.outputDestination);

      // iOS 15 Safari fix: also connect mixerNode directly to the AudioContext
      // destination (speakers).  On iOS 15, the MediaStreamAudioDestinationNode
      // → <audio> element chain is unreliable — the <audio> element may never
      // start playing (autoplay blocked, play() rejected) even after resume().
      // A direct connection to audioContext.destination plays as soon as the
      // AudioContext is in "running" state, regardless of <audio> element state.
      this.audioContext.destination.channelCount = Math.min(
        2,
        this.audioContext.destination.maxChannelCount,
      );
      this.mixerNode.connect(this.audioContext.destination);

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
        console.log('[AudioMixer] Connecting channelWorkletPort for:', subscriberId);
        workletNode.port.postMessage(
          { type: "connectWorker", port: channelWorkletPort },
          [channelWorkletPort],
        );
      } else {
        console.warn('[AudioMixer] No channelWorkletPort provided for:', subscriberId);
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
    this._debug("Starting AudioMixer cleanup");

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

      this._debug("AudioMixer cleanup completed");
    } catch (error) {
      console.error("Error during AudioMixer cleanup:", error);
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
            console.warn('[AudioMixer] Audio play() blocked:', err.name, err.message,
              '— will retry after user interaction');
            // Always register interaction listeners when play() is blocked.
            // On iOS 15 the AudioContext may be "running" (already resumed)
            // but the <audio> element still fails to play without a fresh
            // user gesture — so we must not gate this on the context state.
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
          // Diagnostic messages from the AudioWorklet (useful on iOS 15
          // where worklet console.log may not appear in devtools)
          console.log(`[AudioWorklet Diag] ${subscriberId}:`, event.data);
          break;
        case "error":
          console.error(`Subscriber ${subscriberId} worklet error:`, error);
          break;
        default:
          break;
      }
    };

    // Note: MessagePort doesn't have onerror in standard TypeScript definitions
    // Error handling is done through the message channel
  }

  /**
   * Setup error handlers for audio context.
   *
   * iOS Safari keeps AudioContext in "suspended" state until a user gesture
   * (tap, click, etc.) triggers `audioContext.resume()`.  We register
   * interaction listeners that attempt to resume + replay the audio element
   * so sound starts the moment the user taps anywhere on the page.
   */
  private _setupErrorHandlers(): void {
    if (!this.audioContext) return;

    // ── 1. Monitor state changes ────────────────────────────────────────
    this.audioContext.onstatechange = () => {
      const state = this.audioContext?.state;
      this._debug(`Audio context state changed: ${state}`);

      if (state === "interrupted") {
        // iOS Safari: phone call, Siri, etc. — try to resume immediately
        console.warn("[AudioMixer] Audio context interrupted — attempting resume");
        this.audioContext?.resume().catch(() => { });
      }

      if (state === "running") {
        // Context just became running — make sure audio element is playing
        this._ensureAudioElementPlaying();
        // Remove user-interaction listeners (no longer needed)
        this._removeInteractionListeners();
      }
    };

    // ── 2. Resume when page becomes visible again ───────────────────────
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) {
        await this.resume();
        this._ensureAudioElementPlaying();
      }
    });

    // ── 3. Resume on user interaction (critical for iOS Safari) ─────────
    //    AudioContext.resume() only succeeds inside a user gesture on iOS.
    //    Register listeners that fire once and clean themselves up.
    this._addInteractionListeners();
  }

  /**
   * Add user-interaction event listeners that resume the AudioContext.
   * Required for iOS Safari where AudioContext starts suspended.
   */
  private _addInteractionListeners(): void {
    if (this._boundResumeOnInteraction) return; // already registered

    this._boundResumeOnInteraction = () => {
      if (!this.audioContext) return;
      if (
        this.audioContext.state === "suspended" ||
        this.audioContext.state === ("interrupted" as AudioContextState)
      ) {
        log("[AudioMixer] User interaction detected — resuming AudioContext");
        this.audioContext.resume()
          .then(() => {
            log("[AudioMixer] AudioContext resumed successfully, state:", this.audioContext?.state);
            this._ensureAudioElementPlaying();
            if (this.audioContext?.state === "running") {
              this._removeInteractionListeners();
            }
          })
          .catch((err) => {
            console.warn("[AudioMixer] AudioContext resume failed:", err);
          });
      } else if (this.audioContext.state === "running") {
        // AudioContext already running (resumed earlier) but the <audio>
        // element may still be paused due to a previous autoplay block.
        // Re-try play() now that we have a fresh user gesture.
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
   * Called after AudioContext resumes to recover from autoplay blocks.
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
        // Not an error on first load — will succeed after user interaction
        this._debug("Audio play() deferred:", err.name);
      });
    }
  }

  /**
   * Debug logging
   */
  private _debug(...args: any[]): void {
    if (this.debug) {
      log("[AudioMixer]", ...args);
    }
  }
}

export default AudioMixer;
