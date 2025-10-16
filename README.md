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
- [Browser Detection & Transport](#browser-detection--transport)
- [Media Stream Management](#media-stream-management)
  - [Overview](#overview)
  - [Supported Configurations](#supported-configurations)
  - [Getting Media Streams](#getting-media-streams)
  - [Device Selection](#device-selection)
  - [Switching Devices](#switching-devices)
  - [Screen Sharing](#screen-sharing)
  - [Adding Tracks Dynamically](#adding-tracks-dynamically)
  - [Observer Mode](#observer-mode-no-cameramic)
  - [Graceful Degradation](#graceful-degradation)
  - [Error Handling](#error-handling)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [Client Initialization](#client-initialization)
  - [Room Management](#room-management)
  - [Sub-Room Management](#sub-room-management)
  - [Participant Management](#participant-management)
  - [Media Devices](#media-devices-optional-helpers)
  - [Events](#events)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Features

✨ **Core Features**

- 🎥 **Real-time Video Conferencing** - WebRTC-based video and audio streaming
- 👥 **Participant Management** - Track and manage participants with roles
- 🏫 **Main Rooms** - Create and manage main classroom sessions
- 📦 **Breakout Rooms** - Split participants into smaller sub-rooms
- 📌 **Pin Participants** - Highlight specific participants
- 🎤 **Media Controls** - Toggle camera/microphone for self and others
- 💬 **Real-time Chat** - Send messages, typing indicators, message management
- 🔄 **Auto Reconnection** - Automatic reconnection on network issues
- 📱 **Device Management** - List and select cameras/microphones
- 🎯 **Event-Driven Architecture** - React to all classroom events
- 🛡️ **TypeScript Support** - Full type definitions included
- 🌐 **Smart Transport Selection** - Auto-detect browser and use optimal transport (WebRTC for Safari, WebTransport for others)

---

## Installation

```bash
npm install @ermisnetwork/ermis-classroom-sdk
```

Or with yarn:

```bash
yarn add @ermisnetwork/ermis-classroom-sdk
```

---

## Quick Start

> **✨ New:** You can now provide a custom MediaStream when joining rooms OR let the SDK auto-request media. You also have full control to change media sources while live!

### 1. Get Media Stream (Optional)

You have two options:

**Option A: Provide Custom MediaStream (Recommended)**
```javascript
// Full video call (video + audio)
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    deviceId: { exact: selectedCameraId }, // Select specific device
    width: 1280,
    height: 720,
    frameRate: 30
  },
  audio: {
    deviceId: { exact: selectedMicId }, // Select specific device
    echoCancellation: true,
    noiseSuppression: true
  }
});

// Preview before joining
document.getElementById('local-video').srcObject = stream;

// Join with custom stream
await client.joinRoom('ROOM-CODE-123', stream);
```

**Option B: Let SDK Auto-Request Media**
```javascript
// SDK will automatically request default camera/microphone
await client.joinRoom('ROOM-CODE-123');
```

**Other Configurations:**
```javascript
// Audio only (no camera)
const audioStream = await navigator.mediaDevices.getUserMedia({
  video: false,
  audio: { echoCancellation: true, noiseSuppression: true }
});

// Video only (no microphone)
const videoStream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
  audio: false
});
```

### 2. Initialize SDK

```javascript
import ErmisClassroom from 'ermis-classroom-sdk';

const client = await ErmisClassroom.create({
  host: "your-server.com",
  debug: true,
  webtpUrl: "https://your-webtpUrl.com"
});

client.manualAuthenticate('your-user-id', 'your-token');

console.log('client', client);
```

### 3. Create or Join a Room

```javascript
// Create a new room (with media stream for auto-join)
const room = await client.createRoom({
  name: 'Math Class 101',
  type: ErmisClassroom.RoomTypes.MAIN,
  mediaStream // Required for auto-join
});
console.log('Room code:', room.code);

// Or join an existing room
const result = await client.joinRoom('ROOM-CODE-123', mediaStream);
console.log('Joined room:', result.room.name);
console.log('Participants:', result.participants.length);
```

### 4. Listen to Events

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

### 5. Control Media

```javascript
const currentRoom = client.getCurrentRoom();
const me = currentRoom.localParticipant;

// Toggle microphone
await me.toggleMicrophone();

// Toggle camera
await me.toggleCamera();

// Toggle raise hand
await me.toggleRaiseHand();

// Check status
console.log('Mic:', me.isAudioEnabled);
console.log('Camera:', me.isVideoEnabled);
console.log('Hand raised:', me.isHandRaised);

// Switch camera/microphone
const newStream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: newCameraId },
  audio: { deviceId: newMicId }
});
me.updateMediaStream(newStream);
```

### 6. Send Chat Messages

```javascript
// Listen for incoming messages
client.on(ErmisClassroom.events.MESSAGE_RECEIVED, (event) => {
  console.log(`${event.sender.userId}: ${event.message.text}`);
});

// Send a message
await client.sendMessage('Hello everyone!', {
  senderName: 'John Doe'
});

// Send typing indicator
await client.sendTypingIndicator(true);

// Get message history
const messages = client.getMessages(50);
```

---

## Browser Detection & Transport

### Automatic Transport Selection

The SDK automatically detects your browser and selects the optimal transport protocol:

- **Safari (Desktop & iOS)** → Uses **WebRTC** (better compatibility)
- **Chrome, Firefox, Edge** → Uses **WebTransport** (better performance)

```javascript
import ErmisClassroom, { BrowserDetection } from 'ermis-classroom-sdk';

// SDK automatically selects transport when joining
await client.joinRoom('ROOM-CODE');
// Console will show: "🚀 Setting up publisher with WebRTC" or "WebTransport"
```

### Check Browser Capabilities

```javascript
// Check if Safari
const isSafari = BrowserDetection.isSafari();
const isIOS = BrowserDetection.isIOSSafari();

// Check transport support
const supportsWebTransport = BrowserDetection.isWebTransportSupported();
const supportsWebRTC = BrowserDetection.isWebRTCSupported();

// Get recommendation
const transport = BrowserDetection.determineTransport();
console.log('Use WebRTC:', transport.useWebRTC);
console.log('Reason:', transport.reason);

// Log detailed info
BrowserDetection.logTransportInfo();
```

### Browser Compatibility

| Browser | Version | WebTransport | WebRTC | Auto-Selected |
|---------|---------|--------------|--------|---------------|
| Chrome | 97+ | ✅ | ✅ | WebTransport |
| Edge | 97+ | ✅ | ✅ | WebTransport |
| Firefox | 114+ | ✅ | ✅ | WebTransport |
| Safari | 16+ | ❌ | ✅ | WebRTC |
| iOS Safari | 16+ | ❌ | ✅ | WebRTC |

**📖 See full documentation:** [Browser Detection Guide](./docs/BROWSER_DETECTION.md)

---

## Media Stream Management

### Overview

The SDK requires you to manage MediaStreams, giving you full control over:
- When to request camera/microphone permissions
- Which devices to use
- Stream quality and constraints
- Audio-only, video-only, or observer modes
- Dynamic device switching

### Supported Configurations

| Configuration | Video | Audio | Use Case |
|--------------|-------|-------|----------|
| Full Call | ✅ | ✅ | Standard video conferencing |
| Audio Only | ❌ | ✅ | Voice calls, no camera |
| Video Only | ✅ | ❌ | Silent video, no mic |
| Observer | ❌* | ❌* | View-only mode |

*Observer mode requires a silent audio track or blank video track

### Getting Media Streams

```javascript
// Full video call
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720, frameRate: 30 },
  audio: { echoCancellation: true, noiseSuppression: true }
});

// Audio only
const audioStream = await navigator.mediaDevices.getUserMedia({
  video: false,
  audio: true
});

// Video only
const videoStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: false
});
```

### Device Selection

```javascript
// List available devices
const devices = await navigator.mediaDevices.enumerateDevices();
const cameras = devices.filter(d => d.kind === 'videoinput');
const microphones = devices.filter(d => d.kind === 'audioinput');

// Select specific device
const stream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: { exact: cameras[0].deviceId } },
  audio: { deviceId: { exact: microphones[0].deviceId } }
});
```

### Switching Devices While Live

**Method 1: Switch Individual Devices (Recommended)**
```javascript
const room = client.getCurrentRoom();

// Switch camera only (keeps existing microphone)
await room.localParticipant.publisher.switchCamera(newCameraDeviceId);

// Switch microphone only (keeps existing camera)
await room.localParticipant.publisher.switchMicrophone(newMicDeviceId);
```

**Method 2: Replace Entire MediaStream**
```javascript
const room = client.getCurrentRoom();

// Get new stream with different devices
const newStream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: { exact: newCameraId } },
  audio: { deviceId: { exact: newMicId } }
});

// Replace entire stream (stops old stream automatically)
await room.localParticipant.replaceMediaStream(newStream);
```

### Screen Sharing

```javascript
// Start screen share
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: { width: 1920, height: 1080 },
  audio: true
});

// Replace current stream with screen share
await room.localParticipant.replaceMediaStream(screenStream);

// Handle user stopping screen share
screenStream.getVideoTracks()[0].addEventListener('ended', async () => {
  // Switch back to camera
  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });
  await room.localParticipant.replaceMediaStream(cameraStream);
});
```

### Adding Tracks Dynamically

```javascript
// Join with audio only
const audioStream = await navigator.mediaDevices.getUserMedia({
  video: false,
  audio: true
});
await client.joinRoom(roomCode, audioStream);

// Later, enable camera
const room = client.getCurrentRoom();
const currentStream = room.localParticipant.publisher.stream;
const videoStream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 }
});

// Combine audio + video
const newStream = new MediaStream([
  ...currentStream.getAudioTracks(),
  ...videoStream.getVideoTracks()
]);
room.localParticipant.updateMediaStream(newStream);
```

### Observer Mode (No Camera/Mic)

```javascript
// Create silent audio track
const audioContext = new AudioContext();
const oscillator = audioContext.createOscillator();
const dst = audioContext.createMediaStreamDestination();
oscillator.connect(dst);
oscillator.start();

await client.joinRoom(roomCode, dst.stream);
```

### Graceful Degradation

```javascript
async function joinWithBestAvailable(roomCode) {
  let stream;

  try {
    // Try video + audio
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (e) {
    try {
      // Fallback to audio only
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
      });
    } catch (e2) {
      try {
        // Fallback to video only
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      } catch (e3) {
        // Fallback to observer mode
        const audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const dst = audioContext.createMediaStreamDestination();
        oscillator.connect(dst);
        oscillator.start();
        stream = dst.stream;
      }
    }
  }

  await client.joinRoom(roomCode, stream);
}
```

### Error Handling

```javascript
try {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });
  await client.joinRoom(roomCode, stream);
} catch (error) {
  if (error.name === 'NotAllowedError') {
    alert('Camera/microphone access denied');
  } else if (error.name === 'NotFoundError') {
    alert('No camera or microphone found');
  } else if (error.name === 'NotReadableError') {
    alert('Device is already in use');
  }
}
```

### Mute/Unmute Without Changing Stream

```javascript
const room = client.getCurrentRoom();
const stream = room.localParticipant.publisher.stream;

// Mute audio
const audioTrack = stream.getAudioTracks()[0];
if (audioTrack) {
  audioTrack.enabled = false; // Mute
  audioTrack.enabled = true;  // Unmute
}

// Disable video
const videoTrack = stream.getVideoTracks()[0];
if (videoTrack) {
  videoTrack.enabled = false; // Turn off
  videoTrack.enabled = true;  // Turn on
}
```

---

## Core Concepts

### Room

Represents a classroom session where participants can interact.

```javascript
const room = await client.createRoom({
  name: 'My Classroom',
  type: ErmisClassroom.RoomTypes.MAIN,
  mediaStream // Required for auto-join
});
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
console.log(participant.userId);
console.log(participant.streamId);
console.log(participant.membershipId);
console.log(participant.role);
console.log(participant.roomId);
console.log(participant.isLocal);
console.log(participant.isAudioEnabled);
console.log(participant.isVideoEnabled);
console.log(participant.isHandRaised);
console.log(participant.isPinned);
console.log(participant.isScreenSharing);
console.log(participant.connectionStatus);
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

**Parameters:**
- `config.name` (string) - Room name
- `config.type` (string) - Room type
- `config.mediaStream` (MediaStream) - **Required if autoJoin is true (default)**
- `config.autoJoin` (boolean) - Auto-join after creation (default: true)

```javascript
// Get media stream first
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// Create and auto-join
const room = await client.createRoom({
  name: 'Science Class',
  type: ErmisClassroom.RoomTypes.MAIN,
  mediaStream // Required for auto-join
});

// Or create without auto-join
const room = await client.createRoom({
  name: 'Science Class',
  type: ErmisClassroom.RoomTypes.MAIN,
  autoJoin: false // No mediaStream needed
});
```

**Room Types:**
- `MAIN` - Main classroom
- `BREAKOUT` - Breakout session
- `PRESENTATION` - Presentation mode
- `DISCUSSION` - Discussion mode

#### `client.joinRoom(roomCode, mediaStream)`

Join an existing room.

**Parameters:**
- `roomCode` (string) - Room code to join
- `mediaStream` (MediaStream) - **Required** - Your camera/mic stream

```javascript
// Get media stream
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// Join room
const result = await client.joinRoom('ABC-123', mediaStream);

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

#### `room.switchToSubRoom(subRoomCode, mediaStream)`

Switch to a breakout room.

**Parameters:**
- `subRoomCode` (string) - Sub room code to switch to
- `mediaStream` (MediaStream) - **Required** - Your camera/mic stream

```javascript
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

await room.switchToSubRoom('SUB-ABC-123', mediaStream);
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

// Toggle microphone (mute/unmute)
await me.toggleMicrophone();

// Toggle camera (on/off)
await me.toggleCamera();

// Toggle raise hand
await me.toggleRaiseHand();

// Update media stream (switch camera, enable screen share, etc.)
const newStream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: newCameraId },
  audio: true
});
me.updateMediaStream(newStream);

// Check states
console.log('Audio enabled:', me.isAudioEnabled);
console.log('Video enabled:', me.isVideoEnabled);
console.log('Hand raised:', me.isHandRaised);
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

// Access participant properties
console.log('User ID:', participant.userId);
console.log('Stream ID:', participant.streamId);
console.log('Room ID:', participant.roomId);
console.log('Role:', participant.role);
console.log('Is local:', participant.isLocal);
console.log('Audio enabled:', participant.isAudioEnabled);
console.log('Video enabled:', participant.isVideoEnabled);
console.log('Hand raised:', participant.isHandRaised);
console.log('Pinned:', participant.isPinned);
console.log('Screen sharing:', participant.isScreenSharing);
console.log('Connection status:', participant.connectionStatus);

// Listen to participant events
participant.on(ErmisClassroom.events.AUDIO_TOGGLED, (data) => {
  console.log(`${data.participant.userId} audio:`, data.enabled);
});

participant.on(ErmisClassroom.events.VIDEO_TOGGLED, (data) => {
  console.log(`${data.participant.userId} video:`, data.enabled);
});

participant.on(ErmisClassroom.events.HAND_RAISE_TOGGLED, (data) => {
  console.log(`${data.participant.userId} hand raised:`, data.enabled);
});
```

**Participant Roles:**
- `OWNER` - Room owner
- `MODERATOR` - Moderator with special permissions
- `PARTICIPANT` - Regular participant
- `OBSERVER` - Observer (view only)

### Media Devices (Optional Helpers)

> **Note:** These are optional helper utilities. You can use `navigator.mediaDevices` directly instead. See the [Media Stream Management](#media-stream-management) section for complete examples.

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
// Helper method (wraps navigator.mediaDevices.getUserMedia)
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

// Or use navigator.mediaDevices directly
const stream2 = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// Use the stream with SDK
await client.joinRoom('ROOM_CODE', stream);
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
ErmisClassroom.events.PARTICIPANT_PINNED_FOR_EVERYONE
ErmisClassroom.events.PARTICIPANT_UNPINNED_FOR_EVERYONE
ErmisClassroom.events.AUDIO_TOGGLED
ErmisClassroom.events.VIDEO_TOGGLED
ErmisClassroom.events.HAND_RAISE_TOGGLED
ErmisClassroom.events.REMOTE_AUDIO_STATUS_CHANGED
ErmisClassroom.events.REMOTE_VIDEO_STATUS_CHANGED
ErmisClassroom.events.REMOTE_HAND_RAISING_STATUS_CHANGED
ErmisClassroom.events.SCREEN_SHARE_STARTED
ErmisClassroom.events.SCREEN_SHARE_STOPPED
ErmisClassroom.events.REMOTE_SCREEN_SHARE_STARTED
ErmisClassroom.events.REMOTE_SCREEN_SHARE_STOPPED

// Sub-Room Events
ErmisClassroom.events.SUB_ROOM_CREATED
ErmisClassroom.events.SUB_ROOM_JOINED
ErmisClassroom.events.SUB_ROOM_LEFT
ErmisClassroom.events.SUB_ROOM_SWITCHED

// Media Stream Events
ErmisClassroom.events.LOCAL_STREAM_READY
ErmisClassroom.events.REMOTE_STREAM_READY
ErmisClassroom.events.STREAM_REMOVED

// Chat Events
ErmisClassroom.events.MESSAGE_SENT
ErmisClassroom.events.MESSAGE_RECEIVED
ErmisClassroom.events.MESSAGE_DELETED
ErmisClassroom.events.MESSAGE_UPDATED
ErmisClassroom.events.TYPING_STARTED
ErmisClassroom.events.TYPING_STOPPED
ErmisClassroom.events.CHAT_HISTORY_LOADED

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

### 1. Media Stream Management

**Request permissions early:**
```javascript
// Request permissions before showing room UI
try {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });
  // Show room join UI
  showJoinRoomUI(stream);
} catch (error) {
  // Show permission denied message
  showPermissionError(error);
}
```

**Clean up streams:**
```javascript
// Stop tracks when leaving room or switching streams
function stopMediaStream(stream) {
  stream.getTracks().forEach(track => track.stop());
}

// Before getting new stream
stopMediaStream(oldStream);
const newStream = await navigator.mediaDevices.getUserMedia({...});
```

**Handle graceful degradation:**
```javascript
// Try best available media configuration
async function getBestMediaStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (e) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
      });
    } catch (e2) {
      // Fallback to observer mode
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const dst = audioContext.createMediaStreamDestination();
      oscillator.connect(dst);
      oscillator.start();
      return dst.stream;
    }
  }
}
```

### 2. Error Handling

Always wrap SDK calls in try-catch blocks:

```javascript
try {
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });
  await client.joinRoom('ROOM-CODE', mediaStream);
} catch (error) {
  if (error.name === 'NotAllowedError') {
    alert('Camera/microphone access denied');
  } else if (error.name === 'NotFoundError') {
    alert('No camera or microphone found');
  } else {
    console.error('Failed to join room:', error);
    alert('Failed to join room. Please try again.');
  }
}
```

### 3. Event Listeners

Clean up event listeners when components unmount:

```javascript
// React example
useEffect(() => {
  const handleParticipantAdded = (event) => {
    console.log('New participant:', event.participant);
  };

  client.on(ErmisClassroom.events.PARTICIPANT_ADDED, handleParticipantAdded);

  return () => {
    client.off(ErmisClassroom.events.PARTICIPANT_ADDED, handleParticipantAdded);
  };
}, [client]);
```

### 4. Device Selection

Provide UI for device selection:

```javascript
async function setupDeviceSelection() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  const microphones = devices.filter(d => d.kind === 'audioinput');

  // Show in UI dropdown
  cameras.forEach(camera => {
    addOption('camera-select', camera.label, camera.deviceId);
  });

  microphones.forEach(mic => {
    addOption('mic-select', mic.label, mic.deviceId);
  });
}

// When user selects device
async function switchDevice(deviceId, kind) {
  const room = client.getCurrentRoom();
  const currentStream = room.localParticipant.publisher.stream;

  const constraints = kind === 'video'
    ? { video: { deviceId: { exact: deviceId } }, audio: true }
    : { video: true, audio: { deviceId: { exact: deviceId } } };

  const newStream = await navigator.mediaDevices.getUserMedia(constraints);
  room.localParticipant.updateMediaStream(newStream);

  // Stop old stream
  currentStream.getTracks().forEach(track => track.stop());
}
```

### 5. Preview Before Joining

Show local video preview before joining:

```javascript
async function showPreview() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  // Show preview
  const previewVideo = document.getElementById('preview');
  previewVideo.srcObject = stream;

  // Store stream for later use
  window.pendingStream = stream;
}

async function joinWithPreview(roomCode) {
  // Use the previewed stream
  await client.joinRoom(roomCode, window.pendingStream);
}
```

### 6. Handle Network Issues

Monitor connection status:

```javascript
client.on(ErmisClassroom.events.CONNECTION_STATUS_CHANGED, (status) => {
  if (status === 'disconnected') {
    showReconnectingUI();
  } else if (status === 'connected') {
    hideReconnectingUI();
  }
});
```

---

## Troubleshooting

### MediaStream Errors

**"mediaStream is required"**
- Ensure you're passing a MediaStream to `joinRoom()`, `createRoom()`, or `switchToSubRoom()`

**"Invalid MediaStream provided - no tracks found"**
- Check that your MediaStream has active tracks: `stream.getTracks().length > 0`
- Ensure tracks haven't been stopped before passing to SDK

**"NotAllowedError: Permission denied"**
- User denied camera/microphone permissions
- Ask user to grant permissions in browser settings

**"NotFoundError: Requested device not found"**
- No camera or microphone available
- Use audio-only, video-only, or observer mode

**"NotReadableError: Could not start video source"**
- Device is already in use by another application
- Close other applications using the camera/microphone

### Audio/Video Not Working

**No video track available:**
- Join with audio-only mode
- Or create a blank video track using Canvas

**No audio track available:**
- Join with video-only mode
- Or create a silent audio track using Web Audio API

**Toggle methods not working:**
- Check if stream has the required track type
- SDK will warn if trying to toggle non-existent tracks

---

## License

MIT License - see LICENSE file for details

---

## Support

For issues, questions, or contributions:
- GitHub Issues: [Report an issue](https://github.com/your-repo/ermis-classroom-sdk/issues)
- Documentation: See examples in this README
- Email: support@ermis.com
