# Streaming Flow Analysis

This document provides a detailed analysis of the streaming flow in the SDK, comparing **WebTransport** vs **WebRTC** and **Camera** vs **Screen Share** implementations.

## Table of Contents

1. [Overview](#overview)
2. [WebTransport vs WebRTC](#webtransport-vs-webrtc)
3. [Camera vs Screen Share](#camera-vs-screen-share)
4. [Packet Building](#packet-building)
5. [Channel Initialization](#channel-initialization)

---

## Overview

The SDK supports two transport protocols:

```
┌─────────────────┐     ┌─────────────────┐
│   WebTransport  │     │     WebRTC      │
│  (HTTP/3 based) │     │  (DataChannel)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
            ┌─────────────────┐
            │  StreamManager  │
            └─────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
      Video       Audio       Control
    Channels     Channel      Channel
```

---

## WebTransport vs WebRTC

### Initialization Flow

| Step | WebTransport | WebRTC (DataChannel) |
|------|--------------|----------------------|
| 1. Connect | `WebTransportManager.connect()` | `WebRTCManager.connectMultipleChannels()` |
| 2. Create channel | `webTransport.createBidirectionalStream()` | `peerConnection.createDataChannel()` |
| 3. Store data | `streams.set(channelName, { writer, reader })` | `streams.set(channelName, { dataChannel })` |
| 4. Init channel | `sendInitChannelStream()` sends JSON | Không cần (WebRTC tự xử lý) |
| 5. Ready state | Ngay sau khi tạo stream | Chờ event `dataChannel.onopen` |

### Data Sending Flow

#### WebTransport (`sendViaWebTransport`)

```typescript
// File: StreamManager.ts, lines 806-823
private async sendViaWebTransport(
    streamData: StreamData,
    packet: Uint8Array
): Promise<void> {
    // 1. Add length-delimited prefix (4 bytes, big-endian)
    const len = packet.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);  // Big-endian
    out.set(packet, 4);
    
    // 2. Send directly via writer
    await streamData.writer.write(out.slice());
}
```

**Packet format:**
```
┌─────────────────────────────────────────┐
│ Length (4 bytes, big-endian)            │
├─────────────────────────────────────────┤
│ Packet Data (variable length)           │
└─────────────────────────────────────────┘
```

#### WebRTC (`sendViaDataChannel`)

```typescript
// File: StreamManager.ts, lines 829-936
private async sendViaDataChannel(
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType
): Promise<void> {
    // 1. Check DataChannel ready
    if (!dataChannelReady || dataChannel.readyState !== "open") {
        return;
    }

    // 2. Determine if FEC encoding needed
    const needFecEncode = frameType !== FrameType.EVENT 
                       && frameType !== FrameType.AUDIO;
    //                 ↑ VIDEO needs FEC, AUDIO does not

    if (needFecEncode) {
        // 3A. Video: FEC encoding with RaptorQ WASM
        const encoder = new this.WasmEncoder(packet, chunkSize);
        const fecPackets = encoder.encode(redundancy);
        
        for (const fecPacket of fecPackets) {
            const wrapper = PacketBuilder.createFECPacket(...);
            this.sendOrQueue(channelName, dataChannel, wrapper);
        }
    } else {
        // 3B. Audio/Event: Send directly (no FEC)
        const wrapper = PacketBuilder.createRegularPacket(...);
        this.sendOrQueue(channelName, dataChannel, wrapper);
    }
}
```

### Key Differences Summary

| Aspect | WebTransport | WebRTC DataChannel |
|--------|--------------|-------------------|
| **Protocol** | Length-delimited (4 bytes prefix) | FEC wrapping for video |
| **FEC Encoding** | ❌ None | ✅ RaptorQ WASM for video |
| **Audio Handling** | Length-delimited packet | Regular packet (no FEC) |
| **Buffering** | Stream-based | Queue-based với `bufferedAmountLowThreshold` |
| **Reliability** | Reliable by protocol | FEC for reliability |
| **Latency** | Lower | Slightly higher (FEC overhead) |

---

## Camera vs Screen Share

### Camera Stream Flow (Publisher.startPublishing)

```
Publisher.startPublishing()
    │
    ├── 1. getMediaStream() - Get camera/mic
    │
    ├── 2. setupWebTransportConnection()
    │   └── StreamManager.initWebTransportStreams([
    │         ChannelName.MEETING_CONTROL,  // control channel
    │         ChannelName.MICROPHONE,       // mic_48k
    │         ChannelName.VIDEO_360P,       // video_360
    │         ChannelName.VIDEO_720P        // video_720
    │       ])
    │       (4 bidirectional streams created simultaneously)
    │
    ├── 3. initializeProcessors()
    │   ├── new VideoProcessor(subStreams: [VIDEO_360P, VIDEO_720P])
    │   └── new AudioProcessor(channelName: MICROPHONE)
    │
    └── 4. startMediaProcessing()
        ├── videoProcessor.start()
        └── audioProcessor.start()
```

### Screen Share Flow (Publisher.startShareScreen)

```
Publisher.startShareScreen(screenMediaStream)
    │
    ├── 1. Receive MediaStream from outside (already obtained)
    │
    ├── 2. streamManager.addStream() - CREATE ADDITIONAL STREAMS
    │   ├── ChannelName.SCREEN_SHARE_720P
    │   └── ChannelName.SCREEN_SHARE_AUDIO (if has audio)
    │   (Add 1-2 new bidirectional streams)
    │
    ├── 3. startScreenVideoCapture()
    │   ├── new VideoEncoderManager()
    │   └── new VideoProcessor(screenSubStreams: [SCREEN_SHARE_720P])
    │
    └── 4. startScreenAudioStreaming() (if has audio)
        ├── new AudioEncoderManager(SCREEN_SHARE_AUDIO)
        └── new AudioProcessor(channelName: SCREEN_SHARE_AUDIO)
```

### Comparison Table

| Aspect | Camera Stream | Screen Share |
|--------|---------------|--------------|
| **Initialization** | Same time as connection | Added after already publishing |
| **Number of streams** | 4 (control, mic, 360p, 720p) | 1-2 (720p, audio optional) |
| **SubStreams config** | `VIDEO_360P`, `VIDEO_720P` | `SCREEN_SHARE_720P` |
| **Resolution** | 640x360, 1280x720 | 1280x720 (fixed) |
| **Bitrate** | 400Kbps, 800Kbps | 1Mbps |
| **Framerate** | 30fps | 15-20fps |
| **Stream creation** | `initWebTransportStreams()` | `addStream()` (dynamic) |

---

## Packet Building

### PacketBuilder.createPacket

Creates the base packet with header:

```typescript
static createPacket(
    data: ArrayBuffer | Uint8Array,
    timestamp: number,
    frameType: FrameType,
    sequenceNumber: number
): Uint8Array {
    // Header: 13 bytes
    // - Sequence Number: 4 bytes
    // - Timestamp: 8 bytes
    // - Frame Type: 1 byte
    
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    
    view.setUint32(0, sequenceNumber, false);      // 4 bytes
    view.setBigUint64(4, BigInt(timestamp), false); // 8 bytes
    header[12] = frameType;                         // 1 byte
    
    // Combine header + data
    const packet = new Uint8Array(13 + data.byteLength);
    packet.set(header, 0);
    packet.set(new Uint8Array(data), 13);
    
    return packet;
}
```

### Frame Types

```typescript
enum FrameType {
    // Camera video
    CAM_360P_KEY = 1,
    CAM_360P_DELTA = 2,
    CAM_720P_KEY = 3,
    CAM_720P_DELTA = 4,
    
    // Screen share
    SCREEN_SHARE_KEY = 5,
    SCREEN_SHARE_DELTA = 6,
    
    // Audio
    AUDIO = 10,
    
    // Control
    CONFIG = 20,
    EVENT = 21,
}
```

---

## Channel Initialization

### WebTransport Channel Init

```typescript
// After creating bidirectional stream, send init command
private async sendInitChannelStream(channelName: ChannelName): Promise<void> {
    const command = {
        type: "init_channel_stream",
        data: {
            channel: channelName,
        },
    };

    const commandJson = JSON.stringify(command);
    const commandBytes = new TextEncoder().encode(commandJson);

    // Send with length-delimited format
    const len = commandBytes.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(commandBytes, 4);

    await streamData.writer.write(out.slice());
}
```

### WebRTC Channel Init

WebRTC uses negotiated data channels:

```typescript
const dataChannel = peerConnection.createDataChannel(channelName, {
    ordered: false,  // Unordered for video/audio
    id: 0,           // Fixed ID
    negotiated: true, // Pre-negotiated
});

// Channel is ready when onopen fires
dataChannel.onopen = async () => {
    this.streams.set(channelName, {
        dataChannel,
        dataChannelReady: true,
        // ...
    });
    
    this.emit("streamReady", { channelName });
};
```

---

## Related Documents

- [WebTransport Implementation](transports/webtransport.md)
- [WebRTC Implementation](transports/webrtc.md)
- [Safari Issues](troubleshooting/safari-issues.md)
