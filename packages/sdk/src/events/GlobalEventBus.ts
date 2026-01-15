/**
 * GlobalEventBus - Centralized event system for the SDK
 * Uses existing EventEmitter infrastructure with singleton pattern
 */

import { EventEmitter } from "./EventEmitter";
import type { ServerEvent } from "../types/core/room.types";
import { log } from "../utils";

/**
 * Global event names - centralized event registry
 */
export enum GlobalEvents {
  // Server events (from StreamManager)
  SERVER_EVENT = "server:event",

  // Publisher media events
  LOCAL_STREAM_READY = "publisher:localStreamReady",
  LOCAL_SCREEN_SHARE_READY = "publisher:localScreenShareReady",
  SCREEN_SHARE_STARTED = "publisher:screenShareStarted",
  SCREEN_SHARE_STOPPED = "publisher:screenShareStopped",

  // Publisher connection events
  PUBLISHER_CONNECTED = "publisher:connected",
  PUBLISHER_DISCONNECTED = "publisher:disconnected",
  PUBLISHER_RECONNECTING = "publisher:reconnecting",
  PUBLISHER_RECONNECTED = "publisher:reconnected",
  PUBLISHER_RECONNECTION_FAILED = "publisher:reconnectionFailed",
  PUBLISHER_CONNECTION_HEALTH_CHANGED = "publisher:connectionHealthChanged",

  // Subscriber media events
  REMOTE_STREAM_READY = "subscriber:remoteStreamReady",

  // Subscriber connection events
  SUBSCRIBER_RECONNECTING = "subscriber:reconnecting",
  SUBSCRIBER_RECONNECTED = "subscriber:reconnected",
  SUBSCRIBER_RECONNECTION_FAILED = "subscriber:reconnectionFailed",
}

/**
 * Global event data types - Type-safe event payloads
 */
export interface GlobalEventMap extends Record<string, unknown> {
  // Server events
  [GlobalEvents.SERVER_EVENT]: ServerEvent;

  // Publisher events
  [GlobalEvents.LOCAL_STREAM_READY]: {
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    type: string;
    streamId?: string;
    config: {
      codec: string;
      width: number;
      height: number;
      framerate: number;
      bitrate: number;
    };
    hasAudio: boolean;
    hasVideo: boolean;
  };

  [GlobalEvents.LOCAL_SCREEN_SHARE_READY]: {
    stream: MediaStream;
    videoOnlyStream: MediaStream;
    streamId?: string;
    config: {
      codec: string;
      width: number;
      height: number;
      framerate: number;
      bitrate: number;
    };
    hasAudio: boolean;
    hasVideo: boolean;
  };

  [GlobalEvents.SCREEN_SHARE_STARTED]: {
    stream: MediaStream;
    hasVideo: boolean;
    hasAudio: boolean;
  };

  [GlobalEvents.SCREEN_SHARE_STOPPED]: undefined;

  // Publisher connection events
  [GlobalEvents.PUBLISHER_CONNECTED]: { streamId?: string };
  [GlobalEvents.PUBLISHER_DISCONNECTED]: { streamId?: string; reason?: string };
  [GlobalEvents.PUBLISHER_RECONNECTING]: {
    streamId?: string;
    attempt: number;
    maxAttempts: number;
    delay: number;
  };
  [GlobalEvents.PUBLISHER_RECONNECTED]: { streamId?: string };
  [GlobalEvents.PUBLISHER_RECONNECTION_FAILED]: { streamId?: string; reason: string };
  [GlobalEvents.PUBLISHER_CONNECTION_HEALTH_CHANGED]: { streamId?: string; isHealthy: boolean };

  // Subscriber events
  [GlobalEvents.REMOTE_STREAM_READY]: {
    stream: MediaStream;
    streamId: string;
    subscribeType: string;
  };

  // Subscriber connection events
  [GlobalEvents.SUBSCRIBER_RECONNECTING]: {
    streamId: string;
    attempt: number;
    maxAttempts: number;
    delay: number;
  };
  [GlobalEvents.SUBSCRIBER_RECONNECTED]: { streamId: string };
  [GlobalEvents.SUBSCRIBER_RECONNECTION_FAILED]: { streamId: string; reason: string };
}

/**
 * Global Event Bus - Singleton instance
 * Reuses existing EventEmitter with type-safe global events
 */
class GlobalEventBus extends EventEmitter<GlobalEventMap> {
  private static instance: GlobalEventBus;
  private debugMode: boolean = false;

  private constructor() {
    super();
  }

  static getInstance(): GlobalEventBus {
    if (!GlobalEventBus.instance) {
      GlobalEventBus.instance = new GlobalEventBus();
    }
    return GlobalEventBus.instance;
  }

  /**
   * Enable/disable debug logging
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  // Override emit for debug logging
  emit<K extends keyof GlobalEventMap>(event: K, ...args: GlobalEventMap[K][]): boolean {
    if (this.debugMode) {
      log(
        `[GlobalEventBus] 📡 Emitting "${String(event)}" to ${this.listenerCount(event)} listeners`,
        args[0]
      );
    }
    return super.emit(event, ...args);
  }

  // Override on for debug logging
  on<K extends keyof GlobalEventMap>(
    event: K,
    listener: (...args: GlobalEventMap[K][]) => void
  ): this {
    super.on(event, listener);
    if (this.debugMode) {
      log(
        `[GlobalEventBus] 👂 Listener added for "${String(event)}". Total: ${this.listenerCount(event)}`
      );
    }
    return this;
  }

  // Override off for debug logging
  off<K extends keyof GlobalEventMap>(
    event: K,
    listener: (...args: GlobalEventMap[K][]) => void
  ): this {
    super.off(event, listener);
    if (this.debugMode) {
      log(
        `[GlobalEventBus] 🔇 Listener removed for "${String(event)}". Remaining: ${this.listenerCount(event)}`
      );
    }
    return this;
  }
}

/**
 * Export singleton instance
 */
export const globalEventBus = GlobalEventBus.getInstance();
