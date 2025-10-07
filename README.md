# Ermis Classroom SDK

<div align="center">

![Version](https://img.shields.io/npm/v/ermis-classroom-sdk.svg?style=popout&colorB=blue)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)

A powerful and easy-to-use SDK for building online classroom applications with real-time video conferencing, breakout rooms, and participant management.

[Documentation](#documentation) • [Installation](#installation) • [Quick Start](#quick-start) • [Examples](#examples) • [API Reference](#api-reference)

</div>

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [Client Initialization](#client-initialization)
  - [Room Management](#room-management)
  - [Sub-Room Management](#sub-room-management)
  - [Participant Management](#participant-management)
  - [Media Devices](#media-devices)
  - [Events](#events)
- [Best Practices](#best-practices)

---

## Features

✨ **Core Features**

- 🎥 **Real-time Video Conferencing** - WebRTC-based video and audio streaming
- 👥 **Participant Management** - Track and manage participants with roles
- 🏫 **Main Rooms** - Create and manage main classroom sessions
- 📦 **Breakout Rooms** - Split participants into smaller sub-rooms
- 📌 **Pin Participants** - Highlight specific participants
- 🎤 **Media Controls** - Toggle camera/microphone for self and others
- 🔄 **Auto Reconnection** - Automatic reconnection on network issues
- 📱 **Device Management** - List and select cameras/microphones
- 🎯 **Event-Driven Architecture** - React to all classroom events
- 🛡️ **TypeScript Support** - Full type definitions included

---

## Installation

```bash
npm install ermis-classroom-sdk
```

Or with yarn:

```bash
yarn add ermis-classroom-sdk
```

---

## Quick Start

### 1. Initial SDK

```javascript
import ErmisClassroom from 'ermis-classroom-sdk';

const client = await ErmisClassroom.create(
  {
    host: "your-server.com"
    debug: true,
    webtpUrl: "https://your-webtpUrl.com"
  }
);

client.manualAuthenticate('your-user-id', 'your-token');

console.log('client', client);
```

### 2. Create or Join a Room

```javascript
// Create a new room
const room = await client.createRoom('Math Class 101', ErmisClassroom.RoomTypes.MAIN);
console.log('Room code:', room.code);

// Or join an existing room
const result = await client.joinRoom('ROOM-CODE-123');
console.log('Joined room:', result.room.name);
console.log('Participants:', result.participants.length);
```

### 3. Listen to Events

```javascript
// Listen for new participants
client.on(ErmisClassroom.events.PARTICIPANT_ADDED, (event) => {
  console.log(`ErmisClassroom.events.PARTICIPANT_ADDED`, event);
});

// Handle video streams
client.on(ErmisClassroom.events.LOCAL_STREAM_READY, (event) => {
  document.getElementById('my-video').srcObject = event.stream;
});

client.on(ErmisClassroom.events.REMOTE_STREAM_READY, (event) => {
  const video = document.createElement('video');
  video.srcObject = event.stream;
  video.autoplay = true;
  document.getElementById('videos').appendChild(video);
});
```

### 4. Control Media

```javascript
const currentRoom = client.getCurrentRoom();
const me = currentRoom.localParticipant;

// Toggle microphone
await me.toggleMicrophone();

// Toggle camera
await me.toggleCamera();

// Check status
console.log('Mic:', me.isAudioEnabled);
console.log('Camera:', me.isVideoEnabled);
```

---

## Core Concepts

### Room

Represents a classroom session where participants can interact.

```javascript
const room = await client.createRoom('My Classroom', ErmisClassroom.RoomTypes.MAIN);
```

### SubRoom

A breakout room for small group discussions.

```javascript
const subRoom = await client.createSubRoom({
  name: 'Group 1',
  maxParticipants: 5,
  duration: 30 // minutes
});
```

### Participant

Represents a user in a room with their media state.

```javascript
const participant = room.getParticipant('user-id');
console.log(participant.isAudioEnabled);
console.log(participant.isVideoEnabled);
```

---

## API Reference

### Client Initialization

#### `ErmisClassroom.connect(serverUrl, userId, options)`

Quick connect and authenticate.

```javascript
const client = await ErmisClassroom.connect(
  'https://classroom.example.com',
  'user-123',
  {
    reconnectAttempts: 5,
    reconnectDelay: 3000,
    debug: true,
    defaultVideoConfig: {
      width: 1280,
      height: 720,
      framerate: 30
    }
  }
);
```

#### `ErmisClassroom.create(config)`

Create a client instance without connecting.

```javascript
const client = ErmisClassroom.create({
  host: 'classroom.example.com',
  apiUrl: 'https://api.example.com',
  webtpUrl: 'wss://webtp.example.com',
  reconnectAttempts: 5,
  debug: true
});

// Authenticate later
await client.authenticate('user-123');
```

### Room Management

#### `client.createRoom(config)`

Create a new room.

```javascript
const room = await client.createRoom('Science Class', ErmisClassroom.RoomTypes.MAIN);
```

**Room Types:**
- `MAIN` - Main classroom
- `BREAKOUT` - Breakout session
- `PRESENTATION` - Presentation mode
- `DISCUSSION` - Discussion mode

#### `client.joinRoom(roomCode)`

Join an existing room.

```javascript
const result = await client.joinRoom('ABC-123');

// result contains:
// - room: Room instance
// - localParticipant: Your participant object
// - participants: Array of other participants
```

#### `client.leaveRoom()`

Leave the current room.

```javascript
await client.leaveRoom();
```

#### `client.getRooms(options)`

Get list of available rooms.

```javascript
const rooms = await client.getRooms({
  page: 1,
  perPage: 20,
});

rooms.forEach(room => {
  console.log(`${room.name} - ${room.participantCount} participants`);
});
```

#### `client.getCurrentRoom()`

Get the current room instance.

```javascript
const room = client.getCurrentRoom();
if (room) {
  console.log('Current room:', room.name);
}
```

### Sub-Room Management

#### `client.createSubRoom(config)`

Create a breakout room.

```javascript
const subRoom = await client.createSubRoom({
  name: 'Group 1',
  type: ErmisClassroom.RoomTypes.BREAKOUT,
  maxParticipants: 10,
  duration: 30, // minutes
  autoReturn: true // Auto return to main when time expires
});
```

#### `client.joinSubRoom(subRoomCode)`

Join a breakout room.

```javascript
const result = await client.joinSubRoom('SUB-ABC-123');
```

#### `client.switchSubRoom(targetSubRoomCode)`

Switch from one sub-room to another.

```javascript
const result = await client.switchSubRoom('SUB-XYZ-789');
```

#### `client.returnToMainRoom()`

Return to the main room from a sub-room.

```javascript
const mainRoom = await client.returnToMainRoom();
```

<!-- ### SubRoom Instance Methods

```javascript
// Get list of sub-rooms in current main room
const subRooms = await currentRoom.getSubRooms();

const subRoom = subRooms[0];

// Check time remaining
const remaining = subRoom.getRemainingTime(); // seconds

// Check status
console.log('Is full?', subRoom.isFull());
console.log('Is empty?', subRoom.isEmpty());
console.log('Has expired?', subRoom.hasExpired());

// Extend duration
subRoom.extendDuration(15); // Add 15 minutes

// Change max participants
subRoom.setMaxParticipants(15);

// Invite participant
await subRoom.inviteParticipant('user-id');

// Assign participant
await subRoom.assignParticipant('user-id');

// Broadcast message
await subRoom.broadcastMessage('5 minutes remaining!', 'warning');

// Get statistics
const stats = subRoom.getStats();
console.log(stats);
``` -->

### Participant Management

#### Local Participant (Yourself)

```javascript
const room = client.getCurrentRoom();
const me = room.localParticipant;

// Toggle microphone
await me.toggleMicrophone();

// Toggle camera
await me.toggleCamera();

// Check states
console.log('Audio enabled:', me.isAudioEnabled);
console.log('Video enabled:', me.isVideoEnabled);
console.log('Role:', me.role);

// Get full info
const info = me.getInfo();
```

#### Remote Participants

```javascript
const participant = room.getParticipant('user-id');

// Mute their audio locally (only for you)
await participant.toggleRemoteAudio();

// Toggle pin
participant.togglePin();

// Get display name
const name = participant.getDisplayName();

// Get participant info
const info = participant.getInfo();

// Listen to participant events
participant.on(ErmisClassroom.events.AUDIO_TOGGLED, (enabled) => {
  console.log(`${participant.userId} audio:`, enabled);
});

participant.on(ErmisClassroom.events.VIDEO_TOGGLED, (enabled) => {
  console.log(`${participant.userId} video:`, enabled);
});
```

**Participant Roles:**
- `OWNER` - Room owner
- `MODERATOR` - Moderator with special permissions
- `PARTICIPANT` - Regular participant
- `OBSERVER` - Observer (view only)

### Media Devices

#### Get Available Devices

```javascript
const devices = await ErmisClassroom.MediaDevices.getDevices();

console.log('Cameras:', devices.cameras);
console.log('Microphones:', devices.microphones);
console.log('Speakers:', devices.speakers);

// Display in UI
devices.cameras.forEach(camera => {
  console.log(`${camera.label} (${camera.deviceId})`);
});
```

#### Get User Media Stream

```javascript
const stream = await ErmisClassroom.MediaDevices.getUserMedia({
  video: {
    deviceId: 'camera-device-id',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  },
  audio: {
    deviceId: 'microphone-device-id',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
});

// Use the stream
document.getElementById('preview').srcObject = stream;
```

#### Check Permissions

```javascript
const permissions = await ErmisClassroom.MediaDevices.checkPermissions();

console.log('Camera permission:', permissions.camera?.state);
console.log('Microphone permission:', permissions.microphone?.state);

// States: 'granted', 'denied', 'prompt'
```

### Events

#### Available Events

```javascript
// Client Events
ErmisClassroom.events.CLIENT_AUTHENTICATED
ErmisClassroom.events.CLIENT_AUTHENTICATION_FAILED
ErmisClassroom.events.CLIENT_LOGGED_OUT
ErmisClassroom.events.CLIENT_CONNECTION_STATUS_CHANGED

// Room Events
ErmisClassroom.events.ROOM_CREATED
ErmisClassroom.events.ROOM_JOINED
ErmisClassroom.events.ROOM_LEFT

// Participant Events
ErmisClassroom.events.PARTICIPANT_ADDED
ErmisClassroom.events.PARTICIPANT_REMOVED
ErmisClassroom.events.PARTICIPANT_PINNED
ErmisClassroom.events.PARTICIPANT_UNPINNED
ErmisClassroom.events.AUDIO_TOGGLED
ErmisClassroom.events.VIDEO_TOGGLED

// Sub-Room Events
ErmisClassroom.events.SUB_ROOM_CREATED
ErmisClassroom.events.SUB_ROOM_JOINED
ErmisClassroom.events.SUB_ROOM_LEFT
ErmisClassroom.events.SUB_ROOM_SWITCHED

// Media Stream Events
ErmisClassroom.events.LOCAL_STREAM_READY
ErmisClassroom.events.REMOTE_STREAM_READY
ErmisClassroom.events.STREAM_REMOVED

// Error Events
ErmisClassroom.events.ERROR
```

#### Event Handling

```javascript
// Add event listener
client.on(ErmisClassroom.events.PARTICIPANT_ADDED, (participant) => {
  console.log('New participant:', participant.userId);
});

// Remove event listener
const handler = (participant) => { /* ... */ };
client.on(ErmisClassroom.events.PARTICIPANT_ADDED, handler);
client.off(ErmisClassroom.events.PARTICIPANT_ADDED, handler);

// One-time event
client.once(ErmisClassroom.events.ROOM_JOINED, (result) => {
  console.log('Joined once!');
});

// Remove all listeners for an event
client.removeAllListeners(ErmisClassroom.events.PARTICIPANT_ADDED);
```

---

## Best Practices

### 1. Error Handling

Always wrap SDK calls in try-catch blocks:

```javascript
try {
  await client.joinRoom('ROOM-CODE');
} catch (error) {
  console.error('Failed to join room:', error);
  // Show user-friendly