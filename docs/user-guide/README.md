# User Guide

This guide covers how to use the Ermis Classroom SDK in your applications.

## Chapters

1. [Concepts](concepts.md) - Core concepts and terminology
2. [Publisher](publisher.md) - Publishing video and audio
3. [Subscriber](subscriber.md) - Subscribing to streams
4. [Room](room.md) - Room management API
5. [Events](events.md) - Event system reference
6. [Features](features/README.md) - Advanced features

## Quick Reference

### Complete Flow

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

// 1. Create client
const client = new MeetingClient({
  apiBaseUrl: 'https://api.example.com',
  publishUrl: 'https://media.example.com/publish',
  subscribeUrl: 'https://media.example.com/subscribe',
});

// 2. Authenticate
await client.authenticate('my-user-id');

// 3. Get media stream
const mediaStream = await client.getUserMedia({
  video: true,
  audio: true,
});

// 4. Setup event listeners
client.on('error', (error) => console.error(error));

// 5. Join room
const room = await client.joinRoom('ROOM123', mediaStream);

// 6. Setup room event listeners
room.on('localStreamReady', handleLocalStream);
room.on('participantAdded', handleParticipantAdded);

// 7. Leave when done
await client.leaveRoom();
```

### Common Operations

| Operation | Method |
|-----------|--------|
| Authenticate | `client.authenticate(userId)` |
| Join room | `client.joinRoom(code, mediaStream)` |
| Leave room | `client.leaveRoom()` |
| Start Screen Share | `room.startScreenShare()` |
| Stop Screen Share | `room.stopScreenShare()` |
| Send Custom Event | `room.sendCustomEvent(targets, data)` |
| Get Participants | `room.getParticipants()` |
| Pin Participant | `room.pinParticipant(userId)` |
| Send Chat Message | `room.sendMessage(text)` |

### Access State

| Property | Description |
|----------|-------------|
| `client.getCurrentRoom()` | Current room |
| `client.getState()` | Client state |
| `room.isActive` | Room is active |
| `room.localParticipant` | Local participant |
| `room.getParticipants()` | All participants |
