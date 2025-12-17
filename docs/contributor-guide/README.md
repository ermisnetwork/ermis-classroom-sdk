# Contributor Guide

Welcome contributors! This guide covers the internal architecture and development workflow for the Ermis Classroom SDK.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Basic knowledge of WebRTC/WebTransport
- Understanding of media encoding (H.264, Opus)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/ermisnetwork/ermis-classroom-sdk.git
cd ermis-classroom-sdk

# Install dependencies
pnpm install

# Build the SDK
pnpm build

# Run tests
pnpm test

# Start development
pnpm dev
```

## Project Structure

```
ermis-classroom-sdk/
├── packages/
│   ├── sdk/                    # Core SDK
│   │   ├── src/
│   │   │   ├── cores/          # Room, high-level API
│   │   │   ├── media/
│   │   │   │   ├── publisher/  # Publishing (send media)
│   │   │   │   ├── subscriber/ # Subscribing (receive media)
│   │   │   │   └── shared/     # Shared utilities
│   │   │   ├── events/         # Event system
│   │   │   ├── types/          # TypeScript types
│   │   │   ├── constants/      # Constants and configs
│   │   │   └── utils/          # Utilities
│   │   └── dist/               # Build output
│   │
│   ├── react/                  # React bindings
│   └── vcr-client/             # VCR client
│
├── examples/                   # Example applications
│   └── react/                  # React example
│
└── docs/                       # Documentation (you are here!)
```

## Chapters

1. [Architecture](architecture.md) - System architecture overview
2. [Streaming Flow](streaming-flow.md) - Detailed streaming analysis
3. [Transports](transports/README.md) - WebTransport and WebRTC implementation
4. [Troubleshooting](troubleshooting/README.md) - Common issues and fixes

## Key Concepts for Contributors

### Event-Driven Architecture

The SDK uses EventEmitter pattern extensively:

```typescript
class MyComponent extends EventEmitter<{
  eventName: { data: string };
}> {
  doSomething() {
    this.emit('eventName', { data: 'value' });
  }
}
```

### Async/Await Pattern

All IO operations are async:

```typescript
async function send() {
  await transport.send(data);
}
```

### Type Safety

Strict TypeScript is enforced:

```typescript
// Good
const streamData: StreamData = this.streams.get(channelName);

// Avoid
const streamData = this.streams.get(channelName) as any;
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

See [Contributing Guidelines](../../CONTRIBUTING.md) for more details.
