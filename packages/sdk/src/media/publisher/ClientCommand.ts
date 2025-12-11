import {ChannelName, CLIENT_COMMANDS, FrameType} from "../../constants/publisherConstants";
import {StreamData} from "../../types/media/publisher.types";
import {log} from "../../utils";

// Define separate config types for each protocol
type WebRTCConfig = {
  protocol: 'webrtc';
  sendDataFn: (
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType
  ) => Promise<void>;
  commandType?: 'publisher_command' | 'subscriber_command';
};

type WebTransportConfig = {
  protocol: 'webtransport';
  sendDataFn: (
    streamData: StreamData,
    packet: Uint8Array
  ) => Promise<void>;
  commandType?: 'publisher_command' | 'subscriber_command';
};

type WebSocketConfig = {
  protocol: 'websocket';
  sendDataFn: (data: Uint8Array) => Promise<void>;
  commandType?: 'publisher_command' | 'subscriber_command';
};

// Union type for all configs
export type CommandSenderConfig = WebRTCConfig | WebTransportConfig | WebSocketConfig;

export interface PublisherState {
  hasMic: boolean;
  hasCamera: boolean;
  isMicOn: boolean;
  isCameraOn: boolean;
}

// todo: add change participant permissions command
export class CommandSender {
  private sendData: CommandSenderConfig['sendDataFn'];
  private protocol: CommandSenderConfig['protocol'];
  private commandType: string;
  private HEARTBEAT_INTERVAL_MS = 2000; // 2 seconds
  private heartbeatInterval: ReturnType<typeof setInterval> | null;

  constructor(config: CommandSenderConfig) {
    this.sendData = config.sendDataFn;
    this.protocol = config.protocol;
    this.commandType = config.commandType || 'publisher_command';
    this.heartbeatInterval = null;
  }

  private async _sendPublisherCommand(
    channelName: string,
    streamData: StreamData,
    type: string,
    data: any = null
  ): Promise<void> {
    const command: any = {type};
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    const bytes = new TextEncoder().encode(json);

    if (this.protocol === 'webrtc') {
      const frameType = type === 'media_config' ? FrameType.PUBLISHER_COMMAND : FrameType.EVENT;
      await (this.sendData as WebRTCConfig['sendDataFn'])(
        channelName as ChannelName,
        streamData,
        bytes,
        frameType
      );
    } else if (this.protocol === 'webtransport') {
      await (this.sendData as WebTransportConfig['sendDataFn'])(streamData, bytes);
    } else {
      await (this.sendData as WebSocketConfig['sendDataFn'])(bytes);
    }
  }

  private async _sendSubscriberCommand(
    streamData: StreamData,
    type: string,
    data: any = null
  ): Promise<void> {
    const command: any = {type};
    if (data !== null) {
      command.data = data;
    }

    const json = JSON.stringify(command);
    const bytes = new TextEncoder().encode(json);

    if (this.protocol === 'webtransport') {
      console.warn('[Client Command]Sending subscriber command via WebTransport:', 'command:', command);
      await (this.sendData as WebTransportConfig['sendDataFn'])(streamData, bytes);
    } else if (this.protocol === 'websocket') {
      console.warn('[Client Command]Sending subscriber command via WebSocket:', 'command:', command);
      await (this.sendData as WebSocketConfig['sendDataFn'])(bytes);
    } else {
      console.warn('[Client Command]Sending subscriber command via WebRTC:', 'command:', command);
      await (this.sendData as WebRTCConfig['sendDataFn'])(
        ChannelName.MEETING_CONTROL,
        streamData,
        bytes,
        FrameType.EVENT
      );
    }
  }

  async sendEvent(streamData: StreamData, eventData: any = null): Promise<void> {
    await this._sendPublisherCommand(ChannelName.MEETING_CONTROL, streamData, 'event', eventData);
  }


  async initChannelStream(channelName: string, streamData: StreamData): Promise<void> {
    await this._sendPublisherCommand(channelName, streamData, 'init_channel_stream', {
      channel: channelName,
    });
  }

  async sendPublisherState(streamData: StreamData, state: PublisherState): Promise<void> {
    await this._sendPublisherCommand(ChannelName.MEETING_CONTROL, streamData, 'publisher_state', {
      has_mic: state.hasMic,
      has_camera: state.hasCamera,
      is_mic_on: state.isMicOn,
      is_camera_on: state.isCameraOn,
    });
  }

  async sendMediaConfig(channelName: string, streamData: StreamData, config: any): Promise<void> {
    await this._sendPublisherCommand(channelName, streamData, 'media_config', config);
  }

  async initSubscribeChannelStream(streamData: StreamData, subscriberType: string): Promise<void> {
    await this._sendSubscriberCommand(streamData, 'init_channel_stream', {
      stream_type: subscriberType,
      audio: true,
      video: true,
      quality: ChannelName.VIDEO_720P,
    });
  }

  async startStream(streamData: StreamData): Promise<void> {
    await this._sendSubscriberCommand(streamData, CLIENT_COMMANDS.START_STREAM);
  }

  async stopStream(streamData: StreamData): Promise<void> {
    await this._sendSubscriberCommand(streamData, CLIENT_COMMANDS.STOP_STREAM);
  }

  async pauseStream(streamData: StreamData): Promise<void> {
    await this._sendSubscriberCommand(streamData, CLIENT_COMMANDS.PAUSE_STREAM);
  }

  async resumeStream(streamData: StreamData): Promise<void> {
    await this._sendSubscriberCommand(streamData, CLIENT_COMMANDS.RESUME_STREAM);
  }


  async sendHeartbeat(streamData: StreamData): Promise<void> {
    await this._sendPublisherCommand(
      ChannelName.MEETING_CONTROL,
      streamData,
      'ping'
    );
  }

  startHeartbeat(streamData: StreamData): void {
    this.stopHeartbeat();

    log('[CommandSender] Starting heartbeat interval');

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat(streamData);
        log('[CommandSender] Heartbeat sent');
      } catch (error) {
        console.error('[CommandSender] Failed to send heartbeat:', error);
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      log('[CommandSender] Heartbeat stopped');
    }
  }
}

export default CommandSender;