# ports User Manual

## Overview

`ports` is a developer-focused CLI and terminal UI for inspecting and managing listening TCP ports on your machine.

As of `v2.0.0`, the same package works on macOS, Linux, and Windows. The interface stays the same across platforms, while the process-discovery backend changes automatically behind the scenes.

The Windows version has been optimized to keep the tool comfortably usable for everyday development, but its refresh path is still somewhat heavier than the macOS/Linux version because it relies more on PowerShell-based system queries.

## Installation

Prerequisites:

- Node.js 22.18+ on the 22.x line, 24.11+ on the 24.x line, or 26+, with npm. These requirements match the tsup 9 build tool; Node.js 24 or 26 LTS is recommended.
- macOS/Linux: `lsof` and `ps` available on `PATH`.
- Windows: `powershell` or `pwsh` available on `PATH`, with `Get-NetTCPConnection`, `Get-Process`, and `Get-CimInstance` available. The backend tries `powershell` first, then `pwsh`.

Clone the repository with Git, then install and build:

```bash
git clone https://github.com/k-dawg23/CLI-Ports_Tool.git
cd CLI-Ports_Tool
npm ci
npm run build
npm link
```

After linking, run:

```bash
ports
```

Ensure npm's global executable directory is on `PATH`. If `npm link` fails because of permissions, configure npm to use a user-owned global prefix, add its executable directory to `PATH`, and then run `npm link` again.

To run the built CLI without linking:

```bash
node dist/cli.js
node dist/cli.js list --json
```

`npm start` runs the built CLI. For development, `npm run dev` runs the TypeScript entry point directly without a build.

## Main Ways To Use ports

There are two main usage modes:

1. Interactive TUI:
   Run `ports` with no arguments.
2. Direct CLI commands:
   Use `ports list`, `ports list --json`, `ports check <port>`, or `ports kill <port>`.

## Commands

### `ports`

Launches the interactive terminal UI.

What it does:

- shows a live table of listening ports
- refreshes every 3 seconds
- lets you navigate with the keyboard
- lets you filter, sort, search, kill, open, and inspect from one screen

The TUI requires standard input to be a TTY with raw-mode support. Otherwise, `ports` prints a notice and falls back to the static list view. Use `ports list --json` when you need machine-readable output.

### `ports list`

Prints a one-time static table of listening ports and exits.

Each row includes:

- port
- project
- framework
- PID
- memory usage
- uptime
- command

This is useful when you just want a quick snapshot. Results are sorted by port ascending. Each row represents a unique PID and port pair: IPv4/IPv6 listeners for the same PID and port are combined, while different processes on the same port have separate rows. UDP sockets are not included.

### `ports list --json`

Prints the same listening-port data as a JSON array.

Each object includes:

- `port`
- `pid`
- `command`
- `projectName`
- `framework`
- `memoryKB`
- `uptime`

`port` and `pid` are numbers. `command`, `projectName`, and `framework` are strings. `memoryKB` is a number in KiB, or `null` when unavailable. `uptime` is an elapsed-time string, or `null` when unavailable. An undetected framework is `"-"`; project-name fallbacks are described under Project Detection.

Results use the same PID/port deduplication and port ordering as `ports list`. An empty result is `[]`. This mode is meant for scripts and integrations.

Example:

```bash
ports list --json
```

### `ports check <port>`

Shows detailed information for the first discovered listener on one TCP port. Use a complete ASCII decimal port from `1` through `65535` for `check` and `kill`. Leading zeros are accepted. Signs, whitespace, fractions, suffixes, prefixes, and exponent notation are rejected before any discovery or action.

If something is listening on that port, it prints:

- port
- project
- framework
- PID
- memory
- uptime
- command
- working directory

If nothing is listening, it says the port is free.

Example:

```bash
ports check 3000
```

### `ports kill <port>`

Stops the first discovered process listening on the requested port. If several processes share that port, one invocation stops only one of them. Stopping a process also affects any other ports and work handled by that process.

On macOS/Linux:

- sends `SIGTERM` first
- waits 1 second
- if the captured PID is confirmed alive and still listening on the original port, sends `SIGKILL`

On Windows, it calls `Stop-Process`, waits 1 second, and retries with `Stop-Process -Force` only if the captured PID is confirmed alive and still listening on the original port. This does not request a graceful application shutdown.

If the initial stop fails, it reports failure without attempting the forced stop. Unknown liveness or failed discovery prevents escalation. If the process releases the port but stays alive, it reports “Listener released; process still running” and exits with status 1. Only a confirmed exit reports the process stopped with status 0; a failed or unverified stop, or no listener, exits with status 1. Failure diagnostics go to stderr.

Example:

```bash
ports kill 3000
```

### Help and Version

```bash
ports --help
ports list --help
ports check --help
ports kill --help
ports --version
```

`--help` shows usage and available options. `--version` prints the current version, `2.0.1`.

## TUI Guide

### What The TUI Shows

The interactive UI shows a table with these columns:

- `PORT`
- `PROJECT`
- `FRAMEWORK`
- `PID`
- `MEM`
- `UPTIME`
- `COMMAND`

Below the table, the selected process panel shows:

- port
- project
- PID
- framework
- memory
- uptime
- working directory

The header also shows:

- current version
- current filter mode
- current sort mode

### TUI Shortcuts

#### Navigation

- `↑` / `↓`
  Moves the current selection up or down the visible rows.

#### Search

- `/`
  Opens the search bar at the bottom of the UI.

Search behavior:

- typing filters the visible table live
- it matches:
  - project name
  - command
  - port number
- `Enter` locks in the current search
- `Escape` cancels and clears the search while the search bar is active
- while the search bar is active, other shortcuts are disabled so typing only affects search

Matching is case-insensitive and uses substring matching; leading and trailing whitespace in the query is ignored. To clear a locked search, press `/` to reopen the search bar, then `Escape`.

#### Filtering

- `f`
  Cycles through filter modes.

Filter modes:

- `all ports`
  Shows every listening port.
- `dev ports`
  Shows only ports `3000` through `9999`.
- `node only`
  Shows only processes that are either:
  - recognized as a supported framework project
  - or have a command containing `node`, `deno`, or `bun`

When the filter changes:

- selection resets to the first visible row
- the current filter label is shown in the header

#### Sorting

- `s`
  Cycles through sort modes.

Sort modes:

- `port asc`
  Sorts by port number, lowest first.
- `memory desc`
  Sorts by memory usage, highest first.
- `uptime desc`
  Sorts by uptime, longest running first.
- `project a-z`
  Sorts alphabetically by project name.

The current sort label is shown in the header. Memory and uptime ties are ordered by port ascending, as are matching project names. Missing memory or uptime values are treated as zero for sorting.

#### Refresh

- `r`
  Refreshes immediately instead of waiting for the 3-second auto-refresh.

#### Kill

- `K`
  Stops the selected PID after fresh validation of its PID/port pair, using the guarded termination behavior described above. It never substitutes another PID sharing the port. Duplicate activation of the same pending action is ignored.

#### Open In Browser

- `o`
  Opens `http://localhost:PORT` for the selected row in the default browser.

This only makes sense for services that actually speak HTTP.

#### Open In Editor

- `e`
  Opens the detected process working directory for the selected port in your preferred editor. This can be below the directory containing `package.json`; the action does not automatically open the package root.

Editor command precedence:

1. `PORTS_EDITOR`
2. `VISUAL`
3. `EDITOR`
4. detected `code`

The first defined environment variable wins. A blank value falls back to detecting `code`, rather than trying lower-priority variables. If a configured command fails, `ports` does not retry with another editor.

Examples for macOS/Linux shells:

```bash
PORTS_EDITOR="cursor" ports
PORTS_EDITOR="code -n" ports
PORTS_EDITOR="windsurf" ports
```

In Windows PowerShell:

```powershell
$env:PORTS_EDITOR = "code -n"
ports
```

If no working directory could be detected or the editor cannot be launched, the TUI displays an error. Browser and editor actions validate the selected PID/port pair again. The editor uses that row's detected directory. The browser opens the shared HTTP endpoint and cannot choose which process handles a connection.

#### Quit

- `q`
  Exits the interactive UI.

## Features Explained

### Project Detection

For each listening process, `ports` tries to find a working directory or best-guess project path and then walks upward until it finds a `package.json`.

That is used to determine:

- the project name
- the framework

The project name uses the nearest `package.json`'s non-empty `name`. Fallbacks are:

- if the package name is missing or the file cannot be parsed, the directory containing `package.json` supplies the name
- if no `package.json` is found, the detected working directory's name is used
- if no working directory is available, the project name is `-`

The framework is `-` when no supported framework can be detected. Working-directory, project, and framework information is cached between refreshes. Restart `ports` after changing project metadata if the displayed information is stale.

### Framework Detection

`ports` checks `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` in the nearest detected `package.json` for these frameworks, in this order:

- Next.js
- Astro
- Vite
- Remix
- Nuxt
- SvelteKit
- Angular

The first matching framework wins. For example, a package containing both `vite` and `@sveltejs/kit` is labeled `Vite`. If none are found, the framework column shows `-`.

### Command Detection

The `COMMAND` column prefers the short process name reported by the OS.

When the short name is exactly `MainThread`, `ports` tries command-line information to find a better label. If process statistics provide no command, it falls back to the listener's command when available, then `-`.

This is why a generic thread label can be replaced with something more useful like `node`.

### Visual Emphasis

`ports` intentionally makes likely dev servers easier to spot.

Dev-like processes stay at normal brightness when their command contains any of these strings (case-insensitive), or a supported framework is detected:

- `node`
- `deno`
- `bun`

Other processes are dimmed in the TUI and static table, except for the selected TUI row, which uses inverse highlighting.

Memory highlighting:

- at or above `200 MB` and below `500 MB`: orange
- at or above `500 MB`: red

Only the memory value receives memory highlighting. Colors depend on terminal color support.

Memory values use binary scaling: KiB is divided by 1024 for the displayed `MB` value and by 1024 squared for `GB`. Values of at least 1024 MB are displayed in GB. Missing or zero memory values and missing uptime values display as `-`; JSON uses `null` for missing values.

### Search, Filter, and Sort Together

The TUI applies these layers in sequence:

1. start with all discovered listeners
2. apply the selected filter mode
3. apply the current search query
4. apply the selected sort mode

This means you can narrow the list quickly, then sort just the visible subset.

## How ports Works

### Shared Behavior

Across all supported platforms, `ports`:

- finds listening TCP ports
- gathers per-process command, memory, and uptime data
- tries to identify the process working directory or infer a directory
- walks upward to find `package.json`
- detects a supported framework from dependencies
- returns one normalized process model to the CLI, JSON mode, and TUI

### macOS and Linux Backend

On macOS and Linux, `ports` uses:

- `lsof -iTCP -sTCP:LISTEN -P -n`
- `lsof -a -p <pid> -d cwd -Fn`
- `ps -o comm=,args=,rss=,etime= -p <pid>`

### Windows Backend

On Windows, `ports` uses PowerShell built-ins:

- `Get-NetTCPConnection -State Listen`
- `Get-Process` for process name, working-set memory, and start time
- `Get-CimInstance Win32_Process` for missing command-line and executable-path metadata

Windows working-directory detection is best effort. It takes the directory of the first path-like token in the command line, falling back to the executable's directory. This can identify the runtime installation directory rather than the project directory, affecting project/framework detection and the editor action.

The Windows backend caches metadata and batches queries to reduce refresh work. Refreshes may still feel heavier than on macOS/Linux because of the PowerShell-based inspection.

## Tech Stack

- TypeScript
- Commander.js
- Ink
- React
- chalk
- execa
- tsup
- PowerShell on Windows
- `lsof` and `ps` on macOS/Linux

## Troubleshooting

### `npm link` fails with permissions

Your npm global prefix is probably pointing to a system-owned directory.

Set it to a user-owned directory instead, add npm's global executable directory to `PATH`, then run `npm link` again. You can also use `node dist/cli.js` after building to avoid global linking.

### No listeners or incomplete process details

Check that the platform tools listed under Installation are available. Missing tools, failed required queries, malformed listener output, and enumeration timeouts produce an error and CLI status 1, with diagnostics on stderr and no success payload. Successful JSON is still an array; optional metadata warnings appear only on stderr. Genuine empty discovery exits 0. Process visibility still depends on OS permissions, and processes can exit during collection.

### Browser open does not work

`ports` uses the platform default opener:

- macOS: `open`
- Linux: `xdg-open`
- Windows: PowerShell `Start-Process`

If the environment does not support GUI launch, the command may fail gracefully.

### Editor open does not work

Set one of these environment variables to a working editor command:

- `PORTS_EDITOR`
- `VISUAL`
- `EDITOR`

Check higher-priority variables too: an invalid `PORTS_EDITOR` takes precedence over a valid `VISUAL` or `EDITOR`. The editor command must be launchable in the environment running `ports`.

Examples:

```bash
export PORTS_EDITOR="cursor"
export PORTS_EDITOR="code -n"
```

On Windows PowerShell:

```powershell
$env:PORTS_EDITOR = "code -n"
```

### Refresh failure and stale data

The TUI retains prior rows after a refresh failure and shows `STALE`, the last successful refresh time, and the error. An initial failure shows unavailable data. Search, sorting, and filtering do not clear discovery errors; the next successful snapshot does. Action failures remain visible across routine refreshes.

Selection follows the same PID/port through refreshes and sorting. If it disappears, selection moves to its former position, clamped to the remaining rows; an empty list has no selection. Filter/search changes reset selection to the first visible row. All actions capture their target when pressed.

Only one snapshot collection runs at a time. Pending refreshes coalesce and action validation takes priority over queued routine refreshes. Each active collection has a total 15-second budget; required-query failure is fatal, while optional enrichment deadline produces known listener rows with fallback details and a warning. Stop commands and liveness probes are also bounded.

PID/port checks cannot eliminate PID reuse or races between validation and signaling. Cached cwd/project metadata can remain stale after undetected PID reuse; fresh enumeration does not prove fresh process identity or directory metadata. Restart the tool if cached details are stale.

### A framework is shown as `-`

That means `ports` did not find one of the supported frameworks in the nearest detected `package.json`, or the process is not tied to a JavaScript project at all.

On Windows, an inferred directory pointing at the runtime rather than the project can also prevent detection. Restart `ports` after editing `package.json` to clear cached project metadata.

### A working directory is missing

This can happen when the OS does not expose the process cwd directly or the process exits while `ports` is collecting data.

This is more likely on Windows, where cwd recovery is best effort.
