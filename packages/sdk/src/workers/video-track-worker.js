/**
 * Video Track Worker
 *
 * Dedicated Worker that creates a VideoTrackGenerator (W3C standard API).
 * VTG is only available in DedicatedWorkerGlobalScope (not main thread).
 *
 * Protocol:
 * ─────────
 * Main → Worker:
 *   { type: "init" }
 *     → Worker creates VTG, transfers track back
 *
 *   { type: "frame", frame: VideoFrame }
 *     → Worker writes frame to VTG writable
 *
 *   { type: "mute", muted: boolean }
 *     → Worker sets VTG.muted
 *
 *   { type: "close" }
 *     → Worker closes writable and cleans up
 *
 * Worker → Main:
 *   { type: "ready", track: MediaStreamTrack }
 *     → Track transferred to main thread
 *
 *   { type: "error", message: string }
 */

/** @type {VideoTrackGenerator|null} */
let vtg = null;

/** @type {WritableStreamDefaultWriter<VideoFrame>|null} */
let writer = null;

let isWriting = false;

self.onmessage = async function (e) {
  const { type } = e.data;

  switch (type) {
    case "init":
      try {
        vtg = new VideoTrackGenerator();
        writer = vtg.writable.getWriter();

        // Transfer the track back to main thread
        const track = vtg.track;
        self.postMessage({ type: "ready", track }, [track]);
      } catch (err) {
        self.postMessage({
          type: "error",
          message: `VideoTrackGenerator init failed: ${err.message || err}`,
        });
      }
      break;

    case "frame":
      if (!writer) {
        e.data.frame?.close();
        return;
      }
      const frame = e.data.frame;
      if (!frame) return;

      // Backpressure: skip frame if previous write hasn't completed
      if (isWriting) {
        frame.close();
        return;
      }

      isWriting = true;
      writer
        .write(frame)
        .then(() => {
          isWriting = false;
        })
        .catch(() => {
          isWriting = false;
        });
      break;

    case "mute":
      if (vtg) {
        vtg.muted = !!e.data.muted;
      }
      break;

    case "close":
      if (writer) {
        try {
          writer.close();
        } catch {
          /* ignore */
        }
        writer = null;
      }
      vtg = null;
      break;
  }
};
