# Event Handling Guide - Mic & Camera Status Updates

## Overview
This guide explains how mic and camera status changes are handled and reflected in the UI.

## Event Flow

### 1. Local Participant (Your mic/camera)

```
User clicks toggle button 
  → handleToggleMicrophone() / handleToggleCamera() 
  → participant.toggleMicrophone() / participant.toggleCamera()
  → Publisher sends event to server
  → Participant emits "audioToggled" / "videoToggled" event
  → Room forwards event to ErmisClient
  → UI receives event and updates state
```

### 2. Remote Participants (Other users' mic/camera)

```
Remote user toggles their mic/camera
  → Server sends event to all participants
  → Publisher receives server event
  → Room handles event in _handleServerEvent()
  → Room emits "remoteAudioStatusChanged" / "remoteVideoStatusChanged"
  → ErmisClient forwards event
  → UI updates remote participant's status
```

## Events

### Local Events (Participant.js)
- `audioToggled` - Emitted when local mic is toggled
- `videoToggled` - Emitted when local camera is toggled

### Remote Events (Room.js)
- `remoteAudioStatusChanged` - Emitted when remote participant's mic changes
- `remoteVideoStatusChanged` - Emitted when remote participant's camera changes

### Server Events
- `mic_on` / `mic_off` - Server notification of mic status change
- `camera_on` / `camera_off` - Server notification of camera status change

## Implementation Details

### In Participant.js
```javascript
async toggleMicrophone() {
  await this.publisher.toggleMic();
  this.isAudioEnabled = !this.isAudioEnabled;
  this.emit("audioToggled", {
    participant: this,
    enabled: this.isAudioEnabled,
  });
}
```

### In Room.js
```javascript
// Forward participant events
_setupParticipantEvents(participant) {
  participant.on("audioToggled", ({ participant: p, enabled }) => {
    this.emit("audioToggled", {
      room: this,
      participant: p,
      enabled,
    });
  });
}

// Handle server events
async _handleServerEvent(event) {
  if (event.type === "mic_on") {
    const participant = this.participants.get(event.participant.user_id);
    if (participant) {
      participant.updateMicStatus(true);
      this.emit("remoteAudioStatusChanged", {
        room: this,
        participant,
        enabled: true,
      });
    }
  }
}
```

### In ErmisClient.js
```javascript
_setupRoomEvents(room) {
  const eventsToForward = [
    "audioToggled",
    "videoToggled",
    "remoteAudioStatusChanged",
    "remoteVideoStatusChanged",
    // ... other events
  ];
  
  eventsToForward.forEach((event) => {
    room.on(event, (data) => {
      this.emit(event, data);
    });
  });
}
```

### In VideoMeeting.tsx (UI)
```javascript
// Setup event listeners
client.on(events.REMOTE_AUDIO_STATUS_CHANGED, (data) => {
  setParticipants((prev) => {
    const updated = new Map(prev);
    const participant = updated.get(data.participant.userId);
    if (participant) {
      participant.isAudioEnabled = data.enabled;
      updated.set(data.participant.userId, participant);
    }
    return updated;
  });
});

client.on("audioToggled", (data) => {
  if (data.participant.isLocal) {
    setIsMicEnabled(data.enabled);
    setParticipants((prev) => {
      const updated = new Map(prev);
      const participant = updated.get(data.participant.userId);
      if (participant) {
        participant.isAudioEnabled = data.enabled;
        updated.set(data.participant.userId, participant);
      }
      return updated;
    });
  }
});
```

## UI State Management

### State Variables
- `isMicEnabled` - Controls local mic button appearance
- `isVideoEnabled` - Controls local camera button appearance
- `participants` - Map containing all participant states including audio/video status

### Button Controls
```javascript
const handleToggleMicrophone = async () => {
  const p = participants.get(userId);
  if (!p) return;
  
  await p.toggleMicrophone();
  // Update immediately after toggle
  setIsMicEnabled(p.isAudioEnabled);
  
  // Trigger re-render
  setParticipants(prev => {
    const updated = new Map(prev);
    updated.set(userId, p);
    return updated;
  });
};
```

### Visual Indicators
- Mic icon changes: `MdMic` (enabled) ↔ `MdMicOff` (disabled)
- Camera icon changes: `MdVideocam` (enabled) ↔ `MdVideocamOff` (disabled)
- Button color changes: Green (active) ↔ Gray (inactive)
- Participant info shows muted icon when mic is off

## Testing

### Test Local Toggle
1. Click mic button → Icon should change immediately
2. Check button color changes from green to gray
3. Verify participant info shows mic-off icon

### Test Remote Status
1. Have another user toggle their mic/camera
2. Verify their video tile updates immediately
3. Check muted icon appears/disappears on their tile

## Troubleshooting

### Issue: UI doesn't update when toggling
**Solution**: Check that events are properly forwarded through:
- Participant → Room → ErmisClient → UI

### Issue: Remote status not updating
**Solution**: Verify server events are being received in `_handleServerEvent()`

### Issue: State out of sync
**Solution**: Always update both the participant object and the state map
