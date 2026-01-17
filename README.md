# CollabLearn Desktop

Local desktop client for orchestrating coding agents with your CollabLearn projects.

## Development

```bash
# Install dependencies
yarn

# Start development (runs Vite + TypeScript compiler)
yarn dev

# In another terminal, run Electron
yarn electron
```

## Building

```bash
# Build for production
yarn build

# Create distributable
yarn dist
```

## Structure

```
src/
├── main/           # Electron main process (Node.js)
│   ├── index.ts    # Entry point
│   ├── preload.ts  # IPC bridge
│   └── agents/     # Agent adapters
├── renderer/       # React UI
│   ├── App.tsx
│   └── styles/
└── shared/         # Shared types
```

## Tech Stack

- **Electron** - Desktop framework
- **React** - UI
- **TypeScript** - Type safety
- **Vite** - Build tool
- **electron-builder** - Distribution
