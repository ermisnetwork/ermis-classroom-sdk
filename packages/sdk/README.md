# @ermisnetwork/ermis-classroom-sdk

TypeScript SDK for Ermis Classroom - Real-time video conferencing and collaboration platform.

[![Version](https://img.shields.io/badge/version-0.1.5-blue.svg)](https://github.com/ermisnetwork/ermis-classroom-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Table of Contents

- [Features](#features)
- [Packages](#packages)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Static Files Setup](#static-files-setup)
- [Usage Flow (React)](#usage-flow-react)
  - [Step 1: Setup Provider](#step-1-setup-provider)
  - [Step 2: Authentication](#step-2-authentication)
  - [Step 3: Pre-Join (Setup Devices)](#step-3-pre-join-setup-devices)
  - [Step 4: Join Room](#step-4-join-room)
  - [Step 5: Meeting Room](#step-5-meeting-room)
  - [Step 6: Leave Room](#step-6-leave-room)
- [Core SDK Usage (Vanilla JS/TS)](#core-sdk-usage-vanilla-jsts)
- [API Reference](#api-reference)
- [Events](#events)
- [Types & Constants](#types--constants)
- [Browser Support](#browser-support)
- [License](#license)
- [Support](#support)

## Features

- 🎥 **Real-time Video/Audio Streaming** - Support for 360p and 720p with modern codecs
- 🖥️ **Screen Sharing** - Screen share with audio support (720p/1080p)
- 🎙️ **Audio Processing with WebCodecs** - Opus audio codec at 48kHz
- 📡 **Multiple Transport Protocols** - WebRTC, WebTransport, WebSocket (auto-selects based on browser)
- 👥 **Participant Management** - Track and manage participants with different roles
- 🏠 **Breakout Rooms** - Create and manage breakout rooms within meetings
- 💬 **Real-time Chat** - Send messages, typing indicators, reactions
- ✋ **Raise Hand** - Hand raise feature for meetings
- 📌 **Pin Participant** - Pin participant video
- 🔊 **WASM-powered Performance** - Uses WebAssembly for optimal performance
- 📦 **Self-contained** - Bundled with all runtime dependencies

## Packages

This SDK consists of two packages:

| Package | Description |
|---------|-------------|
| `@ermisnetwork/ermis-classroom-sdk` | Core SDK - works with any framework or vanilla JS/TS |
| `@ermisnetwork/ermis-classroom-react` | React bindings - hooks and components for React apps |

## System Requirements

- **Node.js**: >= 18
- **Browser**: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- **TypeScript**: >= 5.0 (recommended)

## Installation

### For React Projects (Recommended)

```bash
npm install @ermisnetwork/ermis-classroom-sdk @ermisnetwork/ermis-classroom-react
```

### For Vanilla JS/TS Projects

```bash
npm install @ermisnetwork/ermis-classroom-sdk
```

## Static Files Setup

The SDK includes static files (workers, WASM modules, polyfills) in `node_modules` after installation. However, these files need to be served as **static HTTP resources** because:

- **Web Workers** cannot be bundled into JavaScript bundles - they must be loaded via URL
- **WASM modules** require HTTP serving for proper initialization
- **Browser security policies** require workers to be loaded from the same origin

### For Vite Projects (Recommended)

Use the built-in Vite plugin to automatically copy static files:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copySDKStaticFiles } from '@ermisnetwork/ermis-classroom-sdk/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    copySDKStaticFiles({ verbose: true }),
  ],
});
```

### For Other Build Tools

Manually copy the files to your static/public folder:

```bash
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/src/workers public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/src/raptorQ public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/src/polyfills public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/src/opus_decoder public/
```

---

## Usage Flow (React)

This section follows the exact flow used in the demo app. The flow consists of 6 steps:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Setup     │────▶│   Auth      │────▶│  Pre-Join   │
│  Provider   │     │   Screen    │     │   Screen    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
┌─────────────┐     ┌─────────────┐            ▼
│   Leave     │◀────│  Meeting    │◀───────────┘
│   Room      │     │   Room      │
└─────────────┘     └─────────────┘
```

### Step 1: Setup Provider

Wrap your app with `ErmisClassroomProvider`:

```tsx
// App.tsx
import { ErmisClassroomProvider } from '@ermisnetwork/ermis-classroom-react';

function App() {
  return (
    <ErmisClassroomProvider
      config={{
        host: 'api.ermis.network',           // API host
        hostNode: 'media.ermis.network',     // Media server node
        webtpUrl: 'https://media.ermis.network/meeting/wt', // WebTransport URL
      }}
    >
      <YourApp />
    </ErmisClassroomProvider>
  );
}
```

### Step 2: Authentication

Use `useErmisClassroom` hook to authenticate users:

```tsx
// AuthScreen.tsx
import { useState } from 'react';
import { useErmisClassroom } from '@ermisnetwork/ermis-classroom-react';

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [userId, setUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { authenticate } = useErmisClassroom();

  const handleAuthenticate = async () => {
    setIsLoading(true);
    try {
      await authenticate(userId);
      onAuthenticated();
    } catch (err) {
      console.error('Authentication failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <input
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="Enter your user ID"
      />
      <button onClick={handleAuthenticate} disabled={isLoading}>
        {isLoading ? 'Authenticating...' : 'Authenticate'}
      </button>
    </div>
  );
}
```

### Step 3: Pre-Join (Setup Devices)

Setup camera/microphone preview and select devices before joining:

```tsx
// PreJoinScreen.tsx
import { useState, useEffect, useRef } from 'react';
import { useErmisClassroom } from '@ermisnetwork/ermis-classroom-react';

function PreJoinScreen({ onJoined }: { onJoined: () => void }) {
  const [roomCode, setRoomCode] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    devices,              // { cameras, microphones, speakers }
    selectedDevices,      // { camera, microphone, speaker }
    switchCamera,         // (deviceId) => void
    switchMicrophone,     // (deviceId) => void
    getPreviewStream,     // () => Promise<MediaStream>
    stopPreviewStream,    // () => void
    previewStream,        // MediaStream | null
    joinRoom,             // (roomCode, stream?) => Promise<void>
  } = useErmisClassroom();

  // Start camera preview on mount
  useEffect(() => {
    getPreviewStream();
    return () => stopPreviewStream();
  }, []);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  const handleJoinRoom = async () => {
    await joinRoom(roomCode, previewStream ?? undefined);
    onJoined();
  };

  return (
    <div>
      {/* Camera Preview */}
      <video ref={videoRef} autoPlay playsInline muted />

      {/* Device Selection */}
      <select
        value={selectedDevices?.camera || ''}
        onChange={(e) => switchCamera(e.target.value)}
      >
        {devices?.cameras?.map((camera) => (
          <option key={camera.deviceId} value={camera.deviceId}>
            {camera.label}
          </option>
        ))}
      </select>

      <select
        value={selectedDevices?.microphone || ''}
        onChange={(e) => switchMicrophone(e.target.value)}
      >
        {devices?.microphones?.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>

      {/* Room Code & Join */}
      <input
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value)}
        placeholder="Enter room code"
      />
      <button onClick={handleJoinRoom}>Join Room</button>
    </div>
  );
}
```

### Step 4: Join Room

The `joinRoom` function connects you to the meeting and starts streaming:

```tsx
// The joinRoom call in PreJoinScreen above does the following:
// 1. Connects to the room via the room code
// 2. Sets up Publisher (to send your video/audio)
// 3. Sets up Subscribers (to receive remote participants' streams)
// 4. Emits 'localStreamReady' and 'remoteStreamReady' events

await joinRoom(roomCode, previewStream);
```

### Step 5: Meeting Room

Display participants, handle media controls, and screen sharing:

```tsx
// MeetingRoom.tsx
import { useEffect, useRef, useMemo } from 'react';
import { useErmisClassroom, useMediaDevices } from '@ermisnetwork/ermis-classroom-react';

function MeetingRoom({ onLeft }: { onLeft: () => void }) {
  const {
    // Participants
    participants,           // Map<string, Participant>
    userId,                 // Current user ID
    
    // Streams
    localStream,            // MediaStream | null
    remoteStreams,          // Map<userId, MediaStream>
    
    // Media state
    micEnabled,             // boolean
    videoEnabled,           // boolean
    handRaised,             // boolean
    isScreenSharing,        // boolean
    screenShareStreams,     // Map<id, { stream, userName }>
    
    // Controls
    toggleMicrophone,       // () => void
    toggleCamera,           // () => void
    toggleRaiseHand,        // () => void
    toggleScreenShare,      // () => void
    togglePin,              // (userId, type) => void
    leaveRoom,              // () => Promise<void>
    
    // Room info
    currentRoom,            // Room | null
  } = useErmisClassroom();

  const {
    microphones,
    cameras,
    selectedMicrophone,
    selectedCamera,
    selectMicrophone,
    selectCamera,
  } = useMediaDevices();

  // Get participant list
  const participantList = useMemo(() => {
    return Array.from(participants.values());
  }, [participants]);

  // Leave room handler
  const handleLeave = async () => {
    await leaveRoom();
    onLeft();
  };

  return (
    <div>
      {/* Local Video */}
      <LocalVideo stream={localStream} />

      {/* Remote Participants */}
      {participantList
        .filter((p) => p.userId !== userId)
        .map((participant) => (
          <RemoteVideo
            key={participant.userId}
            participant={participant}
            stream={remoteStreams.get(participant.userId)}
          />
        ))}

      {/* Screen Shares */}
      {Array.from(screenShareStreams.entries()).map(([id, data]) => (
        <ScreenShareVideo key={id} stream={data.stream} userName={data.userName} />
      ))}

      {/* Controls */}
      <div className="controls">
        <button onClick={toggleMicrophone}>
          {micEnabled ? '🎤' : '🔇'}
        </button>
        <button onClick={toggleCamera}>
          {videoEnabled ? '📹' : '📷'}
        </button>
        <button onClick={toggleRaiseHand}>
          {handRaised ? '✋' : '🤚'}
        </button>
        <button onClick={toggleScreenShare}>
          {isScreenSharing ? 'Stop Share' : 'Share Screen'}
        </button>
        <button onClick={handleLeave}>Leave</button>

        {/* Device Selection */}
        <select
          value={selectedMicrophone || ''}
          onChange={(e) => selectMicrophone(e.target.value)}
        >
          {microphones.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Helper components
function LocalVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted />;
}

function RemoteVideo({ participant, stream }: { participant: any; stream?: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline />
      <span>{participant.userId}</span>
      {participant.isHandRaised && <span>✋</span>}
      {!participant.isAudioEnabled && <span>🔇</span>}
    </div>
  );
}
```

### Step 6: Leave Room

```tsx
const handleLeave = async () => {
  await leaveRoom();
  // Navigate back to pre-join or auth screen
  onLeft();
};
```

---

## Core SDK Usage (Vanilla JS/TS)

If not using React, you can use the core SDK directly:

```typescript
import { ErmisClient, ROOM_EVENTS } from '@ermisnetwork/ermis-classroom-sdk';

// 1. Create client
const client = new ErmisClient({
  host: 'api.ermis.network',
  hostNode: 'media.ermis.network',
  webtpUrl: 'https://media.ermis.network/meeting/wt',
  debug: true,
});

// 2. Authenticate
await client.authenticate('user-123');

// 3. Setup event listeners
client.on(ROOM_EVENTS.LOCAL_STREAM_READY, ({ stream }) => {
  document.getElementById('local-video').srcObject = stream;
});

client.on(ROOM_EVENTS.REMOTE_STREAM_READY, ({ stream, participant }) => {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  document.getElementById('remote-videos').appendChild(video);
});

client.on(ROOM_EVENTS.PARTICIPANT_ADDED, ({ participant }) => {
  console.log('New participant:', participant.userId);
});

// 4. Get media stream
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
  audio: true,
});

// 5. Join room
const { room, localParticipant, participants } = await client.joinRoom('ROOM-CODE', mediaStream);

// 6. Control media
await localParticipant.toggleMicrophone();
await localParticipant.toggleCamera();
await localParticipant.toggleRaiseHand();

// 7. Screen share
await room.startScreenShare();
await room.stopScreenShare();

// 8. Leave room
await client.leaveRoom();
await client.logout();
```

---

## API Reference

### React Hooks

| Hook | Description |
|------|-------------|
| `useErmisClassroom()` | Main hook - access all SDK functionality |
| `useParticipants()` | Get all participants in the room |
| `useLocalParticipant()` | Get local participant info |
| `useRemoteParticipants()` | Get remote participants only |
| `useMediaDevices()` | Manage camera/microphone devices |
| `useLocalMedia()` | Control local media (mic, camera) |
| `usePreviewStream()` | Manage preview stream before joining |
| `useScreenShare()` | Control screen sharing |
| `useRoom()` | Access room information and actions |
| `useRemoteStreams()` | Get all remote media streams |
| `useRemoteStream(userId)` | Get specific participant's stream |
| `usePinState()` | Manage pinned participant state |
| `useCustomEvents()` | Send/receive custom events |

### React Components

| Component | Description |
|-----------|-------------|
| `ErmisClassroomProvider` | Context provider - wraps your app |
| `GridLayout` | Grid layout for participants |
| `FocusLayout` | Focus layout with main + sidebar |
| `CarouselLayout` | Carousel layout for participants |
| `ParticipantTile` | Render a participant tile |
| `ScreenShareTile` | Render a screen share tile |

### Core SDK Classes

| Class | Description |
|-------|-------------|
| `ErmisClient` | Main client - auth, room management |
| `Room` | Room instance - participants, chat, media |
| `Participant` | Participant - media controls, info |
| `Publisher` | Handle outgoing media streams |
| `Subscriber` | Handle incoming media streams |
| `MediaDeviceManager` | Manage devices |

For detailed API documentation, see:
- [ErmisClient API](./docs/ErmisClient.md)
- [Room API](./docs/Room.md)
- [Participant API](./docs/Participant.md)

---

## Events

### Room Events

```typescript
import { ROOM_EVENTS } from '@ermisnetwork/ermis-classroom-sdk';

// Lifecycle
ROOM_EVENTS.JOINING                    // Room joining
ROOM_EVENTS.JOINED                     // Room joined
ROOM_EVENTS.LEAVING                    // Room leaving
ROOM_EVENTS.LEFT                       // Room left
ROOM_EVENTS.ERROR                      // Error occurred

// Participants
ROOM_EVENTS.PARTICIPANT_ADDED          // New participant
ROOM_EVENTS.PARTICIPANT_REMOVED        // Participant left
ROOM_EVENTS.PARTICIPANT_DISCONNECTED   // Participant disconnected
ROOM_EVENTS.PARTICIPANT_RECONNECTED    // Participant reconnected

// Streams
ROOM_EVENTS.LOCAL_STREAM_READY         // Local stream ready
ROOM_EVENTS.REMOTE_STREAM_READY        // Remote stream ready
ROOM_EVENTS.REMOTE_SCREEN_SHARE_STREAM_READY // Screen share stream ready

// Screen Share
ROOM_EVENTS.SCREEN_SHARE_STARTED       // Screen share started
ROOM_EVENTS.SCREEN_SHARE_STOPPED       // Screen share stopped
ROOM_EVENTS.REMOTE_SCREEN_SHARE_STARTED // Remote screen share started
ROOM_EVENTS.REMOTE_SCREEN_SHARE_STOPPED // Remote screen share stopped

// Media Status
ROOM_EVENTS.AUDIO_TOGGLED              // Audio toggled
ROOM_EVENTS.VIDEO_TOGGLED              // Video toggled
ROOM_EVENTS.HAND_RAISE_TOGGLED         // Hand raise toggled
ROOM_EVENTS.REMOTE_AUDIO_STATUS_CHANGED // Remote audio changed
ROOM_EVENTS.REMOTE_VIDEO_STATUS_CHANGED // Remote video changed

// Chat
ROOM_EVENTS.MESSAGE_RECEIVED           // Message received
ROOM_EVENTS.MESSAGE_SENT               // Message sent
ROOM_EVENTS.TYPING_STARTED             // User started typing
ROOM_EVENTS.TYPING_STOPPED             // User stopped typing
```

---

## Types & Constants

```typescript
import {
  // Constants
  RoomTypes,         // { MAIN, SUB, BREAKOUT, PRIVATE }
  StreamTypes,       // { CAMERA, SCREEN_SHARE }
  ParticipantRoles,  // { HOST, CO_HOST, PARTICIPANT, VIEWER }
  ConnectionStatus,  // { DISCONNECTED, CONNECTING, CONNECTED, FAILED }
  ROOM_EVENTS,
  MEETING_EVENTS,
  VERSION,
} from '@ermisnetwork/ermis-classroom-sdk';

import type {
  // Types
  ErmisClientConfig,
  RoomConfig,
  RoomInfo,
  RoomType,
  JoinRoomResult,
  ParticipantInfo,
  ParticipantRole,
  ChatMessage,
  CustomEventData,
} from '@ermisnetwork/ermis-classroom-sdk';
```

---

## Debugging

The SDK uses the `debug` library for logging. To enable debug logs in the browser console:

### Enable Debug Logs

#### Chrome / Edge / Firefox

1. Open DevTools Console (F12 or Ctrl+Shift+I)
2. Run this command:

```javascript
localStorage.setItem('debug', 'ermis-classroom-sdk*');
```

3. Hard refresh the page: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac)

#### Safari

Safari requires a page reload after setting localStorage:

```javascript
localStorage.setItem('debug', 'ermis-classroom-sdk*');
location.reload();
```

### Disable Debug Logs

To disable debug logs:

```javascript
localStorage.removeItem('debug');
location.reload();
```

### Debug Namespaces

You can filter logs by specific namespaces:

```javascript
// All SDK logs
localStorage.setItem('debug', 'ermis-classroom-sdk*');

// Only Publisher logs
localStorage.setItem('debug', 'ermis-classroom-sdk:publisher*');

// Only Subscriber logs
localStorage.setItem('debug', 'ermis-classroom-sdk:subscriber*');

// Multiple namespaces
localStorage.setItem('debug', 'ermis-classroom-sdk:publisher*,ermis-classroom-sdk:room*');
```

### Programmatic Debug Control

You can also enable debug mode via the SDK config:

```typescript
const client = new ErmisClient({
  host: 'api.ermis.network',
  debug: true, // Enable debug mode
});

// Or toggle at runtime
client.enableDebug();
client.disableDebug();
```

---

## Browser Support

| Browser | Version | Transport Protocol |
|---------|---------|-------------------|
| Chrome | 90+ | WebTransport (preferred), WebRTC |
| Firefox | 90+ | WebRTC, WebSocket |
| Safari | 15+ | WebSocket, WebRTC |
| Edge | 90+ | WebTransport (preferred), WebRTC |

> **Note:** Safari uses WebSocket as the default protocol due to WebTransport limitations. The SDK automatically detects and selects the appropriate protocol.

---

## License

MIT © Ermis Network

## Support

- 📧 Email: [developer@ermis.network](mailto:developer@ermis.network)
- 🌐 Website: [https://ermis.network](https://ermis.network)
- 📚 Documentation: [https://docs.ermis.network](https://docs.ermis.network)
- 🐛 Issue Tracker: [GitHub Issues](https://github.com/ermisnetwork/ermis-classroom-sdk/issues)
