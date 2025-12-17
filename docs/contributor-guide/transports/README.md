# Transports

The SDK supports two transport protocols for media streaming:

1. [WebTransport](webtransport.md) - Modern HTTP/3-based streaming (primary)
2. [WebRTC](webrtc.md) - Traditional peer-to-peer streaming (fallback)

## Transport Selection

```typescript
// Automatic selection based on browser support
if (typeof WebTransport !== 'undefined' && !config.useWebRTC) {
    // Use WebTransport (preferred)
    transport = 'webtransport';
} else {
    // Use WebRTC DataChannels (fallback)
    transport = 'webrtc';
}
```

## Comparison

| Feature | WebTransport | WebRTC |
|---------|--------------|--------|
| **Protocol** | HTTP/3 + QUIC | DTLS + SCTP |
| **Browser Support** | Chrome 94+, Edge 94+ | All modern browsers |
| **Safari Support** | ❌ | ✅ |
| **Latency** | Lower | Higher (due to FEC) |
| **Reliability** | Built-in | FEC-based |
| **Connection Model** | Client-Server | Peer-to-Peer |
| **NAT Traversal** | Simple (HTTP/3) | ICE candidates |

## Data Flow

### WebTransport

```
Client                          Server
   │                              │
   │──── QUIC Handshake ─────────▶│
   │◀─── QUIC Handshake ──────────│
   │                              │
   │──── Create Stream ──────────▶│
   │◀─── Stream Ready ────────────│
   │                              │
   │──── Length-delimited ───────▶│
   │     packets                  │
   │                              │
```

### WebRTC

```
Client                         Signaling                         Server
   │                              │                                │
   │──── Create Offer ───────────▶│───── Forward ─────────────────▶│
   │◀─── Answer ──────────────────│◀──── Answer ───────────────────│
   │                              │                                │
   │◀─── ICE Candidates ──────────│◀──── ICE Candidates ───────────│
   │                              │                                │
   │◀═════════════════════════════════ DTLS + SCTP ═══════════════▶│
   │                              │                                │
   │──── FEC-encoded packets ════════════════════════════════════▶│
   │                              │                                │
```

## Channel Names

Both transports use the same channel names:

| Channel Name | Purpose | Data Type |
|--------------|---------|-----------|
| `meeting_control` | Meeting commands | JSON |
| `mic_48k` | Microphone audio | Opus |
| `video_360` | 360p video | H.264 |
| `video_720` | 720p video | H.264 |
| `screen_share_720` | Screen share | H.264 |
| `screen_share_audio` | Screen audio | Opus |

## Implementation Files

- `WebTransportManager.ts` - WebTransport connection handling
- `WebRTCManager.ts` - WebRTC connection handling
- `StreamManager.ts` - Unified stream/channel management
