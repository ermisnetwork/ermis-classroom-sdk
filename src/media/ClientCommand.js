import { FRAME_TYPE, CHANNEL_NAME, CLIENT_COMMANDS } from "../constant/publisherConstants";

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

  async _sendSubscriberCommand(channelName, type, data = null) {
    const command = { type };
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    if (this.protocol === "webtransport") {
      const bytes = new TextEncoder().encode(json);
      await this.sendData(channelName, bytes);
    } else {
      await this.sendData(channelName, json);
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

  /*  Subscriber command methods  */

  async startStream(channelName) {
    await this._sendCommand(channelName, CLIENT_COMMANDS.START_STREAM);
  }

  async stopStream(channelName) {
    await this._sendCommand(channelName, CLIENT_COMMANDS.STOP_STREAM);
  }

  async pauseStream(channelName) {
    await this._sendCommand(channelName, CLIENT_COMMANDS.PAUSE_STREAM);
  }

  async resumeStream(channelName) {
    await this._sendCommand(channelName, CLIENT_COMMANDS.RESUME_STREAM);
  }
}

export default CommandSender;

// class PublisherCommandSender {
//   constructor(sendDataFn, isWebRtc = true) {
//     this.sendData = sendDataFn;
//     this.isWebRtc = isWebRtc;
//   }

//   async _sendCommand(channelName, type, data = null) {
//     const command = { type };
//     if (data !== null) {
//       command.data = data;
//     }

//     const json = JSON.stringify(command);
//     const bytes = new TextEncoder().encode(json);
//     if (this.isWebRtc) {
//       let frameType = type === "media_config" ? FRAME_TYPE.CONFIG : FRAME_TYPE.EVENT;
//       await this.sendData(channelName, bytes, frameType);
//     } else {
//       await this.sendData(channelName, bytes);
//     }
//   }

//   async sendEvent(eventData = null) {
//     await this._sendCommand(CHANNEL_NAME.MEETING_CONTROL, "event", eventData);
//   }

//   async initChannelStream(channelName) {
//     await this._sendCommand(channelName, "init_channel_stream", {
//       channel: channelName,
//     });
//   }

//   async sendPublisherState(channelName, state) {
//     await this._sendCommand(channelName, "publisher_state", {
//       has_mic: state.hasMic,
//       has_camera: state.hasCamera,
//       is_mic_on: state.isMicOn,
//       is_camera_on: state.isCameraOn,
//     });
//   }

//   async sendMediaConfig(channelName, config) {
//     console.warn("[Client Command]Sending media config to server:", "channel name:", channelName, "config:", config);
//     await this._sendCommand(channelName, "media_config", config);
//   }
// }

// export default PublisherCommandSender;
