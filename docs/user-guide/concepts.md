# Core Concepts

Understanding these core concepts will help you use the SDK effectively.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        MeetingClient                              │
│              (Main Entry Point - Authentication & Room Mgmt)     │
├──────────────────────────────────────────────────────────────────┤
│                              │                                    │
│                         ┌────┴────┐                              │
│                         │  Room   │                              │
│                         └────┬────┘                              │
│                              │                                    │
│        ┌─────────────┐      │      ┌─────────────┐               │
│        │ Participant │──────┼──────│ Participant │               │
│        │   (local)   │      │      │  (remote)   │               │
│        └─────────────┘      │      └─────────────┘               │
│               │             │              │                      │
│               ▼             │              ▼                      │
│        ┌─────────────┐      │      ┌─────────────┐               │
│        │  Publisher  │      │      │ Subscriber  │               │
│        │ (sends)     │      │      │ (receives)  │               │
│        └─────────────┘      │      └─────────────┘               │
│               │             │              │                      │
│               └─────────────┴──────────────┘                      │
│                             │                                     │
│                  ┌──────────┴──────────┐                         │
│                  │   StreamManager     │                         │
│                  └──────────┬──────────┘                         │
│                             │                                     │
│           ┌─────────────────┴─────────────────┐                  │
│           ▼                                   ▼                  │
│    ┌─────────────┐                    ┌─────────────┐            │
│    │WebTransport │                    │   WebRTC    │            │
│    │ (primary)   │                    │ (fallback)  │            │
│    └─────────────┘                    └─────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

## Key Components

### MeetingClient

The `MeetingClient` (also exported as `ErmisClient`) is the main entry point:

- Handles authentication
- Creates and joins rooms
- Manages room lifecycle
- Provides device utilities

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new MeetingClient({
  apiBaseUrl: 'https://api.example.com',
  publishUrl: 'https://media.example.com/publish',
  subscribeUrl: 'https://media.example.com/subscribe',
});

await client.authenticate('user-id');
const room = await client.joinRoom('ROOM123', mediaStream);
```

### Room

The `Room` manages participants and media within a room:

- Manages participants (local and remote)
- Handles media connections
- Provides chat functionality
- Manages breakout rooms

```typescript
// Room is returned from client.joinRoom()
const room = await client.joinRoom('ROOM123', mediaStream);

// Access participants
const participants = room.getParticipants();
const me = room.localParticipant;

// Screen share
await room.startScreenShare();

// Chat
await room.sendMessage('Hello!');
```

### Participant

Represents a user in the room:

- `userId` - Unique user identifier
- `streamId` - Media stream identifier
- `isLocal` - Whether this is the local user
- `publisher` - Publisher instance (for local participant)
- `subscriber` - Subscriber instance (for remote participants)

```typescript
// Local participant
const me = room.localParticipant;

// Get specific participant
const user = room.getParticipant('user-id');

// All participants
const all = room.getParticipants();
```

### Publisher

Handles sending your media streams (used internally by Participant):

- Captures video from camera
- Captures audio from microphone
- Encodes media using WebCodecs (H.264 + Opus)
- Sends encoded data over transport

### Subscriber

Handles receiving media from others (used internally by Participant):

- Connects to participant streams
- Decodes video and audio
- Provides MediaStreams for rendering

## Channels

The SDK uses multiple channels for different media types:

| Channel Name | Purpose | Data Type |
|--------------|---------|-----------|
| `meeting_control` | Meeting events & commands | JSON |
| `mic_48k` | Microphone audio | Opus encoded |
| `video_360` | 360p video stream | H.264 encoded |
| `video_720` | 720p video stream | H.264 encoded |
| `screen_share_720` | Screen share video | H.264 encoded |
| `screen_share_audio` | Screen share audio | Opus encoded |

## Transport Protocols

### WebTransport (Primary)

WebTransport is the preferred protocol offering:
- Lower latency than WebRTC
- Better congestion control
- HTTP/3 based

### WebRTC (Fallback)

WebRTC is used when WebTransport is unavailable (e.g., Safari):
- Broader browser support
- Uses data channels for media
- Includes FEC (Forward Error Correction)

## Event System

The SDK uses an event-driven architecture:

```typescript
// Room events
room.on('participantAdded', ({ participant }) => { ... });
room.on('localStreamReady', (data) => { ... });
room.on('error', ({ error, action }) => { ... });

// MeetingClient events
client.on('connectionStatus', (status) => { ... });
client.on('error', (error) => { ... });
```

See [Events](events.md) for full event reference.
