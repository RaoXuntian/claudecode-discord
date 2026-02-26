# Claude Code Discord Controller

A Discord bot that manages multiple Claude Code sessions remotely via Discord (desktop, web, and mobile).

Run independent Claude Code sessions per channel, with tool use approval/denial via Discord buttons.

> **[Korean documentation (한국어)](README.kr.md)**

## Why This Bot? — vs Official Remote Control

Anthropic's [Remote Control](https://code.claude.com/docs/en/remote-control) lets you view a running local session from your phone. This bot goes further — it's a **multi-machine agent hub** that runs as a daemon, creates new sessions on demand, and supports team collaboration.

| | Official Remote Control | This Bot |
|---|---|---|
| **What it is** | Session viewer | Session controller |
| **Starting a task** | Must open terminal first, then `claude remote-control` | Just send a message in Discord |
| **Terminal dependency** | Closes terminal = session dies (10min timeout) | Bot daemon stays alive independently |
| **New sessions from mobile** | Not possible (existing sessions only) | Send a message = new session |
| **Concurrent sessions** | 1 per machine | Multiple (one per channel) |
| **Multi-PC control** | Switch sessions manually per machine | One Discord server = all machines |
| **Team collaboration** | Single user only | Team members can observe and approve |
| **Notifications** | Must check the app manually | Discord push notifications |
| **Dashboard** | None | Channel list = project dashboard |

### Multi-PC Hub

Create a separate Discord bot per machine, invite them all to the same server, and assign channels:

```
Your Discord Server
├── #work-mac-frontend     ← Bot on work Mac
├── #work-mac-backend      ← Bot on work Mac
├── #home-pc-sideproject   ← Bot on home PC
├── #cloud-server-infra    ← Bot on cloud server
```

**Control every machine's Claude Code from a single phone.** The channel list itself becomes your real-time status dashboard across all machines and projects.

## Features

- 📱 Remote control Claude Code from Discord (desktop/web/mobile)
- 🔀 Independent sessions per channel (project directory mapping)
- ✅ Tool use approve/deny via Discord button UI
- ❓ Interactive question UI (selectable options + custom text input)
- ⏹️ Stop button for instant cancellation during progress, message queue for sequential tasks
- 📎 File attachments support (images, documents, code files)
- 🔄 Session resume/delete/new (persist across bot restarts, last conversation preview)
- ⏱️ Real-time progress display (tool usage, elapsed time)
- 🔒 User whitelist, rate limiting, path security, duplicate instance prevention

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Node.js 20+, TypeScript |
| Discord | discord.js v14 |
| AI | @anthropic-ai/claude-agent-sdk |
| DB | better-sqlite3 (SQLite) |
| Validation | zod v4 |
| Build | tsup (ESM) |
| Test | vitest |

## Installation

```bash
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord

# macOS / Linux
./install.sh

# Windows
./install.bat
```

### Setup Guides

| Platform | Guide |
|----------|-------|
| 🍎 **macOS / Linux** | **[SETUP.md](SETUP.md)** — terminal-based setup, menu bar / tray app |
| 🪟 **Windows** | **[SETUP-WINDOWS.md](SETUP-WINDOWS.md)** — GUI installer, system tray app with control panel, desktop shortcut |

Windows users: `install.bat` handles everything automatically — installs dependencies, builds, creates a desktop shortcut, and launches the bot with a system tray GUI.

## Project Structure

```
claudecode-discord/
├── install.sh              # macOS/Linux auto-installer
├── install.bat             # Windows auto-installer
├── mac-start.sh            # macOS background launcher + menu bar
├── linux-start.sh          # Linux background launcher + system tray
├── win-start.bat           # Windows background launcher + system tray
├── menubar/                # macOS menu bar status app (Swift)
├── tray/                   # System tray app (Linux: Python, Windows: C#)
├── .env.example            # Environment variable template
├── src/
│   ├── index.ts            # Entry point
│   ├── bot/
│   │   ├── client.ts       # Discord bot init & events
│   │   ├── commands/       # Slash commands
│   │   │   ├── register.ts
│   │   │   ├── unregister.ts
│   │   │   ├── status.ts
│   │   │   ├── stop.ts
│   │   │   ├── auto-approve.ts
│   │   │   ├── sessions.ts
│   │   │   ├── last.ts
│   │   │   └── clear-sessions.ts
│   │   └── handlers/       # Event handlers
│   │       ├── message.ts
│   │       └── interaction.ts
│   ├── claude/
│   │   ├── session-manager.ts   # Session lifecycle
│   │   └── output-formatter.ts  # Discord output formatting
│   ├── db/
│   │   ├── database.ts     # SQLite init & queries
│   │   └── types.ts
│   ├── security/
│   │   └── guard.ts        # Auth, rate limit
│   └── utils/
│       └── config.ts       # Env var validation (zod)
├── SETUP.md                # macOS/Linux setup guide
├── SETUP-WINDOWS.md        # Windows setup guide
├── docs/                   # Documentation assets & extras
│   ├── TESTING.md          # Testing guide
│   └── *.png               # Screenshots
├── package.json
└── tsconfig.json
```

## Usage

| Command | Description | Example |
|---------|-------------|---------|
| `/register <folder>` | Link current channel to a project | `/register my-project` |
| `/unregister` | Unlink channel | |
| `/status` | Check all session statuses | |
| `/stop` | Stop current channel's session | |
| `/auto-approve on\|off` | Toggle auto-approval | `/auto-approve on` |
| `/sessions` | List sessions to resume or delete | |
| `/last` | Show the last Claude response from current session | |
| `/clear-sessions` | Delete all session files for the project | |

The `/register` path is resolved relative to the `BASE_PROJECT_DIR` set in your `.env` file.
For example, if `BASE_PROJECT_DIR=/Users/you/projects`, then `/register my-project` maps to `/Users/you/projects/my-project`. Absolute paths also work: `/register path:/Users/you/other/project`.

Send a **regular message** in a registered channel and Claude will respond.
Attach images, documents, or code files and Claude can read and analyze them.

### In-Progress Controls

- **⏹️ Stop** button on progress messages for instant cancellation
- Sending a new message while busy offers **message queue** — auto-processes after current task completes
- `/stop` slash command also available

## Architecture

```
[Mobile Discord] ←→ [Discord Bot] ←→ [Session Manager] ←→ [Claude Agent SDK]
                          ↕
                     [SQLite DB]
```

- Independent sessions per channel (project directory mapping)
- Claude Agent SDK runs Claude Code as subprocess (shares existing auth)
- Tool use approval via Discord buttons (auto-approve mode supported)
- Streaming responses edited every 1.5s into Discord messages
- Heartbeat progress display every 15s until text output begins
- Markdown code blocks preserved across message splits

## Session States

| State | Meaning |
|-------|---------|
| 🟢 online | Claude is working |
| 🟡 waiting | Waiting for tool use approval |
| ⚪ idle | Task complete, waiting for input |
| 🔴 offline | No session |

## Security

### Zero External Attack Surface

This bot **does not open any HTTP servers, ports, or API endpoints.** It connects to Discord via an outbound WebSocket — there is no inbound listener, so there is no network path for external attackers to reach this bot.

```
Typical web server:  External → [Port open, waiting] → Receives requests  (inbound)
This bot:            Bot → [Connects to Discord] → Receives events         (outbound only)
```

### Self-Hosted Architecture

The bot runs entirely on your own PC/server. No external servers involved, and no data leaves your machine except through Discord and the Anthropic API (which uses your own Claude Code login session).

### Access Control

- `ALLOWED_USER_IDS` whitelist-based authentication — all messages and commands from unregistered users are ignored
- Discord servers are private by default (no access without invite link)
- Per-minute request rate limiting

### Execution Protection

- Tool use default: file modifications, command execution, etc. **require user approval each time** (Discord buttons)
- Path traversal (`..`) blocked
- File attachments: executable files (.exe, .bat, etc.) blocked, 25MB size limit

### Precautions

- The `.env` file contains your bot token — **never share it publicly.** If compromised, immediately Reset Token in Discord Developer Portal
- `auto-approve` mode is convenient but may allow Claude to perform unintended actions — use only on trusted projects

## macOS Quick Start (Background + Menu Bar)

On macOS, you can run the bot as a background service with a menu bar status indicator.

```bash
./mac-start.sh          # Start (background + menu bar icon)
./mac-start.sh --stop   # Stop
./mac-start.sh --status # Check status
./mac-start.sh --fg     # Foreground mode (for debugging)
```

- First run without `.env` prompts interactive setup in terminal
- Menu bar icon: 🟢 running / 🔴 stopped / ⚙️ setup needed
- Menu bar provides: start/stop/restart, settings editor (with folder browser), log viewer
- Settings includes setup guide link and folder picker for project directory
- Version display and manual update from menu bar when updates available
- Auto-restarts on crash, auto-starts on boot (via launchd)

> **Note:** This feature is macOS-only (requires launchd and Swift).

## Linux Quick Start (Background + System Tray)

On Linux, you can run the bot as a systemd user service with an optional system tray indicator.

```bash
./linux-start.sh          # Start (systemd + tray icon if GUI available)
./linux-start.sh --stop   # Stop
./linux-start.sh --status # Check status
./linux-start.sh --fg     # Foreground mode (for debugging)
```

- First run without `.env` prompts interactive setup
- System tray icon: green (running) / red (stopped), with start/stop/settings menu
- Version display and manual update from tray when updates available
- Auto-restarts on crash, auto-starts on boot (via systemd)
- Tray requires `pip3 install pystray Pillow` (auto-installed on first run)
- Works without GUI (headless server) — tray is skipped automatically

## Windows Quick Start (Background + System Tray)

On Windows, `install.bat` sets up everything and creates a **desktop shortcut**. Double-click it to launch.

<p align="center">
  <img src="docs/windows-tray.png" alt="Windows Control Panel" width="400">
</p>

```batch
win-start.bat          &:: Start (background + tray + control panel)
win-start.bat --stop   &:: Stop
win-start.bat --status &:: Check status
win-start.bat --fg     &:: Foreground mode (for debugging)
```

The bot runs in the background with a **system tray icon**:

<p align="center">
  <img src="docs/windows-tray-icon.png" alt="Windows System Tray Icon" width="300">
</p>

- **Control Panel GUI**: left-click tray icon for start/stop/restart, settings, log viewer, auto-update
- **EN / KR language toggle** with persistent preference
- System tray: green (running) / red (stopped) / orange (setup needed)
- GUI Settings dialog — no manual `.env` editing needed:

<p align="center">
  <img src="docs/windows-settings.png" alt="Windows Settings Dialog" width="400">
</p>
- One-click auto-update: pulls code, rebuilds, recompiles tray app
- Auto-starts on logon (via Windows Registry)
- Desktop shortcut created by `install.bat`

> See **[SETUP-WINDOWS.md](SETUP-WINDOWS.md)** for the full Windows guide.

## Development

```bash
npm run dev          # Dev mode (tsx)
npm run build        # Production build (tsup)
npm start            # Run built files
npm test             # Tests (vitest)
npm run test:watch   # Test watch mode
```

## License

[MIT License](LICENSE) - Free to use, modify, and distribute commercially. Attribution required: include the original copyright notice and link to [this repository](https://github.com/chadingTV/claudecode-discord).
