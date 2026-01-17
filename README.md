# CollabLearn Desktop

Local desktop client for orchestrating coding agents with your CollabLearn projects.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Yarn](https://yarnpkg.com/) package manager
- [GitHub CLI](https://cli.github.com/) with Copilot access

## Installation

```bash
git clone https://github.com/akshitcodes/CollabLearn-desktop-agent.git
cd CollabLearn-desktop-agent
yarn
```

## Usage

### Development

```bash
# Start the development server
yarn dev

# In another terminal, run Electron
yarn electron
```

### Production Build

```bash
# Build for production
yarn build

# Create distributable installer
yarn dist
```

The installer will be output to the `release/` folder.

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── index.ts    # Entry point
│   ├── preload.ts  # IPC bridge
│   └── agents/     # Agent adapters
├── renderer/       # React UI
│   ├── App.tsx
│   └── styles/
└── shared/         # Shared types
```

## Tech Stack

- [Electron](https://www.electronjs.org/) - Desktop framework
- [React](https://react.dev/) - UI library
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tool
- [electron-builder](https://www.electron.build/) - Distribution

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

MIT
