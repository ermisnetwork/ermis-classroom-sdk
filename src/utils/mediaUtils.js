/**
 * Media Utilities for handling camera and microphone
 */

/**
 * Get user media with fallback support
 * @param {Object} options - Media options
 * @param {boolean} options.audio - Enable audio
 * @param {boolean} options.video - Enable video
 * @param {number} options.width - Video width
 * @param {number} options.height - Video height
 * @param {number} options.frameRate - Video frame rate
 * @returns {Promise<MediaStream|null>} Media stream or null if failed
 */
export async function getUserMedia(options = {}) {
    const {
        audio = true,
        video = true,
        width = 1280,
        height = 720,
        frameRate = 30,
    } = options;

    const constraints = {};

    if (audio) {
        constraints.audio = {
            sampleRate: 48000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };
    }

    if (video) {
        constraints.video = {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: frameRate },
        };
    }

    // Check if at least one media type is requested
    if (!audio && !video) {
        console.warn("[MediaUtils] Neither audio nor video requested");
        return null;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("[MediaUtils] Media stream obtained:", {
            hasVideo: stream.getVideoTracks().length > 0,
            hasAudio: stream.getAudioTracks().length > 0,
        });
        return stream;
    } catch (error) {
        console.error("[MediaUtils] Error accessing media devices:", error);

        // Try fallback: request devices individually
        if (audio && video) {
            console.log("[MediaUtils] Trying fallback...");

            // Try video only
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    video: constraints.video,
                });
                console.warn("[MediaUtils] Fallback: Got video only, no audio available");
                return videoStream;
            } catch (videoError) {
                console.error("[MediaUtils] Video fallback failed:", videoError);

                // Try audio only
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({
                        audio: constraints.audio,
                    });
                    console.warn("[MediaUtils] Fallback: Got audio only, no video available");
                    return audioStream;
                } catch (audioError) {
                    console.error("[MediaUtils] Audio fallback failed:", audioError);
                    console.error("[MediaUtils] No media devices available");
                    return null;
                }
            }
        } else {
            // Single device requested but failed
            console.error(`[MediaUtils] Failed to access ${video ? "camera" : "microphone"}`);
            return null;
        }
    }
}

/**
 * Check available media devices
 * @returns {Promise<Object>} Object with hasCamera and hasMicrophone booleans
 */
export async function checkMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some((device) => device.kind === "videoinput");
        const hasMicrophone = devices.some((device) => device.kind === "audioinput");

        console.log("[MediaUtils] Available devices:", {
            hasCamera,
            hasMicrophone,
        });

        return { hasCamera, hasMicrophone };
    } catch (error) {
        console.error("[MediaUtils] Error enumerating devices:", error);
        return { hasCamera: false, hasMicrophone: false };
    }
}

/**
 * Request permissions for camera and microphone
 * @returns {Promise<Object>} Object with granted permissions
 */
export async function requestMediaPermissions() {
    try {
        // Request both permissions
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
        });

        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;

        // Stop all tracks after checking permissions
        stream.getTracks().forEach((track) => track.stop());

        console.log("[MediaUtils] Permissions granted:", {
            camera: hasVideo,
            microphone: hasAudio,
        });

        return {
            camera: hasVideo,
            microphone: hasAudio,
        };
    } catch (error) {
        console.error("[MediaUtils] Permission request failed:", error);
        return {
            camera: false,
            microphone: false,
        };
    }
}

/**
 * Stop all tracks in a media stream
 * @param {MediaStream} stream - Media stream to stop
 */
export function stopMediaStream(stream) {
    if (stream) {
        stream.getTracks().forEach((track) => {
            track.stop();
            console.log(`[MediaUtils] Stopped ${track.kind} track`);
        });
    }
}

/**
 * Get stream info
 * @param {MediaStream} stream - Media stream
 * @returns {Object} Stream information
 */
export function getStreamInfo(stream) {
    if (!stream) {
        return {
            hasVideo: false,
            hasAudio: false,
            videoTrackCount: 0,
            audioTrackCount: 0,
        };
    }

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    return {
        hasVideo: videoTracks.length > 0,
        hasAudio: audioTracks.length > 0,
        videoTrackCount: videoTracks.length,
        audioTrackCount: audioTracks.length,
        videoTrack: videoTracks[0],
        audioTrack: audioTracks[0],
    };
}
