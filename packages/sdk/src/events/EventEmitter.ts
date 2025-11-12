/**
 * Base EventEmitter class for handling events across the SDK
 * Type-safe event emitter implementation
 */

type EventListener<T = unknown> = (...args: T[]) => void;

export class EventEmitter<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  private _events: Map<keyof EventMap, EventListener[]> = new Map();

  /**
   * Register an event listener
   */
  on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): this {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event)?.push(listener as EventListener);
    return this;
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): this {
    if (!this._events.has(event)) return this;

    const listeners = this._events.get(event);
    if (!listeners) return this;

    const index = listeners.indexOf(listener as EventListener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this._events.delete(event);
    }
    return this;
  }

  /**
   * Emit an event to all registered listeners
   */
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K][]): boolean {
    if (!this._events.has(event)) return false;

    const listeners = this._events.get(event);
    if (!listeners) return false;

    listeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${String(event)}:`, error);
      }
    });
    return true;
  }

  /**
   * Register a one-time event listener
   */
  once<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): this {
    const onceWrapper = (...args: EventMap[K][]) => {
      this.off(event, onceWrapper as EventListener<EventMap[K]>);
      listener(...args);
    };
    return this.on(event, onceWrapper as EventListener<EventMap[K]>);
  }

  /**
   * Remove all listeners for an event, or all events if no event specified
   */
  removeAllListeners<K extends keyof EventMap>(event?: K): this {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  /**
   * Get the count of listeners for an event
   */
  listenerCount<K extends keyof EventMap>(event: K): number {
    return this._events.has(event) ? (this._events.get(event)?.length ?? 0) : 0;
  }
}

export default EventEmitter;
