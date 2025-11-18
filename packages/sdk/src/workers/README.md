# Workers Directory

This directory contains Web Worker files that run in isolated JavaScript contexts.

## Why duplicate files exist?

### Workers vs Main Code

Workers run in a separate JavaScript context and **cannot import** from the main codebase TypeScript files. They need self-contained JavaScript files.

### File Organization

```
workers/
├── publisherConstants.js       # Constants for workers (JS, self-contained)
├── ClientCommand.js            # Command sender for workers (unified)
├── media-worker-*.js           # Various worker implementations
└── README.md                   # This file

src/
├── constants/
│   └── publisherConstants.ts   # Constants for main code (TS, uses enums)
├── media/publisher/
│   └── ClientCommand.ts        # Command sender for main code (TS)
└── types/
    └── media/publisher.types.ts # Type definitions (TS)
```

## Key Differences

| Aspect | Workers (JS) | Main Code (TS) |
|--------|--------------|----------------|
| Language | Plain JavaScript | TypeScript |
| Imports | Self-contained only | Can import from codebase |
| Type Safety | Runtime checks | Compile-time types |
| Context | Web Worker | Main thread |

## Important Notes

1. **Do NOT remove worker duplicates** - They are required for Web Worker execution
2. **Keep definitions synchronized** - When updating main code constants, update worker constants too
3. **Worker files are copied to dist/** - See `scripts/copy-static-files.js`

## Constants Synchronization

When updating constants, ensure both versions match:

**TypeScript (main code):**
```typescript
// src/types/media/publisher.types.ts
export enum FrameType {
  CONFIG = 0xfd,
  EVENT = 0xfe,
}
```

**JavaScript (workers):**
```javascript
// src/workers/publisherConstants.js
const FRAME_TYPE = {
  CONFIG: 0xfd,
  EVENT: 0xfe,
};
```

## Build Process

Workers are copied as-is to `dist/workers/` during build:
- No TypeScript compilation
- No bundling
- Plain file copy via `scripts/copy-static-files.js`
