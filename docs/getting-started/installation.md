# Installation

## Package Installation

Install the SDK using your preferred package manager:

```bash
# npm
npm install @ermisnetwork/ermis-classroom-sdk

# pnpm (recommended)
pnpm add @ermisnetwork/ermis-classroom-sdk

# yarn
yarn add @ermisnetwork/ermis-classroom-sdk
```

## Vite Plugin (Recommended)

If using Vite, add the SDK plugin to automatically configure required assets:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { ermisClassroomPlugin } from '@ermisnetwork/ermis-classroom-sdk/vite-plugin';

export default defineConfig({
  plugins: [
    ermisClassroomPlugin(),
    // your other plugins...
  ],
});
```

The plugin automatically copies:
- WASM modules for audio encoding (Opus)
- FEC encoding (RaptorQ)
- Polyfills for MediaStreamTrackProcessor

## Manual Setup (Non-Vite)

If not using Vite, copy these files to your public folder:

1. **Opus Decoder WASM** - Required for audio encoding
2. **RaptorQ WASM** - Required for FEC (WebRTC only)
3. **Polyfills** - Required for older browsers

```bash
# Copy from node_modules to public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/opus_decoder public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/raptorQ public/
cp -r node_modules/@ermisnetwork/ermis-classroom-sdk/dist/polyfills public/
```

## TypeScript Configuration

Add the SDK types to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@ermisnetwork/ermis-classroom-sdk"]
  }
}
```

## Server Requirements

You'll need a compatible media server with:
- WebTransport endpoint (for publishing)
- HTTP/3 support (recommended)
- WebRTC signaling endpoint (fallback)

## Next Steps

- [Quick Start](quick-start.md) - Create your first video call
