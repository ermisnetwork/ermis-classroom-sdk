export const ROOM_EVENTS = {
  // Room lifecycle
  JOINING: 'joining',
  JOINED: 'joined',
  LEAVING: 'leaving',
  LEFT: 'left',
  ROOM_LEFT: 'roomLeft',
  ROOM_ENDED: 'roomEnded',
  ERROR: 'error',

  // Participant events
  PARTICIPANT_ADDED: 'participantAdded',
  PARTICIPANT_JOINED: 'participantJoined',
  PARTICIPANT_REMOVED: 'participantRemoved',
  PARTICIPANT_UPDATED: 'participantUpdated',
  PARTICIPANT_ERROR: 'participantError',
  PARTICIPANT_DISCONNECTED: 'participantDisconnected',
  PARTICIPANT_RECONNECTED: 'participantReconnected',
  PERMISSION_UPDATED: 'permissionUpdated',

  // Media status events
  LOCAL_STREAM_READY: 'localStreamReady',
  LOCAL_SCREEN_SHARE_READY: 'localScreenShareReady',
  REMOTE_STREAM_READY: 'remoteStreamReady',
  REMOTE_SCREEN_SHARE_STREAM_READY: 'remoteScreenShareStreamReady',
  SCREEN_SHARE_STARTING: 'screenShareStarting',
  SCREEN_SHARE_STARTED: 'screenShareStarted',
  SCREEN_SHARE_STOPPING: 'screenShareStopping',
  SCREEN_SHARE_STOPPED: 'screenShareStopped',
  SCREEN_SHARE_REQUESTED: 'screenShareRequested',
  REMOTE_SCREEN_SHARE_STARTED: 'remoteScreenShareStarted',
  REMOTE_SCREEN_SHARE_STOPPED: 'remoteScreenShareStopped',

  // Audio/Video toggle events
  AUDIO_TOGGLED: 'audioToggled',
  VIDEO_TOGGLED: 'videoToggled',
  HAND_RAISE_TOGGLED: 'handRaiseToggled',
  REMOTE_AUDIO_STATUS_CHANGED: 'remoteAudioStatusChanged',
  REMOTE_VIDEO_STATUS_CHANGED: 'remoteVideoStatusChanged',
  REMOTE_HAND_RAISING_STATUS_CHANGED: 'remoteHandRaisingStatusChanged',

  // Pin events
  PARTICIPANT_PINNED: 'participantPinned',
  PARTICIPANT_UNPINNED: 'participantUnpinned',
  PARTICIPANT_PINNED_FOR_EVERYONE: 'participantPinnedForEveryone',
  PARTICIPANT_UNPINNED_FOR_EVERYONE: 'participantUnpinnedForEveryone',

  // Sub-room / Breakout room events
  SUB_ROOM_CREATED: 'subRoomCreated',
  SUB_ROOM_JOINED: 'subRoomJoined',
  SUB_ROOM_LEFT: 'subRoomLeft',
  CREATING_BREAKOUT_ROOM: 'creatingBreakoutRoom',
  BREAKOUT_ROOM_CREATED: 'breakoutRoomCreated',
  BREAKOUT_ROOM_CLOSED: 'breakoutRoomClosed',

  // Chat events (handled via separate API/WebSocket, not ServerMeetingEvent)
  MESSAGE_RECEIVED: 'messageReceived',
  MESSAGE_SENT: 'messageSent',
  MESSAGE_UPDATED: 'messageUpdated',
  MESSAGE_DELETED: 'messageDeleted',
  TYPING_STARTED: 'typingStarted',
  TYPING_STOPPED: 'typingStopped',
} as const;

export type RoomEventName = (typeof ROOM_EVENTS)[keyof typeof ROOM_EVENTS];
