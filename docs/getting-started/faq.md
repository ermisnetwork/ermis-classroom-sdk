# FAQ

## General Questions

### What protocols does the SDK support?

- **WebTransport** (Primary) - Modern HTTP/3-based streaming
- **WebRTC** (Fallback) - Traditional peer-to-peer for Safari

### Which browsers are supported?

| Browser | WebTransport | WebRTC |
|---------|--------------|--------|
| Chrome 94+ | ✅ | ✅ |
| Edge 94+ | ✅ | ✅ |
| Safari 15.4+ | ❌ | ✅ |
| Firefox | ❌ | ✅ |

---

## Usage

### How do I join a room?

```typescript
import { MeetingClient } from '@ermisnetwork/ermis-classroom-sdk';

const client = new MeetingClient({
  apiBaseUrl: 'https://api.example.com',
  publishUrl: 'https://media.example.com/publish',
  subscribeUrl: 'https://media.example.com/subscribe',
});

// Authenticate
await client.authenticate('my-user-id');

// Get media
const mediaStream = await client.getUserMedia({
  video: true,
  audio: true,
});

// Join room by code
const room = await client.joinRoom('ROOM123', mediaStream);
```

### How do I enable WebRTC fallback?

```typescript
const client = new MeetingClient({
  apiBaseUrl: 'https://api.example.com',
  publishUrl: 'https://media.example.com/publish',
  subscribeUrl: 'https://media.example.com/subscribe',
  webRtcHost: 'media.example.com',
  useWebRTC: true,  // Force WebRTC
});
```

### How do I screen share?

```typescript
// Start screen share
await room.startScreenShare();

// Stop
await room.stopScreenShare();
```

---

## Troubleshooting

### Audio not working on Safari?

Safari requires user interaction before playing audio. Call `play()` in response to a user click.

### Video freezing?

Check:
1. Network connection
2. Lower resolution
3. Tab not throttled

### WebTransport failing?

SDK auto-falls back to WebRTC. Ensure:
1. Server supports HTTP/3
2. Valid SSL certificates
3. Firewall allows UDP

---

## Performance

### Bandwidth usage?

| Resolution | Video | Audio | Total |
|------------|-------|-------|-------|
| 360p | 400 Kbps | 48 Kbps | ~450 Kbps |
| 720p | 800 Kbps | 48 Kbps | ~850 Kbps |
