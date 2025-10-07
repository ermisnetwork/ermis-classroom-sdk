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
    listeners.forEach((listener) => {
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

export default EventEmitter;
