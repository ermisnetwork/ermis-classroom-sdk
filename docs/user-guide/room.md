# Room

The `Room` class manages participants, media connections, and chat within a meeting room.

> **Note**: Rooms are created and returned by `MeetingClient.joinRoom()`. You don't typically create Room instances directly.

## Accessing a Room

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new MeetingClient({ ... });
await client.authenticate('user-id');

// Join room - returns a Room instance
const room = await client.joinRoom('ROOM123', mediaStream);

// Or get current room
const currentRoom = client.getCurrentRoom();
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Room ID |
| `name` | `string` | Room name |
| `code` | `string` | Room join code |
| `type` | `'main' \| 'breakout'` | Room type |
| `isActive` | `boolean` | Room is active |
| `localParticipant` | `Participant` | Local participant |
| `participants` | `Map<string, Participant>` | All participants |
| `pinnedParticipant` | `Participant \| null` | Pinned participant |
| `messages` | `ChatMessage[]` | Chat messages |
| `subRooms` | `Map<string, SubRoom>` | Breakout rooms |

## Participants

### Get Participants

```typescript
// Get all participants
const participants = room.getParticipants();

// Get specific participant by user ID
const participant = room.getParticipant('user-id');

// Access local participant
const me = room.localParticipant;
```

### Pin Participant

```typescript
// Pin a participant's video
room.pinParticipant('user-id');

// Unpin
room.unpinParticipant();

// Access pinned
const pinned = room.pinnedParticipant;
```

## Screen Sharing

```typescript
// Start screen share (SDK handles getDisplayMedia)
const screenStream = await room.startScreenShare();

// Stop screen share
await room.stopScreenShare();
```

## Custom Events

```typescript
// Send to all participants
await room.sendCustomEvent([], { action: 'highlight', data: 123 });

// Send to specific participants
await room.sendCustomEvent(['user1', 'user2'], { action: 'private' });

// Listen for custom events
const unsubscribe = room.onCustomEvent((event) => {
  console.log('From:', event.sender_stream_id);
  console.log('Data:', event.value);
});

// Stop listening
unsubscribe();
```

## Chat (Messaging)

```typescript
// Send message
const message = await room.sendMessage('Hello everyone!', {
  senderName: 'John',
});

// Update message
await room.updateMessage(message.id, 'Updated text');

// Delete message
await room.deleteMessage(message.id);

// Get messages
const messages = room.getMessages(100);

// Send typing indicator
await room.sendTypingIndicator(true);
await room.sendTypingIndicator(false);

// Get typing users
const typingUsers = room.getTypingUsers();
```

## Breakout Rooms

```typescript
// Create breakout rooms (main room only)
const rooms = await room.createBreakoutRoom({
  rooms: [
    { name: 'Group 1', participants: [{ userId: 'user1' }] },
    { name: 'Group 2', participants: [{ userId: 'user2' }] },
  ],
});

// Join assigned breakout room
await room.joinBreakoutRoom();

// Get sub rooms
const subRooms = await room.getSubRooms();

// Close all breakout rooms
await room.closeSubRoom();
```

## Leaving

```typescript
// Leave via room
await room.leave();

// Or via client
await client.leaveRoom();
```

## Events

| Event | Description |
|-------|-------------|
| `joining` | Joining room |
| `joined` | Joined room |
| `leaving` | Leaving room |
| `left` | Left room |
| `participantAdded` | Participant added |
| `participantRemoved` | Participant removed |
| `localStreamReady` | Local stream ready |
| `remoteStreamReady` | Remote stream ready |
| `error` | Error occurred |

See [Events](events.md) for full reference.
