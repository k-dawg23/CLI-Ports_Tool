# ports

`ports` is a developer-first CLI and terminal UI for seeing what is listening on your machine right now.

The project also now includes a single-page end-user site at [index.html](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/index.html) that shows the product, features, shortcuts, commands, stack, and getting-started flow in one place.

## Features

- Interactive TUI when you run `ports`
- Filter modes for all ports, dev ports, and node-focused processes
- Sort modes for port, memory, uptime, and project name
- Inline TUI search by project name, command, or port
- Visual emphasis that dims system processes and highlights high memory use
- Static table output with `ports list`
- JSON output for `ports list --json`
- Cleaner framework fallback and command names in the UI
- Port inspection with `ports check <port>`
- Quick termination with `ports kill <port>`
- TUI shortcuts for browser launch and opening the project in VS Code
- Project detection by walking up to the nearest `package.json`
- Framework detection for Next.js, Astro, Vite, Remix, Nuxt, SvelteKit, and Angular

## Install

```bash
npm install
npm run build
npm link
```

After linking, run:

```bash
ports
```

If `ports` is run in a non-interactive shell, it automatically falls back to the static table view.

## Commands

```bash
ports
ports list
ports list --json
ports check 3000
ports kill 3000
```

`ports list --json` returns an array of objects with:

- `port`
- `pid`
- `command`
- `projectName`
- `framework`
- `memoryKB`
- `uptime`

## TUI Shortcuts

- `↑` / `↓` move selection
- `f` cycle filters between all ports, dev ports, and node only
- `s` cycle sorting between port, memory, uptime, and project name
- `/` open the search bar; typing filters live, `Enter` locks it in, `Escape` clears it
- `r` refresh immediately
- `K` stop the selected process with SIGTERM, then SIGKILL after 1 second if needed
- `o` open `http://localhost:PORT` in the default browser
- `e` open the detected project directory in VS Code
- `q` quit

## How It Works

- `lsof -iTCP -sTCP:LISTEN -P -n` finds listeners
- `lsof -a -p <pid> -d cwd -Fn` finds working directories
- `ps -o rss=,etime= -p <pid>` provides memory and uptime
- The tool walks upward from each process working directory to locate `package.json`

## Visual Styling

- Dev processes stay at normal brightness when they are `node`, `deno`, `bun`, or have a recognized framework
- System-style processes are dimmed in both the TUI and `ports list`
- Memory values over `200 MB` are highlighted in orange
- Memory values over `500 MB` are highlighted in red

## Display Notes

- Framework shows `-` when no framework is detected or it is not relevant
- Command uses the `ps` `comm` value, which is usually more useful than the truncated `lsof` command label
- The TUI columns are aligned to fixed widths so values sit cleanly under their headings

## Version

Current release: `v1.1.0`
