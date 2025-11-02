const SUBSCRIBE_TYPE = {
  CAMERA: "camera",
  SCREEN: "screen",
};

const CLIENT_COMMANDS = {
  INIT_STREAM: "init_channel_stream",
  STOP_STREAM: "stop_stream",
  START_STREAM: "start_stream",
  PAUSE_STREAM: "pause_stream",
  RESUME_STREAM: "resume_stream",
  PUBLISHER_STATE: "publisher_state",
};

/**
 * Frame type constants
 */
const FRAME_TYPE = {
  CAM_360P_KEY: 0,
  CAM_360P_DELTA: 1,
  CAM_720P_KEY: 2,
  CAM_720P_DELTA: 3,
  CAM_1080P_KEY: 4,
  CAM_1080P_DELTA: 5,
  AUDIO: 6,
  CONFIG: 0xfd,
  EVENT: 0xfe,
  PING: 0xff,
};

/**
 * Transport packet type constants
 */
const TRANSPORT_PACKET_TYPE = {
  VIDEO: 0x00,
  AUDIO: 0x01,
  CONFIG: 0xfd,
  EVENT: 0xfe,
  PUBLISHER_COMMAND: 0xff,
};

/**
 * Helper function to get frame type based on channel name and chunk type
 */
function getFrameType(channelName, chunkType) {
  switch (channelName) {
    case CHANNEL_NAME.VIDEO_360P:
      return chunkType === "key" ? FRAME_TYPE.CAM_360P_KEY : FRAME_TYPE.CAM_360P_DELTA;
    case CHANNEL_NAME.VIDEO_720P:
      return chunkType === "key" ? FRAME_TYPE.CAM_720P_KEY : FRAME_TYPE.CAM_720P_DELTA;
    case CHANNEL_NAME.VIDEO_1080P:
      return chunkType === "key" ? FRAME_TYPE.CAM_1080P_KEY : FRAME_TYPE.CAM_1080P_DELTA;
    default:
      return FRAME_TYPE.CAM_720P_KEY;
  }
}

/**
 * Helper function to get transport packet type from frame type
 */
function getTransportPacketType(frameType) {
  switch (frameType) {
    case FRAME_TYPE.PING:
    case FRAME_TYPE.EVENT:
    case FRAME_TYPE.CONFIG:
      return TRANSPORT_PACKET_TYPE.PUBLISHER_COMMAND;
    case FRAME_TYPE.AUDIO:
      return TRANSPORT_PACKET_TYPE.AUDIO;
    default:
      return TRANSPORT_PACKET_TYPE.VIDEO;
  }
}

/**
 * Channel name constants
 */
const CHANNEL_NAME = {
  MEETING_CONTROL: "meeting_control",
  AUDIO: "mic_48k",
  VIDEO_360P: "video_360p",
  VIDEO_720P: "video_720p",
  VIDEO_1080P: "video_1080p",
};

/**
 * Helper function to get data channel ID from channel name
 */
function getDataChannelId(channelName, type = "camera") {
  const mapping = {
    camera: {
      [CHANNEL_NAME.MEETING_CONTROL]: 0,
      [CHANNEL_NAME.AUDIO]: 1,
      [CHANNEL_NAME.VIDEO_360P]: 2,
      [CHANNEL_NAME.VIDEO_720P]: 3,
      [CHANNEL_NAME.VIDEO_1080P]: 4,
    },
    screenShare: {
      [CHANNEL_NAME.AUDIO]: 0,
      [CHANNEL_NAME.VIDEO_720P]: 1,
      [CHANNEL_NAME.VIDEO_1080P]: 2,
    },
  };

  return mapping[type]?.[channelName] ?? 5;
}

const PUBLISH_TYPE = {
  CAMERA: "publish_camera",
  SCREEN: "publish_screen",
};

[
  {
    name: "meeting_control",
    channelName: CHANNEL_NAME.MEETING_CONTROL,
  },
  {
    name: "audio",
    channelName: CHANNEL_NAME.AUDIO,
  },
  {
    name: "video_360p",
    width: 640,
    height: 360,
    bitrate: 400_000,
    framerate: 30,
    channelName: CHANNEL_NAME.VIDEO_360P,
  },
  {
    name: "video_720p",
    width: 1280,
    height: 720,
    bitrate: 800_000,
    framerate: 30,
    channelName: CHANNEL_NAME.VIDEO_720P,
  },
];

const SUB_STREAMS = {
  MEETING_CONTROL: {
    name: "meeting_control",
    channelName: CHANNEL_NAME.MEETING_CONTROL,
  },
  AUDIO: {
    name: "audio",
    channelName: CHANNEL_NAME.AUDIO,
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
  VIDEO_1080P: {
    name: "video_1080p",
    width: 1920,
    height: 1080,
    bitrate: 1_500_000,
    framerate: 30,
    channelName: CHANNEL_NAME.VIDEO_1080P,
  },
};

export {
  SUBSCRIBE_TYPE,
  CLIENT_COMMANDS,
  FRAME_TYPE,
  getFrameType,
  getTransportPacketType,
  CHANNEL_NAME,
  getDataChannelId,
  PUBLISH_TYPE,
  SUB_STREAMS,
};
