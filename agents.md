# agents.md — AI Coding Agent Rules

Global preferences for AI coding agents (Claude Code, Cursor, etc.).

---

## Code Style

- Write minimal, clean code. No over-engineering or premature abstraction.
- No unnecessary comments, docstrings, or type annotations on unchanged code.
- Don't add error handling, fallbacks, or validation beyond what's explicitly requested.
- Favor deleting unused code over leaving it commented out.
- Three similar lines of code is better than a premature abstraction.
- Don't design for hypothetical future requirements.

## Code Editing

- Always read the full file or relevant section before editing to avoid duplicating code.
- After edits, verify no duplicates were introduced.
- Prefer editing existing files over creating new ones.
- Only add comments where logic isn't self-evident.

## Documentation

- Preserve existing structure when updating docs. Update in-place rather than rewriting unless explicitly asked.
- Never proactively create README or documentation files unless asked.

## Git & Security

- Never commit, push, or open PRs without explicit instruction.
- Scan for credentials/secrets before any git operation involving new files.
- Never use `--force`, `--no-verify`, or other destructive git flags without confirmation.
- Never amend published commits without asking.

## Planning & Scope

- Pause and discuss approach before making multi-file changes or architectural decisions.
- Match scope of changes to what was actually requested — don't refactor surrounding code.
- Always get approval before touching production configs, CI/CD, or shared infrastructure.

## Communication

- Keep responses short and concise.
- No emojis unless asked.
- No time estimates.

---

## Stack

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Backend     | Python (FastAPI)                               |
| Frontend    | TypeScript (Next.js / React)                   |
| AI          | Anthropic Claude SDK (`claude-sonnet-4-6`)     |
| Database    | Google Sheets (no Prisma, direct DB drivers)   |
| Deployment  | Vercel (frontend), Fly.io (backend)            |
| Integrations| Google Calendar, Google Sheets, Strava, Telegram Bot |

- Prefer free/low-cost solutions over heavy frameworks.
- Favor explicit tool-based agent loops over monolithic routers.

---

## Agent Skills / Workflows

Custom skills live in `~/.cursor/skills/` (prompt-based, not bash scripts). Scripts to be ported there from `.claude/skills/`. Until ported, invoke via terminal.

### strava-fetcher
Fetches new Strava activities after a given timestamp. Outputs JSON with `raw_rows` (metric) and `clean_rows` (imperial) for appending to Google Sheets.

### google-sheets
Read/write the "Strava Data" Google Sheet. Can get the latest activity date or append new rows.

### google-calendar
Read and write Google Calendar events. Supports looking up specific calendars by name (e.g., "Ira Rickman" or "Workout").

### document (Obsidian)
Log the current session to the Obsidian vault. Obsidian MCP is configured — use MCP tools directly, no script needed.

---

## Cursor-Specific

- Global rules: this file is injected into Cursor settings as "Rules for AI"
- Project rules: use `.cursor/rules/*.mdc` for project-specific overrides
- Custom skills: `~/.cursor/skills/` (prompt-based, not bash scripts)
- Custom subagents: `~/.cursor/agents/` (available, currently unused)
- MCP servers: `~/.cursor/mcp.json` — Obsidian MCP active

---

## Development Priorities

1. **Security** — scan for credentials before any push.
2. **Performance & cost** — lightweight and free solutions preferred.
3. **Architecture clarity** — explicit, composable agents over monolithic code.
