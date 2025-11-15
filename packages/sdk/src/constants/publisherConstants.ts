/**
 * Publisher/Subscriber Constants
 */

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
 * Transport packet type constants
 */
export const TRANSPORT_PACKET_TYPE = {
    VIDEO: 0x00,
    AUDIO: 0x01,
    CONFIG: 0xfd,
    EVENT: 0xfe,
    PUBLISHER_COMMAND: 0xff,
} as const;

/**
 * Frame type constants
 */
export const FRAME_TYPE = {
    CAM_360P_KEY: 0,
    CAM_360P_DELTA: 1,
    CAM_720P_KEY: 2,
    CAM_720P_DELTA: 3,
    MIC_AUDIO: 6,
    SS_720P_KEY: 4,
    SS_720P_DELTA: 5,
    SS_1080P_KEY: 7,
    SS_1080P_DELTA: 8,
    SS_AUDIO: 9,
    CONFIG: 0xfd,
    EVENT: 0xfe,
    PING: 0xff,
} as const;

/**
 * Channel name constants
 */
export const CHANNEL_NAME = {
    MEETING_CONTROL: "meeting_control",
    MIC_AUDIO: "mic_48k",
    VIDEO_360P: "video_360p",
    VIDEO_720P: "video_720p",
    SCREEN_SHARE_720P: "screen_share_720p",
    SCREEN_SHARE_1080P: "screen_share_1080p",
    SCREEN_SHARE_AUDIO: "screen_share_audio",
} as const;

export type ChannelName = (typeof CHANNEL_NAME)[keyof typeof CHANNEL_NAME];

/**
 * Helper function to get frame type based on channel name and chunk type
 */
export function getFrameType(channelName: string, chunkType: "key" | "delta"): number {
    switch (channelName) {
        case CHANNEL_NAME.VIDEO_360P:
            return chunkType === "key" ? FRAME_TYPE.CAM_360P_KEY : FRAME_TYPE.CAM_360P_DELTA;
        case CHANNEL_NAME.VIDEO_720P:
            return chunkType === "key" ? FRAME_TYPE.CAM_720P_KEY : FRAME_TYPE.CAM_720P_DELTA;
        case CHANNEL_NAME.SCREEN_SHARE_720P:
            return chunkType === "key" ? FRAME_TYPE.SS_720P_KEY : FRAME_TYPE.SS_720P_DELTA;
        case CHANNEL_NAME.SCREEN_SHARE_1080P:
            return chunkType === "key" ? FRAME_TYPE.SS_1080P_KEY : FRAME_TYPE.SS_1080P_DELTA;
        default:
            return FRAME_TYPE.CAM_720P_KEY;
    }
}

/**
 * Helper function to get transport packet type from frame type
 */
export function getTransportPacketType(frameType: number): number {
    switch (frameType) {
        case FRAME_TYPE.PING:
        case FRAME_TYPE.EVENT:
        case FRAME_TYPE.CONFIG:
            return TRANSPORT_PACKET_TYPE.PUBLISHER_COMMAND;
        case FRAME_TYPE.MIC_AUDIO:
        case FRAME_TYPE.SS_AUDIO:
            return TRANSPORT_PACKET_TYPE.AUDIO;
        default:
            return TRANSPORT_PACKET_TYPE.VIDEO;
    }
}

/**
 * Helper function to get data channel ID from channel name
 */
export function getDataChannelId(channelName: string, type: "camera" | "screenShare" = "camera"): number {
    const mapping: Record<string, Record<string, number>> = {
        camera: {
            [CHANNEL_NAME.MEETING_CONTROL]: 0,
            [CHANNEL_NAME.MIC_AUDIO]: 1,
            [CHANNEL_NAME.VIDEO_360P]: 2,
            [CHANNEL_NAME.VIDEO_720P]: 3,
        },
        screenShare: {
            [CHANNEL_NAME.SCREEN_SHARE_720P]: 5,
            [CHANNEL_NAME.SCREEN_SHARE_AUDIO]: 6,
        },
    };

    return mapping[type]?.[channelName] ?? 5;
}

export interface SubStream {
    name: string;
    channelName: string;
    width?: number;
    height?: number;
    bitrate?: number;
    framerate?: number;
}

export const SUB_STREAMS: Record<string, SubStream> = {
    MEETING_CONTROL: {
        name: "meeting_control",
        channelName: CHANNEL_NAME.MEETING_CONTROL,
    },
    MIC_AUDIO: {
        name: "mic_audio",
        channelName: CHANNEL_NAME.MIC_AUDIO,
    },
    VIDEO_360P: {
        name: "video_360p",
        width: 640,
        height: 360,
        bitrate: 400_000,
        framerate: 30,
        channelName: CHANNEL_NAME.VIDEO_360P,
    },
    VIDEO_720P: {
        name: "video_720p",
        width: 1280,
        height: 720,
        bitrate: 800_000,
        framerate: 30,
        channelName: CHANNEL_NAME.VIDEO_720P,
    },
    SCREEN_SHARE_AUDIO: {
        name: "screen_share_audio",
        channelName: CHANNEL_NAME.SCREEN_SHARE_AUDIO,
    },
    SCREEN_SHARE_720P: {
        name: "screen_share_720p",
        width: 1280,
        height: 720,
        bitrate: 1_000_000,
        framerate: 15,
        channelName: CHANNEL_NAME.SCREEN_SHARE_720P,
    },
    SCREEN_SHARE_1080P: {
        name: "screen_share_1080p",
        width: 1920,
        height: 1080,
        bitrate: 1_500_000,
        framerate: 15,
        channelName: CHANNEL_NAME.SCREEN_SHARE_1080P,
    },
};

export function getSubStreams(streamType: string): SubStream[] {
    console.log("Getting sub streams for type:", streamType);
    if (streamType === "screen_share") {
        return [SUB_STREAMS.SCREEN_SHARE_AUDIO, SUB_STREAMS.SCREEN_SHARE_720P];
    } else if (streamType === "camera") {
        return [
            SUB_STREAMS.MIC_AUDIO,
            SUB_STREAMS.VIDEO_360P,
            SUB_STREAMS.VIDEO_720P,
            SUB_STREAMS.MEETING_CONTROL,
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
