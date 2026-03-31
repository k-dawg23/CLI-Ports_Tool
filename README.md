# ports

`ports` is a developer-first CLI and terminal UI for seeing what is listening on your machine right now.

## Features

- Interactive TUI when you run `ports`
- Static table output with `ports list`
- Port inspection with `ports check <port>`
- Quick termination with `ports kill <port>`
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
ports check 3000
ports kill 3000
```

## TUI Shortcuts

- `↑` / `↓` move selection
- `r` refresh immediately
- `k` kill the selected process
- `q` quit

## How It Works

- `lsof -iTCP -sTCP:LISTEN -P -n` finds listeners
- `lsof -a -p <pid> -d cwd -Fn` finds working directories
- `ps -o rss=,etime= -p <pid>` provides memory and uptime
- The tool walks upward from each process working directory to locate `package.json`

## Version

Initial release: `v1.0.0`
