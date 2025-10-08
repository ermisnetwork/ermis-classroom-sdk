# Ermis Classroom SDK - React Example

This example demonstrates how to use the Ermis Classroom SDK with React and TypeScript.

## Features

- ✅ Client-side media stream management
- ✅ Camera/microphone preview before joining
- ✅ Error handling for media permissions
- ✅ Audio-only, video-only support
- ✅ Pin participants (locally or for everyone)
- ✅ Real-time participant management
- ✅ Screen sharing support

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Development Server

```bash
npm run dev
```

### 3. Open in Browser

Navigate to `http://localhost:5173`

## How It Works

### Media Stream Management

The example follows the SDK's new media stream management approach:

1. **Request Media Access Early**
   - Media stream is requested after authentication
   - User sees preview before joining room
   - Errors are handled gracefully

2. **Join Room with Media Stream**
   ```typescript
   const mediaStream = await navigator.mediaDevices.getUserMedia({
     video: true,
     audio: true
   });
   await client.joinRoom(roomCode, mediaStream);
   ```

3. **Handle Errors**
   - `NotAllowedError`: Permission denied
   - `NotFoundError`: No camera/microphone
   - `NotReadableError`: Device in use

### Key Components

**VideoMeeting.tsx** - Main component with:
- Authentication flow
- Media stream request and preview
- Room joining with media stream
- Participant video grid
- Media controls (mic, camera, leave)
- Pin functionality

## Usage

1. **Connect**: Enter your email and click "Connect"
2. **Allow Permissions**: Grant camera/microphone access when prompted
3. **Preview**: See your video preview
4. **Join Room**: Enter room code and click "Join Room"
5. **Controls**: Use bottom controls to toggle mic/camera or leave

## Media Stream Features

### Preview Before Joining
- Shows local video preview after permissions granted
- Displays status messages for media access
- Retry button if permissions denied

### Error Handling
- Clear error messages for permission issues
- Automatic retry mechanism
- Graceful degradation support

### Device Management
- Uses browser's native `getUserMedia()`
- Supports device switching (can be extended)
- Proper cleanup on component unmount

## Project Structure

```
src/
├── VideoMeeting.tsx    # Main video meeting component
├── App.tsx             # App wrapper
└── main.tsx            # Entry point
```

## Technologies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Styled Components** - Styling
- **Ermis Classroom SDK** - Video calling

## Learn More

- [SDK Documentation](../../README.md)
- [Media Stream Management Guide](../../README.md#media-stream-management)
- [API Reference](../../README.md#api-reference)

