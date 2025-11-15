/**
 * WebTransportManager - Manages WebTransport connections for subscriber
 *
 * Responsibilities:
 * - Establishes WebTransport connection to subscribe URL
 * - Creates bidirectional streams for video and audio channels
 * - Manages connection lifecycle and reconnection
 */

import EventEmitter from "../../../events/EventEmitter";

/**
 * Stream channel types
 */
export type StreamChannelType = "cam_360p" | "cam_720p" | "mic_48k" | "media";

/**
 * WebTransport stream info
 */
export interface WebTransportStreamInfo {
  channelName: StreamChannelType;
  readable: ReadableStream;
  writable: WritableStream;
}

/**
 * WebTransport manager events
 */
interface WebTransportManagerEvents extends Record<string, unknown> {
  connected: undefined;
  disconnected: { reason?: string; error?: unknown };
  streamCreated: WebTransportStreamInfo;
  error: { error: Error; context: string };
}

/**
 * WebTransportManager class
 */
export class WebTransportManager extends EventEmitter<WebTransportManagerEvents> {
  private webTransport: WebTransport | null = null;
  private subscribeUrl: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  constructor(subscribeUrl: string) {
    super();
    this.subscribeUrl = subscribeUrl;
  }

  /**
   * Connect to WebTransport server
   */
  async connect(): Promise<void> {
    try {
      console.log("Connecting to WebTransport:", this.subscribeUrl);

      this.webTransport = new WebTransport(this.subscribeUrl);
      await this.webTransport.ready;

      this.isConnected = true;
      this.reconnectAttempts = 0;

      console.log("WebTransport connected successfully");
      this.emit("connected", undefined);

      // Listen for connection closure
      this.webTransport.closed
        .then(() => {
          console.log("WebTransport closed gracefully");
          this.handleDisconnection();
        })
        .catch((error) => {
          console.error("WebTransport closed with error:", error);
          this.handleDisconnection(error);
        });
    } catch (error) {
      console.error("Failed to connect to WebTransport:", error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Create a bidirectional stream for a channel
   */
  async createBidirectionalStream(
    channelName: StreamChannelType
  ): Promise<WebTransportStreamInfo> {
    if (!this.webTransport || !this.isConnected) {
      throw new Error("WebTransport not connected");
    }

    try {
      console.log(`Creating bidirectional stream for ${channelName}`);

      const stream = await this.webTransport.createBidirectionalStream();

      const streamInfo: WebTransportStreamInfo = {
        channelName,
        readable: stream.readable,
        writable: stream.writable,
      };

      this.emit("streamCreated", streamInfo);

      return streamInfo;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Stream creation failed");
      console.error(`Failed to create stream for ${channelName}:`, err);
      this.emit("error", { error: err, context: "createBidirectionalStream" });
      throw err;
    }
  }

  /**
   * Disconnect from WebTransport
   */
  async disconnect(): Promise<void> {
    if (this.webTransport) {
      try {
        this.webTransport.close();
        this.webTransport = null;
        this.isConnected = false;
        console.log("WebTransport disconnected");
      } catch (error) {
        console.error("Error during disconnect:", error);
      }
    }
  }

  /**
   * Handle disconnection with smart retry logic
   */
  private handleDisconnection(error?: unknown): void {
    this.isConnected = false;
    this.webTransport = null;

    this.emit("disconnected", {
      reason: error ? "Connection error" : "Connection closed",
      error,
    });

    // Check if error is retriable
    const shouldRetry = this.isRetriableError(error);

    if (!shouldRetry) {
      console.error(
        "[WebTransport] Non-retriable error, not attempting reconnection"
      );
      this.emit("error", {
        error:
          error instanceof Error ? error : new Error(String(error)),
        context: "Non-retriable disconnection",
      });
      return;
    }

    // Attempt reconnection for retriable errors
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnection();
    } else {
      console.error("[WebTransport] Max reconnection attempts reached");
      this.emit("error", {
        error: new Error("Max reconnection attempts exceeded"),
        context: "reconnection",
      });
    }
  }

  /**
   * Determine if an error is retriable
   */
  private isRetriableError(error: unknown): boolean {
    if (!error) return true; // Graceful closure, can retry

    const errorMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    // Don't retry on configuration/authentication errors
    const nonRetriablePatterns = [
      "invalid url",
      "authentication",
      "unauthorized",
      "forbidden",
      "not found",
      "bad request",
      "invalid configuration",
      "stream mode",
    ];

    for (const pattern of nonRetriablePatterns) {
      if (errorMessage.includes(pattern)) {
        console.warn(
          `[WebTransport] Non-retriable error detected: ${errorMessage}`
        );
        return false;
      }
    }

    // Retry on network/temporary errors
    return true;
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: unknown): void {
    const err =
      error instanceof Error ? error : new Error("Connection error");
    this.emit("error", { error: err, context: "connect" });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++;

    // Exponential backoff with max cap
    const baseDelay = this.reconnectDelay; // 2000ms
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      maxDelay
    );

    console.log(
      `[WebTransport] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
      console.log("[WebTransport] Reconnection successful!");
    } catch (error) {
      console.error(
        `[WebTransport] Reconnection attempt ${this.reconnectAttempts} failed:`,
        error
      );

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("[WebTransport] All reconnection attempts failed");
        this.emit("error", {
          error: new Error("All reconnection attempts failed"),
          context: "reconnection",
        });
      }
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Reset reconnection attempts
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}
