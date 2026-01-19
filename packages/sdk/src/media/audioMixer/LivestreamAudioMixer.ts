/**
 * LivestreamAudioMixer - Mixes tab audio with microphone audio for livestreaming
 *
 * Uses Web Audio API to combine multiple audio sources into a single MediaStream
 * that can be sent through the livestream audio channel.
 */

import { log } from "../../utils";

export interface LivestreamAudioMixerConfig {
  /** Master output volume (0-1) */
  masterVolume?: number;
  /** Microphone volume (0-1) */
  micVolume?: number;
  /** Tab audio volume (0-1) */
  tabAudioVolume?: number;
  /** Screen share audio volume (0-1) */
  screenShareVolume?: number;
  /** Audio sample rate in Hz */
  sampleRate?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export class LivestreamAudioMixer {
  private audioContext: AudioContext | null = null;
  private mixerNode: GainNode | null = null;
  private outputDestination: MediaStreamAudioDestinationNode | null = null;

  // Source nodes
  private micSource: MediaStreamAudioSourceNode | null = null;
  private tabAudioSource: MediaStreamAudioSourceNode | null = null;
  private screenShareSource: MediaStreamAudioSourceNode | null = null;

  // Gain nodes for individual volume control
  private micGain: GainNode | null = null;
  private tabAudioGain: GainNode | null = null;
  private screenShareGain: GainNode | null = null;

  // Configuration
  private masterVolume: number;
  private micVolume: number;
  private tabAudioVolume: number;
  private screenShareVolume: number;
  private sampleRate: number;
  private debug: boolean;

  private isInitialized = false;

  constructor(config: LivestreamAudioMixerConfig = {}) {
    this.masterVolume = config.masterVolume ?? 1.0;
    this.micVolume = config.micVolume ?? 1.0;
    this.tabAudioVolume = config.tabAudioVolume ?? 1.0;
    this.screenShareVolume = config.screenShareVolume ?? 1.0;
    this.sampleRate = config.sampleRate ?? 48000;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize the audio mixer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this._debug("LivestreamAudioMixer already initialized");
      return;
    }

    try {
      // Create AudioContext
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({
        sampleRate: this.sampleRate,
        latencyHint: "interactive" as AudioContextLatencyCategory,
      });

      // Resume context if suspended (required by some browsers)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Create mixer node (GainNode to combine audio)
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = this.masterVolume;

      // Create output destination
      this.outputDestination =
        this.audioContext.createMediaStreamDestination();
      this.mixerNode.connect(this.outputDestination);

      this.isInitialized = true;
      this._debug("LivestreamAudioMixer initialized successfully");
    } catch (error) {
      console.error("Failed to initialize LivestreamAudioMixer:", error);
      throw error;
    }
  }

  /**
   * Mix microphone and tab audio streams into a single output stream
   *
   * @param micStream - MediaStream from microphone
   * @param tabAudioStream - MediaStream from tab audio (getDisplayMedia with audio)
   * @returns Mixed MediaStream ready for encoding and publishing
   */
  async mixAudioStreams(
    micStream: MediaStream | null,
    tabAudioStream: MediaStream | null,
  ): Promise<MediaStream> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.audioContext || !this.mixerNode) {
      throw new Error("AudioContext not initialized");
    }

    // Add microphone source if available
    if (micStream && micStream.getAudioTracks().length > 0) {
      this._debug("Adding microphone source to mixer");
      this.micSource = this.audioContext.createMediaStreamSource(micStream);
      this.micGain = this.audioContext.createGain();
      this.micGain.gain.value = this.micVolume;

      this.micSource.connect(this.micGain);
      this.micGain.connect(this.mixerNode);
    } else {
      this._debug("No microphone stream provided");
    }

    // Add tab audio source if available
    if (tabAudioStream && tabAudioStream.getAudioTracks().length > 0) {
      this._debug("Adding tab audio source to mixer");
      this.tabAudioSource =
        this.audioContext.createMediaStreamSource(tabAudioStream);
      this.tabAudioGain = this.audioContext.createGain();
      this.tabAudioGain.gain.value = this.tabAudioVolume;

      this.tabAudioSource.connect(this.tabAudioGain);
      this.tabAudioGain.connect(this.mixerNode);
    } else {
      this._debug("No tab audio stream provided");
    }

    if (!this.outputDestination) {
      throw new Error("Output destination not initialized");
    }

    this._debug("Audio streams mixed successfully");
    return this.outputDestination.stream;
  }

  /**
   * Set microphone volume
   * @param volume - Volume level (0-1)
   */
  setMicVolume(volume: number): void {
    this.micVolume = Math.max(0, Math.min(1, volume));
    if (this.micGain) {
      this.micGain.gain.value = this.micVolume;
    }
    this._debug(`Mic volume set to: ${this.micVolume}`);
  }

  /**
   * Set tab audio volume
   * @param volume - Volume level (0-1)
   */
  setTabAudioVolume(volume: number): void {
    this.tabAudioVolume = Math.max(0, Math.min(1, volume));
    if (this.tabAudioGain) {
      this.tabAudioGain.gain.value = this.tabAudioVolume;
    }
    this._debug(`Tab audio volume set to: ${this.tabAudioVolume}`);
  }

  /**
   * Set screen share audio volume
   * @param volume - Volume level (0-1)
   */
  setScreenShareVolume(volume: number): void {
    this.screenShareVolume = Math.max(0, Math.min(1, volume));
    if (this.screenShareGain) {
      this.screenShareGain.gain.value = this.screenShareVolume;
    }
    this._debug(`Screen share volume set to: ${this.screenShareVolume}`);
  }

  /**
   * Dynamically add screen share audio to the mix
   * Called when screen sharing starts during livestream
   * @param screenShareStream - MediaStream from screen share
   */
  addScreenShareAudio(screenShareStream: MediaStream): void {
    if (!this.isInitialized || !this.audioContext || !this.mixerNode) {
      this._debug("Cannot add screen share audio - mixer not initialized");
      return;
    }

    // Remove existing screen share audio if any
    this.removeScreenShareAudio();

    const audioTracks = screenShareStream.getAudioTracks();
    if (audioTracks.length === 0) {
      this._debug("Screen share stream has no audio tracks");
      return;
    }

    this._debug("Adding screen share audio source to mixer");
    this.screenShareSource = this.audioContext.createMediaStreamSource(screenShareStream);
    this.screenShareGain = this.audioContext.createGain();
    this.screenShareGain.gain.value = this.screenShareVolume;

    this.screenShareSource.connect(this.screenShareGain);
    this.screenShareGain.connect(this.mixerNode);

    this._debug("Screen share audio added to mix successfully");
  }

  /**
   * Remove screen share audio from the mix
   * Called when screen sharing stops during livestream
   */
  removeScreenShareAudio(): void {
    if (this.screenShareSource) {
      this._debug("Removing screen share audio from mixer");
      this.screenShareSource.disconnect();
      this.screenShareSource = null;
    }
    if (this.screenShareGain) {
      this.screenShareGain.disconnect();
      this.screenShareGain = null;
    }
    this._debug("Screen share audio removed from mix");
  }

  /**
   * Set master output volume
   * @param volume - Volume level (0-1)
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.mixerNode) {
      this.mixerNode.gain.value = this.masterVolume;
    }
    this._debug(`Master volume set to: ${this.masterVolume}`);
  }

  /**
   * Get the mixed output MediaStream
   */
  getOutputMediaStream(): MediaStream | null {
    return this.outputDestination?.stream ?? null;
  }

  /**
   * Get mixer statistics
   */
  getStats(): {
    isInitialized: boolean;
    micVolume: number;
    tabAudioVolume: number;
    screenShareVolume: number;
    masterVolume: number;
    hasMicSource: boolean;
    hasTabAudioSource: boolean;
    hasScreenShareSource: boolean;
    audioContextState: AudioContextState | "closed";
  } {
    return {
      isInitialized: this.isInitialized,
      micVolume: this.micVolume,
      tabAudioVolume: this.tabAudioVolume,
      screenShareVolume: this.screenShareVolume,
      masterVolume: this.masterVolume,
      hasMicSource: this.micSource !== null,
      hasTabAudioSource: this.tabAudioSource !== null,
      hasScreenShareSource: this.screenShareSource !== null,
      audioContextState: this.audioContext?.state ?? "closed",
    };
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
    this._debug("Starting LivestreamAudioMixer cleanup");

    try {
      // Disconnect sources
      if (this.micSource) {
        this.micSource.disconnect();
        this.micSource = null;
      }
      if (this.tabAudioSource) {
        this.tabAudioSource.disconnect();
        this.tabAudioSource = null;
      }
      if (this.screenShareSource) {
        this.screenShareSource.disconnect();
        this.screenShareSource = null;
      }

      // Disconnect gain nodes
      if (this.micGain) {
        this.micGain.disconnect();
        this.micGain = null;
      }
      if (this.tabAudioGain) {
        this.tabAudioGain.disconnect();
        this.tabAudioGain = null;
      }
      if (this.screenShareGain) {
        this.screenShareGain.disconnect();
        this.screenShareGain = null;
      }

      // Disconnect mixer
      if (this.mixerNode) {
        this.mixerNode.disconnect();
        this.mixerNode = null;
      }

      // Clear output destination
      this.outputDestination = null;

      // Close audio context
      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close();
      }

      this.audioContext = null;
      this.isInitialized = false;

      this._debug("LivestreamAudioMixer cleanup completed");
    } catch (error) {
      console.error("Error during LivestreamAudioMixer cleanup:", error);
    }
  }

  /**
   * Debug logging
   */
  private _debug(...args: any[]): void {
    if (this.debug) {
      log("[LivestreamAudioMixer]", ...args);
    }
  }
}

export default LivestreamAudioMixer;
