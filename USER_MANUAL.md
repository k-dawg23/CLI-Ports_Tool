# ports User Manual

## Overview

`ports` is a developer-focused CLI and terminal UI for inspecting what is listening on TCP ports on your machine.

It helps you answer questions like:

- What is running on port 3000?
- Which project owns this dev server?
- Is this a Next.js app, a Vite server, or a system service?
- Which listener is using a lot of memory?
- Can I kill this process, open it in the browser, or jump into its project folder quickly?

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

If `npm link` fails because of permissions, set npm's global prefix to a user-owned directory and try again.

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

- sends `SIGTERM` first
- waits 1 second
- if the process is still alive, sends `SIGKILL`

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
  Kills the currently selected process using the same `SIGTERM` then `SIGKILL` behavior as `ports kill <port>`.

#### Open In Browser

- `o`
  Opens `http://localhost:PORT` for the selected row in the default browser.

This only makes sense for services that actually speak HTTP.

#### Open In VS Code

- `e`
  Opens the detected project directory for the selected row in VS Code using the `code` command.

If no working directory could be detected, this action will fail gracefully.

#### Quit

- `q`
  Exits the interactive UI.

## Features Explained

### Project Detection

For each listening process, `ports` tries to find the working directory and then walks upward until it finds a `package.json`.

That is used to determine:

- the project name
- the framework

If no project can be identified:

- `projectName` falls back to a reasonable directory-based name where possible
- `framework` shows `-`

### Framework Detection

Recognized frameworks:

- Next.js
- Astro
- Vite
- Remix
- Nuxt
- SvelteKit
- Angular

If the process does not look like one of these, the framework column shows `-`.

### Command Display

The `COMMAND` column uses the `ps` `comm` value instead of relying only on the `lsof` command label.

Why this matters:

- `lsof` can return truncated or unhelpful values
- `ps comm` is usually more stable and readable

Special handling:

- if the command is `MainThread`, `ports` tries to derive a more useful fallback from the first meaningful token in `args`

### Memory Display

Memory comes from `ps` RSS output and is displayed in MB or GB.

Highlighting:

- over `200 MB`: orange
- over `500 MB`: red

Only the memory value itself is highlighted.

### Visual Emphasis

To make dev servers easier to spot, `ports` visually dims non-dev/system-style processes.

Processes stay normal brightness when they are:

- `node`
- `deno`
- `bun`
- or tied to a recognized framework

This applies to:

- the TUI
- `ports list`

### Uptime

Uptime comes from `ps etime`.

For sorting, `ports` parses the elapsed time string into seconds so that sorting by uptime is accurate.

## How ports Collects Its Data

The tool uses standard system commands:

- `lsof -iTCP -sTCP:LISTEN -P -n`
  Finds listening TCP ports.
- `lsof -a -p <pid> -d cwd -Fn`
  Finds the working directory of a process.
- `ps -o comm=,args=,rss=,etime= -p <pid>`
  Gets:
  - command
  - args
  - memory
  - uptime

Then it:

- walks upward to find `package.json`
- reads the package name
- inspects dependencies to detect the framework

## Example Workflows

### Find What Is On Port 3000

```bash
ports check 3000
```

### Kill A Stuck Dev Server

```bash
ports kill 5173
```

### Open The Full TUI

```bash
ports
```

Then:

- press `f` to filter
- press `s` to sort
- press `/` to search
- press `K` to kill the selected row

### Feed Another Script

```bash
ports list --json
```

## Troubleshooting

### `ports` command not found

Make sure you ran:

```bash
npm run build
npm link
```

### `npm link` permission denied

Your npm global prefix may point to a system-owned directory like `/usr`.

Configure a user-owned npm prefix, then run `npm link` again.

### Browser open does not work

The system needs a supported launcher:

- macOS: `open`
- Linux: `xdg-open`
- Windows: `start`

### VS Code open does not work

The `code` command must be installed and available in your shell.

### Search is not letting me use shortcuts

That is expected while the search bar is active.

Use:

- `Enter` to lock the search
- `Escape` to clear it and return to normal shortcuts

## Related Files

- End-user landing page: [index.html](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/index.html)
- Project overview: [README.md](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/README.md)
- Release history: [PROJECT_HISTORY.md](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/PROJECT_HISTORY.md)
