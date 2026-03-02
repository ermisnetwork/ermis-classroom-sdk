/**
 * VideoProcessor - Manages video processing for subscriber
 *
 * Responsibilities:
 * - Initializes MediaStreamTrackGenerator for native VideoFrame
 * - Uses WebGL for WASM decoder YUV420 output (GPU-accelerated)
 * - Falls back to canvas capture for MediaStream when using WebGL
 * - Optional jitter buffer for smooth playback (screen share)
 * - Manages video track lifecycle
 */

import EventEmitter from "../../../events/EventEmitter";
import { log } from "../../../utils";

// YUV to RGB WebGL shaders
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const YUV_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_textureY;
uniform sampler2D u_textureU;
uniform sampler2D u_textureV;

void main() {
    float y = texture(u_textureY, v_texCoord).r;
    float u = texture(u_textureU, v_texCoord).r - 0.5;
    float v = texture(u_textureV, v_texCoord).r - 0.5;
    
    // BT.601 conversion
    float r = y + 1.402 * v;
    float g = y - 0.344136 * u - 0.714136 * v;
    float b = y + 1.772 * u;
    
    fragColor = vec4(r, g, b, 1.0);
}`;

// RGBA pass-through shader
const RGBA_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}`;

/**
 * Video processor events
 */
interface VideoProcessorEvents extends Record<string, unknown> {
  initialized: { stream: MediaStream };
  frameProcessed: undefined;
  error: { error: Error; context: string };
}

interface YUV420Frame {
  format: 'yuv420';
  yPlane: Uint8Array;
  uPlane: Uint8Array;
  vPlane: Uint8Array;
  width: number;
  height: number;
}

/**
 * VideoProcessor class
 */
export class VideoProcessor extends EventEmitter<VideoProcessorEvents> {
  private videoGenerator: MediaStreamTrackGenerator | null = null;
  private videoWriter: WritableStreamDefaultWriter<VideoFrame> | null = null;
  private mediaStream: MediaStream | null = null;

  // WebGL rendering for YUV420 (WASM decoder)
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null; // 2D fallback
  private yuvProgram: WebGLProgram | null = null;
  private rgbaProgram: WebGLProgram | null = null; // RGBA program
  private textures: {
    y: WebGLTexture | null;
    u: WebGLTexture | null;
    v: WebGLTexture | null;
    rgba: WebGLTexture | null; // RGBA texture
  } = { y: null, u: null, v: null, rgba: null };

  // Buffers (from stream-poc2 - separate buffers for better attribute binding)
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  private webglInitialized = false;
  private useWebGL = false;
  private frameCount = 0;
  private _writeFrameCount = 0;

  // Fallback for browsers without MediaStreamTrackGenerator (e.g. iOS 15)
  private useCanvasCapture = false;

  /**
   * Check if VideoFrame constructor works with canvas (test for iOS 15 compatibility)
   */
  private isVideoFrameWithCanvasSupported(): boolean {
    try {
      // VideoFrame must exist
      if (typeof VideoFrame === 'undefined') return false;

      // On iOS Safari 15, VideoFrame exists but doesn't work with OffscreenCanvas
      // Test by checking if we can create a minimal test
      // Note: The actual VideoFrame(canvas) creation will fail silently on some browsers
      // So we also need to check if OffscreenCanvas is properly supported
      if (typeof OffscreenCanvas === 'undefined') return false;

      // Additional check: iOS Safari 15 has issues with VideoFrame + OffscreenCanvas
      // Detect by checking for native VideoDecoder support (if no VideoDecoder, likely old Safari)
      if (typeof VideoDecoder === 'undefined') {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // Jitter buffer - smooths bursty frame delivery into adaptive-rate output
  private jitterBufferEnabled = false;
  private jitterBuffer: VideoFrame[] = [];
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackTimerActive = false;
  private playbackIntervalMs = 50; // 20fps output rate
  private targetBufferSize = 3; // Aim to keep ~3 frames buffered (150ms at 20fps)
  private maxBufferSize = 15; // Drop oldest frames if buffer exceeds this
  // private isWriting = false; // Guard against overlapping writes

  // Diagnostics
  private lastFrameArrivalTime = 0;
  private frameArrivalGaps: number[] = [];

  /**
   * Enable jitter buffer for smooth playback
   * @param fps - Target output framerate (used to calculate playback interval)
   */
  enableJitterBuffer(fps: number = 20): void {
    this.jitterBufferEnabled = true;
    this.playbackIntervalMs = Math.round(1000 / fps);
    this.targetBufferSize = Math.max(2, Math.ceil(fps * 0.15)); // ~150ms worth of frames
    this.maxBufferSize = fps; // 1 second max
    log(`[VideoProcessor] Jitter buffer enabled: ${fps}fps, interval=${this.playbackIntervalMs}ms, targetBuffer=${this.targetBufferSize}`);
  }

  /**
   * Initialize video system
   */
  init(): MediaStream {
    try {
      log("[VideoProcessor] Initializing video system...");

      // Check for full pipeline support: MediaStreamTrackGenerator + VideoFrame(canvas)
      const hasTrackGenerator = typeof MediaStreamTrackGenerator === "function";
      const hasVideoFrameCanvas = this.isVideoFrameWithCanvasSupported();

      if (hasTrackGenerator && hasVideoFrameCanvas) {
        log("[VideoProcessor] Creating MediaStreamTrackGenerator...");
        // Create video track generator
        this.videoGenerator = new MediaStreamTrackGenerator({
          kind: "video",
        });

        this.videoWriter = this.videoGenerator.writable.getWriter();

        // Create MediaStream with video track only
        this.mediaStream = new MediaStream([this.videoGenerator]);
      } else {
        log("[VideoProcessor] Using canvas.captureStream() fallback.");
        this.useCanvasCapture = true;

        // Create fallback canvas immediately
        const width = 640; // Default width
        const height = 480; // Default height
        this.initWebGL(width, height);

        if (this.canvas && 'captureStream' in this.canvas) {
          // Cast to any because TS might not know captureStream exists on HTMLCanvasElement in all envs or it might be OffscreenCanvas type intersection issue
          this.mediaStream = (this.canvas as any).captureStream(30); // 30 FPS
        } else {
          throw new Error("Canvas captureStream not supported");
        }
      }

      log("[VideoProcessor] Video system initialized");
      this.emit("initialized", { stream: this.mediaStream! });

      return this.mediaStream!;

    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Video initialization failed");
      console.error("[VideoProcessor] ❌ Failed to initialize video system:", err);
      this.emit("error", { error: err, context: "init" });
      throw err;
    }
  }

  /**
   * Initialize WebGL for YUV420 rendering (with 2D fallback from stream-poc2)
   */
  private initWebGL(width: number, height: number): void {
    if (this.webglInitialized) return;

    try {
      // Create offscreen canvas or regular canvas
      if (!this.useCanvasCapture && typeof OffscreenCanvas !== 'undefined') {
        this.canvas = new OffscreenCanvas(width, height);
      } else {
        // Must use regular canvas for captureStream or if OffscreenCanvas not available
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
      }

      // Try WebGL2 first
      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true, // Required for captureStream fallback
      }) as WebGL2RenderingContext;

      if (!this.gl) {
        // 2D fallback
        console.warn('[VideoProcessor] WebGL2 not available, falling back to 2D');
        if (this.canvas instanceof HTMLCanvasElement) {
          this.ctx2d = this.canvas.getContext('2d');
        }
        this.webglInitialized = true;
        this.useWebGL = false;
        log('[VideoProcessor] ✅ 2D canvas renderer initialized (fallback)');
        return;
      }

      // Create YUV program for WASM decoder output
      this.yuvProgram = this.createProgram(VERTEX_SHADER, YUV_FRAGMENT_SHADER);
      if (!this.yuvProgram) return;

      // Create RGBA program (from stream-poc2 - for VideoFrame/ImageData)
      this.rgbaProgram = this.createProgram(VERTEX_SHADER, RGBA_FRAGMENT_SHADER);

      // Setup geometry (full-screen quad with separate buffers)
      this.setupGeometry();

      // Create textures for YUV planes
      this.textures.y = this.createTexture();
      this.textures.u = this.createTexture();
      this.textures.v = this.createTexture();
      this.textures.rgba = this.createTexture(); // RGBA texture

      this.webglInitialized = true;
      this.useWebGL = true;
      log('[VideoProcessor] ✅ WebGL YUV+RGBA renderer initialized');
    } catch (e) {
      console.warn('[VideoProcessor] Failed to initialize WebGL:', e);
    }
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createProgram(vertexSrc: string, fragmentSrc: string): WebGLProgram | null {
    const gl = this.gl!;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSrc);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSrc);

    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Setup geometry using separate buffers
   */
  private setupGeometry(): void {
    const gl = this.gl!;

    // Positions (clip space) - from stream-poc2
    const positions = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);

    // Texture coordinates (flipped Y for video) - from stream-poc2
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);

    // Position buffer
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Texcoord buffer
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  }

  private createTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Texture params order matches stream-poc2
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  /**
   * Bind attributes for a specific program
   */
  private bindAttributes(program: WebGLProgram): void {
    const gl = this.gl!;

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * Render YUV420 using WebGL
   */
  private renderYUV420(frame: YUV420Frame): void {
    // Use 2D fallback if WebGL not available
    if (this.ctx2d) {
      this.renderYUV420_2D(frame);
      return;
    }

    const gl = this.gl!;
    const program = this.yuvProgram!;
    const { yPlane, uPlane, vPlane, width, height } = frame;

    // Resize canvas if needed
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width;
      this.canvas!.height = height;
      gl.viewport(0, 0, width, height);
    }

    gl.useProgram(program);
    this.bindAttributes(program);

    const uvWidth = width >> 1;
    const uvHeight = height >> 1;

    // Upload Y plane
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.y);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureY'), 0);

    // Upload U plane
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.u);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, uvWidth, uvHeight, 0, gl.RED, gl.UNSIGNED_BYTE, uPlane);
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureU'), 1);

    // Upload V plane
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, uvWidth, uvHeight, 0, gl.RED, gl.UNSIGNED_BYTE, vPlane);
    gl.uniform1i(gl.getUniformLocation(program, 'u_textureV'), 2);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Render YUV420 using Canvas 2D (fallback from stream-poc2)
   * Software BT.601 YUV to RGB conversion
   */
  private renderYUV420_2D(frame: YUV420Frame): void {
    const ctx = this.ctx2d!;
    const { yPlane, uPlane, vPlane, width, height } = frame;

    // Resize canvas if needed
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width;
      this.canvas!.height = height;
    }

    const imageData = ctx.createImageData(width, height);
    const rgba = imageData.data;
    const uvWidth = width >> 1;

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const yIndex = j * width + i;
        const uvIndex = (j >> 1) * uvWidth + (i >> 1);

        const y = yPlane[yIndex];
        const u = uPlane[uvIndex] - 128;
        const v = vPlane[uvIndex] - 128;

        // BT.601 conversion (same as stream-poc2)
        let r = y + 1.402 * v;
        let g = y - 0.344136 * u - 0.714136 * v;
        let b = y + 1.772 * u;

        // Clamp to 0-255
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));

        const rgbaIndex = yIndex * 4;
        rgba[rgbaIndex] = r;
        rgba[rgbaIndex + 1] = g;
        rgba[rgbaIndex + 2] = b;
        rgba[rgbaIndex + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Render a VideoFrame directly to canvas
   * Uses Canvas 2D drawImage for optimal GPU→GPU transfer
   */
  renderVideoFrame(frame: VideoFrame): void {
    if (!frame) return;

    // Resize canvas if needed
    const displayWidth = frame.displayWidth;
    const displayHeight = frame.displayHeight;

    if (this.canvas!.width !== displayWidth || this.canvas!.height !== displayHeight) {
      this.canvas!.width = displayWidth;
      this.canvas!.height = displayHeight;

      if (this.gl) {
        this.gl.viewport(0, 0, displayWidth, displayHeight);
      }
    }

    // For 2D context, use drawImage (optimal for VideoFrame - from stream-poc2)
    if (this.ctx2d) {
      this.ctx2d.drawImage(frame, 0, 0, displayWidth, displayHeight);
      return;
    }

    // For WebGL, upload VideoFrame as texture
    // Modern browsers optimize this for GPU-backed VideoFrames
    const gl = this.gl!;
    const program = this.rgbaProgram!;

    gl.viewport(0, 0, displayWidth, displayHeight);
    gl.useProgram(program);
    this.bindAttributes(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.rgba);

    // texImage2D with VideoFrame - browser handles GPU→GPU transfer if possible
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Render ImageData (RGBA) to canvas
   */
  renderImageData(imageData: ImageData): void {
    if (this.ctx2d) {
      this.ctx2d.putImageData(imageData, 0, 0);
      return;
    }

    const gl = this.gl!;
    const program = this.rgbaProgram!;

    if (this.canvas!.width !== imageData.width || this.canvas!.height !== imageData.height) {
      this.canvas!.width = imageData.width;
      this.canvas!.height = imageData.height;
    }

    gl.viewport(0, 0, this.canvas!.width, this.canvas!.height);
    gl.useProgram(program);
    this.bindAttributes(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.rgba);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private isWriting = false;

  /**
   * Write video frame (with optional jitter buffer)
   * Handles both native VideoFrame and YUV420 frame objects from WASM decoder
   * Uses non-blocking approach to avoid pipeline stalls
   */
  async writeFrame(frame: VideoFrame | YUV420Frame): Promise<void> {
    if (!frame) {
      return;
    }

    // Skip if already writing (backpressure) - ONLY for VideoFrame generator mode
    // For manual canvas render, we can just draw immediately as it's sync
    if (!this.useCanvasCapture && this.isWriting) {
      // Close frame if it's a VideoFrame to avoid memory leak
      if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
        frame.close();
      }
      return;
    }

    try {
      // Handle YUV420 frame from WASM decoder - use WebGL
      if ('format' in frame && frame.format === 'yuv420') {
        const yuvFrame = frame as YUV420Frame;

        // Initialize WebGL on first YUV frame if not already done
        if (!this.webglInitialized) {
          this.initWebGL(yuvFrame.width, yuvFrame.height);
        }

        if (this.useWebGL && this.gl && this.canvas) {
          // Render YUV to canvas via WebGL (synchronous)
          this.renderYUV420(yuvFrame);

          // If using canvas capture fallback, we're done! The stream updates automatically.
          if (this.useCanvasCapture) {
            this.emit("frameProcessed", undefined);
            return;
          }

          // Create VideoFrame from canvas and write to generator
          if (this.videoWriter && typeof VideoFrame !== 'undefined') {
            const videoFrame = new VideoFrame(this.canvas as OffscreenCanvas, {
              timestamp: Date.now() * 1000,
            });

            this.isWriting = true;
            // Non-blocking write - don't await
            this.videoWriter.write(videoFrame).then(() => {
              this.isWriting = false;
              this.frameCount++;
              this.emit("frameProcessed", undefined);
            }).catch(() => {
              this.isWriting = false;
            }).finally(() => {
              videoFrame.close();
            });
          }
        }
      }
      // Handle native VideoFrame
      else if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) {
        if (!this.videoWriter) {
          frame.close();
          return;
        }

        this.isWriting = true;
        // Non-blocking write
        this.videoWriter.write(frame).then(() => {
          this.isWriting = false;
          this.frameCount++;
          this.emit("frameProcessed", undefined);
        }).catch(() => {
          this.isWriting = false;
        });
        // Note: Don't close native VideoFrame here - caller may still need it
      }
    } catch (error) {
      this.isWriting = false;
      console.warn("Error writing frame:", error);
    }
  }

  /**
   * Write a single frame to the video writer directly
   */
  private async writeFrameDirect(frame: VideoFrame): Promise<void> {
    try {
      await this.videoWriter!.write(frame);

      this.frameCount++;
      this.emit("frameProcessed", undefined);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Video write failed");
      console.error(`[VideoProcessor] ❌ Failed to write video frame #${this.frameCount}:`, err);

      if (this.videoGenerator) {
        console.error("[VideoProcessor] Track state after error:", this.videoGenerator.readyState);
      }

      this.emit("error", { error: err, context: "writeFrame" });
      throw err;
    }
  }

  // ==========================================
  // === Jitter Buffer Playback             ===
  // ==========================================

  /**
   * Start the adaptive-rate playback timer
   * Writes one frame from the buffer at each tick, adjusting rate based on backlog
   */
  private startPlaybackTimer(): void {
    this.stopPlaybackTimer();
    this.playbackTimerActive = true;
    log(`[VideoProcessor] Starting jitter buffer playback at ~${this.playbackIntervalMs
      }ms intervals`);

    const tick = () => {
      if (!this.playbackTimerActive) return;

      this.playbackTick().finally(() => {
        if (!this.playbackTimerActive) return;

        let delay = this.playbackIntervalMs;
        const backlog = this.jitterBuffer.length;

        // Adaptive delay: drain faster if buffer builds up
        if (backlog > this.targetBufferSize * 2) {
          delay = 5;  // extremely fast to catch up
        } else if (backlog > this.targetBufferSize) {
          delay = Math.max(5, Math.floor(this.playbackIntervalMs / 2)); // faster drain
        }

        this.playbackTimer = setTimeout(tick, delay);
      });
    };

    this.playbackTimer = setTimeout(tick, this.playbackIntervalMs);
  }

  /**
   * Stop the playback timer
   */
  private stopPlaybackTimer(): void {
    this.playbackTimerActive = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * Playback tick: write one frame from the buffer
   * Called at fixed intervals for smooth output
   */
  private async playbackTick(): Promise<void> {
    // Guard against overlapping writes
    if (this.isWriting) return;

    if (this.jitterBuffer.length === 0) {
      // Buffer underrun — no frame to show, keep showing last frame
      return;
    }

    this.isWriting = true;
    try {
      // Take the next frame from the buffer
      const frame = this.jitterBuffer.shift()!;
      await this.writeFrameDirect(frame);
    } catch {
      // Write failed, skip frame
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Get media stream
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Cleanup video system
   */
  cleanup(): void {
    try {
      // Cleanup WebGL resources
      if (this.gl) {
        // Delete textures
        if (this.textures.y) this.gl.deleteTexture(this.textures.y);
        if (this.textures.u) this.gl.deleteTexture(this.textures.u);
        if (this.textures.v) this.gl.deleteTexture(this.textures.v);
        if (this.textures.rgba) this.gl.deleteTexture(this.textures.rgba);

        // Delete buffers
        if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);

        // Delete programs
        if (this.yuvProgram) this.gl.deleteProgram(this.yuvProgram);
        if (this.rgbaProgram) this.gl.deleteProgram(this.rgbaProgram);

        this.gl = null;
      }

      // Cleanup 2D context
      this.ctx2d = null;
      this.canvas = null;
      this.webglInitialized = false;
      this.useWebGL = false;

      // Close video writer
      if (this.videoWriter) {
        try {
          this.videoWriter.releaseLock();
        } catch {
          // Writer might already be released
        }
        this.videoWriter = null;
      }

      // Stop video generator
      if (this.videoGenerator) {
        try {
          if (this.videoGenerator.stop) {
            this.videoGenerator.stop();
          }
        } catch {
          // Generator might already be stopped
        }
        this.videoGenerator = null;
      }

      this.mediaStream = null;

      log("Video system cleaned up");
    } catch (error) {
      console.warn("Error cleaning video system:", error);
    }
  }
}
