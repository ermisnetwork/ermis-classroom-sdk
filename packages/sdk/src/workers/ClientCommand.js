import {CHANNEL_NAME, CLIENT_COMMANDS, FRAME_TYPE, STREAM_TYPE} from "./publisherConstants.js";

class CommandSender {
  constructor(config) {
    this.sendData = config.sendDataFn;
    this.protocol = config.protocol || "websocket";
    this.commandType = config.commandType || "publisher_command"; // publisher or subscriber
    this.localStreamId = config.localStreamId;
  }

  async _sendPublisherCommand(channelName, type, data = null) {
    const command = {type};
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    const bytes = new TextEncoder().encode(json);
    if (this.protocol === "webrtc") {
      let frameType = type === "media_config" ? FRAME_TYPE.CONFIG : FRAME_TYPE.EVENT;
      await this.sendData(channelName, bytes, frameType);
    } else {
      await this.sendData(channelName, bytes);
    }
  }

  async _sendSubscriberCommand(type, data = null) {
    const command = {type};
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    if (this.protocol === "webtransport") {
      const bytes = new TextEncoder().encode(json);
      await this.sendData(bytes);
    } else {
      await this.sendData(json);
    }
  }

  async sendEvent(eventData = null) {
    await this._sendPublisherCommand(CHANNEL_NAME.MEETING_CONTROL, "event", eventData);
  }

  async initChannelStream(channelName) {
    await this._sendPublisherCommand(channelName, "init_channel_stream", {
      channel: channelName,
    });
  }

  async sendPublisherState(channelName, state) {
    await this._sendPublisherCommand(channelName, "publisher_state", {
      has_mic: state.hasMic,
      has_camera: state.hasCamera,
      is_mic_on: state.isMicOn,
      is_camera_on: state.isCameraOn,
    });
  }

  async sendMediaConfig(channelName, config) {
    await this._sendPublisherCommand(channelName, "media_config", config);
  }


  //! temporary disable sharescreen audio
  async initSubscribeChannelStream(subscriberType, options = {}) {
    const initQuality =
      subscriberType === STREAM_TYPE.SCREEN_SHARE ? CHANNEL_NAME.SCREEN_SHARE_720P : CHANNEL_NAME.VIDEO_720P;
      let audioEnabled = subscriberType === STREAM_TYPE.SCREEN_SHARE ? false : true;
      const commandData = {
      subscriber_stream_id: this.localStreamId,
      stream_type: subscriberType,
      audio: audioEnabled,
      video: options.video !== undefined ? options.video : true,
      quality: initQuality,
    }
    console.warn('initSubscribeChannelStream commandData', commandData);
    await this._sendSubscriberCommand("init_channel_stream", commandData);
    // await this._sendSubscriberCommand("init_channel_stream", {
    //   subscriber_stream_id: this.localStreamId,
    //   stream_type: subscriberType,
    //   audio: audioEnabled,
    //   video: options.video !== undefined ? options.video : true,
    //   quality: initQuality,
    // });
  }

  async startStream() {
    await this._sendSubscriberCommand(CLIENT_COMMANDS.START_STREAM);
  }

  async stopStream() {
    await this._sendSubscriberCommand(CLIENT_COMMANDS.STOP_STREAM);
  }

  async pauseStream() {
    await this._sendSubscriberCommand(CLIENT_COMMANDS.PAUSE_STREAM);
  }

  async resumeStream() {
    await this._sendSubscriberCommand(CLIENT_COMMANDS.RESUME_STREAM);
  }
}

export default CommandSender;
