# CLAUDE.md

This file is a reference guide for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

A bot that manages Claude Code sessions for multiple projects from Discord (desktop/web/mobile). Each Discord channel maps to an independent Claude Agent SDK session tied to a project directory. Write tools (Edit, Write, Bash) require approval or denial via Discord buttons; read-only tools are auto-approved. The AskUserQuestion tool displays questions and collects answers via Discord buttons/select menus (direct text input also supported). File attachments (images, documents, code files) are downloaded to `.claude-uploads/` within the project, then passed to the Read tool. Dangerous executables (.exe, .bat, etc.) are blocked; 25MB size limit applies. Supports macOS, Linux, and Windows (native/WSL).

## Commands

```bash
npm run dev          # Development run (tsx)
npm run build        # Production build (tsup, ESM)
npm start            # Run built files
npm test             # Run tests (vitest)
npm run test:watch   # Watch mode for tests
npx tsc --noEmit     # Type check only
./install.sh         # macOS/Linux auto-install (Node.js, Claude Code, npm)
install.bat          # Windows auto-install
```

## Architecture

```
[Discord] <-> [Discord Bot (discord.js v14)] <-> [SessionManager] <-> [Claude Agent SDK]
                              |
                        [SQLite (better-sqlite3)]
```

**Core data flow:** Message sent to registered channel → `message.ts` handler validates auth/rate-limit → if awaiting custom input, treats it as AskUserQuestion answer → checks concurrent session (rejects if active) → downloads file attachments (images + documents) → `SessionManager.sendMessage()` creates/resumes Agent SDK `query()` → streams responses to Discord messages via edits every 1.5s → before text output, shows heartbeat every 15s (tool name, elapsed time, tool use count) → Stop button on in-progress messages for immediate termination → when tool use occurs, `canUseTool` callback sends question UI if AskUserQuestion, auto-approves if read-only, otherwise sends Discord button embed → user approves/denies → promise resolves → result embed (cost/duration) sent.

### File Structure

```
claudecode-discord/
├── install.sh              # macOS/Linux auto-install script
├── install.bat             # Windows auto-install script
├── .env.example            # Environment variable template
├── src/
│   ├── index.ts            # Entry point
│   ├── bot/
│   │   ├── client.ts       # Discord bot init & event routing
│   │   ├── commands/       # Slash commands (10+)
│   │   │   ├── register.ts
│   │   │   ├── unregister.ts
│   │   │   ├── status.ts
│   │   │   ├── stop.ts
│   │   │   ├── auto-approve.ts
│   │   │   ├── sessions.ts
│   │   │   ├── last.ts
│   │   │   ├── usage.ts
│   │   │   ├── resume.ts
│   │   │   └── clear-sessions.ts
│   │   └── handlers/
│   │       ├── message.ts      # Message handling, file downloads
│   │       └── interaction.ts  # Button/select menu handling
│   ├── claude/
│   │   ├── session-manager.ts  # Session lifecycle, progress display
│   │   └── output-formatter.ts # Discord output formatting
│   ├── db/
│   │   ├── database.ts     # SQLite init & queries
│   │   └── types.ts
│   ├── security/
│   │   └── guard.ts        # Auth, rate limit, path validation
│   └── utils/
│       ├── config.ts       # Environment variable validation (zod v4)
│       └── i18n.ts         # Localization helper L(en, zh)
├── SETUP.md / SETUP.kr.md  # Detailed setup guides (English/Korean)
├── README.md / README.kr.md
├── package.json
└── tsconfig.json
```

### Key Modules

- **`src/bot/client.ts`** — Discord.js client init, event routing, per-guild slash command registration
- **`src/bot/commands/`** — 10+ slash commands: register, unregister, status, stop, auto-approve, sessions, resume, last, usage, queue, clear-sessions
- **`src/bot/handlers/message.ts`** — Passes channel messages to SessionManager after security checks. If awaiting AskUserQuestion direct input, treats message as answer (not forwarded to Claude). Downloads image and document attachments to `.claude-uploads/` and adds file paths to prompt. Rejects concurrent messages while session is active. Blocks dangerous files (.exe, .bat, etc.) and enforces 25MB size limit.
- **`src/bot/handlers/interaction.ts`** — Handles button interactions (approve/deny/approve-all/stop/session-resume/session-delete/session-cancel) and StringSelectMenu (session selection with Resume/Delete/Cancel buttons, new session creation). Shows last conversation preview on session selection. Handles AskUserQuestion option buttons (ask-opt), direct input (ask-other), and multi-select menus (ask-select).
- **`src/claude/session-manager.ts`** — Singleton managing active sessions per channel. Implements approval workflow via Agent SDK `query()` and `canUseTool` callback. Manages pending approvals in a requestId-based Map (5-minute timeout). On AskUserQuestion, sends Discord button/select menu UI, injects user answer into `updatedInput.answers`. Supports free-text answers via pendingCustomInputs. Processes multiple questions sequentially. Resumes sessions via SDK session ID. On bot restart, loads session_id from DB for automatic resume. Shows heartbeat (15s interval) before text output. Stop button on in-progress messages. Cleans up active sessions in finally block.
- **`src/bot/commands/sessions.ts`** — Scans JSONL session files in `~/.claude/projects/` and lists existing sessions. Filters empty sessions (<512 bytes, no user messages). Strips IDE-injected tags. Displays relative timestamps based on file mtime (N min/hr/day ago). Shows current session with ▶ marker. Includes "Create New Session" option. Shows last assistant message preview on selection. Uses Discord StringSelectMenu.
- **`src/bot/commands/resume.ts`** — Lists all Claude Code sessions from all projects on this machine. Allows resuming any session in the current channel (including CLI-started sessions).
- **`src/bot/commands/clear-sessions.ts`** — Bulk-deletes all JSONL session files for the registered project.
- **`src/claude/output-formatter.ts`** — Splits messages to fit Discord's 2000-char limit (preserving markdown code block fences). Creates tool approval request and result embeds. Creates AskUserQuestion embed with option buttons/select menus. Stop button factory. Reflects SHOW_COST setting in result embed.
- **`src/db/database.ts`** — SQLite WAL mode. Auto-creates data.db. Two tables: `projects` (channel→project path mapping, auto_approve flag), `sessions` (session state tracking, SDK session_id storage).
- **`src/security/guard.ts`** — User whitelist (ALLOWED_USER_IDS), in-memory sliding window rate limiting, path traversal (`..`) blocking.
- **`src/utils/config.ts`** — Zod v4 schema for environment variable validation, singleton pattern.
- **`src/utils/i18n.ts`** — Localization helper `L(en, zh)`. Set language via `.tray-lang` file ("en" default).

### Tool Approval Logic (`canUseTool`)

1. AskUserQuestion → Send Discord question UI (buttons/select menus), collect user answer, inject into `updatedInput.answers` and return allow (5-minute timeout; denied if no response).
2. Read-only tools (Read, Glob, Grep, WebSearch, WebFetch, TodoWrite) → Always auto-approve.
3. Channel `auto_approve` is enabled → Auto-approve.
4. Otherwise → Send Discord button embed, wait for user response (5-minute timeout; denied if no response).

### Session States

- **🟢 online** — Claude is working
- **🟡 waiting** — Waiting for tool use approval
- **⚪ idle** — Task complete, awaiting next input
- **🔴 offline** — No active session

### Multi-PC Support

Create a separate Discord bot for each PC and invite all to the same guild. Each bot registers projects in different channels for independent operation.

## Development Principles (Important)

This is a **public open-source** project used by many non-technical users. All design and implementation must follow these principles:

- **No manual steps**: "Tell the user to run this command" is not a solution. Individual guidance to hundreds of users is not feasible. Issues must be resolved automatically in code.
- **Auto-update integrity**: The tray app's update feature must work without conflicts in any environment. Handle all cases in code: git conflicts, build failures, etc. Currently implemented with `git fetch` + `git reset --hard` to make conflicts impossible.
- **Backward compatibility**: New updates must not block existing users from updating. Already-deployed code cannot be changed remotely, so changes to tracked files (e.g., package-lock.json) must not cause update conflicts.
- **Error guidance**: When errors occur, automatically show users the cause and how to resolve it (e.g., auto-display `claude login` instructions when login expires).

## TypeScript Conventions

- ESM module (`"type": "module"`), use `.js` extension for local imports
- Strict mode, `noUnusedLocals` and `noUnusedParameters` enabled
- Target: ES2022, moduleResolution: bundler
- Use Zod v4 (API differs from v3)
- Use `path.join()`, `path.resolve()` for path handling (Windows compatible)
- Use `split(/[\\/]/)` for filename extraction (supports both macOS/Windows path separators)

## Environment Setup

Copy `.env.example` to `.env` and fill in values. Required: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `ALLOWED_USER_IDS`, `BASE_PROJECT_DIR`. Optional: `RATE_LIMIT_PER_MINUTE` (default 10), `SHOW_COST` (default true; false recommended for Max plan users). data.db is auto-created on first run.
