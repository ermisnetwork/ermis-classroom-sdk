# Breakout Rooms

Create and manage breakout rooms (sub-rooms) for group discussions within your main meeting.

## Overview

Breakout rooms allow hosts to split participants into smaller groups for discussions, then bring everyone back to the main room.

## Creating Breakout Rooms

Only hosts can create breakout rooms:

```typescript
// Create breakout rooms with participant assignments
const rooms = await room.createBreakoutRoom({
  rooms: [
    { 
      name: 'Group 1', 
      participants: [{ userId: 'user1' }, { userId: 'user2' }] 
    },
    { 
      name: 'Group 2', 
      participants: [{ userId: 'user3' }, { userId: 'user4' }] 
    },
  ],
});
```

### Using MeetingClient

```typescript
// Create breakout rooms via client
const rooms = await client.createBreakoutRooms({
  rooms: [
    { name: 'Team A', participants: [{ userId: 'user1' }] },
    { name: 'Team B', participants: [{ userId: 'user2' }] },
  ],
});
```

## Joining Breakout Rooms

Participants join their assigned breakout room:

```typescript
// Join assigned breakout room
const breakoutRoom = await room.joinBreakoutRoom();
```

Or via client:

```typescript
const breakoutRoom = await client.joinBreakoutRoom();
```

## Getting Sub Rooms

```typescript
// Get list of available sub rooms
const subRooms = await room.getSubRooms();

subRooms.forEach(subRoom => {
  console.log(`${subRoom.name}: ${subRoom.participantCount} participants`);
});
```

## Sub Room Navigation

### Join Specific Sub Room

```typescript
// Join a specific sub room by ID
const subRoom = await room.joinSubRoom('sub-room-id');
```

### Leave Sub Room

```typescript
// Return to main room
await room.leaveSubRoom('sub-room-id');
```

### Switch Between Sub Rooms

```typescript
// Switch from current sub room to another
await client.switchSubRoom('target-sub-room-code');
```

### Return to Main Room

```typescript
// Return from any sub room to main room
const mainRoom = await client.returnToMainRoom();
```

## Closing Breakout Rooms

Only hosts can close breakout rooms:

```typescript
// Close all breakout rooms - participants return to main room
await room.closeSubRoom();
```

## SubRoom Class

The `SubRoom` class represents a breakout room:

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Sub room ID |
| `name` | `string` | Display name |
| `type` | `'main' \| 'sub'` | Room type |
| `parentRoomId` | `string \| null` | Parent main room ID |
| `isActive` | `boolean` | Room is active |
| `participants` | `Map<string, Participant>` | Participants in sub room |

### Methods

```typescript
// Get all participants in sub room
const participants = subRoom.getAllParticipants();

// Get participant count
const count = subRoom.getParticipantCount();

// Get specific participant
const participant = subRoom.getParticipant('user-id');

// Get sub room info
const info = subRoom.getInfo();
```

## Events

```typescript
// Sub room activated
subRoom.on('activated', ({ room }) => {
  console.log('Sub room is now active');
});

// Sub room deactivated
subRoom.on('deactivated', ({ room }) => {
  console.log('Sub room closed');
});

// Participant removed from sub room
subRoom.on('participantRemoved', ({ room, participant }) => {
  console.log(`${participant.userId} left sub room`);
});
```

## Complete Example

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new MeetingClient({ ... });
await client.authenticate('host-id');

const room = await client.joinRoom('MAIN123', mediaStream);

// Host creates breakout rooms
const breakoutRooms = await room.createBreakoutRoom({
  rooms: [
    { name: 'Discussion 1', participants: [{ userId: 'user1' }, { userId: 'user2' }] },
    { name: 'Discussion 2', participants: [{ userId: 'user3' }, { userId: 'user4' }] },
  ],
});

console.log('Created breakout rooms:', breakoutRooms.length);

// Later: close all breakout rooms
await room.closeSubRoom();
```

## Best Practices

1. **Limit sub room count** - Too many sub rooms can be hard to manage
2. **Balance participants** - Distribute participants evenly across rooms
3. **Set time limits** - Inform participants when breakout sessions will end
4. **Provide instructions** - Tell participants what to discuss in their groups
5. **Monitor progress** - Host can visit sub rooms to check on discussions
