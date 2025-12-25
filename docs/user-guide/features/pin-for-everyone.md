# Pin for Everyone

The "Pin for Everyone" feature allows hosts/moderators to pin a participant's video or screen share for all meeting attendees. This is useful for presentations, lectures, or when you want everyone to focus on a specific participant.

## PinType Enum

The `PinType` enum defines what type of media is being pinned:

```typescript
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

// PinType values:
// PinType.User = 1        - Pin a user's camera video
// PinType.ScreenShare = 2 - Pin a screen share
```

| Enum Value | Numeric Value | Description |
|------------|---------------|-------------|
| `PinType.User` | 1 | Pins the participant's camera video |
| `PinType.ScreenShare` | 2 | Pins the participant's screen share |

## Pinning/Unpinning

### Via Participant

```typescript
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

const localParticipant = room.localParticipant;
const targetStreamId = 'target-participant-stream-id';

// Pin a user's camera for everyone (default)
await localParticipant.pinForEveryone(targetStreamId);
// or explicitly:
await localParticipant.pinForEveryone(targetStreamId, PinType.User);

// Pin a screen share for everyone
await localParticipant.pinForEveryone(targetStreamId, PinType.ScreenShare);

// Unpin for everyone
await localParticipant.unPinForEveryone(targetStreamId);
// or with specific type:
await localParticipant.unPinForEveryone(targetStreamId, PinType.ScreenShare);
```

### Via Publisher

```typescript
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

const publisher = room.localParticipant.publisher;

// Pin user's camera
await publisher.pinForEveryone(targetStreamId, PinType.User);

// Pin screen share
await publisher.pinForEveryone(targetStreamId, PinType.ScreenShare);

// Unpin
await publisher.unPinForEveryone(targetStreamId, PinType.ScreenShare);
```

## Room State

After a pin event, the Room object maintains the current pin state:

```typescript
// Get pinned participant
const pinnedParticipant = room.pinnedParticipant; // Participant | null

// Get pin type
const pinnedPinType = room.pinnedPinType; // PinType | null (1 = User, 2 = ScreenShare)

// Get full room info
const roomInfo = room.getInfo();
console.log(roomInfo.pinnedParticipant); // userId or null
console.log(roomInfo.pinnedPinType);     // PinType or null
```

## Participant Pin State

Each participant also has a `pinType` property:

```typescript
// Check if participant is pinned and what type
const participant = room.participants.get(userId);
console.log(participant.isPinned);  // boolean
console.log(participant.pinType);   // PinType | null
```

## Event Handling

### Listening for Pin Events

```typescript
import { ROOM_EVENTS, PinType } from '@ermisnetwork/ermis-classroom-sdk';

// When someone is pinned for everyone
room.on(ROOM_EVENTS.PARTICIPANT_PINNED_FOR_EVERYONE, (event) => {
  console.log('Pinned participant:', event.participant.userId);
  console.log('Pin type:', event.pinType); // 1 = User, 2 = ScreenShare
  
  if (event.pinType === PinType.ScreenShare) {
    // Focus on screen share tile
  } else {
    // Focus on camera tile
  }
});

// When someone is unpinned for everyone
room.on(ROOM_EVENTS.PARTICIPANT_UNPINNED_FOR_EVERYONE, (event) => {
  console.log('Unpinned participant:', event.participant.userId);
  console.log('Pin type was:', event.pinType);
});
```

### Event Payload

```typescript
interface PinForEveryoneEvent {
  room: Room;
  participant: Participant;
  pinType: PinType; // 1 = User, 2 = ScreenShare
}
```

## UI Integration Guide

### Determining the Focused Tile

When integrating pin functionality, you need to handle both camera and screen share tiles correctly.

**Tile ID Convention:**
- Camera tile: `userId` (e.g., `"user-123"`)
- Screen share tile: `screen-${userId}` (e.g., `"screen-user-123"`)

### React Example

```tsx
import { useEffect, useState, useRef } from 'react';
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

function MeetingRoom() {
  const { currentRoom } = useErmisClassroom();
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);
  const prevPinnedRef = useRef<string | null>(null);

  // Get pinned info from room
  const pinnedParticipant = currentRoom?.pinnedParticipant || null;
  const pinnedPinType = currentRoom?.pinnedPinType || null;

  // Calculate the correct tile ID based on pinType
  const pinnedTileId = pinnedParticipant
    ? (pinnedPinType === PinType.ScreenShare 
        ? `screen-${pinnedParticipant.userId}` 
        : pinnedParticipant.userId)
    : null;

  // Sync pin state
  useEffect(() => {
    if (pinnedTileId !== prevPinnedRef.current) {
      setFocusedTileId(pinnedTileId);
      prevPinnedRef.current = pinnedTileId;
    }
  }, [pinnedTileId]);

  // Render tiles
  return (
    <div>
      {tiles.map(tile => (
        <VideoTile 
          key={tile.id}
          tile={tile}
          isFocused={tile.id === focusedTileId}
        />
      ))}
    </div>
  );
}
```

### Handling Pin Actions from UI

```tsx
function handlePinForEveryone(tileId: string) {
  // Determine if this is a screen share tile
  const isScreenShare = tileId.startsWith('screen-');
  const userId = isScreenShare ? tileId.replace('screen-', '') : tileId;
  const participant = currentRoom?.getParticipant(userId);
  
  if (participant) {
    const pinType = isScreenShare ? PinType.ScreenShare : PinType.User;
    localParticipant.pinForEveryone(participant.streamId, pinType);
  }
}

function handleUnpinForEveryone(tileId: string) {
  const isScreenShare = tileId.startsWith('screen-');
  const userId = isScreenShare ? tileId.replace('screen-', '') : tileId;
  const participant = currentRoom?.getParticipant(userId);
  
  if (participant) {
    const pinType = isScreenShare ? PinType.ScreenShare : PinType.User;
    localParticipant.unPinForEveryone(participant.streamId, pinType);
  }
}
```

## Using ErmisClassroomProvider (React)

The React provider handles pinType automatically:

```tsx
import { useErmisClassroom } from '@ermisnetwork/ermis-classroom-react';

function MeetingRoom() {
  const { togglePin } = useErmisClassroom();

  // togglePin automatically determines pinType based on tile ID
  // If tileId starts with "screen-", it uses PinType.ScreenShare
  // Otherwise, it uses PinType.User
  
  const handlePin = (tileId: string) => {
    togglePin(tileId, 'everyone', 'pin');
  };

  const handleUnpin = (tileId: string) => {
    togglePin(tileId, 'everyone', 'unpin');
  };
}
```

## Server Event Structure

When the server broadcasts a pin event, it includes:

```json
{
  "type": "pin_for_everyone",
  "participant": {
    "user_id": "user-123",
    "stream_id": "stream-abc",
    "pin_type": 2,
    ...
  },
  "pin_type": 2,
  "timestamp": "2025-01-01T00:00:00Z"
}
```

## Complete Integration Checklist

1. **Import PinType enum** from SDK
2. **Handle pin actions** with correct pinType based on tile type
3. **Listen to pin events** and read pinType from event
4. **Calculate correct tile ID** using pinType:
   - `PinType.User` → use `userId`
   - `PinType.ScreenShare` → use `screen-${userId}`
5. **Update UI focus** based on the calculated tile ID
6. **Track room state** via `room.pinnedParticipant` and `room.pinnedPinType`

## Troubleshooting

### Wrong tile is focused when pinning screen share

Make sure you're checking `pinnedPinType`:
```typescript
const tileId = pinnedPinType === PinType.ScreenShare 
  ? `screen-${pinnedParticipant.userId}` 
  : pinnedParticipant.userId;
```

### Pin not syncing across participants

Ensure you're using `pinForEveryone` (not local pin) and that the current user has host/moderator permissions.

### PinType is undefined

Always provide a fallback:
```typescript
const pinType = event.pinType ?? PinType.User;
```
