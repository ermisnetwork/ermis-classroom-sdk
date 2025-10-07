
      
if (!globalThis.MediaStreamTrackGenerator) {
      globalThis.MediaStreamTrackGenerator = class MediaStreamTrackGenerator {
        constructor({ kind }) {
          if (kind === "video") {
            const canvas = document.createElement("canvas");
            let gl;
            try {
              gl = canvas.getContext("webgl", { desynchronized: true });
              if (!gl) {
                console.warn("WebGL not supported, falling back to 2D canvas for MediaStreamTrackGenerator polyfill.");
                // Fallback to 2D, or throw error if 2D is not desired
                return this.create2DCanvasTrack(canvas);
              }
            } catch (e) {
              console.warn("Error initializing WebGL, falling back to 2D canvas for MediaStreamTrackGenerator polyfill.", e);
              return this.create2DCanvasTrack(canvas);
            }

            const vsSource = `
              attribute vec4 aVertexPosition;
              attribute vec2 aTextureCoord;
              varying highp vec2 vTextureCoord;
              void main(void) {
                gl_Position = aVertexPosition;
                vTextureCoord = aTextureCoord;
              }
            `;

            const fsSource = `
              varying highp vec2 vTextureCoord;
              uniform sampler2D uSampler;
              void main(void) {
                gl_FragColor = texture2D(uSampler, vTextureCoord);
              }
            `;

            const shaderProgram = this.initShaderProgram(gl, vsSource, fsSource);
            if (!shaderProgram) {
                console.error("Failed to initialize shader program for MediaStreamTrackGenerator polyfill. Video track will not work.");
                // Return a dummy track or throw an error
                const emptyTrack = canvas.captureStream().getVideoTracks()[0];
                emptyTrack.writable = new WritableStream({ write(frame) { frame.close(); }});
                return emptyTrack;
            }

            const programInfo = {
              program: shaderProgram,
              attribLocations: {
                vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
                textureCoord: gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
              },
              uniformLocations: {
                uSampler: gl.getUniformLocation(shaderProgram, 'uSampler'),
              },
            };

            const buffers = this.initBuffers(gl);
            const texture = this.initTexture(gl);

            const track = canvas.captureStream().getVideoTracks()[0];

            track.writable = new WritableStream({
              write(frame) {
                if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                  canvas.width = frame.displayWidth;
                  canvas.height = frame.displayHeight;
                  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
                }

                gl.clearColor(0.0, 0.0, 0.0, 0.0); // Clear to transparent
                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.useProgram(programInfo.program);

                // Bind position buffer
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
                gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

                // Bind texture coordinate buffer
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
                gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

                // Update texture with video frame
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

                gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                frame.close();
              },
            });
            return track;
          }
          // Placeholder for audio if it were to be re-added from MSTG_polyfill.old.js
          // else if (kind === "audio") { ... }
        }

        // Helper method for 2D canvas fallback (original implementation)
        create2DCanvasTrack(canvas) {
            const ctx = canvas.getContext("2d", { desynchronized: true });
            const track = canvas.captureStream().getVideoTracks()[0];
            track.writable = new WritableStream({
              write(frame) {
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                frame.close();
              },
            });
            return track;
        }

        // WebGL helper functions
        initShaderProgram(gl, vsSource, fsSource) {
          const vertexShader = this.loadShader(gl, gl.VERTEX_SHADER, vsSource);
          const fragmentShader = this.loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
          if (!vertexShader || !fragmentShader) return null;

          const shaderProgram = gl.createProgram();
          gl.attachShader(shaderProgram, vertexShader);
          gl.attachShader(shaderProgram, fragmentShader);
          gl.linkProgram(shaderProgram);

          if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
            return null;
          }
          return shaderProgram;
        }

        loadShader(gl, type, source) {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
          }
          return shader;
        }

        initBuffers(gl) {
          const positionBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          const positions = [-1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0]; // Triangle strip for a quad
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

          const textureCoordBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
          // Note: Y is flipped because WebGL's texture origin (0,0) is bottom-left,
          // while VideoFrame/Canvas2D origin is top-left.
          // Using (0,0), (1,0), (0,1), (1,1) for texcoords with a -1 to 1 quad
          // often works directly with texImage2D(VideoFrame) without manual flipping.
          // If frames appear upside down, flip Y: (0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0)
          const textureCoordinates = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

          return { position: positionBuffer, textureCoord: textureCoordBuffer };
        }

        initTexture(gl) {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          // Set up texture parameters: no mipmaps, clamp to edge.
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          return texture;
        }
      };
}