# Ermis Classroom SDK - Usage Examples

## Installation

```bash
npm install @ermisnetwork/ermis-classroom-sdk
```

## Example 1: Basic Setup

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

// Initialize client
const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
  userId: 'user-123',
});

// Connect
await client.connect();
console.log('Connected to Ermis Classroom!');
```

## Example 2: Join Room and Publish Video

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
});

await client.connect();

// Join a room
const room = await client.joinRoom('room-123');

// Start publishing video/audio
await room.startPublish({
  video: {
    enabled: true,
    width: 1280,
    height: 720,
    framerate: 30,
  },
  audio: {
    enabled: true,
    sampleRate: 48000,
  },
});

console.log('Publishing video/audio to room!');
```

## Example 3: Subscribe to Participants

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
});

await client.connect();
const room = await client.joinRoom('room-123');

// Listen for participants
room.on('participantJoined', (participant) => {
  console.log(`${participant.name} joined the room`);
  
  // Subscribe to their video
  participant.subscribe({
    video: true,
    audio: true,
  });
});

room.on('participantLeft', (participant) => {
  console.log(`${participant.name} left the room`);
});

// Listen for streams
room.on('streamAdded', (stream) => {
  console.log('New stream available:', stream.id);
  
  // Attach to video element
  const videoElement = document.getElementById('remote-video');
  if (videoElement instanceof HTMLVideoElement) {
    videoElement.srcObject = stream;
  }
});
```

## Example 4: Screen Sharing

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
});

await client.connect();
const room = await client.joinRoom('room-123');

// Start screen sharing
await room.startScreenShare({
  width: 1920,
  height: 1080,
  framerate: 15,
});

console.log('Screen sharing started!');

// Stop screen sharing
document.getElementById('stop-btn')?.addEventListener('click', async () => {
  await room.stopScreenShare();
  console.log('Screen sharing stopped');
});
```

## Example 5: React Integration

```tsx
import { useState, useEffect } from 'react';
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

function VideoConference() {
  const [client, setClient] = useState<ErmisClient | null>(null);
  const [room, setRoom] = useState<any>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    const initClient = async () => {
      const ermisClient = new ErmisClient({
        apiKey: 'your-api-key',
        serverUrl: 'wss://your-server.com',
      });

      await ermisClient.connect();
      setClient(ermisClient);

      const joinedRoom = await ermisClient.joinRoom('room-123');
      setRoom(joinedRoom);
    };

    initClient();

    return () => {
      client?.disconnect();
    };
  }, []);

  const togglePublish = async () => {
    if (!room) return;

    if (isPublishing) {
      await room.stopPublish();
      setIsPublishing(false);
    } else {
      await room.startPublish({
        video: true,
        audio: true,
      });
      setIsPublishing(true);
    }
  };

  return (
    <div>
      <h1>Ermis Classroom</h1>
      <button onClick={togglePublish}>
        {isPublishing ? 'Stop Publishing' : 'Start Publishing'}
      </button>
      <video id="local-video" autoPlay muted />
      <video id="remote-video" autoPlay />
    </div>
  );
}

export default VideoConference;
```

## Example 6: Handling Static Files (Vite)

When using the SDK in a Vite project, you need to ensure static files (workers, WASM) are accessible:

### Option A: Copy files manually

```bash
# Copy static files from SDK to your public folder
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/workers public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/raptorQ public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/polyfills public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/opus_decoder public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/constants public/
```

### Option B: Use Vite plugin (if developing in Ermis-classroom monorepo)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyPatchFiles } from '@ermisnetwork/ermis-classroom-patch-files/plugin';

export default defineConfig({
  plugins: [
    react(),
    copyPatchFiles({ verbose: true }), // Auto-copy static files
  ],
});
```

## Example 7: Advanced Configuration

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
  
  // Transport protocol
  protocol: 'webtransport', // 'webrtc' | 'webtransport' | 'websocket'
  
  // WebRTC configuration
  webRtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  },
  
  // Audio configuration
  audioConfig: {
    sampleRate: 48000,
    channelCount: 2,
    echoCancellation: true,
    noiseSuppression: true,
  },
  
  // Video configuration
  videoConfig: {
    codec: 'avc1.640c34', // H.264
    width: 1280,
    height: 720,
    framerate: 30,
    bitrate: 800_000,
  },
});
```

## Example 8: Event Handling

```typescript
import { ErmisClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new ErmisClient({
  apiKey: 'your-api-key',
  serverUrl: 'wss://your-server.com',
});

// Client events
client.on('connected', () => {
  console.log('Connected to server');
});

client.on('disconnected', () => {
  console.log('Disconnected from server');
});

client.on('error', (error) => {
  console.error('Client error:', error);
});

await client.connect();
const room = await client.joinRoom('room-123');

// Room events
room.on('participantJoined', (participant) => {
  console.log('Participant joined:', participant);
});

room.on('participantLeft', (participant) => {
  console.log('Participant left:', participant);
});

room.on('streamAdded', (stream) => {
  console.log('Stream added:', stream);
});

room.on('streamRemoved', (stream) => {
  console.log('Stream removed:', stream);
});

room.on('connectionQualityChanged', (quality) => {
  console.log('Connection quality:', quality);
});
```

## Troubleshooting

### Workers not loading
- Ensure workers are served from `/workers/` path
- Check browser console for CORS errors
- Verify static files are in the public folder

### WASM modules not loading
- Check that `.wasm` files are in `/raptorQ/` path
- Ensure proper MIME types are set by your server
- Verify files are accessible via HTTP

### Audio/Video not working
- Check browser permissions for camera/microphone
- Ensure HTTPS is used (required for WebRTC)
- Verify codec support in browser

## Support

- Documentation: https://docs.ermis.network
- GitHub: https://github.com/ermisnetwork/ermis-classroom
- Email: developer@ermis.network
