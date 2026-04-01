# ports

`ports` is a developer-first CLI and terminal UI for seeing what is listening on your machine right now.

`v2.0.0` makes the tool cross-platform. The same package now runs on macOS, Linux, and Windows, selecting the right process-discovery backend at runtime.

The project also includes a single-page end-user site at [index.html](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/index.html) and a full manual at [USER_MANUAL.md](/home/kdawg/AI-BootCamp/CLI-Ports_Tool/USER_MANUAL.md).

## Features

- Interactive TUI when you run `ports`
- Cross-platform runtime support for macOS, Linux, and Windows
- Static table output with `ports list`
- Machine-readable output with `ports list --json`
- Port inspection with `ports check <port>`
- Quick termination with `ports kill <port>`
- Filter modes for all ports, dev ports, and node-focused processes
- Sort modes for port, memory, uptime, and project name
- Inline TUI search by project name, command, or port
- Visual emphasis that dims system processes and highlights high memory use
- Browser launch from the TUI with `o`
- Project-folder launch from the TUI with `e`
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

If `npm link` fails because npm is configured to use a system-owned global directory, move npm's global prefix to a user-owned location first.

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
- `/` open the search bar; typing filters live, `Enter` locks it in, `Escape` clears it
- `f` cycle filters between all ports, dev ports, and node only
- `s` cycle sorting between port, memory, uptime, and project name
- `r` refresh immediately
- `K` stop the selected process gracefully first, then force-stop it after 1 second if needed
- `o` open `http://localhost:PORT` in the default browser
- `e` open the detected project directory in your preferred editor
- `q` quit

## Cross-Platform Backends

`ports` uses a shared data model with OS-specific backends underneath it.

- macOS and Linux use:
  - `lsof -iTCP -sTCP:LISTEN -P -n`
  - `lsof -a -p <pid> -d cwd -Fn`
  - `ps -o comm=,args=,rss=,etime= -p <pid>`
- Windows uses PowerShell built-ins:
  - `Get-NetTCPConnection -State Listen`
  - `Get-CimInstance Win32_Process`

The CLI, TUI, JSON output, filters, sorting, search, and project/framework detection all stay the same across platforms.

On Windows, `ports` has been tuned to keep the live experience practical, but it still does more work through PowerShell than the macOS/Linux backend does through native Unix tools. In day-to-day use that means Windows may feel a little heavier during refreshes, even though the feature set is the same.

## Editor Selection

When you press `e` in the TUI, `ports` chooses the editor command using this precedence:

1. `PORTS_EDITOR`
2. `VISUAL`
3. `EDITOR`
4. detected `code`

Examples:

```bash
PORTS_EDITOR="cursor" ports
PORTS_EDITOR="windsurf" ports
PORTS_EDITOR="code -n" ports
```

If no supported editor command is available, `ports` shows a clear error instead of crashing.

## Visual Styling

- Dev processes stay at normal brightness when they are `node`, `deno`, `bun`, or have a recognized framework
- System-style processes are dimmed in both the TUI and `ports list`
- Memory values over `200 MB` are highlighted in orange
- Memory values over `500 MB` are highlighted in red

## Display Notes

- Framework shows `-` when no framework is detected or it is not relevant
- Command prefers the short process name from system process data, with a fallback for generic values like `MainThread`
- The TUI and static list share fixed-width columns so values stay aligned under their headings

## Version

Current release: `v2.0.0`
