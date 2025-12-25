# Screen Share

Share your screen or application window with other participants.

## Basic Usage

```typescript
// Get screen capture stream
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 15 },
  },
  audio: true, // Optional: capture system audio
});

// Start sharing (SDK handles getDisplayMedia internally)
await room.startScreenShare();

// Stop sharing
await room.stopScreenShare();
```

## Options for getDisplayMedia

### Video Options

```typescript
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 15, max: 30 },
    cursor: 'always', // 'always', 'motion', 'never'
    displaySurface: 'monitor', // 'monitor', 'window', 'browser'
  },
});
```

### Audio Options

```typescript
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});
```

## Handling User Stop

When user clicks "Stop sharing" in browser UI:

```typescript
const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

screenStream.getVideoTracks()[0].onended = () => {
  console.log('User stopped screen sharing');
  room.stopScreenShare();
};
```

## Events

```typescript
// Screen share started
room.on('screenShareStarted', ({ stream, hasVideo, hasAudio }) => {
  console.log('Screen sharing started');
  console.log('Has audio:', hasAudio);
});

// Screen share stopped
room.on('screenShareStopped', () => {
  console.log('Screen sharing stopped');
});

// Remote screen share
room.on('remoteScreenShareReady', ({ streamId, videoStream }) => {
  screenVideo.srcObject = videoStream;
});
```

## Best Practices

### 1. Request Permission Early

```typescript
// Check if screen sharing is supported
const isSupported = 'getDisplayMedia' in navigator.mediaDevices;

// Request permission on user action (button click)
document.getElementById('share-btn').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    await room.startScreenShare();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      console.log('User denied screen sharing');
    }
  }
};
```

### 2. Handle System Audio Availability

```typescript
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,
});

const hasAudio = screenStream.getAudioTracks().length > 0;
if (!hasAudio) {
  console.log('System audio not available (user may have unchecked it)');
}
```

### 3. Cleanup on Stop

```typescript
room.on('screenShareStopped', () => {
  // Clear screen share preview
  screenPreview.srcObject = null;
  
  // Update UI
  shareButton.textContent = 'Share Screen';
});
```

## Browser Support

| Feature | Chrome | Edge | Safari | Firefox |
|---------|--------|------|--------|---------|
| Screen capture | ✅ | ✅ | ✅ | ✅ |
| Window capture | ✅ | ✅ | ✅ | ✅ |
| Tab capture | ✅ | ✅ | ❌ | ✅ |
| System audio | ✅ | ✅ | ❌ | ❌ |

> [!NOTE]
> System audio capture is only available on Chrome/Edge and may require user to check "Share audio" option.
