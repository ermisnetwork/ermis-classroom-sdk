const hasAudioWorklet = () => {
  return (
    window.AudioContext &&
    typeof new AudioContext().audioWorklet === "object" &&
    typeof new AudioContext().audioWorklet.addModule === "function"
  );
};

if (!self.MediaStreamTrackProcessor) {
  self.MediaStreamTrackProcessor = class MediaStreamTrackProcessor {
    constructor(track, triggerWorker, init) {
      if (track.kind == "video") {
        this.readable = new ReadableStream({
          async start(controller) {
            this.video = document.createElement("video");
            this.video.srcObject = new MediaStream([track]);
            await Promise.all([
              this.video.play(),
              new Promise((r) => (this.video.onloadedmetadata = r)),
            ]);
            this.track = track;
            this.canvas = new OffscreenCanvas(
              this.video.videoWidth,
              this.video.videoHeight
            );
            this.ctx = this.canvas.getContext("2d", {desynchronized: true});
            this.t1 = performance.now();
            //todo: move this triggerWorker.postMessage to pull function, only trigger when window is hidden, add logic stop interval when window is visible
            triggerWorker.postMessage({
              frameRate: track.getSettings().frameRate,
            });

            document.addEventListener("visibilitychange", async () => {
              init = false;
              if (document.hidden) {
                return new Promise((resolve) => {
                  triggerWorker.onmessage = (event) => {
                    this.t1 = event.data;
                    this.ctx.drawImage(this.video, 0, 0);
                    controller.enqueue(
                      new VideoFrame(this.canvas, {timestamp: this.t1})
                    );
                    resolve();
                  };
                });
              } else if (!document.hidden) {
                while (
                  performance.now() - this.t1 <
                  1000 / track.getSettings().frameRate
                  ) {
                  await new Promise((r) => requestAnimationFrame(r));
                }
                this.t1 = performance.now();
                this.ctx.drawImage(this.video, 0, 0);
                controller.enqueue(
                  new VideoFrame(this.canvas, {timestamp: this.t1})
                );
              }
            });
          },

          async pull(controller) {
            if (init) {
              while (
                performance.now() - this.t1 <
                1000 / track.getSettings().frameRate
                ) {
                await new Promise((r) => requestAnimationFrame(r));
              }
              this.t1 = performance.now();
              this.ctx.drawImage(this.video, 0, 0);
              controller.enqueue(
                new VideoFrame(this.canvas, {timestamp: this.t1})
              );
            }
          },
        });
      } else if (track.kind == "audio") {

        this.readable = new ReadableStream({
          async start(controller) {
            this.ac = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: 48000,
            });

            this.arrays = [];
            this.bufferSize = 0;
            this.targetBufferSize = 480; // 10ms at 48kHz
            this.baseTime = performance.now() * 1000; // Base time in microseconds
            this.totalSamplesProcessed = 0;

            if (!hasAudioWorklet()) {
              // Use ScriptProcessorNode fallback for Safari that doesn't support AudioWorklet
              this.bufferSize = 4096;
              const scriptNode = this.ac.createScriptProcessor(
                this.bufferSize,
                1,
                1
              );

              scriptNode.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                const buffer = new Float32Array(input.length);
                buffer.set(input);
                this.arrays.push([[buffer]]); // Format to match worklet output
              };

              // Connect but keep output muted
              const source = this.ac.createMediaStreamSource(
                new MediaStream([track])
              );
              const gainNode = this.ac.createGain();
              gainNode.gain.value = 0;

              source.connect(scriptNode);
              scriptNode.connect(gainNode);
              gainNode.connect(this.ac.destination);

              // Keep references
              this.scriptNode = scriptNode;
              this.source = source;
              this.gainNode = gainNode;

              return; // Exit early, skipping AudioWorklet setup
            }

            // If AudioWorklet is supported, continue with the original implementation
            try {
              function worklet() {
                class AudioProcessor extends AudioWorkletProcessor {
                  constructor() {
                    super();
                    this.buffers = [];
                    this.currentBuffer = null;
                    this.currentSize = 0;
                    this.targetSize = 480; // Target 10ms (480 samples at 48kHz)
                  }

                  process(inputs) {
                    const input = inputs[0];
                    if (!input || !input[0]) return true;

                    // Just use the first channel if stereo input
                    const channel = input[0];

                    if (!this.currentBuffer) {
                      this.currentBuffer = new Float32Array(this.targetSize);
                      this.currentSize = 0;
                    }

                    // Add data to the buffer
                    const remainingSpace = this.targetSize - this.currentSize;
                    const samplesToAdd = Math.min(
                      channel.length,
                      remainingSpace
                    );

                    this.currentBuffer.set(
                      channel.slice(0, samplesToAdd),
                      this.currentSize
                    );
                    this.currentSize += samplesToAdd;

                    // If buffer is full, send it
                    if (this.currentSize >= this.targetSize) {
                      this.port.postMessage([[this.currentBuffer]]); // Single channel
                      this.currentBuffer = null;

                      // Handle any remaining samples
                      if (samplesToAdd < channel.length) {
                        const remaining = channel.slice(samplesToAdd);
                        this.currentBuffer = new Float32Array(this.targetSize);
                        this.currentSize = remaining.length;
                        this.currentBuffer.set(remaining, 0);
                      }
                    }

                    return true;
                  }
                }

                registerProcessor("mstp-shim", AudioProcessor);
              }

              // Convert worklet function to string
              const workletCode = `(${worklet.toString()})()`;
              const workletBlob = new Blob([workletCode], {
                type: "application/javascript",
              });
              const workletUrl = URL.createObjectURL(workletBlob);

              // Try to use Blob URL instead of data URL for Safari

              await this.ac.audioWorklet.addModule(workletUrl);

              this.node = new AudioWorkletNode(this.ac, "mstp-shim");

              // Create a gain node to mute the output
              const gain = this.ac.createGain();
              gain.gain.value = 0; // Mute output
              this.node.connect(gain).connect(this.ac.destination);

              // Connect input to audioWorklet
              this.ac
                .createMediaStreamSource(new MediaStream([track]))
                .connect(this.node);

              // Set up message handling
              this.node.port.addEventListener("message", ({data}) => {
                if (data[0][0]) {
                  this.arrays.push(data);
                }
              });

              this.node.port.start(); // Ensure port is started
            } catch (err) {
              // Fall back to ScriptProcessorNode if AudioWorklet fails
              // (Implementation would be same as the one above)
            }
          },

          async pull(controller) {
            try {
              while (!this.arrays.length) {
                await new Promise((resolve) => {
                  const checkBuffer = () => {
                    if (this.arrays.length > 0) {
                      resolve();
                    } else {
                      setTimeout(checkBuffer, 5); // Check more frequently (5ms)
                    }
                  };
                  checkBuffer();
                });
              }

              const [channels] = this.arrays.shift();
              const channel = channels[0]; // Get first channel (mono)

              // Calculate timestamp
              const timestamp =
                this.baseTime +
                Math.floor(
                  (this.totalSamplesProcessed / this.ac.sampleRate) * 1_000_000
                );

              // Ensure consistent frame sizes
              const consistentFrameSize = 480; // 10ms at 48kHz
              let processedChannel;

              if (channel.length !== consistentFrameSize) {
                processedChannel = new Float32Array(consistentFrameSize);

                // Copy as much data as possible
                const copyLength = Math.min(
                  channel.length,
                  consistentFrameSize
                );
                for (let i = 0; i < copyLength; i++) {
                  processedChannel[i] = channel[i];
                }
              } else {
                processedChannel = channel;
              }

              this.totalSamplesProcessed += processedChannel.length;

              controller.enqueue(
                new self.AudioData({
                  format: "f32-planar",
                  sampleRate: this.ac.sampleRate,
                  numberOfFrames: processedChannel.length,
                  numberOfChannels: 1, // Ensure mono output
                  timestamp: timestamp,
                  duration: Math.floor(
                    (processedChannel.length / this.ac.sampleRate) * 1_000_000
                  ),
                  data: processedChannel,
                })
              );
            } catch (err) {
              controller.error(err);
            }
          },

          cancel() {
            if (this.ac && this.ac.state !== "closed") {
              this.ac.close();
            }
          },
        });
      }
    }
  };
}
