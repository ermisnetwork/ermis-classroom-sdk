# Publisher

The `Publisher` handles capturing and streaming your local media (camera, microphone).

> **Note**: Publishers are created internally when you join a room. You typically don't create them directly.

## Accessing the Publisher

```typescript
// Publisher is accessible via local participant
const publisher = room.localParticipant?.publisher;
```

## Direct Usage (Advanced)

For advanced use cases, you can create a Publisher directly:

```typescript
import { Publisher } from '@ermisnetwork/ermis-classroom-sdk';

const publisher = new Publisher({
  streamId: 'my-stream-id',
  publishUrl: 'https://server.com/publish',
  roomId: 'room-id',
  hasMic: true,
  hasCamera: true,
  permissions: {
    can_publish: true,
    can_publish_sources: [
      ['mic_48k', true],
      ['video_360', true],
      ['video_720', true],
    ],
  },
});

await publisher.init();
await publisher.startPublishing();
```

## Media Controls

### Toggle Camera/Microphone

```typescript
// Toggle camera
await publisher.toggleCamera();
// or
await publisher.toggleVideo();

// Toggle microphone
await publisher.toggleMic();
// or
await publisher.toggleAudio();
```

### Explicit On/Off

```typescript
// Camera
await publisher.turnOnVideo();
await publisher.turnOffVideo();

// Microphone
await publisher.turnOnAudio();
await publisher.turnOffAudio();
```

### Check State

```typescript
const isCameraOn = publisher.isVideoOn();
const isMicOn = publisher.isAudioOn();
```

## Device Switching

```typescript
// Switch camera
const result = await publisher.switchVideoDevice(deviceId);

// Switch microphone
await publisher.switchAudioDevice(deviceId);
```

## Hand Raise

```typescript
// Raise hand
await publisher.raiseHand();

// Lower hand
await publisher.lowerHand();
```

## Pin for Everyone

Pin a participant's video for all viewers (host/co-host only):

```typescript
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

// Pin a participant for everyone by their stream ID (default: PinType.User)
await publisher.pinForEveryone('target-stream-id');

// Pin a screen share for everyone
await publisher.pinForEveryone('target-stream-id', PinType.ScreenShare);

// Unpin for everyone
await publisher.unPinForEveryone('target-stream-id');

// Unpin a screen share for everyone
await publisher.unPinForEveryone('target-stream-id', PinType.ScreenShare);
```

**PinType Values:**
| Enum | Value | Description |
|------|-------|-------------|
| `PinType.User` | 1 | Pin a user's camera video |
| `PinType.ScreenShare` | 2 | Pin a screen share |

## Custom Events

```typescript
// Send custom event to all
await publisher.sendCustomEvent([], { action: 'quiz' });

// Send to specific participants
await publisher.sendCustomEvent(['streamId1'], { action: 'private' });
```

## Stopping

```typescript
await publisher.stop();
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `streamStart` | - | Publishing started |
| `streamStop` | - | Publishing stopped |
| `statusUpdate` | `{ message, isError }` | Status changed |
| `error` | `Error` | Error occurred |
| `localStreamReady` | `{ stream, videoOnlyStream, ... }` | Stream ready |
| `screenShareStarted` | `{ stream, hasVideo, hasAudio }` | Screen share started |
| `screenShareStopped` | - | Screen share stopped |
| `mediaStreamReplaced` | `{ stream, videoOnlyStream, hasVideo, hasAudio }` | Media stream replaced |

```typescript
publisher.on('statusUpdate', ({ message, isError }) => {
  console.log(isError ? `Error: ${message}` : message);
});
```
