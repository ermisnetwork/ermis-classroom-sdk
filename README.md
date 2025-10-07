# Ermis Classroom SDK - API Documentation

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Classes](#core-classes)
  - [ErmisClassroom](#ermisclassroom)
  - [ErmisClient](#ermisclient)
  - [Room](#room)
  - [SubRoom](#subroom)
  - [Participant](#participant)
- [Events](#events)
- [Types & Constants](#types--constants)
- [Advanced Usage](#advanced-usage)
- [Error Handling](#error-handling)

---

## Installation

```bash
npm install ermis-classroom-sdk
```

```javascript
// ES6 Modules
import ErmisClassroom from "ermis-classroom-sdk";

// CommonJS
const ErmisClassroom = require("ermis-classroom-sdk");

// Browser CDN
<script src="https://unpkg.com/ermis-classroom-sdk/dist/ermis-classroom.min.js"></script>;
```

---

## Quick Start

```javascript
import ErmisClassroom from "ermis-classroom-sdk";

// Create client
const client = ErmisClassroom.create({
  host: "your-server.com:9999",
  debug: true,
});

// Authenticate
await client.authenticate("teacher@school.com");

// Create and join room
const room = await client.createRoom({
  name: "Physics Class",
  type: ErmisClassroom.RoomTypes.MAIN,
});

// Listen to participant events
client.on(ErmisClassroom.events.PARTICIPANT_ADDED, ({ participant }) => {
  console.log(`${participant.userId} joined`);
});

// Set UI containers
const mainVideo = document.getElementById("main-video");
const sidebar = document.getElementById("sidebar-videos");
client.setUIContainers(mainVideo, sidebar);
```

---

## Core Classes

### ErmisClassroom

The main SDK class providing static methods for client creation and utilities.

#### Static Methods

##### `create(config: ClientConfig): ErmisClient`

Creates a new Ermis Classroom client.

**Parameters:**

- `config` (ClientConfig): Configuration options

```javascript
const client = ErmisClassroom.create({
  host: "server.com:9999",
  apiUrl: "https://server.com:9999/meeting", // optional
  webtpUrl: "https://server.com:4455/meeting/wt", // optional
  autoSaveCredentials: true, // default: true
  reconnectAttempts: 3, // default: 3
  reconnectDelay: 2000, // default: 2000ms
  debug: false, // default: false
});
```

##### `connect(serverUrl: string, userId: string, options?: ConnectionOptions): Promise<ErmisClient>`

Connect and authenticate in one step.

```javascript
const client = await ErmisClassroom.connect(
  "https://server.com:9999",
  "user@email.com",
  { autoSaveCredentials: true }
);
```

#### Static Properties

##### `version: string`

SDK version number.

##### `events: EventConstants`

Available event constants.

##### `MediaDevices: MediaDeviceUtils`

Media device utilities.

##### `RoomTypes: RoomTypeConstants`

Room type constants.

##### `ConnectionStatus: StatusConstants`

Connection status constants.

##### `ParticipantRoles: RoleConstants`

Participant role constants.

---

### ErmisClient

Main client class for managing authentication, rooms, and global state.

#### Constructor

```javascript
const client = new ErmisClient(config);
```

#### Methods

##### `authenticate(userId: string): Promise<User>`

Authenticate user and obtain access token.

```javascript
const user = await client.authenticate("teacher@school.com");
// Returns: { id: string, token: string, authenticatedAt: number }
```

##### `logout(): Promise<void>`

Logout user and cleanup resources.

```javascript
await client.logout();
```

##### `createRoom(config: RoomConfig): Promise<Room>`

Create a new room.

```javascript
const room = await client.createRoom({
  name: "Physics Class",
  type: "main", // 'main' | 'breakout' | 'presentation'
  autoJoin: true, // default: true
});
```

##### `joinRoom(roomCode: string): Promise<JoinResult>`

Join an existing room by code.

```javascript
const result = await client.joinRoom("abc1-def2-ghi3");
// Returns: { room: Room, localParticipant: Participant, participants: Participant[] }
```

##### `leaveRoom(): Promise<void>`

Leave current room.

```javascript
await client.leaveRoom();
```

##### `getRooms(options?: ListOptions): Promise<RoomInfo[]>`

Get available rooms.

```javascript
const rooms = await client.getRooms({
  page: 1,
  perPage: 20,
});
```

##### `createSubRoom(config: SubRoomConfig): Promise<SubRoom>`

Create a sub room (breakout room).

```javascript
const subRoom = await client.createSubRoom({
  name: "Group 1",
  type: "breakout",
  maxParticipants: 5,
  duration: 30, // minutes
  autoReturn: true,
});
```

##### `joinSubRoom(subRoomCode: string): Promise<JoinResult>`

Join a sub room.

```javascript
await client.joinSubRoom("sub-room-code");
```

##### `returnToMainRoom(): Promise<Room>`

Return to main room from sub room.

```javascript
const mainRoom = await client.returnToMainRoom();
```

##### `switchSubRoom(targetSubRoomCode: string): Promise<JoinResult>`

Switch between sub rooms.

```javascript
await client.switchSubRoom("other-sub-room-code");
```

##### `setUIContainers(mainVideoArea: HTMLElement, sidebarArea: HTMLElement): void`

Set UI containers for video rendering.

```javascript
client.setUIContainers(
  document.getElementById("main-video"),
  document.getElementById("sidebar-videos")
);
```

#### Properties

##### `getCurrentRoom(): Room | null`

Get current active room.

##### `getRoom(roomId: string): Room | null`

Get room by ID.

##### `getState(): ClientState`

Get current client state.

##### `getConfig(): ClientConfig`

Get client configuration.

#### Events

Extends EventEmitter. See [Events](#events) section for available events.

---

### Room

Represents a meeting room with participants and media management.

#### Constructor

```javascript
// Usually created by ErmisClient, not directly
const room = new Room(config);
```

#### Methods

##### `join(userId: string): Promise<JoinResult>`

Join this room.

```javascript
const result = await room.join("user@email.com");
```

##### `leave(): Promise<void>`

Leave this room.

```javascript
await room.leave();
```

##### `createSubRoom(config: SubRoomConfig): Promise<SubRoom>`

Create a sub room (main rooms only).

```javascript
const subRoom = await room.createSubRoom({
  name: "Breakout 1",
  maxParticipants: 4,
});
```

##### `getSubRooms(): Promise<SubRoom[]>`

Get all sub rooms.

```javascript
const subRooms = await room.getSubRooms();
```

##### `addParticipant(memberData: MemberData, userId: string): Participant`

Add a participant to the room.

##### `removeParticipant(userId: string): Participant | null`

Remove a participant from the room.

##### `getParticipant(userId: string): Participant | null`

Get participant by user ID.

##### `getParticipants(): Participant[]`

Get all participants.

##### `pinParticipant(userId: string): boolean`

Pin a participant's video.

```javascript
room.pinParticipant("user@email.com");
```

##### `unpinParticipant(): boolean`

Unpin currently pinned participant.

```javascript
room.unpinParticipant();
```

##### `setUIContainers(mainVideoArea: HTMLElement, sidebarArea: HTMLElement): void`

Set UI containers for this room.

##### `renderParticipantTiles(): void`

Render all participant video tiles.

```javascript
room.renderParticipantTiles();
```

#### Properties

##### `id: string`

Room ID.

##### `name: string`

Room name.

##### `code: string`

Room join code.

##### `type: string`

Room type ('main', 'breakout', etc.).

##### `isActive: boolean`

Whether room is currently active.

##### `participants: Map<string, Participant>`

Participants map.

##### `localParticipant: Participant | null`

Local participant.

##### `pinnedParticipant: Participant | null`

Currently pinned participant.

##### `getInfo(): RoomInfo`

Get room information object.

#### Events

- `joined`: Room joined successfully
- `left`: Room left
- `participantAdded`: New participant added
- `participantRemoved`: Participant removed
- `participantPinned`: Participant pinned
- `participantUnpinned`: Participant unpinned
- `subRoomCreated`: Sub room created
- `error`: Error occurred

---

### SubRoom

Extends Room with additional breakout room functionality.

#### Constructor

```javascript
const subRoom = new SubRoom(config);
```

#### Methods (Additional to Room)

##### `joinFromMain(userId: string): Promise<JoinResult>`

Join sub room from main room.

```javascript
await subRoom.joinFromMain("user@email.com");
```

##### `returnToMainRoom(): Promise<Room>`

Return to main room.

```javascript
const mainRoom = await subRoom.returnToMainRoom();
```

##### `switchToSubRoom(targetSubRoom: SubRoom): Promise<JoinResult>`

Switch to another sub room.

```javascript
await subRoom.switchToSubRoom(otherSubRoom);
```

##### `inviteParticipant(userId: string): Promise<InviteResult>`

Invite participant to this sub room.

```javascript
await subRoom.inviteParticipant("student@email.com");
```

##### `assignParticipant(userId: string): Promise<AssignResult>`

Assign participant to this sub room (host action).

```javascript
await subRoom.assignParticipant("student@email.com");
```

##### `broadcastMessage(message: string, type?: string): Promise<BroadcastResult>`

Broadcast message to all participants.

```javascript
await subRoom.broadcastMessage("Discussion ends in 5 minutes", "warning");
```

##### `getRemainingTime(): number | null`

Get remaining time in minutes.

```javascript
const remainingMinutes = subRoom.getRemainingTime();
```

##### `extendDuration(additionalMinutes: number): void`

Extend sub room duration.

```javascript
subRoom.extendDuration(15); // Add 15 more minutes
```

##### `setMaxParticipants(limit: number): void`

Set participant limit.

```javascript
subRoom.setMaxParticipants(8);
```

#### Properties (Additional to Room)

##### `parentRoom: Room`

Reference to parent room.

##### `maxParticipants: number`

Maximum participants allowed.

##### `duration: number | null`

Duration in minutes (null = unlimited).

##### `startTime: number | null`

Start timestamp.

##### `autoReturn: boolean`

Auto return to main room when empty.

##### `isTemporary: boolean`

Whether room is temporary.

#### Utility Methods

##### `isFull(): boolean`

Check if sub room is full.

##### `isEmpty(): boolean`

Check if sub room is empty.

##### `hasExpired(): boolean`

Check if sub room has expired.

##### `getStats(): SubRoomStats`

Get comprehensive sub room statistics.

---

### Participant

Represents a participant in a meeting room.

#### Constructor

```javascript
const participant = new Participant(config);
```

#### Methods

##### `createVideoTile(): HTMLElement`

Create video tile DOM element.

```javascript
const tile = participant.createVideoTile();
document.body.appendChild(tile);
```

##### `toggleMicrophone(): Promise<void>`

Toggle microphone (local participant only).

```javascript
await participant.toggleMicrophone();
```

##### `toggleCamera(): Promise<void>`

Toggle camera (local participant only).

```javascript
await participant.toggleCamera();
```

##### `toggleRemoteAudio(): Promise<void>`

Toggle remote participant's audio.

```javascript
await participant.toggleRemoteAudio();
```

##### `togglePin(): void`

Toggle pin status.

```javascript
participant.togglePin();
```

##### `setConnectionStatus(status: string): void`

Update connection status.

##### `setPublisher(publisher: Publisher): void`

Set publisher instance (local participant).

##### `setSubscriber(subscriber: Subscriber): void`

Set subscriber instance (remote participant).

##### `cleanup(): void`

Cleanup participant resources.

#### Properties

##### `userId: string`

User identifier.

##### `streamId: string`

Stream identifier.

##### `membershipId: string`

Membership identifier.

##### `role: string`

Participant role ('owner', 'moderator', 'participant').

##### `isLocal: boolean`

Whether this is the local participant.

##### `isAudioEnabled: boolean`

Audio enabled state.

##### `isVideoEnabled: boolean`

Video enabled state.

##### `isPinned: boolean`

Pin state.

##### `connectionStatus: string`

Connection status.

##### `videoElement: HTMLVideoElement`

Video element.

##### `tile: HTMLElement`

Video tile element.

#### Utility Methods

##### `getDisplayName(): string`

Get display name with role.

##### `getInfo(): ParticipantInfo`

Get participant information object.

#### Events

- `audioToggled`: Audio state changed
- `videoToggled`: Video state changed
- `pinToggled`: Pin state changed
- `statusChanged`: Connection status changed
- `tileCreated`: Video tile created
- `error`: Error occurred
- `cleanup`: Participant cleaned up

---

## Events

### Client Events

```javascript
client.on("authenticated", ({ user }) => {
  console.log("User authenticated:", user.id);
});

client.on("authenticationFailed", ({ userId, error }) => {
  console.error("Auth failed for", userId, error);
});

client.on("loggedOut", () => {
  console.log("User logged out");
});

client.on("connectionStatusChanged", ({ status }) => {
  console.log("Connection status:", status);
});
```

### Room Events

```javascript
client.on("roomCreated", ({ room }) => {
  console.log("Room created:", room.name);
});

client.on("roomJoined", ({ room, joinResult }) => {
  console.log("Joined room:", room.name);
  room.renderParticipantTiles();
});

client.on("roomLeft", ({ room }) => {
  console.log("Left room:", room.name);
});
```

### Participant Events

```javascript
client.on("participantAdded", ({ room, participant }) => {
  console.log(`${participant.userId} joined ${room.name}`);

  // Listen to participant events
  participant.on("audioToggled", ({ participant, enabled }) => {
    console.log(`${participant.userId} ${enabled ? "unmuted" : "muted"}`);
  });

  participant.on("pinToggled", ({ participant, pinned }) => {
    if (pinned) {
      console.log(`${participant.userId} is now pinned`);
    }
  });
});

client.on("participantRemoved", ({ room, participant }) => {
  console.log(`${participant.userId} left ${room.name}`);
});
```

### Sub Room Events

```javascript
client.on("subRoomCreated", ({ subRoom, parentRoom }) => {
  console.log(`Sub room ${subRoom.name} created`);
});

client.on("subRoomJoined", ({ subRoom, parentRoom }) => {
  console.log(`Joined sub room: ${subRoom.name}`);
});

client.on("subRoomSwitched", ({ fromSubRoom, toSubRoom }) => {
  console.log(`Switched from ${fromSubRoom.name} to ${toSubRoom.name}`);
});
```

### Error Events

```javascript
client.on("error", ({ error, action, room, participant }) => {
  console.error(`Error in ${action}:`, error);
});
```

---

## Types & Constants

### Room Types

```javascript
ErmisClassroom.RoomTypes = {
  MAIN: "main",
  BREAKOUT: "breakout",
  PRESENTATION: "presentation",
  DISCUSSION: "discussion",
};
```

### Connection Status

```javascript
ErmisClassroom.ConnectionStatus = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
};
```

### Participant Roles

```javascript
ErmisClassroom.ParticipantRoles = {
  OWNER: "owner",
  MODERATOR: "moderator",
  PARTICIPANT: "participant",
  OBSERVER: "observer",
};
```

### Event Constants

```javascript
ErmisClassroom.events = {
  // Client events
  CLIENT_AUTHENTICATED: "authenticated",
  CLIENT_AUTHENTICATION_FAILED: "authenticationFailed",
  CLIENT_LOGGED_OUT: "loggedOut",
  CLIENT_CONNECTION_STATUS_CHANGED: "connectionStatusChanged",

  // Room events
  ROOM_CREATED: "roomCreated",
  ROOM_JOINED: "roomJoined",
  ROOM_LEFT: "roomLeft",

  // Participant events
  PARTICIPANT_ADDED: "participantAdded",
  PARTICIPANT_REMOVED: "participantRemoved",
  PARTICIPANT_PINNED: "participantPinned",
  PARTICIPANT_UNPINNED: "participantUnpinned",

  // Sub room events
  SUB_ROOM_CREATED: "subRoomCreated",
  SUB_ROOM_JOINED: "subRoomJoined",
  SUB_ROOM_SWITCHED: "subRoomSwitched",

  // Error events
  ERROR: "error",
};
```

---

## Advanced Usage

### Media Device Management

```javascript
// Get available devices
const devices = await ErmisClassroom.MediaDevices.getDevices();
console.log("Cameras:", devices.cameras);
console.log("Microphones:", devices.microphones);
console.log("Speakers:", devices.speakers);

// Check permissions
const permissions = await ErmisClassroom.MediaDevices.checkPermissions();
if (permissions.camera?.state !== "granted") {
  // Request permission
  await ErmisClassroom.MediaDevices.getUserMedia({ video: true });
}

// Get user media with constraints
const stream = await ErmisClassroom.MediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
  audio: { sampleRate: 48000 },
});
```

### Custom Storage Implementation

```javascript
const customStorage = {
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => sessionStorage.removeItem(key),
};

const client = ErmisClassroom.create({
  host: "server.com:9999",
  storage: customStorage,
});
```

### Auto-render UI Integration

```javascript
// Set UI containers
const mainVideo = document.getElementById("main-video");
const sidebar = document.getElementById("sidebar-videos");
client.setUIContainers(mainVideo, sidebar);

// Auto-render when events occur
client.on(ErmisClassroom.events.ROOM_JOINED, ({ room }) => {
  room.renderParticipantTiles();
});

client.on(ErmisClassroom.events.PARTICIPANT_ADDED, ({ room }) => {
  room.renderParticipantTiles();
});

client.on(ErmisClassroom.events.PARTICIPANT_REMOVED, ({ room }) => {
  room.renderParticipantTiles();
});
```

### Breakout Room Management

```javascript
// Create multiple breakout rooms
const breakoutRooms = await Promise.all([
  client.createSubRoom({ name: "Group 1", maxParticipants: 4 }),
  client.createSubRoom({ name: "Group 2", maxParticipants: 4 }),
  client.createSubRoom({ name: "Group 3", maxParticipants: 4 }),
]);

// Auto-assign participants
const participants = room.getParticipants();
for (let i = 0; i < participants.length; i++) {
  const targetRoom = breakoutRooms[i % breakoutRooms.length];
  if (!targetRoom.isFull()) {
    await targetRoom.assignParticipant(participants[i].userId);
  }
}

// Monitor breakout rooms
breakoutRooms.forEach((subRoom) => {
  subRoom.on("expired", async ({ subRoom }) => {
    console.log(`${subRoom.name} has expired`);
    // Participants automatically return to main room
  });

  subRoom.on("participantLimitExceeded", ({ subRoom, current, limit }) => {
    console.warn(`${subRoom.name} is over capacity: ${current}/${limit}`);
  });
});
```

### Configuration Options

```javascript
const client = ErmisClassroom.create({
  // Server configuration
  host: "server.com:9999",
  apiUrl: "https://server.com:9999/meeting",
  webtpUrl: "https://server.com:4455/meeting/wt",

  // Authentication
  autoSaveCredentials: true,

  // Connection
  reconnectAttempts: 5,
  reconnectDelay: 3000,

  // Debug
  debug: true,

  // Custom storage
  storage: customStorageImplementation,

  // Media defaults
  defaultVideoConfig: {
    width: 1920,
    height: 1080,
    framerate: 30,
    bitrate: 2_000_000,
  },
  defaultAudioConfig: {
    sampleRate: 48000,
    channels: 2,
  },
});
```

---

## Error Handling

### Try-Catch Pattern

```javascript
try {
  await client.authenticate("user@email.com");
  const room = await client.createRoom({ name: "Test Room" });
} catch (error) {
  console.error("Operation failed:", error.message);

  if (error.message.includes("authentication")) {
    // Handle auth errors
  } else if (error.message.includes("room")) {
    // Handle room errors
  }
}
```

### Event-Based Error Handling

```javascript
client.on("error", ({ error, action, room, participant }) => {
  console.error(`Error in ${action}:`, error);

  switch (action) {
    case "authenticate":
      showLoginError(error.message);
      break;
    case "joinRoom":
      showRoomJoinError(error.message);
      break;
    case "createSubRoom":
      showSubRoomError(error.message);
      break;
    default:
      showGenericError(error.message);
  }
});

client.on("authenticationFailed", ({ userId, error }) => {
  showMessage(`Login failed for ${userId}: ${error.message}`, "error");
});

client.on("reconnectionFailed", () => {
  showMessage("Connection lost. Please refresh the page.", "error");
});
```

### Participant-Level Error Handling

```javascript
client.on("participantAdded", ({ participant }) => {
  participant.on("error", ({ participant, error, action }) => {
    console.error(`${participant.userId} error in ${action}:`, error);

    if (action === "toggleMicrophone") {
      showMessage(
        `Failed to toggle microphone for ${participant.userId}`,
        "warning"
      );
    }
  });
});
```

### Cleanup on Page Unload

```javascript
window.addEventListener("beforeunload", async () => {
  try {
    await client.cleanup();
  } catch (error) {
    console.error("Cleanup error:", error);
  }
});

// Or using visibility API
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    // Page is being hidden, cleanup resources
    await client.getCurrentRoom()?.leave();
  }
});
```

---

This documentation covers the complete API surface of the refactored Ermis Classroom SDK. The modular architecture provides a clean, event-driven interface similar to modern WebRTC SDKs while maintaining the specific functionality needed for virtual classroom scenarios.
