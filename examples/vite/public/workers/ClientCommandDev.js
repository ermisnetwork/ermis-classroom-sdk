import { FRAME_TYPE, CHANNEL_NAME, CLIENT_COMMANDS } from "./publisherConstants.js";

class CommandSender {
  constructor(config) {
    this.sendData = config.sendDataFn;
    this.protocol = config.protocol || "websocket";
    this.commandType = config.commandType || "publisher_command"; // publisher or subscriber
  }

  async _sendPublisherCommand(channelName, type, data = null) {
    const command = { type };
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
    const command = { type };
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    if (this.protocol === "webtransport") {
      console.warn("[Client Command]Sending subscriber command via WebTransport:", "command:", command);
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
    console.warn("[Client Command]Sending media config to server:", "channel name:", channelName, "config:", config);
    await this._sendPublisherCommand(channelName, "media_config", config);
  }

  // SubscriberCommand::InitChannelStream {
  //                           channel,
  //                           stream_type,
  //                           audio,
  //                           video,
  //                           quality,
  //                       },
  /*  Subscriber command methods  */

  async initSubscribeChannelStream() {
    await this._sendSubscriberCommand("init_channel_stream", {
      channel: "media",
      stream_type: "camera",
      audio: true,
      video: true,
      quality: CHANNEL_NAME.VIDEO_720P,
    });
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
