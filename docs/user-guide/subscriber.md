# Subscriber

The `Subscriber` handles receiving and playing remote media streams from other participants.

> **Note**: Subscribers are created internally when remote participants join. You typically don't create them directly.

## Accessing the Subscriber

```typescript
// Subscriber is accessible via remote participant
const participant = room.getParticipant('user-id');
const subscriber = participant?.subscriber;
```

## Direct Usage (Advanced)

For advanced use cases, you can create a Subscriber directly:

```typescript
import { Subscriber } from '@ermisnetwork/ermis-classroom-sdk';

const subscriber = new Subscriber({
  localStreamId: 'my-stream-id',
  streamId: 'remote-stream-id',
  roomId: 'room-id',
  host: 'media.example.com',
  isOwnStream: false,
});

await subscriber.start();
```

## Methods

### Start/Stop

```typescript
// Start receiving
await subscriber.start();

// Stop receiving
subscriber.stop();

// Check if started
const isActive = subscriber.started();
```

### Audio Control

```typescript
// Toggle audio on/off
const isAudioOn = subscriber.toggleAudio();
```

### Quality Control

```typescript
// Switch video quality
subscriber.switchBitrate('360p');  // or '720p'
```

### Get Media Stream

```typescript
// Get the media stream for rendering
const stream = subscriber.getMediaStream();
if (stream) {
  videoElement.srcObject = stream;
}
```

### Get Info

```typescript
const info = subscriber.getInfo();
// {
//   subscriberId: string,
//   streamId: string,
//   isStarted: boolean,
//   ...
// }
```

## Setting Audio Mixer

```typescript
// Set audio mixer for audio output
subscriber.setAudioMixer(audioMixer);
```

## Cleanup

```typescript
subscriber.cleanup();
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `starting` | `{ subscriber }` | Starting |
| `started` | `{ subscriber }` | Started |
| `stopping` | `{ subscriber }` | Stopping |
| `stopped` | `{ subscriber }` | Stopped |
| `videoReady` | `{ mediaStream }` | Video stream ready |
| `audioReady` | `{ mediaStream }` | Audio stream ready |
| `streamReady` | `{ videoStream, audioStream }` | Both streams ready |
| `error` | `{ subscriber, error, action }` | Error occurred |

```typescript
subscriber.on('started', ({ subscriber }) => {
  console.log('Subscriber started:', subscriber.getSubscriberId());
});

subscriber.on('error', ({ error, action }) => {
  console.error(`Error during ${action}:`, error);
});
```
