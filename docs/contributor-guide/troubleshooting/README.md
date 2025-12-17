# Troubleshooting

This section covers common issues and their solutions.

## Contents

- [Safari Issues](safari-issues.md) - Safari-specific problems and fixes

## Quick Troubleshooting Checklist

### Connection Issues

- [ ] Check server is running and reachable
- [ ] Verify SSL certificates are valid
- [ ] Check network allows HTTP/3 (for WebTransport)
- [ ] Try WebRTC fallback if WebTransport fails

### Audio/Video Issues

- [ ] Check camera/microphone permissions
- [ ] Verify hardware is not in use by another app
- [ ] Check tracks are not muted
- [ ] Verify config was sent before data

### Safari-Specific

- [ ] Use WebRTC mode (WebTransport not supported)
- [ ] Check for audio timing issues
- [ ] Verify user interaction before play()

## Common Error Messages

### "WebTransport not initialized"

**Cause**: Trying to use WebTransport before connection is ready.

**Solution**: Wait for connection promise to resolve.

### "Stream not found"

**Cause**: Trying to send data before stream is created.

**Solution**: Wait for `streamReady` event.

### "DataChannel not ready"

**Cause**: WebRTC DataChannel not yet open.

**Solution**: The SDK now waits for channels automatically.

### "WASM encoder not initialized"

**Cause**: RaptorQ WASM module not loaded.

**Solution**: Ensure WASM files are in `public/raptorQ/`.
