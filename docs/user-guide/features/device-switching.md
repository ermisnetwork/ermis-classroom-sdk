# Device Switching

Switch between cameras and microphones without interrupting your stream.

## Listing Available Devices

```typescript
async function getDevices() {
  // Request permissions first
  await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  
  // Get all devices
  const devices = await navigator.mediaDevices.enumerateDevices();
  
  const cameras = devices.filter(d => d.kind === 'videoinput');
  const microphones = devices.filter(d => d.kind === 'audioinput');
  const speakers = devices.filter(d => d.kind === 'audiooutput');
  
  return { cameras, microphones, speakers };
}
```

## Using MediaDeviceManager

The SDK provides a `MediaDeviceManager` for easier device management:

```typescript
import { MediaDeviceManager } from '@ermisnetwork/ermis-classroom-sdk';

const deviceManager = new MediaDeviceManager();

// Get all devices
const devices = await deviceManager.getDevices();
console.log('Cameras:', devices.cameras);
console.log('Microphones:', devices.microphones);
console.log('Speakers:', devices.speakers);
```

Or use the client's helper:

```typescript
const deviceManager = client.createMediaDeviceManager();
```

## Switching Camera

Switch camera via the local participant's publisher:

```typescript
const { cameras } = await getDevices();
const publisher = room.localParticipant?.publisher;

// Switch to a specific camera by device ID
const result = await publisher.switchVideoDevice(cameras[1].deviceId);
if (result) {
  // Update local video preview with new stream
  localVideo.srcObject = result.videoOnlyStream;
}
```

### Example: Camera Selector UI

```typescript
const cameraSelect = document.getElementById('camera-select');
const { cameras } = await getDevices();

// Populate dropdown
cameras.forEach(camera => {
  const option = document.createElement('option');
  option.value = camera.deviceId;
  option.text = camera.label || `Camera ${camera.deviceId.slice(0, 8)}`;
  cameraSelect.appendChild(option);
});

// Handle selection
cameraSelect.onchange = async () => {
  const publisher = room.localParticipant?.publisher;
  if (publisher) {
    await publisher.switchVideoDevice(cameraSelect.value);
  }
};
```

## Switching Microphone

```typescript
const { microphones } = await getDevices();
const publisher = room.localParticipant?.publisher;

// Switch to a specific microphone
await publisher.switchAudioDevice(microphones[1].deviceId);
```

### Example: Microphone Selector UI

```typescript
const micSelect = document.getElementById('mic-select');
const { microphones } = await getDevices();

// Populate dropdown
microphones.forEach(mic => {
  const option = document.createElement('option');
  option.value = mic.deviceId;
  option.text = mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`;
  micSelect.appendChild(option);
});

// Handle selection
micSelect.onchange = async () => {
  const publisher = room.localParticipant?.publisher;
  if (publisher) {
    await publisher.switchAudioDevice(micSelect.value);
  }
};
```

## Handling Device Changes

Devices can be plugged in or unplugged during a session:

```typescript
navigator.mediaDevices.ondevicechange = async () => {
  console.log('Device list changed');
  
  // Re-enumerate devices
  const { cameras, microphones } = await getDevices();
  
  // Update UI
  updateCameraDropdown(cameras);
  updateMicDropdown(microphones);
};
```

## Face Detection Camera

Switch based on camera facing direction (mobile):

```typescript
async function switchToFrontCamera() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  
  // Find front camera (label often contains 'front' or 'user')
  const frontCamera = cameras.find(c => 
    c.label.toLowerCase().includes('front') ||
    c.label.toLowerCase().includes('user')
  );
  
  if (frontCamera) {
    const publisher = room.localParticipant?.publisher;
    await publisher?.switchVideoDevice(frontCamera.deviceId);
  }
}

async function switchToBackCamera() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  
  const backCamera = cameras.find(c => 
    c.label.toLowerCase().includes('back') ||
    c.label.toLowerCase().includes('environment')
  );
  
  if (backCamera) {
    const publisher = room.localParticipant?.publisher;
    await publisher?.switchVideoDevice(backCamera.deviceId);
  }
}
```

## Virtual Devices

You can use virtual camera/microphone devices:

```typescript
// Virtual cameras (OBS, Snap Camera, etc.) appear as regular devices
const { cameras } = await getDevices();

const virtualCamera = cameras.find(c => 
  c.label.toLowerCase().includes('obs') ||
  c.label.toLowerCase().includes('snap') ||
  c.label.toLowerCase().includes('virtual')
);

if (virtualCamera) {
  const publisher = room.localParticipant?.publisher;
  await publisher?.switchVideoDevice(virtualCamera.deviceId);
}
```

## Error Handling

```typescript
try {
  const publisher = room.localParticipant?.publisher;
  await publisher?.switchVideoDevice(deviceId);
} catch (error) {
  if (error.name === 'NotFoundError') {
    console.error('Camera not found');
  } else if (error.name === 'NotAllowedError') {
    console.error('Camera access denied');
  } else if (error.name === 'NotReadableError') {
    console.error('Camera in use by another application');
  } else {
    console.error('Camera switch failed:', error);
  }
}
```

## Best Practices

1. **Always request permission first** before enumerating devices
2. **Handle device changes** dynamically
3. **Provide fallback** if device switching fails
4. **Show device labels** clearly to users
5. **Remember user preferences** using localStorage
