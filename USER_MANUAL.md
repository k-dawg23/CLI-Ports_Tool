# ports User Manual

## Overview

`ports` is a developer-focused CLI and terminal UI for inspecting what is listening on TCP ports on your machine.

As of `v2.0.0`, the same package works on macOS, Linux, and Windows. The interface stays the same across platforms, while the process-discovery backend changes automatically behind the scenes.

The Windows version has been optimized to keep the tool comfortably usable for everyday development, but its refresh path is still somewhat heavier than the macOS/Linux version because it relies more on PowerShell-based system queries.

## Installation

From the project directory:

```bash
npm install
npm run build
npm link
```

After linking, run:

```bash
ports
```

If `npm link` fails because of permissions, configure npm to use a user-owned global prefix and then run `npm link` again.

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

If `ports` is run in a non-interactive shell, it automatically falls back to the static list view instead of opening the TUI.

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

This is useful when you just want a quick snapshot.

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

This mode is meant for scripts and integrations.

Example:

```bash
ports list --json
```

### `ports check <port>`

Shows detailed information for one port.

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

Stops whatever is listening on a port.

Behavior:

- sends a graceful termination first
- waits 1 second
- if the process is still alive, sends a forced stop

On Unix-style systems this is `SIGTERM` then `SIGKILL`. On Windows this is `Stop-Process`, then `Stop-Process -Force`.

Example:

```bash
ports kill 3000
```

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
- `Escape` cancels and clears the search
- while the search bar is active, other shortcuts are disabled so typing only affects search

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

The current sort label is shown in the header.

#### Refresh

- `r`
  Refreshes immediately instead of waiting for the 3-second auto-refresh.

#### Kill

- `K`
  Kills the currently selected process using the same graceful-then-forced behavior as `ports kill <port>`.

#### Open In Browser

- `o`
  Opens `http://localhost:PORT` for the selected row in the default browser.

This only makes sense for services that actually speak HTTP.

#### Open In Editor

- `e`
  Opens the detected project directory for the selected row in your preferred editor.

Editor command precedence:

1. `PORTS_EDITOR`
2. `VISUAL`
3. `EDITOR`
4. detected `code`

Examples:

```bash
PORTS_EDITOR="cursor" ports
PORTS_EDITOR="code -n" ports
PORTS_EDITOR="windsurf" ports
```

If no working directory could be detected, this action will fail gracefully.

#### Quit

- `q`
  Exits the interactive UI.

## Features Explained

### Project Detection

For each listening process, `ports` tries to find a working directory or best-guess project path and then walks upward until it finds a `package.json`.

That is used to determine:

- the project name
- the framework

If no project can be identified:

- project name falls back to `-`
- framework falls back to `-`

### Framework Detection

`ports` checks `package.json` dependencies and devDependencies for these frameworks:

- Next.js
- Astro
- Vite
- Remix
- Nuxt
- SvelteKit
- Angular

If none are found, the framework column shows `-`.

### Command Detection

The `COMMAND` column prefers the short process name reported by the OS.

If that short name is generic and not useful, such as `MainThread`, `ports` falls back to command-line information to find a better label.

This is why a generic thread label can be replaced with something more useful like `node`.

### Visual Emphasis

`ports` intentionally makes likely dev servers easier to spot.

Dev-like processes stay at normal brightness when they are:

- `node`
- `deno`
- `bun`
- or attached to a recognized framework

System-style processes are dimmed so dev servers stand out more clearly.

Memory highlighting:

- above `200 MB`: orange
- above `500 MB`: red

Only the memory value is highlighted, not the whole row.

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
- tries to identify the project directory
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
- `Get-CimInstance Win32_Process`

Windows working-directory detection is best effort. When the exact cwd is not available, `ports` tries to derive a useful project path from the executable path or command line.

In practice, the Windows backend is feature-complete and usable, but it may refresh a little less lightly than the macOS/Linux backend because the underlying process inspection is more expensive.

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

Set it to a user-owned directory instead, then run `npm link` again.

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

Examples:

```bash
export PORTS_EDITOR="cursor"
export PORTS_EDITOR="code -n"
```

On Windows PowerShell:

```powershell
$env:PORTS_EDITOR = "code -n"
```

### A framework is shown as `-`

That means `ports` did not find one of the supported frameworks in the nearest detected `package.json`, or the process is not tied to a JavaScript project at all.

### A working directory is missing

This can happen when the OS does not expose the process cwd directly or the process exits while `ports` is collecting data.

This is more likely on Windows, where cwd recovery is best effort.
