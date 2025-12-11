// Check if EncodedAudioChunk is not supported
if (!globalThis.EncodedAudioChunk) {
  console.warn("EncodedAudioChunk not supported, using polyfill");

  self.EncodedAudioChunk = class EncodedAudioChunk {
    #type;
    #timestamp;
    #duration;
    #data;
    #byteLength;

    constructor(init) {
      // Validate required parameters
      if (!init || !init.type || !init.data) {
        throw new TypeError(
          "EncodedAudioChunk constructor requires type and data"
        );
      }

      if (init.type !== "key" && init.type !== "delta") {
        throw new TypeError("EncodedAudioChunk type must be 'key' or 'delta'");
      }

      // Store properties
      this.#type = init.type;
      this.#timestamp = init.timestamp || 0;
      this.#duration = init.duration || 0;

      // Handle data based on its type
      if (init.data instanceof ArrayBuffer) {
        this.#data = new Uint8Array(init.data);
      } else if (ArrayBuffer.isView(init.data)) {
        this.#data = new Uint8Array(
          init.data.buffer,
          init.data.byteOffset,
          init.data.byteLength
        );
      } else {
        throw new TypeError(
          "EncodedAudioChunk data must be an ArrayBuffer or ArrayBufferView"
        );
      }

      this.#byteLength = this.#data.byteLength;
    }

    // Read-only properties getters
    get type() {
      return this.#type;
    }

    get timestamp() {
      return this.#timestamp;
    }

    get duration() {
      return this.#duration;
    }

    get byteLength() {
      return this.#byteLength;
    }

    // Method to copy data to a destination buffer
    copyTo(destination) {
      if (
        !(destination instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(destination)
      ) {
        throw new TypeError(
          "Destination must be an ArrayBuffer or ArrayBufferView"
        );
      }

      // Get a view of the destination
      let destView;
      if (destination instanceof ArrayBuffer) {
        destView = new Uint8Array(destination);
      } else {
        destView = new Uint8Array(
          destination.buffer,
          destination.byteOffset,
          destination.byteLength
        );
      }

      // Check if destination has enough space
      if (destView.byteLength < this.#byteLength) {
        throw new DOMException(
          "Destination buffer is too small",
          "InvalidStateError"
        );
      }

      // Copy the data
      destView.set(this.#data);
      return destination;
    }
  };

  // Replace the global EncodedAudioChunk with our polyfill
  // globalThis.EncodedAudioChunk = EncodedAudioChunkPolyfill;
}
