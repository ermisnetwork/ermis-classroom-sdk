import EventEmitter from "../../../events/EventEmitter";
import type {
  WebTransportConfig,
  TransportManagerEvents,
} from "../../../types/media/transport.types";

/**
 * WebTransportManager - Manages WebTransport connection lifecycle
 *
 * Responsibilities:
 * - Establish and maintain WebTransport connection
 * - Handle connection state changes
 * - Provide connection health monitoring
 * - Handle reconnection logic
 * - Create bidirectional and unidirectional streams
 *
 * Events:
 * - connected: When connection is established
 * - disconnected: When connection is lost
 * - reconnecting: When attempting to reconnect
 * - reconnectFailed: When all reconnection attempts fail
 * - connectionError: When connection error occurs
 * - streamCreated: When a stream is created
 * - streamError: When stream creation fails
 * - closed: When connection is closed gracefully
 */
export class WebTransportManager extends EventEmitter<
  Record<keyof TransportManagerEvents, unknown>
> {
  private transport: WebTransport | null = null;
  private config: WebTransportConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private connectionTimeout = 10000;

  constructor(config: WebTransportConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to WebTransport server
   */
  async connect(): Promise<WebTransport> {
    if (this.isConnected && this.transport) {
      console.log("[WebTransport] Already connected");
      return this.transport;
    }

    try {
      console.log("[WebTransport] Connecting to:", this.config.url);

      const connectPromise = new Promise<WebTransport>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("WebTransport connection timeout"));
        }, this.connectionTimeout);

        (async () => {
          try {
            this.transport = new WebTransport(this.config.url, {
              serverCertificateHashes: this.config.serverCertificateHashes,
            });

            await this.transport.ready;
            clearTimeout(timeout);

            this.isConnected = true;
            this.reconnectAttempts = 0;

            this.setupEventHandlers();

            console.log("[WebTransport] Connected successfully");
            this.emit("connected");

            resolve(this.transport);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        })();
      });

      return await connectPromise;
    } catch (error) {
      console.error("[WebTransport] Connection failed:", error);
      this.emit("connectionError", error);

      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        return this.attemptReconnect();
      }

      throw error;
    }
  }

  /**
   * Setup event handlers for WebTransport
   */
  private setupEventHandlers(): void {
    if (!this.transport) return;

    // Handle connection closure
    this.transport.closed
      .then(() => {
        console.log("[WebTransport] Connection closed gracefully");
        this.handleDisconnection("closed");
      })
      .catch((error) => {
        console.error("[WebTransport] Connection closed with error:", error);
        this.handleDisconnection("error", error);
      });
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(
    reason: "closed" | "error",
    error?: unknown,
  ): void {
    this.isConnected = false;
    this.transport = null;

    this.emit("disconnected", { reason, error });

    // Attempt reconnection if not gracefully closed
    if (
      reason === "error" &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      void this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnect(): Promise<WebTransport> {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * 2 ** (this.reconnectAttempts - 1);

    console.log(
      `[WebTransport] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
    );
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      return await this.connect();
    } catch (error) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.emit("reconnectFailed", error);
        throw new Error("Max reconnection attempts reached");
      }
      throw error;
    }
  }

  /**
   * Create bidirectional stream
   */
  async createBidirectionalStream(): Promise<WebTransportBidirectionalStream> {
    if (!this.transport || !this.isConnected) {
      throw new Error("WebTransport not connected");
    }

    try {
      const stream = await this.transport.createBidirectionalStream();
      this.emit("streamCreated", "bidirectional");
      console.log("[WebTransport] Bidirectional stream created");
      return stream;
    } catch (error) {
      console.error(
        "[WebTransport] Failed to create bidirectional stream:",
        error,
      );
      this.emit("streamError", error);
      throw error;
    }
  }

  /**
   * Create unidirectional stream
   */
  // async createUnidirectionalStream(): Promise<WritableStream> {
  //   if (!this.transport || !this.isConnected) {
  //     throw new Error("WebTransport not connected");
  //   }

  //   try {
  //     const stream = await this.transport.createUnidirectionalStream();
  //     this.emit("streamCreated", "unidirectional");
  //     console.log("[WebTransport] Unidirectional stream created");
  //     return stream;
  //   } catch (error) {
  //     console.error(
  //       "[WebTransport] Failed to create unidirectional stream:",
  //       error,
  //     );
  //     this.emit("streamError", error);
  //     throw error;
  //   }
  // }

  /**
   * Get connection statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    reconnectAttempts: number;
    datagrams?: WebTransportDatagramDuplexStream;
  }> {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      datagrams: this.transport?.datagrams,
    };
  }

  /**
   * Close connection gracefully
   */
  async close(closeInfo?: WebTransportCloseInfo): Promise<void> {
    if (!this.transport) {
      console.log("[WebTransport] No active connection to close");
      return;
    }

    try {
      console.log("[WebTransport] Closing connection...");
      this.transport.close(closeInfo);

      // Wait for closure
      await this.transport.closed;

      this.isConnected = false;
      this.transport = null;
      this.reconnectAttempts = 0;

      this.emit("closed");
      console.log("[WebTransport] Connection closed successfully");
    } catch (error) {
      console.error("[WebTransport] Error during close:", error);
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isTransportConnected(): boolean {
    return this.isConnected && this.transport !== null;
  }

  /**
   * Get transport instance
   */
  getTransport(): WebTransport | null {
    return this.transport;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebTransportConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset reconnection counter
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  /**
   * Set max reconnection attempts
   */
  setMaxReconnectAttempts(max: number): void {
    this.maxReconnectAttempts = max;
  }

  /**
   * Set reconnection delay
   */
  setReconnectDelay(delay: number): void {
    this.reconnectDelay = delay;
  }

  /**
   * Set connection timeout
   */
  setConnectionTimeout(timeout: number): void {
    this.connectionTimeout = timeout;
  }
}
