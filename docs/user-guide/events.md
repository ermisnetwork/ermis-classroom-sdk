# Events

The SDK uses an event-driven architecture. This page documents all available events.

## MeetingClient Events

### Authentication Events

```typescript
client.on('authenticated', ({ user }) => {
  console.log('Authenticated as:', user.id);
});

client.on('loggedOut', () => {
  console.log('Logged out');
});
```

### Connection Events

```typescript
client.on('connectionStatus', (status) => {
  console.log('Connection status:', status);
});

client.on('error', (error) => {
  console.error('Client error:', error);
});
```

## Room Events

### Lifecycle Events

```typescript
room.on('joining', ({ room }) => {
  console.log('Joining room...');
});

room.on('joined', ({ room, participants }) => {
  console.log('Joined room with', participants.length, 'participants');
});

room.on('leaving', ({ room }) => {
  console.log('Leaving room...');
});

room.on('left', ({ room }) => {
  console.log('Left room');
});
```

### Participant Events

```typescript
room.on('participantAdded', ({ room, participant }) => {
  console.log(`${participant.userId} joined`);
  // participant: { userId, streamId, isLocal, role, ... }
});

room.on('participantRemoved', ({ room, participant }) => {
  console.log(`${participant.userId} left`);
});
```

### Local Media Events

```typescript
room.on('localStreamReady', ({ 
  stream,           // Full MediaStream
  videoOnlyStream,  // Video-only stream for display
  hasVideo,         // boolean
  hasAudio,         // boolean
  streamId,         // Your stream ID
}) => {
  localVideo.srcObject = videoOnlyStream;
  localVideo.play();
});

room.on('localScreenShareReady', ({
  stream,
  videoOnlyStream,
  hasVideo,
  hasAudio,
}) => {
  screenPreview.srcObject = videoOnlyStream;
});
```

### Remote Media Events

```typescript
room.on('remoteStreamReady', ({
  streamId,      // Remote participant's stream ID
  videoStream,   // MediaStream for video
  audioStream,   // MediaStream for audio
}) => {
  const video = document.getElementById(`video-${streamId}`);
  video.srcObject = videoStream;
  video.play();
});
```

### Error Events

```typescript
room.on('error', ({ room, error, action }) => {
  console.error(`Error during ${action}:`, error.message);
  // action: 'join', 'leave', 'sendMessage', etc.
});
```

## Server Events

Server-sent events for real-time state changes:

```typescript
room.on('serverEvent', (event) => {
  switch (event.type) {
    case 'mic_on':
      console.log(`${event.sender_stream_id} turned on mic`);
      break;
    case 'mic_off':
      console.log(`${event.sender_stream_id} turned off mic`);
      break;
    case 'camera_on':
      console.log(`${event.sender_stream_id} turned on camera`);
      break;
    case 'camera_off':
      console.log(`${event.sender_stream_id} turned off camera`);
      break;
    case 'raise_hand':
      console.log(`${event.sender_stream_id} raised hand`);
      break;
    case 'custom':
      console.log('Custom event:', event.value);
      break;
  }
});
```

## Custom Events

Send and receive custom events:

```typescript
// Send to all
await room.sendCustomEvent([], { action: 'quiz' });

// Send to specific users
await room.sendCustomEvent(['user1'], { action: 'private' });

// Listen
const unsubscribe = room.onCustomEvent((event) => {
  console.log('From:', event.sender_stream_id);
  console.log('Data:', event.value);
});

// Stop listening
unsubscribe();
```

## Chat Events

```typescript
room.on('messageSent', ({ room, message }) => {
  console.log('Sent:', message.text);
});

room.on('messageDeleted', ({ room, messageId }) => {
  console.log('Deleted:', messageId);
});
```

## Removing Listeners

```typescript
const handler = (data) => { ... };

room.on('participantAdded', handler);
room.off('participantAdded', handler);
```
