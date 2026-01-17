# CollabLearn Desktop

Local desktop client for orchestrating coding agents with your CollabLearn projects.

---

## Installation Options

There are **three ways** to install CollabLearn Desktop, each suited to different needs:

### Option 1: Download Pre-built Installer (Recommended for End Users)

> **Status**: Coming Soon - Releases will be available on GitHub Releases.

Download the installer for your operating system from the [Releases](https://github.com/akshitcodes/CollabLearn-desktop-agent/releases) page.

| Platform | File                           | Notes                          |
| -------- | ------------------------------ | ------------------------------ |
| Windows  | `CollabLearn-Desktop-x.x.x.exe`| NSIS installer, run to install |
| macOS    | `CollabLearn-Desktop-x.x.x.dmg`| Drag to Applications folder    |
| Linux    | `CollabLearn-Desktop-x.x.x.AppImage`| Make executable & run     |

**Advantages:**
- ✅ **Easiest setup** – No dev tools required
- ✅ **Auto-updates** (when configured)
- ✅ **Production-optimized** build

**Disadvantages:**
- ❌ Cannot modify source code
- ❌ Must wait for new releases for updates
- ❌ Releases not yet available (in development)

---

### Option 2: Build from Source (For Developers & Contributors)

Clone and build locally for full control:

```bash
# Clone the repo
git clone https://github.com/akshitcodes/CollabLearn-desktop-agent.git
cd CollabLearn-desktop-agent

# Install dependencies
yarn

# Run in development mode
yarn dev
# In a second terminal:
yarn electron
```

**Advantages:**
- ✅ **Full source access** – Modify anything
- ✅ **Hot reload** during development
- ✅ **Debug with DevTools**
- ✅ **Contribute back** via pull requests

**Disadvantages:**
- ❌ Requires Node.js (v18+), Yarn, and Git
- ❌ More setup steps
- ❌ Manual updates (git pull)

---

### Option 3: Build Your Own Installer

Create a distributable for your own machine or to share:

```bash
# Clone and install
git clone https://github.com/akshitcodes/CollabLearn-desktop-agent.git
cd CollabLearn-desktop-agent
yarn

# Build the production bundle
yarn build

# Create platform-specific installer
yarn dist       # Full installer (NSIS/DMG/AppImage)
# OR
yarn pack       # Unpacked directory (faster, for testing)
```

Output will be in the `release/` folder.

**Advantages:**
- ✅ **Custom builds** with your modifications
- ✅ **Share with team** without requiring dev setup
- ✅ **Test installers** before official release

**Disadvantages:**
- ❌ Requires dev environment to build
- ❌ Platform-specific (build on Windows for `.exe`, etc.)
- ❌ No automatic updates unless you host your own

---

## Prerequisites

Depending on your installation method, you may need:

| Requirement          | Option 1 | Option 2 | Option 3 |
| -------------------- | :------: | :------: | :------: |
| Node.js v18+         |    ❌    |    ✅    |    ✅    |
| Yarn                 |    ❌    |    ✅    |    ✅    |
| Git                  |    ❌    |    ✅    |    ✅    |
| GitHub Copilot CLI   |    ✅    |    ✅    |    ✅    |

> **Note**: A GitHub Copilot subscription with CLI access is required for agent functionality.

---

## Setup After Installation

1. **Launch the app** – CollabLearn Desktop
2. **Authenticate** – Log in with your CollabLearn account
3. **Connect your agent** – Ensure GitHub Copilot CLI is installed and authenticated:
   ```bash
   gh auth login
   gh copilot --version
   ```
4. **Link a workspace** – Point to your local project directory
5. **Execute tasks** – Select tasks from your CollabLearn collab and run agents

---

## Project Structure

```
src/
├── main/           # Electron main process (Node.js)
│   ├── index.ts    # Entry point
│   ├── preload.ts  # IPC bridge
│   └── agents/     # Agent adapters (Copilot, Claude, etc.)
├── renderer/       # React UI
│   ├── App.tsx
│   └── styles/
└── shared/         # Shared types
```

---

## Tech Stack

- **Electron** – Desktop framework
- **React** – UI
- **TypeScript** – Type safety
- **Vite** – Build tool
- **electron-builder** – Distribution

---

## Troubleshooting

| Issue                              | Solution                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `yarn` command not found           | Install Yarn: `npm install -g yarn`                                      |
| Electron doesn't start             | Make sure to run `yarn build` before `yarn electron`                     |
| GitHub Copilot not detected        | Run `gh auth login` and `gh copilot alias` first                         |
| Build fails on macOS for Windows   | Cross-compilation not supported; build on target OS                      |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## License

MIT
