# Participant

The `Participant` class represents a user in a meeting room, handling both local and remote participants with media management.

> **Note**: Participants are created internally when joining a room or when remote users join. You don't create them directly.

## Accessing Participants

```typescript
// Local participant (you)
const me = room.localParticipant;

// Get specific participant by user ID
const participant = room.getParticipant('user-id');

// Get all participants
const participants = room.getParticipants();
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `userId` | `string` | Unique user identifier |
| `streamId` | `string` | Media stream identifier |
| `membershipId` | `string` | Room membership ID |
| `role` | `ParticipantRole` | Role in the room (host, co-host, member) |
| `roomId` | `string` | ID of the room |
| `isLocal` | `boolean` | Whether this is the local user |
| `name` | `string` | Display name |
| `isAudioEnabled` | `boolean` | Microphone is on |
| `isVideoEnabled` | `boolean` | Camera is on |
| `isHandRaised` | `boolean` | Hand is raised |
| `isPinned` | `boolean` | Participant is pinned |
| `publisher` | `Publisher \| null` | Publisher instance (local only) |
| `subscriber` | `Subscriber \| null` | Subscriber instance (remote only) |

## Media Controls (Local Participant)

### Toggle Microphone

```typescript
// Toggle microphone on/off
await participant.toggleMicrophone();
```

### Toggle Camera

```typescript
// Toggle camera on/off
await participant.toggleCamera();
```

### Toggle Remote Audio (Remote Participants)

```typescript
// Mute/unmute a remote participant's audio locally
await participant.toggleRemoteAudio();
```

## Hand Raise

```typescript
// Raise/lower hand
await participant.toggleRaiseHand();
```

## Pin Controls

### Pin Locally

```typescript
// Toggle pin for yourself only
participant.togglePin();
```

### Pin for Everyone (Host/Co-host Only)

```typescript
import { PinType } from '@ermisnetwork/ermis-classroom-sdk';

// Pin a participant for all viewers (default: PinType.User)
await participant.pinForEveryone('target-stream-id');

// Pin a screen share for everyone
await participant.pinForEveryone('target-stream-id', PinType.ScreenShare);

// Unpin for everyone
await participant.unPinForEveryone('target-stream-id');

// Unpin a screen share for everyone
await participant.unPinForEveryone('target-stream-id', PinType.ScreenShare);
```

**PinType Values:**
| Enum | Value | Description |
|------|-------|-------------|
| `PinType.User` | 1 | Pin a user's camera video |
| `PinType.ScreenShare` | 2 | Pin a screen share |

## Screen Sharing (Local Participant)

```typescript
// Start screen sharing
const screenStream = await participant.startScreenShare();

// Stop screen sharing
await participant.stopScreenShare();

// Toggle screen sharing
await participant.toggleScreenShare();
```

## Media Stream Updates

### Replace Media Stream

Replace the entire media stream (camera + mic):

```typescript
const newStream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: newCameraId },
  audio: { deviceId: newMicId },
});

const result = await participant.replaceMediaStream(newStream);
// result: { stream, videoOnlyStream, hasVideo, hasAudio }
```

### Update Media Stream

Update with a new stream while keeping existing configuration:

```typescript
await participant.updateMediaStream(newStream);
```

## Connection Status

```typescript
// Get current connection status
const status = participant.connectionStatus;
// 'connected' | 'connecting' | 'disconnected' | 'failed'
```

## Get Participant Info

```typescript
const info = participant.getInfo();
// {
//   userId: string,
//   streamId: string,
//   role: ParticipantRole,
//   isLocal: boolean,
//   name: string,
//   isAudioEnabled: boolean,
//   isVideoEnabled: boolean,
//   isHandRaised: boolean,
//   isPinned: boolean,
//   connectionStatus: string,
// }
```

## Helper Methods

```typescript
// Get display name
const name = participant.getName();

// Get display name with role indicator
const displayName = participant.getDisplayName();
// e.g., "John (Host)"
```

## Cleanup

```typescript
// Clean up resources (called automatically when leaving room)
participant.cleanup();
```
