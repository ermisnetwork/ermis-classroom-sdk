/**
 * GlobalEventBus - Centralized event system for the SDK
 * Uses existing EventEmitter infrastructure with singleton pattern
 */

import { EventEmitter } from "./EventEmitter";
import type { ServerEvent } from "../types/core/room.types";

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
    MEDIA_STREAM_REPLACED = "publisher:mediaStreamReplaced",

    // Subscriber media events
    REMOTE_STREAM_READY = "subscriber:remoteStreamReady",
    REMOTE_VIDEO_INITIALIZED = "subscriber:remoteVideoInitialized",
    REMOTE_AUDIO_INITIALIZED = "subscriber:remoteAudioInitialized",

    // Connection events
    PUBLISHER_CONNECTED = "publisher:connected",
    PUBLISHER_DISCONNECTED = "publisher:disconnected",
    SUBSCRIBER_CONNECTED = "subscriber:connected",
    SUBSCRIBER_DISCONNECTED = "subscriber:disconnected",
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

    [GlobalEvents.MEDIA_STREAM_REPLACED]: {
        stream: MediaStream;
        videoOnlyStream: MediaStream;
        hasVideo: boolean;
        hasAudio: boolean;
    };

    // Subscriber events
    [GlobalEvents.REMOTE_STREAM_READY]: {
        stream: MediaStream;
        streamId: string;
        subscribeType: string;
    };

    [GlobalEvents.REMOTE_VIDEO_INITIALIZED]: {
        streamId: string;
    };

    [GlobalEvents.REMOTE_AUDIO_INITIALIZED]: {
        streamId: string;
    };

    // Connection events
    [GlobalEvents.PUBLISHER_CONNECTED]: undefined;
    [GlobalEvents.PUBLISHER_DISCONNECTED]: { reason?: string };
    [GlobalEvents.SUBSCRIBER_CONNECTED]: { streamId: string };
    [GlobalEvents.SUBSCRIBER_DISCONNECTED]: { streamId: string; reason?: string };
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
            console.log(
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
            console.log(
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
            console.log(
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
