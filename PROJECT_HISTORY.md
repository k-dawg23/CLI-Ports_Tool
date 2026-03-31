# Project History

## v1.0.3 - 2026-03-31

- Added TUI sort modes for port ascending, memory descending, uptime descending, and project name alphabetical.
- Added the `s` shortcut to cycle sort modes and show the active sort in the TUI header.
- Implemented elapsed-time parsing so uptime sorting compares total seconds instead of raw strings.
- Added `[s]` to the shortcut bar and updated the README for the new sorting workflow.

## v1.0.2 - 2026-03-31

- Added TUI filter modes for `all ports`, `dev ports`, and `node only`.
- Added the `f` shortcut to cycle filters and show the active filter in the TUI header.
- Reset selection to the first visible row whenever the filter changes.
- Added `[f]` to the shortcut bar and updated the README for the new filtering workflow.

## v1.0.1 - 2026-03-31

- Changed the TUI kill shortcut from lowercase `k` to uppercase `K`.
- Enhanced kill behavior to send SIGTERM first, wait 1 second, and then send SIGKILL if the process is still alive.
- Added `o` to open `http://localhost:PORT` in the default browser.
- Added `e` to open the detected project directory in VS Code.
- Replaced the plain-text shortcut hint with a bottom shortcut bar using colored square-bracket key labels.
- Updated the README for the new TUI shortcuts and bumped the documented release to `v1.0.1`.

## v1.0.0 - 2026-03-31

- Created the `ports` TypeScript CLI project in `CLI-Ports_Tool`.
- Set up build and packaging with `tsup`, executable `bin` wiring, and Node 18+ support.
- Added direct commands:
  - `ports list`
  - `ports check <port>`
  - `ports kill <port>`
- Built an Ink-based interactive TUI for `ports` with:
  - live 3-second refresh
  - arrow-key navigation
  - keyboard shortcuts for refresh, kill, and quit
- Implemented port discovery using `lsof -iTCP -sTCP:LISTEN -P -n`.
- Implemented per-process enrichment using:
  - `lsof -d cwd` for working directory lookup
  - `ps -o rss=,etime=` for memory and uptime
- Added project-name discovery by walking upward to `package.json`.
- Added framework detection for Next.js, Astro, Vite, Remix, Nuxt, SvelteKit, and Angular.
- Added colored terminal output with `chalk`.
- Added `.gitignore` for generated artifacts.
- Corrected the build entry to use a TSX CLI entrypoint for Ink rendering.
- Added a `README.md` with installation, usage, and TUI shortcut docs.
- Added a non-TTY fallback so `ports` prints a static table when interactive raw mode is unavailable.
- Tightened TTY detection to require raw-mode support before launching the Ink interface.
