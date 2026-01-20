# Event Integration Guide

This guide shows how to integrate and handle SDK events in your application.

> 📚 **Need a complete event reference?** See [Events](events.md) for a full list of all available events, their parameters, and basic usage syntax.

## Quick Start

The SDK provides two ways to listen to events:

### 1. Direct Room Events (Low-level)
```typescript
import { Room } from '@ermisnetwork/ermis-classroom-sdk'

room.on('participantRemovedByHost', (event) => {
  console.log('Participant removed:', event)
})
```

### 2. Context Hooks (Recommended for React)
```typescript
import { useErmisClassroom } from '@ermisnetwork/ermis-classroom-react'

const { onParticipantRemoved } = useErmisClassroom()

useEffect(() => {
  const unsubscribe = onParticipantRemoved((data) => {
    // Handle event
  })
  return unsubscribe // Always cleanup
}, [onParticipantRemoved])
```

## Participant Removal Event

### Event Structure

```typescript
interface ParticipantRemovedEvent {
  participant: Participant  // Removed participant
  reason: string           // Optional reason from host
  isLocal: boolean         // true if you were removed
}
```

### Complete Example

```typescript
import { useEffect, useState } from 'react'
import { useErmisClassroom } from '@ermisnetwork/ermis-classroom-react'

function MeetingRoom({ onNavigateToHome }) {
  const { currentRoom, leaveRoom } = useErmisClassroom()
  const [kickNotification, setKickNotification] = useState(null)

  useEffect(() => {
    if (!currentRoom) return

    const handleParticipantRemoved = (event) => {
      if (event.isLocal) {
        // You were removed - show notification
        setKickNotification({
          message: event.reason || 'You have been removed',
          timestamp: Date.now()
        })
        
        // Cleanup and navigate after 3 seconds
        setTimeout(async () => {
          try {
            await leaveRoom() // SDK cleanup
          } catch (error) {
            console.error('Cleanup error:', error)
          } finally {
            onNavigateToHome() // Navigate away
          }
        }, 3000)
      } else {
        // Someone else was removed - UI auto-updates
        console.log(`${event.participant.userId} removed`)
      }
    }

    // Register listener
    currentRoom.on('participantRemovedByHost', handleParticipantRemoved)

    // Cleanup on unmount
    return () => {
      currentRoom.off('participantRemovedByHost', handleParticipantRemoved)
    }
  }, [currentRoom, leaveRoom, onNavigateToHome])

  // Render notification
  if (kickNotification) {
    return (
      <div className="notification-modal">
        <h3>Removed from Meeting</h3>
        <p>{kickNotification.message}</p>
        <p>Leaving automatically...</p>
        <button onClick={() => leaveRoom().then(onNavigateToHome)}>
          Leave Now
        </button>
      </div>
    )
  }

  return <div>{/* Your meeting UI */}</div>
}
```

## Available Events

### Room Lifecycle

```typescript
// Room ending
room.on('roomEnded', (event) => {
  // Host ended the meeting
  console.log('Reason:', event.reason)
})

// Leaving room
room.on('leaving', (event) => {
  // Started leaving process
})

room.on('left', (event) => {
  // Completely left room
})
```

### Participant Events

```typescript
// Participant joined
room.on('participantAdded', (event) => {
  console.log(`${event.participant.userId} joined`)
})

// Participant left
room.on('participantRemoved', (event) => {
  console.log(`${event.participant.userId} left`)
})

// Participant removed by host
room.on('participantRemovedByHost', (event) => {
  if (event.isLocal) {
    // You were kicked
  } else {
    // Someone else was kicked
  }
})
```

### Stream Events

```typescript
// Stream added
room.on('participantStreamAdded', (event) => {
  const { participant, stream } = event
  // Attach stream to video element
})

// Stream removed
room.on('participantStreamRemoved', (event) => {
  // Remove stream from UI
})
```

## Using Context Callbacks

Recommended approach for React applications:

```typescript
const {
  onRoomEnded,
  onParticipantRemoved,
  currentRoom
} = useErmisClassroom()

// Room ended by host
useEffect(() => {
  const unsubscribe = onRoomEnded(() => {
    console.log('Meeting ended')
    navigate('/home')
  })
  return unsubscribe
}, [onRoomEnded])

// Participant removed
useEffect(() => {
  const unsubscribe = onParticipantRemoved((data) => {
    if (data.isLocal) {
      // Handle being removed
      showNotification(data.reason)
      cleanup()
    }
  })
  return unsubscribe
}, [onParticipantRemoved])
```

## Event Flow: Removal Process

1. **Host removes participant:**
```typescript
await removeParticipant(userId, "Breaking rules")
```

2. **Server broadcasts event to all clients**

3. **SDK dispatches event:**
```typescript
// Internal - handled automatically
room.emit('participantRemovedByHost', {
  participant,
  reason,
  isLocal: participant.userId === localUserId
})
```

4. **Your app receives event:**
```typescript
currentRoom.on('participantRemovedByHost', (event) => {
  if (event.isLocal) {
    handleBeingRemoved(event.reason)
  }
})
```

5. **Cleanup and navigate:**
```typescript
await leaveRoom()    // SDK cleanup
navigate('/home')    // App navigation
```

## Best Practices

### ✅ Always Do

**1. Cleanup Listeners**
```typescript
useEffect(() => {
  const handler = (event) => { /* ... */ }
  currentRoom.on('event', handler)
  
  return () => {
    currentRoom.off('event', handler)
  }
}, [currentRoom])
```

**2. Error Handling**
```typescript
try {
  await leaveRoom()
} catch (error) {
  console.error('Cleanup failed:', error)
} finally {
  navigate('/home') // Always navigate
}
```

**3. Check Existence**
```typescript
if (currentRoom) {
  currentRoom.on('event', handler)
}
```

### ❌ Never Do

**1. Forget Cleanup**
```typescript
// BAD - memory leak
useEffect(() => {
  currentRoom.on('event', handler)
  // Missing return cleanup
}, [])
```

**2. Navigate Without Cleanup**
```typescript
// BAD - resource leak
if (event.isLocal) {
  navigate('/home') // SDK still has resources
}
```

**3. Missing Error Handling**
```typescript
// BAD - might throw
await leaveRoom()
navigate('/home') // May not reach here
```

## Integration Checklist

When integrating into a new application:

- [ ] Install: `@ermisnetwork/ermis-classroom-react`
- [ ] Wrap app with `<ErmisClassroomProvider>`
- [ ] Use `useErmisClassroom()` hook
- [ ] Listen to required events
- [ ] Implement cleanup before navigation
- [ ] Test scenarios:
  - [ ] Being removed from meeting
  - [ ] Seeing others removed
  - [ ] Host ending meeting
  - [ ] Network disconnection

## Common Issues

### Race Condition with Cleanup

**Problem:** Navigating immediately causes preview re-init during cleanup

**Solution:** Always await cleanup before navigation
```typescript
// Good
setTimeout(async () => {
  await leaveRoom()    // Wait for cleanup
  navigate('/home')    // Then navigate
}, 3000)
```

### Memory Leaks

**Problem:** Event listeners not cleaned up

**Solution:** Always return cleanup function
```typescript
useEffect(() => {
  const handler = (e) => { /* ... */ }
  room?.on('event', handler)
  
  return () => {
    room?.off('event', handler)
  }
}, [room])
```

## TypeScript Support

```typescript
import type { 
  Participant,
  Room,
  ParticipantRemovedEvent 
} from '@ermisnetwork/ermis-classroom-sdk'

const handleRemoved = (event: ParticipantRemovedEvent) => {
  // Fully typed
  console.log(event.participant.userId)
  console.log(event.reason)
  console.log(event.isLocal)
}
```

## Summary

**Core integration steps:**

1. Use `useErmisClassroom()` hook to access SDK
2. Listen to events with `room.on()` or callback APIs
3. **Always** cleanup listeners in `useEffect` return
4. Handle removal: show UI → cleanup → navigate
5. Test all scenarios thoroughly

**Key principle:** The SDK handles internal cleanup (stopping publishers, closing connections). Your app needs to:
- Listen to events
- Update UI accordingly
- Call `leaveRoom()` to trigger cleanup  
- Navigate after cleanup completes
