# Project History

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
