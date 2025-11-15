/**
 * Stream type constants
 */
export const STREAM_TYPE = {
    CAMERA: "camera",
    SCREEN_SHARE: "screen_share",
} as const;

export type StreamType = (typeof STREAM_TYPE)[keyof typeof STREAM_TYPE];
