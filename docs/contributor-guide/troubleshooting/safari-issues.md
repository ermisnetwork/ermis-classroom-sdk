# Safari Issues

Safari has several unique behaviors that require special handling in the SDK.

## WebTransport Not Supported

Safari does not support WebTransport. The SDK automatically falls back to WebRTC.

```typescript
// Force WebRTC for Safari
const room = new Room({
  roomId: 'my-room',
  publishUrl: 'https://server.com/publish',
  webRtcHost: 'server.com',
  useWebRTC: true,  // Required for Safari
});
```

## Audio Timing Issue (mic_48k)

### Problem

Safari may open WebRTC DataChannels in a different order than Chrome/Firefox. This can cause the `mic_48k` (microphone) channel to not be ready when audio encoding starts, resulting in dropped audio packets.

### Symptoms

- Video works but audio does not stream
- No error messages in console
- `video_360` and `video_720` channels work fine
- `meeting_control` channel works fine
- Only `mic_48k` channel fails silently

### Root Cause

The audio encoding system starts sending packets immediately after initialization, but Safari's DataChannel for `mic_48k` may not be open yet:

```typescript
// BEFORE FIX - packets dropped if channel not ready
async sendAudioChunk(channelName, audioData, timestamp) {
    const streamData = this.streams.get(channelName);
    if (!streamData) {
        return;  // Silent fail - no waiting!
    }
    // ...
}
```

### Solution (Implemented)

The SDK now waits for the stream to be ready before sending audio:

```typescript
// AFTER FIX - wait for stream
async sendAudioChunk(channelName, audioData, timestamp) {
    let streamData = this.streams.get(channelName);
    
    // Wait for stream to be ready (Safari fix)
    if (!streamData) {
        try {
            streamData = await this.waitForStream(channelName, 5000);
        } catch (error) {
            console.warn('Stream not ready:', error);
            return;
        }
    }

    // Additional check for DataChannel state
    if (this.isWebRTC && streamData.dataChannel) {
        if (streamData.dataChannel.readyState !== "open") {
            return; // Skip until open
        }
    }
    
    // Send audio...
}
```

### Code Location

- **File**: `packages/sdk/src/media/publisher/transports/StreamManager.ts`
- **Method**: `sendAudioChunk()`
- **Lines**: 568-618

## Autoplay Policy

Safari has strict autoplay policies. Audio/video will not play without user interaction.

### Problem

```typescript
// This will fail in Safari without user interaction
videoElement.play(); // DOMException: NotAllowedError
```

### Solution

Always call `play()` in response to a user action:

```typescript
document.getElementById('join-btn').onclick = async () => {
    await room.joinAsPublisher({ hasCamera: true, hasMic: true });
    
    room.on('localStreamReady', ({ videoOnlyStream }) => {
        const video = document.getElementById('local-video');
        video.srcObject = videoOnlyStream;
        video.play(); // OK - within user gesture
    });
};
```

Or use `muted` attribute for videos:

```typescript
// Muted videos can autoplay
<video autoplay muted playsinline id="local-video"></video>
```

## getUserMedia Differences

Safari requires specific attributes for video elements:

```html
<!-- Required for iOS Safari -->
<video autoplay playsinline></video>
```

Without `playsinline`, iOS Safari will open video in fullscreen.

## Screen Recording Permissions

Safari requires explicit permission for screen recording, which must be enabled in System Preferences:

1. Open **System Preferences** → **Security & Privacy** → **Privacy**
2. Select **Screen Recording**
3. Add your browser to the allowed list

## WebRTC Codec Support

Safari's WebRTC implementation has limited codec support:

| Codec | Safari Support |
|-------|---------------|
| H.264 | ✅ Baseline, Main |
| VP8 | ✅ Supported |
| VP9 | ❌ Not supported |
| AV1 | ❌ Not supported |
| Opus | ✅ Supported |

The SDK uses H.264 Baseline which is widely supported.

## Debugging Tips

1. **Check Safari Web Inspector** (Develop menu → Show Web Inspector)
2. **Enable verbose logging** in the SDK
3. **Monitor DataChannel states** in console
4. **Test with Safari Technology Preview** for latest fixes

## Related Issues

- [WebKit Bug 176083](https://bugs.webkit.org/show_bug.cgi?id=176083) - WebTransport support
- [WebKit Bug 204483](https://bugs.webkit.org/show_bug.cgi?id=204483) - DataChannel timing
