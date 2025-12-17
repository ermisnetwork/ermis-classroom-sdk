# Ermis Classroom SDK

A TypeScript SDK for building real-time video/audio classroom applications using **WebTransport** and **WebRTC** protocols.

## Features

- 🎥 **Multi-resolution Video Streaming** - Support for 360p, 720p, and 1080p
- 🎤 **Opus Audio Encoding** - High-quality, low-latency audio
- 🖥️ **Screen Sharing** - Share your screen with participants
- 📡 **Dual Transport** - WebTransport (primary) and WebRTC (fallback)
- 🔄 **FEC Error Correction** - RaptorQ-based forward error correction for WebRTC
- 🎛️ **Device Switching** - Switch camera/microphone on-the-fly
- 📊 **Real-time Events** - Rich event system for meeting controls

## Quick Links

- [Getting Started](getting-started/README.md) - Installation and quick start guide
- [User Guide](user-guide/README.md) - How to use the SDK
- [Contributor Guide](contributor-guide/README.md) - Internal architecture and development

## Installation

```bash
npm install @ermisnetwork/ermis-classroom-sdk
# or
pnpm add @ermisnetwork/ermis-classroom-sdk
# or
yarn add @ermisnetwork/ermis-classroom-sdk
```

## Basic Usage

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

// Create client
const client = new MeetingClient({
  apiBaseUrl: 'https://your-api.com',
  publishUrl: 'https://your-server.com/publish',
  subscribeUrl: 'https://your-server.com/subscribe',
});

// Authenticate
await client.authenticate('user-id');

// Get media stream
const mediaStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true,
});

// Join room by code
const room = await client.joinRoom('ROOM123', mediaStream);

// Listen for events
room.on('participantAdded', ({ participant }) => {
  console.log(`${participant.userId} joined`);
});

// Start screen share
await room.startScreenShare();

// Leave room
await client.leaveRoom();
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    MeetingClient                         │
│              (Main SDK Entry Point)                      │
├─────────────────────────────────────────────────────────┤
│                          │                               │
│                     ┌────┴────┐                         │
│                     │  Room   │                          │
│                     └────┬────┘                         │
│                          │                               │
│    ┌────────────┐       │       ┌────────────┐          │
│    │ Participant│───────┼───────│ Participant│          │
│    │  (local)   │       │       │  (remote)  │          │
│    └────────────┘       │       └────────────┘          │
│           │             │              │                 │
│    ┌──────┴──────┐      │       ┌──────┴──────┐         │
│    │  Publisher  │      │       │ Subscriber  │         │
│    └─────────────┘      │       └─────────────┘         │
│                         │                                │
│              ┌──────────┴──────────┐                    │
│              │    StreamManager    │                    │
│              └──────────┬──────────┘                    │
│                         │                                │
│         ┌───────────────┴───────────────┐               │
│         ▼                               ▼               │
│  ┌─────────────┐                ┌─────────────┐        │
│  │WebTransport │                │   WebRTC    │        │
│  └─────────────┘                └─────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## License

MIT License
