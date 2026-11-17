# Changelog

All notable changes to Agent-Board. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/). The older entries were written afterwards from the git history and the release tags.

## [1.7.0] - 2026-11-17

### Added
- **Time machine**: replay the last hour, today or yesterday on the board. Play/pause, speed 1x/10x/60x, a scrubber with marks for "waiting for approval" and "round done", and a "Recording, not live" banner. Live events that arrive meanwhile are held back. Read-only `GET /replay` streams a capped window of the event log.
- **Week in review**: the "Week" button (key `W`) and `GET /week` show the last 7 days with bars, an hour heatmap (a real table), the most used tools, projects and a comparison with the previous week.
- **Share card** for the day summary: a 1200 x 630 card (numbers only) to save as SVG or PNG or copy as an image, light or dark. Built in the browser, nothing is uploaded.
- **Second machine**: opt-in, token-protected `POST /ingest` plus a sender script; agents of the other computer show an `@name` badge and a machine filter (`&machine=1` in the demo). See `docs/SECOND-MACHINE.md`.
- Opt-in read-only access from LAN or Tailscale (`AGENT_BOARD_BIND`, `AGENT_BOARD_HOSTS`).
- City view: a task board at the main figure's desk (#41).
- Desk timeout is configurable (`AGENT_BOARD_IDLE_MINUTES`); idle desks show "last seen ...".
- Screen readers hear waiting, resumed and failed states (#59). The empty-state card shows the doctor result (#49).
- Day summary: hourly active time and approval counts.

### Changed
- `events.jsonl` keeps 48 hours when rotating (#55); replay and `/health` read only the tail of the log (#57).
- Service worker cache lists come from one source, with a consistency test (#58). New files are cached, cache version v7.
- A clear message instead of a stack trace when the port is taken or invalid (#54).
- Attention state: a loose request ends only on tool start or end.

### Fixed
- Desk labels no longer overlap with three desks; the map re-measures when the stage changes size (#71).
- `install.mjs --gemini --doctor` no longer checks the Claude setup (#53).
- Week summary closes its read stream after reading (Windows CI, Node 20).

### Tests
- Many new unit and real-HTTP tests (static-file hardening, Host checks, replay, week, ingest, idle) and browser tests for the new cards.

## [1.6.0] - 2026-11-01

### Added
- Installable as a Claude Code plugin (`/plugin install`).
- `node install.mjs --doctor` self-check.
- Task board next to the desk for TodoWrite progress, counts only (#22).
- Agent shirts coloured by type (Explore / Plan / general-purpose) with a legend (#25).
- Experimental Gemini CLI support (#27).
- Empty state: a "No session yet" card with a copyable install command and a demo link (#21).
- CONTRIBUTING, issue templates and an add-a-language guide.

### Changed
- Short labels for MCP tools and skills everywhere (#24); server names are sanitised.
- CodeQL runs only in public repositories.

## [1.5.0] - 2026-10-30

### Added
- **City view**: an isometric pixel town (key `C`, `?view=city`) where agents walk between buildings.
- Keyboard shortcuts `H`, `T` and `?` with a help window (#14).
- "Reduce motion" can be switched live.
- `CLAUDE.md` for Claude sessions (#19).

### Changed
- Labels: counters next to the room name, names stay inside the house.

### Fixed
- Truncating `events.jsonl` no longer loses or halves events.
- Browser test retries the Chrome start up to three times (#13).

## [1.4.0] - 2026-10-24

### Added
- **Day summary**: the "Today" button with active time per commander and project folder.
- Language selector in the header (1.3.1).
- Live demo on GitHub Pages and a demo GIF in the README.
- Browser smoke test in headless Chrome (`npm run test:browser`).

### Fixed
- Desk labels no longer overlap with three or four desks.

### Changed
- CodeQL `init` and `analyze` actions are updated together; Dependabot groups them.

## [1.3.0] - 2026-10-10

Covers 1.2.0 and 1.3.0.

### Added
- **Codex support** (experimental, 1.2.0): `node install.mjs --codex`, a second commander desk.
- One desk per session; up to four desks, cleared after the session ends or goes idle.
- Spanish as a third language.

### Changed
- The UI is English by default; German stays as an option (1.3.0).

## [1.1.0] - 2026-10-10

### Added
- Windows support: the installer writes `node "<dir>/collector.mjs" --agent-board` hooks, the status line passes through Git Bash, and CI runs on Ubuntu, macOS and Windows with Node 20, 22 and 24.

## [1.0.0]

First version: a pixel-art live view of Claude Code agents fed by hooks. (No release tag.)

[1.7.0]: https://github.com/Stefan-Paun/agent-board/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Stefan-Paun/agent-board/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Stefan-Paun/agent-board/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Stefan-Paun/agent-board/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Stefan-Paun/agent-board/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/Stefan-Paun/agent-board/releases/tag/v1.1.0
