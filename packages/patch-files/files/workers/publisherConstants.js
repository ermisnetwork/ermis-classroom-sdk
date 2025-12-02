/**
 * Publisher/Subscriber Constants for Web Workers
 * 
 * This file is used by workers running in Web Worker context.
 * Keep it as plain JS without external dependencies.
 */

// Stream type constants (matches StreamTypes in publisher.types.ts)
const STREAM_TYPE = {
  CAMERA: "camera",
  SCREEN_SHARE: "screen_share",
};

// Alias for subscriber context (same as STREAM_TYPE)
const SUBSCRIBE_TYPE = {
  CAMERA: "camera",
  SCREEN: "screen_share",
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
 * Frame type constants
 */
const FRAME_TYPE = {
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
  MIC_AUDIO: "mic_48k",
  VIDEO_360P: "video_360p",
  VIDEO_720P: "video_720p",
  SCREEN_SHARE_720P: "screen_share_720p",
  SCREEN_SHARE_1080P: "screen_share_1080p",
  SCREEN_SHARE_AUDIO: "screen_share_audio",
};

/**
 * Helper function to get data channel ID from channel name
 */
function getDataChannelId(channelName, type = "camera") {
  const mapping = {
    camera: {
      [CHANNEL_NAME.MEETING_CONTROL]: 0,
      [CHANNEL_NAME.MIC_AUDIO]: 1,
      [CHANNEL_NAME.VIDEO_360P]: 2,
      [CHANNEL_NAME.VIDEO_720P]: 3,
    },
    screenShare: {
      [CHANNEL_NAME.SCREEN_SHARE_720P]: 5,
      [CHANNEL_NAME.SCREEN_SHARE_AUDIO]: 6,
      // [CHANNEL_NAME.SCREEN_SHARE_1080P]: 2,
    },
  };

  return mapping[type]?.[channelName] ?? 5;
}

const SUB_STREAMS = {
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

function getSubStreams(streamType) {
  console.log("Getting sub streams for type:", streamType);
  if (streamType === STREAM_TYPE.SCREEN_SHARE) {
    return [SUB_STREAMS.SCREEN_SHARE_AUDIO, SUB_STREAMS.SCREEN_SHARE_720P]; //, SUB_STREAMS.SCREEN_SHARE_1080P];
  } else if (streamType === STREAM_TYPE.CAMERA) {
    return [SUB_STREAMS.MIC_AUDIO, SUB_STREAMS.VIDEO_360P, SUB_STREAMS.VIDEO_720P, SUB_STREAMS.MEETING_CONTROL];
  } else {
    return new Error("Invalid publisher type, cannot get sub streams for type:", streamType);
  }
}

const MEETING_EVENTS = {
  // --- Tham gia / Rời phòng ---
  USER_JOINED: "join", // Khi người dùng vào phòng
  USER_LEFT: "leave", // Khi người dùng rời phòng

  // --- Mic & Camera ---
  MIC_ON: "mic_on", // Khi bật mic
  MIC_OFF: "mic_off", // Khi tắt mic
  CAMERA_ON: "camera_on", // Khi bật camera
  CAMERA_OFF: "camera_off", // Khi tắt camera
  TOGGLE_AUDIO: "toggle_audio", // Trường hợp gom bật/tắt mic thành một event (backend hợp nhất)
  TOGGLE_VIDEO: "toggle_video", // Trường hợp gom bật/tắt camera thành một event (backend hợp nhất)

  // --- Tương tác người dùng ---
  RAISE_HAND: "raise_hand", // Khi giơ tay
  LOWER_HAND: "lower_hand", // Khi hạ tay
  PIN_FOR_EVERYONE: "pin_for_everyone", // Khi ghim người nào đó cho tất cả
  UNPIN_FOR_EVERYONE: "unpin_for_everyone", // Khi bỏ ghim cho tất cả

  // --- Chia sẻ màn hình ---
  REQUEST_SHARE_SCREEN: "request_share_screen", // Khi người dùng yêu cầu chia sẻ màn hình
  START_SCREEN_SHARE: "start_share_screen", // Khi bắt đầu chia sẻ màn hình
  STOP_SCREEN_SHARE: "stop_share_screen", // Khi dừng chia sẻ màn hình

  // --- Breakout room ---
  BREAKOUT_ROOM: "break_out_room", // Khi tạo breakout room
  CLOSE_BREAKOUT_ROOM: "close_breakout_room", // Khi đóng breakout room
  JOIN_SUB_ROOM: "join_sub_room", // Khi người dùng vào breakout room con
  LEAVE_SUB_ROOM: "leave_sub_room", // Khi người dùng rời breakout room con

  // --- Phòng điều khiển / quản trị (tuỳ chọn mở rộng) ---
  SYSTEM_MESSAGE: "system_message", // Thông báo hệ thống / admin gửi
  MEETING_ENDED: "meeting_ended", // Khi host kết thúc phòng
};

export {
  STREAM_TYPE,
  SUBSCRIBE_TYPE,
  CLIENT_COMMANDS,
  FRAME_TYPE,
  getFrameType,
  getTransportPacketType,
  CHANNEL_NAME,
  getDataChannelId,
  SUB_STREAMS,
  getSubStreams,
  MEETING_EVENTS,
};
