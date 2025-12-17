# Architecture

This document describes the high-level architecture of the Ermis Classroom SDK.

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Publisher                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  MediaStream (camera/mic/screen)                                          │
│        │                                                                  │
│        ▼                                                                  │
│  ┌─────────────┐     ┌─────────────────┐                                 │
│  │VideoProcessor│     │ AudioProcessor   │                                │
│  └─────────────┘     └─────────────────┘                                 │
│        │                     │                                            │
│        ▼                     ▼                                            │
│  ┌───────────────┐   ┌───────────────────┐                               │
│  │VideoEncoderMgr│   │AudioEncoderManager│                               │
│  └───────────────┘   └───────────────────┘                               │
│        │                     │                                            │
│        └─────────┬───────────┘                                            │
│                  ▼                                                        │
│           ┌─────────────────┐                                             │
│           │  StreamManager  │                                             │
│           └─────────────────┘                                             │
│                  │                                                        │
│    ┌─────────────┼─────────────┐                                         │
│    ▼             ▼             ▼                                         │
│ WebTransport   WebRTC      WebRTC (screenShare)                          │
│ (streams)    (dataChannels) (dataChannels)                               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### Room

The `Room` class (`src/cores/Room.ts`) is the main entry point:

- Orchestrates Publisher and Subscriber
- Manages participant state
- Provides high-level API for applications

### Publisher

The `Publisher` (`src/media/publisher/Publisher.ts`) handles sending media:

- **VideoProcessor** - Captures video frames using MediaStreamTrackProcessor
- **AudioProcessor** - Captures audio samples
- **VideoEncoderManager** - Encodes video to H.264
- **AudioEncoderManager** - Encodes audio to Opus
- **StreamManager** - Sends encoded data over transport

### Subscriber

The `Subscriber` (`src/media/subscriber/Subscriber.ts`) handles receiving media:

- **StreamReceiver** - Receives encoded data
- **VideoDecoder** - Decodes H.264 to frames
- **AudioDecoder** - Decodes Opus to samples
- **MediaStreamOutputs** - Outputs to MediaStream for rendering

### StreamManager

The `StreamManager` (`src/media/publisher/transports/StreamManager.ts`) manages transport:

- Creates and manages channels (streams/data channels)
- Builds packets with headers
- Handles FEC encoding for WebRTC
- Routes data to appropriate transport

## Data Flow

### Publishing Flow

```
Camera → VideoProcessor → VideoEncoder → StreamManager → Server
   │                           │               │
   │                           ▼               ▼
   │                      H.264 NAL     Length-delimited
   │                       units          packets
   ▼
Microphone → AudioProcessor → AudioEncoder → StreamManager → Server
                                    │               │
                                    ▼               ▼
                                Opus frames    Length-delimited
                                                 packets
```

### Subscribing Flow

```
Server → StreamReceiver → VideoDecoder → VideoTrack → <video>
             │                  │
             │                  ▼
             │            VideoFrame
             ▼
Server → StreamReceiver → AudioDecoder → AudioTrack → <audio>
                               │
                               ▼
                          AudioData
```

## Channel Architecture

The SDK uses multiple channels for different media types:

| Channel | ID | Purpose | Protocol |
|---------|---|---------| ---------|
| `meeting_control` | 0 | Commands & events | JSON |
| `mic_48k` | 1 | Microphone audio | Opus |
| `video_360` | 2 | 360p video | H.264 |
| `video_720` | 3 | 720p video | H.264 |
| `screen_share_720` | 5 | Screen video | H.264 |
| `screen_share_audio` | 6 | Screen audio | Opus |

## Packet Format

### WebTransport Packet

```
┌─────────────────────────────────────────────┐
│ Length (4 bytes, big-endian)                │
├─────────────────────────────────────────────┤
│ Sequence Number (4 bytes)                   │
├─────────────────────────────────────────────┤
│ Timestamp (8 bytes)                         │
├─────────────────────────────────────────────┤
│ Frame Type (1 byte)                         │
├─────────────────────────────────────────────┤
│ Payload (variable)                          │
└─────────────────────────────────────────────┘
```

### WebRTC Packet (with FEC)

```
┌─────────────────────────────────────────────┐
│ Sequence Number (4 bytes)                   │
├─────────────────────────────────────────────┤
│ Packet Type (1 byte)                        │
├─────────────────────────────────────────────┤
│ RaptorQ Config (14 bytes)                   │
├─────────────────────────────────────────────┤
│ FEC Symbol Data (variable)                  │
└─────────────────────────────────────────────┘
```

## Transport Selection

```typescript
if (supportsWebTransport && !forceWebRTC) {
  // Use WebTransport - lower latency
  transport = new WebTransportManager();
} else {
  // Use WebRTC with DataChannels
  transport = new WebRTCManager();
}
```

## Event System

The SDK uses a custom EventEmitter with TypeScript support:

```typescript
class StreamManager extends EventEmitter<{
  streamReady: { channelName: ChannelName };
  sendError: { channelName: ChannelName; error: unknown };
}> {
  // ...
}

// Usage
streamManager.on('streamReady', ({ channelName }) => {
  console.log(`Stream ${channelName} is ready`);
});
```

## Error Handling

Errors are propagated through:

1. Event emissions (`error` events)
2. Promise rejections
3. Global error handlers

```typescript
try {
  await publisher.startPublishing();
} catch (error) {
  // Handle initialization errors
}

publisher.on('error', (error) => {
  // Handle runtime errors
});
```
