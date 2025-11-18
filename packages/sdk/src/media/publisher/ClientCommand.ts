/**
 * ClientCommand - Command sender for Publisher/Subscriber
 * ✅ PORT FROM ermis-classroom-sdk/src/media/ClientCommand.js
 */

import { FrameType, ChannelName, CLIENT_COMMANDS } from "../../constants/publisherConstants";

export interface CommandSenderConfig {
    sendDataFn: (channelName: string, bytes: Uint8Array, frameType?: number) => Promise<void>;
    protocol?: 'webrtc' | 'webtransport' | 'websocket';
    commandType?: 'publisher_command' | 'subscriber_command';
}

export interface PublisherState {
    hasMic: boolean;
    hasCamera: boolean;
    isMicOn: boolean;
    isCameraOn: boolean;
}

/**
 * CommandSender class for sending commands to server
 * ✅ PORT FROM ClientCommand.js
 */
export class CommandSender {
    private sendData: (channelName: string, bytes: Uint8Array, frameType?: number) => Promise<void>;
    private protocol: string;
    // @ts-expect-error - May be used in future
    private commandType: string;

    constructor(config: CommandSenderConfig) {
        this.sendData = config.sendDataFn;
        this.protocol = config.protocol || 'websocket';
        this.commandType = config.commandType || 'publisher_command';
    }

    /**
     * Send publisher command
     * ✅ PORT FROM ClientCommand.js:10-23
     */
    private async _sendPublisherCommand(
        channelName: string,
        type: string,
        data: any = null
    ): Promise<void> {
        const command: any = { type };
        if (data !== null) {
            command.data = data;
        }

        const json = JSON.stringify(command);
        const bytes = new TextEncoder().encode(json);

        if (this.protocol === 'webrtc') {
            const frameType = type === 'media_config' ? FrameType.CONFIG : FrameType.EVENT;
            await this.sendData(channelName, bytes, frameType);
        } else {
            await this.sendData(channelName, bytes);
        }
    }

    /**
     * Send subscriber command
     * ✅ PORT FROM ClientCommand.js:25-41
     */
    private async _sendSubscriberCommand(type: string, data: any = null): Promise<void> {
        const command: any = { type };
        if (data !== null) {
            command.data = data;
        }

        const json = JSON.stringify(command);
        if (this.protocol === 'webtransport') {
            console.warn('[Client Command]Sending subscriber command via WebTransport:', 'command:', command);
            const bytes = new TextEncoder().encode(json);
            await this.sendData('', bytes); // Subscriber uses single data stream
        } else {
            console.warn('[Client Command]Sending subscriber command via WebSocket:', 'command:', command);
            // For WebSocket, might need to handle differently
            const bytes = new TextEncoder().encode(json);
            await this.sendData('', bytes);
        }
    }

    /**
     * Send event to server
     * ✅ PORT FROM ClientCommand.js:43-45
     */
    async sendEvent(eventData: any = null): Promise<void> {
        await this._sendPublisherCommand(ChannelName.MEETING_CONTROL, 'event', eventData);
    }

    /**
     * Initialize channel stream
     * ✅ PORT FROM ClientCommand.js:47-51
     */
    async initChannelStream(channelName: string): Promise<void> {
        await this._sendPublisherCommand(channelName, 'init_channel_stream', {
            channel: channelName,
        });
    }

    /**
     * Send publisher state
     * ✅ PORT FROM ClientCommand.js:53-60
     */
    async sendPublisherState(channelName: string, state: PublisherState): Promise<void> {
        await this._sendPublisherCommand(channelName, 'publisher_state', {
            has_mic: state.hasMic,
            has_camera: state.hasCamera,
            is_mic_on: state.isMicOn,
            is_camera_on: state.isCameraOn,
        });
    }

    /**
     * Send media config
     * ✅ PORT FROM ClientCommand.js:62-65
     */
    async sendMediaConfig(channelName: string, config: any): Promise<void> {
        console.warn('[Client Command]Sending media config to server:', 'channel name:', channelName, 'config:', config);
        await this._sendPublisherCommand(channelName, 'media_config', config);
    }

    /**
     * Initialize subscribe channel stream
     * ✅ PORT FROM ClientCommand.js:67-74
     */
    async initSubscribeChannelStream(subscriberType: string): Promise<void> {
        await this._sendSubscriberCommand('init_channel_stream', {
            stream_type: subscriberType,
            audio: true,
            video: true,
            quality: ChannelName.VIDEO_720P,
        });
    }

    /**
     * Start stream
     * ✅ PORT FROM ClientCommand.js:76-78
     */
    async startStream(): Promise<void> {
        await this._sendSubscriberCommand(CLIENT_COMMANDS.START_STREAM);
    }

    /**
     * Stop stream
     * ✅ PORT FROM ClientCommand.js:80-82
     */
    async stopStream(): Promise<void> {
        await this._sendSubscriberCommand(CLIENT_COMMANDS.STOP_STREAM);
    }

    /**
     * Pause stream
     * ✅ PORT FROM ClientCommand.js:84-86
     */
    async pauseStream(): Promise<void> {
        await this._sendSubscriberCommand(CLIENT_COMMANDS.PAUSE_STREAM);
    }

    /**
     * Resume stream
     * ✅ PORT FROM ClientCommand.js:88-90
     */
    async resumeStream(): Promise<void> {
        await this._sendSubscriberCommand(CLIENT_COMMANDS.RESUME_STREAM);
    }
}

export default CommandSender;
