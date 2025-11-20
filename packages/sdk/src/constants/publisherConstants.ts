/**
 * Publisher/Subscriber Constants
 * 
 * Re-exports types and provides helper functions
 */

import type { SubStream } from "../types/media/publisher.types";
import {
    FrameType,
    ChannelName,
    TransportPacketType,
    StreamTypes,
} from "../types/media/publisher.types";

// Re-export for convenience
export { FrameType, ChannelName, TransportPacketType, StreamTypes };

// Legacy const-style export for backward compatibility
export const CHANNEL_NAME = ChannelName;

export const CLIENT_COMMANDS = {
    INIT_STREAM: "init_channel_stream",
    STOP_STREAM: "stop_stream",
    START_STREAM: "start_stream",
    PAUSE_STREAM: "pause_stream",
    RESUME_STREAM: "resume_stream",
    PUBLISHER_STATE: "publisher_state",
} as const;

export type ClientCommand = (typeof CLIENT_COMMANDS)[keyof typeof CLIENT_COMMANDS];

/**
 * Helper function to get frame type based on channel name and chunk type
 */
export function getFrameType(channelName: string, chunkType: "key" | "delta"): number {
    switch (channelName) {
        case ChannelName.VIDEO_360P:
            return chunkType === "key" ? FrameType.CAM_360P_KEY : FrameType.CAM_360P_DELTA;
        case ChannelName.VIDEO_720P:
            return chunkType === "key" ? FrameType.CAM_720P_KEY : FrameType.CAM_720P_DELTA;
        case ChannelName.SCREEN_SHARE_720P:
            return chunkType === "key" ? FrameType.SCREEN_SHARE_KEY : FrameType.SCREEN_SHARE_DELTA;
        case ChannelName.SCREEN_SHARE_1080P:
            return chunkType === "key" ? FrameType.SCREEN_SHARE_KEY : FrameType.SCREEN_SHARE_DELTA;
        default:
            return FrameType.CAM_720P_KEY;
    }
}

/**
 * Helper function to get transport packet type from frame type
 */
// export function getTransportPacketType(frameType: number): number {
//     switch (frameType) {
//         case FrameType.PUBLISHER_COMMAND:
//         case FrameType.EVENT:
//         case FrameType.CONFIG:
//             return TransportPacketType.PUBLISHER_COMMAND; // PUBLISHER_COMMAND
//         case FrameType.AUDIO:
//             return TransportPacketType.AUDIO;
//         default:
//             return TransportPacketType.VIDEO;
//     }
// }

/**
 * Helper function to get data channel ID from channel name
 */
export function getDataChannelId(channelName: string, type: "camera" | "screenShare" = "camera"): number {
    const mapping: Record<string, Record<string, number>> = {
        camera: {
            [ChannelName.MEETING_CONTROL]: 0,
            [ChannelName.MICROPHONE]: 1,
            [ChannelName.VIDEO_360P]: 2,
            [ChannelName.VIDEO_720P]: 3,
        },
        screenShare: {
            [ChannelName.SCREEN_SHARE_720P]: 5,
            [ChannelName.SCREEN_SHARE_AUDIO]: 6,
        },
    };

    return mapping[type]?.[channelName] ?? 5;
}

export const SUB_STREAMS: Record<string, SubStream> = {
    MEETING_CONTROL: {
        name: "meeting_control",
        channelName: ChannelName.MEETING_CONTROL,
    },
    MIC_AUDIO: {
        name: "mic_audio",
        channelName: ChannelName.MICROPHONE,
    },
    VIDEO_360P: {
        name: "video_360p",
        width: 640,
        height: 360,
        bitrate: 400_000,
        framerate: 30,
        channelName: ChannelName.VIDEO_360P,
    },
    VIDEO_720P: {
        name: "video_720p",
        width: 1280,
        height: 720,
        bitrate: 800_000,
        framerate: 30,
        channelName: ChannelName.VIDEO_720P,
    },
    SCREEN_SHARE_AUDIO: {
        name: "screen_share_audio",
        channelName: ChannelName.SCREEN_SHARE_AUDIO,
    },
    SCREEN_SHARE_720P: {
        name: "screen_share_720p",
        width: 1280,
        height: 720,
        bitrate: 1_000_000,
        framerate: 15,
        channelName: ChannelName.SCREEN_SHARE_720P,
    },
    SCREEN_SHARE_1080P: {
        name: "screen_share_1080p",
        width: 1920,
        height: 1080,
        bitrate: 1_500_000,
        framerate: 15,
        channelName: ChannelName.SCREEN_SHARE_1080P,
    },
};

export function getSubStreams(streamType: string): SubStream[] {
    console.log("Getting sub streams for type:", streamType);
    if (streamType === StreamTypes.SCREEN_SHARE) {
        return [SUB_STREAMS.SCREEN_SHARE_AUDIO, SUB_STREAMS.SCREEN_SHARE_720P];
    } else if (streamType === StreamTypes.CAMERA) {
        return [
            SUB_STREAMS.MEETING_CONTROL,
            SUB_STREAMS.MIC_AUDIO,
            SUB_STREAMS.VIDEO_360P,
            SUB_STREAMS.VIDEO_720P,
        ];
    } else {
        throw new Error(`Invalid publisher type, cannot get sub streams for type: ${streamType}`);
    }
}

export const MEETING_EVENTS = {
    // Join / Leave room
    USER_JOINED: "join",
    USER_LEFT: "leave",

    // Mic & Camera
    MIC_ON: "mic_on",
    MIC_OFF: "mic_off",
    CAMERA_ON: "camera_on",
    CAMERA_OFF: "camera_off",
    TOGGLE_AUDIO: "toggle_audio",
    TOGGLE_VIDEO: "toggle_video",

    // User interaction
    RAISE_HAND: "raise_hand",
    LOWER_HAND: "lower_hand",
    PIN_FOR_EVERYONE: "pin_for_everyone",
    UNPIN_FOR_EVERYONE: "unpin_for_everyone",

    // Screen share
    REQUEST_SHARE_SCREEN: "request_share_screen",
    START_SCREEN_SHARE: "start_share_screen",
    STOP_SCREEN_SHARE: "stop_share_screen",

    // Breakout room
    BREAKOUT_ROOM: "break_out_room",
    CLOSE_BREAKOUT_ROOM: "close_breakout_room",
    JOIN_SUB_ROOM: "join_sub_room",
    LEAVE_SUB_ROOM: "leave_sub_room",

    // Room control
    SYSTEM_MESSAGE: "system_message",
    MEETING_ENDED: "meeting_ended",
} as const;

export type MeetingEvent = (typeof MEETING_EVENTS)[keyof typeof MEETING_EVENTS];
