# @ermisnetwork/ermis-classroom-sdk

TypeScript SDK for Ermis Classroom - Real-time video conferencing and collaboration platform.

## Features

- 🎥 Real-time video/audio streaming
- 🖥️ Screen sharing support
- 🎙️ Audio processing with WebCodecs
- 📡 Multiple transport protocols (WebRTC, WebTransport, WebSocket)
- 🔊 Opus audio codec support
- 🚀 WASM-powered performance
- 📦 Self-contained with all runtime dependencies

## Installation

```bash
npm install @ermisnetwork/ermis-classroom-sdk
```

## Quick Start

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

// Initialize client
const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
});

// Connect to room
await client.connect();

// Join a room
const room = await client.joinRoom('room-id');

// Start publishing video/audio
await room.startPublish({
  video: true,
  audio: true,
});

// Subscribe to other participants
room.on('participantJoined', (participant) => {
  participant.subscribe();
});
```

## Static Files

This SDK includes workers, WASM modules, and polyfills that need to be served from your application's public directory.

### For Vite Projects

The static files are automatically included in the `dist/` directory when you install the package. You need to copy them to your public folder:

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  // ... your config
  
  // The SDK files are already in dist/, you can reference them directly
  // or copy them to your public folder during build
});
```

### Manual Copy

If you need to manually copy the static files:

```bash
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/workers public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/raptorQ public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/polyfills public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/opus_decoder public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/constants public/
```

## API Reference

### ErmisClient

Main client class for connecting to Ermis Classroom.

```typescript
const client = new ErmisClient(options);
```

**Options:**
- `apiKey: string` - Your API key
- `serverUrl: string` - WebSocket server URL
- `userId?: string` - Optional user ID

### Room

Room instance for managing participants and streams.

```typescript
const room = await client.joinRoom(roomId);
```

**Methods:**
- `startPublish(options)` - Start publishing media
- `stopPublish()` - Stop publishing
- `subscribe(participantId)` - Subscribe to participant
- `unsubscribe(participantId)` - Unsubscribe from participant

**Events:**
- `participantJoined` - New participant joined
- `participantLeft` - Participant left
- `streamAdded` - New stream available
- `streamRemoved` - Stream removed

## Development

For local development and examples, see the [Ermis-classroom monorepo](https://github.com/ermisnetwork/ermis-classroom).

## License

MIT © Ermis Network

## Support

- 📧 Email: developer@ermis.network
- 🌐 Website: https://ermis.network
- 📚 Documentation: https://docs.ermis.network
