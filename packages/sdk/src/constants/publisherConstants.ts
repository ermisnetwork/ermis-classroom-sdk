import { ChannelName, FrameType, StreamTypes, SubStream, TransportPacketType } from '../types';

export { FrameType, ChannelName, TransportPacketType, StreamTypes };

export const CHANNEL_NAME = ChannelName;

export const CLIENT_COMMANDS = {
  INIT_STREAM: 'init_channel_stream',
  STOP_STREAM: 'stop_stream',
  START_STREAM: 'start_stream',
  PAUSE_STREAM: 'pause_stream',
  RESUME_STREAM: 'resume_stream',
  PUBLISHER_STATE: 'publisher_state',
} as const;

export type ClientCommand = (typeof CLIENT_COMMANDS)[keyof typeof CLIENT_COMMANDS];

/**
 * Helper function to get frame type based on channel name and chunk type
 */
export function getFrameType(channelName: string, chunkType: 'key' | 'delta'): number {
  switch (channelName) {
    case ChannelName.VIDEO_360P:
      return chunkType === 'key' ? FrameType.CAM_360P_KEY : FrameType.CAM_360P_DELTA;
    case ChannelName.VIDEO_720P:
      return chunkType === 'key' ? FrameType.CAM_720P_KEY : FrameType.CAM_720P_DELTA;
    case ChannelName.VIDEO_1080P:
      return chunkType === 'key' ? FrameType.CAM_1080P_KEY : FrameType.CAM_1080P_DELTA;
    case ChannelName.SCREEN_SHARE_720P:
      return chunkType === 'key' ? FrameType.SCREEN_SHARE_KEY : FrameType.SCREEN_SHARE_DELTA;
    case ChannelName.SCREEN_SHARE_1080P:
      return chunkType === 'key' ? FrameType.SCREEN_SHARE_KEY : FrameType.SCREEN_SHARE_DELTA;
    case ChannelName.LIVESTREAM_720P:
      return chunkType === 'key' ? FrameType.LIVESTREAM_KEY : FrameType.LIVESTREAM_DELTA;
    default:
      return FrameType.CAM_720P_KEY;
  }
}

/**
 * Helper function to get data channel ID from channel name
 */
export function getDataChannelId(
  channelName: string,
  type: 'camera' | 'screenShare' | 'livestream' = 'camera',
): number {
  const mapping: Record<string, Record<string, number>> = {
    camera: {
      [ChannelName.MEETING_CONTROL]: 0,
      [ChannelName.MICROPHONE]: 1,
      [ChannelName.VIDEO_360P]: 2,
      [ChannelName.VIDEO_720P]: 3,
      [ChannelName.VIDEO_1080P]: 9,
    },
    screenShare: {
      [ChannelName.SCREEN_SHARE_720P]: 5,
      [ChannelName.SCREEN_SHARE_AUDIO]: 6,
    },
    livestream: {
      [ChannelName.LIVESTREAM_720P]: 7,
      [ChannelName.LIVESTREAM_AUDIO]: 8,
    },
  };

  return mapping[type]?.[channelName] ?? 5;
}

export const SUB_STREAMS: Record<string, SubStream> = {
  MEETING_CONTROL: {
    name: 'meeting_control',
    channelName: ChannelName.MEETING_CONTROL,
  },
  MIC_AUDIO: {
    name: 'mic_audio',
    channelName: ChannelName.MICROPHONE,
  },
  VIDEO_360P: {
    name: 'video_360p',
    width: 1920,
    height: 1080,
    bitrate: 2_500_000,
    framerate: 30,
    channelName: ChannelName.VIDEO_360P,
  },
  VIDEO_720P: {
    name: 'video_720p',
    width: 1280,
    height: 720,
    bitrate: 800_000,
    framerate: 30,
    channelName: ChannelName.VIDEO_720P,
  },
  VIDEO_1080P: {
    name: 'video_1080p',
    width: 1920,
    height: 1080,
    bitrate: 2_500_000,
    framerate: 30,
    channelName: ChannelName.VIDEO_1080P,
  },
  SCREEN_SHARE_AUDIO: {
    name: 'screen_share_audio',
    channelName: ChannelName.SCREEN_SHARE_AUDIO,
  },
  SCREEN_SHARE_720P: {
    name: 'screen_share_720p',
    width: 1280,
    height: 720,
    bitrate: 1_000_000,
    framerate: 15,
    channelName: ChannelName.SCREEN_SHARE_720P,
  },
  SCREEN_SHARE_1080P: {
    name: 'screen_share_1080p',
    width: 1920,
    height: 1080,
    bitrate: 1_500_000,
    framerate: 15,
    channelName: ChannelName.SCREEN_SHARE_1080P,
  },
  LIVESTREAM_720P: {
    name: 'livestream_720p',
    width: 1280,
    height: 720,
    bitrate: 1_500_000,
    framerate: 15,
    channelName: ChannelName.LIVESTREAM_720P,
  },
  LIVESTREAM_AUDIO: {
    name: 'livestream_audio',
    channelName: ChannelName.LIVESTREAM_AUDIO,
  },
};

export function getSubStreams(
  streamType: string,
  permissions: {
    can_publish: boolean;
    can_publish_sources: [string, boolean][];
  },
  videoResolutions?: ChannelName[],
): SubStream[] {
  if (!permissions.can_publish) {
    return [];
  }

  const allowedSources = new Map(permissions.can_publish_sources);

  // Video channels that can be filtered by videoResolutions
  const videoChannels = new Set([
    ChannelName.VIDEO_360P,
    ChannelName.VIDEO_720P,
    ChannelName.VIDEO_1080P,
  ]);

  let baseSubStreams: SubStream[];

  if (streamType === StreamTypes.SCREEN_SHARE) {
    baseSubStreams = [SUB_STREAMS.SCREEN_SHARE_AUDIO, SUB_STREAMS.SCREEN_SHARE_720P];
  } else if (streamType === StreamTypes.CAMERA) {
    // Include all possible video resolutions, filter will select which ones to use
    baseSubStreams = [
      SUB_STREAMS.MEETING_CONTROL,
      SUB_STREAMS.MIC_AUDIO,
      SUB_STREAMS.VIDEO_360P,
      SUB_STREAMS.VIDEO_720P,
      SUB_STREAMS.VIDEO_1080P,
    ];
  } else {
    throw new Error(`Invalid publisher type, cannot get sub streams for type: ${streamType}`);
  }

  return baseSubStreams.filter((sub) => {
    if (sub.channelName === ChannelName.MEETING_CONTROL) {
      return true;
    }

    const key = sub.channelName;
    const allowed = allowedSources.get(key);
    if (allowed !== true) {
      return false;
    }

    // If videoResolutions filter is specified and this is a video channel, only include specified resolutions
    if (videoResolutions && videoResolutions.length > 0 && videoChannels.has(sub.channelName)) {
      return videoResolutions.includes(sub.channelName);
    }

    // Default behavior: when videoResolutions is NOT specified, exclude 1080p (only 360p + 720p)
    if (!videoResolutions && sub.channelName === ChannelName.VIDEO_1080P) {
      return false;
    }

    return true;
  });
}

export const MEETING_EVENTS = {
  // Join / Leave room
  USER_JOINED: 'join',
  USER_LEFT: 'leave',

  // Mic & Camera
  MIC_ON: 'mic_on',
  MIC_OFF: 'mic_off',
  CAMERA_ON: 'camera_on',
  CAMERA_OFF: 'camera_off',
  TOGGLE_AUDIO: 'toggle_audio',
  TOGGLE_VIDEO: 'toggle_video',

  // User interaction
  RAISE_HAND: 'raise_hand',
  LOWER_HAND: 'lower_hand',
  PIN_FOR_EVERYONE: 'pin_for_everyone',
  UNPIN_FOR_EVERYONE: 'unpin_for_everyone',

  // Screen share
  REQUEST_SHARE_SCREEN: 'request_share_screen',
  START_SCREEN_SHARE: 'start_share_screen',
  STOP_SCREEN_SHARE: 'stop_share_screen',

  // Livestream
  START_LIVESTREAM: 'start_livestream',
  STOP_LIVESTREAM: 'stop_livestream',

  // Recording
  START_RECORD: 'start_record',
  STOP_RECORD: 'stop_record',

  // Breakout room
  BREAKOUT_ROOM: 'break_out_room',
  CLOSE_BREAKOUT_ROOM: 'close_breakout_room',
  JOIN_SUB_ROOM: 'join_sub_room',
  LEAVE_SUB_ROOM: 'leave_sub_room',

  // Room control
  SYSTEM_MESSAGE: 'system_message',
  MEETING_ENDED: 'meeting_ended',
} as const;

export type MeetingEvent = (typeof MEETING_EVENTS)[keyof typeof MEETING_EVENTS];
