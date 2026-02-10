/**
 * WebGL2 Video Renderer
 * Renders VideoFrames and YUV420 buffers to canvas
 * Falls back to Canvas 2D if WebGL2 is unavailable
 */

// YUV to RGB conversion shader
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

const RGBA_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}`;

export class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.yuvProgram = null;
        this.rgbaProgram = null;
        this.textures = {};
        this.initialized = false;
        this.useWebGLForVideoFrame = false; // Use 2D for VideoFrame by default (more efficient)
        
        this._init();
    }
    
    _init() {
        // Try WebGL2 first for YUV rendering
        const gl = this.canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
        });
        
        if (!gl) {
            console.warn('WebGL2 not available, falling back to 2D');
            this.ctx2d = this.canvas.getContext('2d');
            return;
        }
        
        this.gl = gl;
        
        // Create YUV program for WASM decoder output
        this.yuvProgram = this._createProgram(VERTEX_SHADER, YUV_FRAGMENT_SHADER);
        
        // Create RGBA program (fallback for VideoFrame if needed)
        this.rgbaProgram = this._createProgram(VERTEX_SHADER, RGBA_FRAGMENT_SHADER);
        
        // Setup geometry (full-screen quad)
        this._setupGeometry();
        
        // Create textures for YUV planes
        this.textures.y = this._createTexture();
        this.textures.u = this._createTexture();
        this.textures.v = this._createTexture();
        this.textures.rgba = this._createTexture();
        
        this.initialized = true;
    }
    
    _createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    _createProgram(vertexSrc, fragmentSrc) {
        const gl = this.gl;
        const vertexShader = this._createShader(gl.VERTEX_SHADER, vertexSrc);
        const fragmentShader = this._createShader(gl.FRAGMENT_SHADER, fragmentSrc);
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }
    
    _setupGeometry() {
        const gl = this.gl;
        
        // Positions (clip space)
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);
        
        // Texture coordinates (flipped Y for video)
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
    
    _createTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
    }
    
    _bindAttributes(program) {
        const gl = this.gl;
        
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
     * Render a VideoFrame to the canvas
     * For native VideoFrames, uses Canvas 2D drawImage which is optimized
     * for GPU-backed frames (zero-copy or fast GPU blit)
     * @param {VideoFrame} frame - The VideoFrame to render
     */
    renderVideoFrame(frame) {
        if (!frame) return;
        
        // Resize canvas if needed
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
            
            // Reset viewport for WebGL
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }
        
        // For 2D context, use drawImage (optimal for VideoFrame)
        if (this.ctx2d) {
            this.ctx2d.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        
        // For WebGL, upload VideoFrame as texture
        // Modern browsers optimize this for GPU-backed VideoFrames
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        gl.useProgram(this.rgbaProgram);
        this._bindAttributes(this.rgbaProgram);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.rgba);
        
        // texImage2D with VideoFrame - browser handles GPU→GPU transfer if possible
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        
        gl.uniform1i(gl.getUniformLocation(this.rgbaProgram, 'u_texture'), 0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    /**
     * Render YUV420 planar data to the canvas
     * @param {Uint8Array} yPlane - Y plane data
     * @param {Uint8Array} uPlane - U plane data
     * @param {Uint8Array} vPlane - V plane data
     * @param {number} width - Frame width
     * @param {number} height - Frame height
     */
    renderYUV420(yPlane, uPlane, vPlane, width, height) {
        // Resize canvas if needed
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        
        if (this.ctx2d) {
            // 2D fallback - convert YUV to RGB manually
            this._renderYUV420_2D(yPlane, uPlane, vPlane, width, height);
            return;
        }
        
        const gl = this.gl;
        gl.viewport(0, 0, width, height);
        
        gl.useProgram(this.yuvProgram);
        this._bindAttributes(this.yuvProgram);
        
        const uvWidth = width >> 1;
        const uvHeight = height >> 1;
        
        // Upload Y plane
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.y);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);
        
        // Upload U plane
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.u);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, uvWidth, uvHeight, 0, gl.RED, gl.UNSIGNED_BYTE, uPlane);
        
        // Upload V plane
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.v);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, uvWidth, uvHeight, 0, gl.RED, gl.UNSIGNED_BYTE, vPlane);
        
        // Set uniforms
        gl.uniform1i(gl.getUniformLocation(this.yuvProgram, 'u_textureY'), 0);
        gl.uniform1i(gl.getUniformLocation(this.yuvProgram, 'u_textureU'), 1);
        gl.uniform1i(gl.getUniformLocation(this.yuvProgram, 'u_textureV'), 2);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    /**
     * Render YUV420 using Canvas 2D (fallback)
     */
    _renderYUV420_2D(yPlane, uPlane, vPlane, width, height) {
        const imageData = this.ctx2d.createImageData(width, height);
        const rgba = imageData.data;
        
        const uvWidth = width >> 1;
        
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const yIndex = j * width + i;
                const uvIndex = (j >> 1) * uvWidth + (i >> 1);
                
                const y = yPlane[yIndex];
                const u = uPlane[uvIndex] - 128;
                const v = vPlane[uvIndex] - 128;
                
                // BT.601 conversion
                let r = y + 1.402 * v;
                let g = y - 0.344136 * u - 0.714136 * v;
                let b = y + 1.772 * u;
                
                // Clamp
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
        
        this.ctx2d.putImageData(imageData, 0, 0);
    }
    
    /**
     * Render ImageData (RGBA) to canvas
     * @param {ImageData} imageData - The ImageData to render
     */
    renderImageData(imageData) {
        if (this.ctx2d) {
            this.ctx2d.putImageData(imageData, 0, 0);
            return;
        }
        
        const gl = this.gl;
        
        if (this.canvas.width !== imageData.width || this.canvas.height !== imageData.height) {
            this.canvas.width = imageData.width;
            this.canvas.height = imageData.height;
        }
        
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.rgbaProgram);
        this._bindAttributes(this.rgbaProgram);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.rgba);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
        
        gl.uniform1i(gl.getUniformLocation(this.rgbaProgram, 'u_texture'), 0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    /**
     * Check if WebGL2 is being used
     */
    isWebGL() {
        return this.gl !== null;
    }
    
    /**
     * Cleanup resources
     */
    destroy() {
        if (this.gl) {
            const gl = this.gl;
            gl.deleteTexture(this.textures.y);
            gl.deleteTexture(this.textures.u);
            gl.deleteTexture(this.textures.v);
            gl.deleteTexture(this.textures.rgba);
            gl.deleteBuffer(this.positionBuffer);
            gl.deleteBuffer(this.texCoordBuffer);
            gl.deleteProgram(this.yuvProgram);
            gl.deleteProgram(this.rgbaProgram);
        }
    }
}

/**
 * Check if MediaStreamTrackGenerator is available
 */
export function hasMediaStreamTrackGenerator() {
    return typeof MediaStreamTrackGenerator !== 'undefined';
}

/**
 * Check if WebGL2 is available
 */
export function hasWebGL2() {
    try {
        const canvas = document.createElement('canvas');
        return !!canvas.getContext('webgl2');
    } catch (e) {
        return false;
    }
}

export default WebGLRenderer;
