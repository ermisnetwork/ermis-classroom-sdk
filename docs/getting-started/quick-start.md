# Quick Start

Build a simple video call application!

## 1. Create a MeetingClient

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new MeetingClient({
  apiBaseUrl: 'https://your-api.com',
  publishUrl: 'https://your-server.com/publish',
  subscribeUrl: 'https://your-server.com/subscribe',
  webRtcHost: 'your-server.com',  // optional WebRTC fallback
});
```

## 2. Authenticate User

```typescript
// Authenticate with your user ID
const user = await client.authenticate('my-user-id');
console.log('Authenticated as:', user.id);

// Or use manual authentication if you have the token
client.manualAuthenticate('my-user-id', 'your-jwt-token');
```

## 3. Get Media Stream

```typescript
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
  audio: true,
});

// Or use built-in helper
const mediaStream = await client.getUserMedia({
  video: true,
  audio: true,
});
```

## 4. Join a Room

```typescript
// Join by room code
const room = await client.joinRoom('ROOM123', mediaStream);

console.log('Joined room:', room.name);
console.log('Participants:', room.getParticipants().length);
```

## 5. Listen for Events

```typescript
// Local stream ready
room.on('localStreamReady', ({ videoOnlyStream, hasVideo, hasAudio }) => {
  const localVideo = document.getElementById('local-video');
  localVideo.srcObject = videoOnlyStream;
  localVideo.play();
});

// Participant joined
room.on('participantAdded', ({ participant }) => {
  console.log(`${participant.userId} joined`);
});

// Remote stream ready
room.on('remoteStreamReady', ({ streamId, videoStream }) => {
  const video = document.getElementById(`video-${streamId}`);
  video.srcObject = videoStream;
  video.play();
});
```

## 6. Screen Sharing

```typescript
// Start screen share
const screenStream = await room.startScreenShare();

// Stop screen share
await room.stopScreenShare();
```

## 7. Chat Messages

```typescript
// Send message
const message = await room.sendMessage('Hello everyone!');

// Listen for messages
room.on('messageReceived', ({ message }) => {
  console.log(`${message.senderName}: ${message.text}`);
});
```

## 8. Leave Room

```typescript
// Leave current room
await client.leaveRoom();

// Or logout completely
await client.logout();
```

## Complete Example

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

async function main() {
  // Create client
  const client = new MeetingClient({
    apiBaseUrl: 'https://api.example.com',
    publishUrl: 'https://media.example.com/publish',
    subscribeUrl: 'https://media.example.com/subscribe',
  });

  // Authenticate
  await client.authenticate('my-user-id');

  // Get media stream
  const mediaStream = await client.getUserMedia({
    video: true,
    audio: true,
  });

  // Join room
  const room = await client.joinRoom('ABC123', mediaStream);

  // Setup event handlers
  room.on('localStreamReady', ({ videoOnlyStream }) => {
    document.getElementById('local-video').srcObject = videoOnlyStream;
  });

  room.on('participantAdded', ({ participant }) => {
    console.log('Participant joined:', participant.userId);
  });

  room.on('error', ({ error, action }) => {
    console.error(`Error during ${action}:`, error);
  });

  console.log('Successfully joined the room!');
}

main();
```

## Next Steps

- [Concepts](../user-guide/concepts.md) - Understanding the SDK architecture
- [Room](../user-guide/room.md) - Full Room API reference
- [Events](../user-guide/events.md) - Full event reference
