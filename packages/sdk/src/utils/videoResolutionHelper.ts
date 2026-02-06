import { log } from './index';

/**
 * Calculate proportional substream resolutions based on actual camera dimensions
 * Maintains aspect ratio while targeting 360p and 720p quality levels
 * 
 * @param actualWidth - Actual video track width
 * @param actualHeight - Actual video track height
 * @returns Object with calculated 360p and 720p dimensions
 */
export function calculateSubStreamResolutions(
    actualWidth: number,
    actualHeight: number
): {
    video360p: { width: number; height: number };
    video720p: { width: number; height: number };
    video1080p: { width: number; height: number };
    video1440p: { width: number; height: number };
} {
    // Calculate aspect ratio
    const aspectRatio = actualWidth / actualHeight;

    // Determine if landscape (width > height) or portrait (height > width)
    const isLandscape = aspectRatio > 1;

    let video360p: { width: number; height: number };
    let video720p: { width: number; height: number };
    let video1080p: { width: number; height: number };
    let video1440p: { width: number; height: number };

    if (isLandscape) {
        // Landscape mode: target shorter side to 360/720
        // 360p: shorter side = 360
        video360p = {
            width: Math.round(360 * aspectRatio),
            height: 360
        };

        // 720p: shorter side = 720
        video720p = {
            width: Math.round(720 * aspectRatio),
            height: 720
        };

        // 1080p: shorter side = 1080
        video1080p = {
            width: Math.round(1080 * aspectRatio),
            height: 1080
        };

        // 1440p: shorter side = 1440
        video1440p = {
            width: Math.round(1440 * aspectRatio),
            height: 1440
        };
    } else {
        // Portrait mode: target shorter side to 360/720
        // 360p: shorter side = 360
        video360p = {
            width: 360,
            height: Math.round(360 / aspectRatio)
        };

        // 720p: shorter side = 720
        video720p = {
            width: 720,
            height: Math.round(720 / aspectRatio)
        };

        // 1080p: shorter side = 1080
        video1080p = {
            width: 1080,
            height: Math.round(1080 / aspectRatio)
        };

        // 1440p: shorter side = 1440
        video1440p = {
            width: 1440,
            height: Math.round(1440 / aspectRatio)
        };
    }

    // Ensure dimensions are even numbers (required for most video encoders)
    video360p.width = Math.round(video360p.width / 2) * 2;
    video360p.height = Math.round(video360p.height / 2) * 2;
    video720p.width = Math.round(video720p.width / 2) * 2;
    video720p.height = Math.round(video720p.height / 2) * 2;
    video1080p.width = Math.round(video1080p.width / 2) * 2;
    video1080p.height = Math.round(video1080p.height / 2) * 2;
    video1440p.width = Math.round(video1440p.width / 2) * 2;
    video1440p.height = Math.round(video1440p.height / 2) * 2;

    log('[VideoResolutionHelper] Calculated resolutions:', {
        actual: `${actualWidth}x${actualHeight}`,
        aspectRatio: aspectRatio.toFixed(3),
        isLandscape,
        video360p: `${video360p.width}x${video360p.height}`,
        video720p: `${video720p.width}x${video720p.height}`,
        video1080p: `${video1080p.width}x${video1080p.height}`,
        video1440p: `${video1440p.width}x${video1440p.height}`,
    });

    return { video360p, video720p, video1080p, video1440p };
}

/**
 * Get video track dimensions from MediaStreamTrack
 * 
 * @param videoTrack - MediaStreamTrack to extract dimensions from
 * @returns Object with width and height, or null if not available
 */
export function getVideoTrackDimensions(
    videoTrack: MediaStreamTrack
): { width: number; height: number } | null {
    try {
        const settings = videoTrack.getSettings();

        if (settings.width && settings.height) {
            return {
                width: settings.width,
                height: settings.height
            };
        }

        log('[VideoResolutionHelper] Video track settings missing width/height:', settings);
        return null;
    } catch (error) {
        console.error('[VideoResolutionHelper] Error getting video track settings:', error);
        return null;
    }
}
