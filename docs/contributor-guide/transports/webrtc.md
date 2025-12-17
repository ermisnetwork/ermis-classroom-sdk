# WebRTC Implementation

WebRTC serves as the fallback transport when WebTransport is not available (e.g., Safari).

## Overview

The SDK uses WebRTC DataChannels for media transport, not the traditional RTP-based media tracks. This approach:

- Gives full control over encoding
- Enables custom FEC (Forward Error Correction)
- Maintains consistent API with WebTransport
- Works with existing server infrastructure

## Connection Flow

```typescript
// WebRTCManager.ts
async connectMultipleChannels(
    channelNames: string[],
    streamManager: StreamManager
): Promise<void> {
    for (const channelName of channelNames) {
        // Create new peer connection for each channel
        const webRtc = new RTCPeerConnection();
        this.peerConnections.set(channelName, webRtc);

        // Create data channel
        streamManager.createDataChannelDirect(channelName, webRtc);

        // Create and send offer
        const offer = await webRtc.createOffer();
        await webRtc.setLocalDescription(offer);

        // Exchange SDP with server
        const response = await fetch(`https://${this.serverUrl}/meeting/sdp/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                offer,
                room_id: this.roomId,
                stream_id: this.streamId,
                action: channelName,
            }),
        });

        const answer = await response.json();
        await webRtc.setRemoteDescription(answer);
    }
}
```

## DataChannel Creation

```typescript
// StreamManager.ts
async createDataChannelDirect(
    channelName: ChannelName, 
    peerConnection: RTCPeerConnection
): Promise<void> {
    const ordered = channelName === ChannelName.MEETING_CONTROL;

    const dataChannel = peerConnection.createDataChannel(channelName, {
        ordered,        // Ordered only for control channel
        id: 0,          // Fixed ID
        negotiated: true, // Pre-negotiated
    });

    dataChannel.binaryType = "arraybuffer";

    // Set buffer thresholds based on channel type
    if (channelName.includes("1080p")) {
        dataChannel.bufferedAmountLowThreshold = 65536;
    } else if (channelName.includes("720p")) {
        dataChannel.bufferedAmountLowThreshold = 32768;
    } else {
        dataChannel.bufferedAmountLowThreshold = 16384;
    }

    dataChannel.onopen = async () => {
        this.streams.set(channelName, {
            dataChannel,
            dataChannelReady: true,
            configSent: false,
        });
        
        this.emit("streamReady", { channelName });
    };

    dataChannel.onbufferedamountlow = () => {
        // Drain queued packets
        const queue = this.getQueue(channelName);
        while (queue.length > 0 && 
               dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold) {
            const packet = queue.shift();
            if (packet) dataChannel.send(packet);
        }
    };
}
```

## FEC Encoding (RaptorQ)

Video packets use Forward Error Correction for reliability:

```typescript
private async sendViaDataChannel(
    channelName: ChannelName,
    streamData: StreamData,
    packet: Uint8Array,
    frameType: FrameType
): Promise<void> {
    const needFecEncode = frameType !== FrameType.EVENT 
                       && frameType !== FrameType.AUDIO;

    if (needFecEncode) {
        // FEC encoding for video
        const MAX_MTU = 512;
        const MIN_CHUNKS = 5;
        const REDUNDANCY_RATIO = 0.1;

        let MTU = Math.ceil(packet.length / MIN_CHUNKS);
        MTU = Math.max(100, Math.min(MTU, MAX_MTU));

        const totalPackets = Math.ceil(packet.length / (MTU - 20));
        let redundancy = Math.ceil(totalPackets * REDUNDANCY_RATIO);
        redundancy = Math.max(1, Math.min(redundancy, 10));

        const encoder = new this.WasmEncoder(packet, MTU - 20);
        const configBuf = encoder.getConfigBuffer();
        const fecPackets = encoder.encode(redundancy);

        // Send each FEC symbol
        for (const fecPacket of fecPackets) {
            const wrapper = PacketBuilder.createFECPacket(
                fecPacket,
                sequenceNumber,
                transportPacketType,
                raptorQConfig
            );
            this.sendOrQueue(channelName, dataChannel, wrapper);
        }

        encoder.free();
    } else {
        // No FEC for audio/events
        const wrapper = PacketBuilder.createRegularPacket(packet, ...);
        this.sendOrQueue(channelName, dataChannel, wrapper);
    }
}
```

## Packet Queuing

To handle DataChannel backpressure:

```typescript
private sendOrQueue(
    channelName: ChannelName,
    dataChannel: RTCDataChannel,
    packet: Uint8Array
): void {
    const queue = this.getQueue(channelName);

    if (dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold 
        && queue.length === 0) {
        // Send immediately
        dataChannel.send(packet.slice());
    } else {
        // Queue for later
        queue.push(packet);
    }
}
```

## FEC Packet Format

```
┌─────────────────────────────────────────┐
│ Sequence Number (4 bytes)               │
├─────────────────────────────────────────┤
│ Packet Type (1 byte)                    │
├─────────────────────────────────────────┤
│ RaptorQ Config (14 bytes)               │
│ ┌─────────────────────────────────────┐ │
│ │ Transfer Length (8 bytes)           │ │
│ │ Symbol Size (2 bytes)               │ │
│ │ Source Blocks (1 byte)              │ │
│ │ Sub Blocks (2 bytes)                │ │
│ │ Alignment (1 byte)                  │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ FEC Symbol Data (variable)              │
└─────────────────────────────────────────┘
```

## Screen Share with WebRTC

Screen share creates additional peer connections:

```typescript
// StreamManager.ts
async addStream(channelName: ChannelName): Promise<void> {
    if (this.isWebRTC) {
        // Create new connection for screen share
        await this.createDataChannelForScreenShare(channelName);
    } else {
        await this.createBidirectionalStream(channelName);
    }
}

private async createDataChannelForScreenShare(
    channelName: ChannelName
): Promise<void> {
    // Use WebRTCManager to create new peer connection
    await this.webRtcManager.connectMultipleChannels([channelName], this);
}
```

## Browser Support

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 25+ | ✅ Full support |
| Edge | 79+ | ✅ Full support |
| Safari | 11+ | ✅ Full support |
| Firefox | 22+ | ✅ Full support |

## Known Issues

### Safari Audio Timing

Safari may open DataChannels in a different order, causing audio packets to be dropped before the channel is ready.

**Solution**: The SDK now waits for the stream to be ready before sending audio:

```typescript
async sendAudioChunk(channelName, audioData, timestamp): Promise<void> {
    let streamData = this.streams.get(channelName);
    
    if (!streamData) {
        // Wait for stream to be ready (Safari fix)
        streamData = await this.waitForStream(channelName, 5000);
    }
    
    // Check DataChannel state
    if (streamData.dataChannel?.readyState !== "open") {
        return; // Skip if not open
    }
    
    // Send audio...
}
```

See [Safari Issues](../troubleshooting/safari-issues.md) for more details.

## Performance Tips

1. **Set appropriate buffer thresholds** based on channel type
2. **Use queuing** to handle backpressure
3. **Monitor ICE state** for connection health
4. **Free WASM encoders** after use to prevent memory leaks
