# Project History

## v1.1.0 - 2026-03-31

- Added a single-page end-user HTML site for the project.
- The page includes a styled running `ports` example, usage guidance, features, keyboard shortcuts, CLI commands, how it works, the tech stack, and getting-started steps.
- Updated the README to point users to the new page.

## v1.0.7 - 2026-03-31

- Replaced the framework fallback value `Unknown` with `-`.
- Switched the command display to use the `ps` `comm` value so unhelpful truncated labels like `MainThrea` are avoided when possible.
- Tightened the TUI column layout so values align more evenly under each heading.
- Updated the README for the improved display behavior.

## v1.0.6 - 2026-03-31

- Added `--json` to `ports list` for machine-readable output.
- The JSON output returns `port`, `pid`, `command`, `projectName`, `framework`, `memoryKB`, and `uptime` for each listening process.
- Updated the README to document the new scripting-friendly output mode.

## v1.0.5 - 2026-03-31

- Dimmed non-dev processes in both the TUI and `ports list` so dev servers stand out more clearly.
- Kept `node`, `deno`, `bun`, and recognized framework processes at normal brightness.
- Highlighted memory values above `200 MB` in orange and above `500 MB` in red.
- Applied the memory emphasis only to the memory value, not the rest of the row.
- Updated the README for the new visual styling behavior.

## v1.0.4 - 2026-03-31

- Added inline TUI search with `/` to filter by project name, command, or port number.
- Added a bottom search bar that updates results while typing.
- Made `Enter` lock in the current search and `Escape` cancel and clear it.
- Disabled the other TUI shortcuts while the search bar is active.
- Added `[/]` to the shortcut bar and updated the README for the new search workflow.

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
