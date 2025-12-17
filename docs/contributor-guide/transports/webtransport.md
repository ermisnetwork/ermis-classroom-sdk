# WebTransport Implementation

WebTransport is the primary transport protocol for the SDK, offering lower latency than WebRTC.

## Overview

WebTransport is a modern web API built on HTTP/3 and QUIC, providing:

- Bidirectional streams
- Unreliable datagrams
- Multiplexed connections
- Lower latency than WebSockets

## Connection Flow

```typescript
// WebTransportManager.ts
async connect(): Promise<WebTransport> {
    const webTransport = new WebTransport(this.url);
    
    // Wait for connection to be ready
    await webTransport.ready;
    
    return webTransport;
}
```

## Stream Creation

For each media channel, we create a bidirectional stream:

```typescript
// StreamManager.ts
private async createBidirectionalStream(
    channelName: ChannelName
): Promise<void> {
    const stream = await this.webTransport.createBidirectionalStream();
    const readable = stream.readable;
    const writable = stream.writable;

    const writer = writable.getWriter();
    const reader = readable.getReader();

    this.streams.set(channelName, {
        writer,
        reader,
        configSent: false,
        config: null,
    });

    // Initialize channel with server
    await this.sendInitChannelStream(channelName);
}
```

## Packet Format

All packets use length-delimited format:

```
┌─────────────────────────────────────────┐
│ Length (4 bytes, big-endian)            │
├─────────────────────────────────────────┤
│ Packet Data                             │
│ ┌─────────────────────────────────────┐ │
│ │ Sequence (4 bytes)                  │ │
│ ├─────────────────────────────────────┤ │
│ │ Timestamp (8 bytes)                 │ │
│ ├─────────────────────────────────────┤ │
│ │ Frame Type (1 byte)                 │ │
│ ├─────────────────────────────────────┤ │
│ │ Payload (variable)                  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Sending Data

```typescript
private async sendViaWebTransport(
    streamData: StreamData,
    packet: Uint8Array
): Promise<void> {
    if (!streamData.writer) {
        throw new Error("Stream writer not available");
    }

    // Wrap packet with length prefix
    const len = packet.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false); // Big-endian
    out.set(packet, 4);

    await streamData.writer.write(out.slice());
}
```

## Receiving Events

For the `meeting_control` channel, we read server events:

```typescript
private setupEventStreamReader(
    reader: ReadableStreamDefaultReader<Uint8Array>
): void {
    const delimitedReader = new LengthDelimitedReader(reader);

    (async () => {
        while (true) {
            const message = await delimitedReader.readMessage();
            
            if (message === null) {
                break; // Stream ended
            }

            const messageStr = new TextDecoder().decode(message);
            const event = JSON.parse(messageStr);
            
            globalEventBus.emit(GlobalEvents.SERVER_EVENT, event);
        }
    })();
}
```

## Channel Initialization

Each channel is initialized with a JSON command:

```typescript
private async sendInitChannelStream(channelName: ChannelName): Promise<void> {
    const command = {
        type: "init_channel_stream",
        data: {
            channel: channelName,
        },
    };

    const commandJson = JSON.stringify(command);
    const commandBytes = new TextEncoder().encode(commandJson);

    // Send with length-delimited format
    const len = commandBytes.length;
    const out = new Uint8Array(4 + len);
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);
    out.set(commandBytes, 4);

    await streamData.writer.write(out.slice());
}
```

## Browser Support

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 94+ | ✅ Full support |
| Edge | 94+ | ✅ Full support |
| Safari | - | ❌ Not supported |
| Firefox | - | ❌ Not supported |

## Server Requirements

Your server must support:

1. **HTTP/3** protocol
2. **WebTransport** protocol (draft or final)
3. **QUIC** with TLS 1.3
4. Valid TLS certificate (required for QUIC)

## Error Handling

```typescript
try {
    const webTransport = new WebTransport(url);
    await webTransport.ready;
} catch (error) {
    if (error.name === 'WebTransportError') {
        console.error('WebTransport connection failed:', error.message);
        // Fall back to WebRTC
    }
}

// Handle connection close
webTransport.closed.then((info) => {
    console.log('Connection closed:', info.reason);
});
```

## Performance Tips

1. **Reuse streams** - Don't create new streams for each packet
2. **Batch small packets** - Combine related data when possible
3. **Use appropriate buffer sizes** - Match your media bitrate
4. **Monitor backpressure** - Check writer's `ready` promise
