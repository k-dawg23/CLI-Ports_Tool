# ports

`ports` is a developer-focused CLI and terminal UI for inspecting and managing listening TCP ports on your machine.

`v2.0.0` makes the tool cross-platform. The same package now runs on macOS, Linux, and Windows, selecting the right process-discovery backend at runtime.

The project also includes a [user manual](USER_MANUAL.md) and a [single-page HTML guide](index.html). GitHub displays `index.html` as source; download it or clone the repository and open it in a browser to view the rendered guide.

## Features

- Interactive TUI when you run `ports` in a terminal, with automatic refresh every 3 seconds
- Static-list fallback when interactive input is unavailable
- Cross-platform runtime support for macOS, Linux, and Windows
- Static table output with `ports list`
- Machine-readable output with `ports list --json`
- Static list filters by exact port/PID or project-name substring
- Optional numeric IPv4/IPv6 listener bindings with `ports list --addresses`
- Port inspection with `ports check <port>`
- Quick termination with `ports kill <port>`
- Filter modes for all ports, dev ports, and node-focused processes
- Sort modes for port, memory, uptime, and project name
- Inline TUI search by project name, command, or port
- Visual emphasis that dims system processes and highlights high memory use
- Browser launch from the TUI with `o`
- Open the detected process working directory in your editor from the TUI with `e`
- Project detection by walking up to the nearest `package.json`
- Framework detection for Next.js, Astro, Vite, Remix, Nuxt, SvelteKit, and Angular

## Install

Prerequisites:

- Node.js 22.18+ on the 22.x line, 24.11+ on the 24.x line, or 26+, with npm. These requirements match the tsup 9 build tool; Node.js 24 or 26 LTS is recommended.
- macOS/Linux: `lsof` and `ps` on `PATH`.
- Windows: `powershell` or `pwsh` on `PATH`, with `Get-NetTCPConnection`, `Get-Process`, and `Get-CimInstance` available.

Install from this repository (Git is required for cloning):

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

Ensure npm's global executable directory is on `PATH`. If `npm link` fails because npm is configured to use a system-owned global directory, move npm's global prefix to a user-owned location first and add its executable directory to `PATH`.

You can also run the built CLI without linking:

```bash
node dist/cli.js
node dist/cli.js list --json
```

For development, `npm run dev` runs the TypeScript entry point directly; `npm start` runs the built CLI.

## Commands

```bash
ports
ports list
ports list --json
ports check 3000
ports kill 3000
ports --help
ports --version
```

`ports` opens the TUI only when standard input is a TTY with raw-mode support; otherwise it prints a notice and a static table. Use `ports list --json` for machine-readable output.

`ports list` prints a one-time table with port, project, framework, PID, memory, uptime, and command columns. `ports check <port>` shows details including the working directory, or reports that the port is free. Port arguments must contain only decimal digits and be in the range `1`–`65535`. Leading zeros are accepted; suffixes, fractions, signs, whitespace, and exponent notation are rejected before discovery.

`ports kill <port>` stops the first discovered process listening on that port. Stopping a process affects all of its ports. On macOS/Linux, it sends `SIGTERM`, waits 1 second, then sends `SIGKILL` only if the captured PID is confirmed alive and still listening on that port. On Windows, it calls `Stop-Process`, waits 1 second, then retries with `-Force` only after the same checks; this is not a graceful application shutdown. The command exits with status 1 if stopping fails, no listener is found, verification fails, or the process remains alive after releasing the listener. Only a confirmed process exit is reported as stopped. Failure diagnostics go to stderr.

`ports list --json` returns an array of objects with:

- `port`
- `pid`
- `command`
- `projectName`
- `framework`
- `memoryKB`
- `uptime`

`memoryKB` is memory usage in KiB and `uptime` is the OS-derived elapsed-time string; either is `null` when unavailable. Undetected frameworks use `"-"`. Listeners are deduplicated by PID and port, so a port can appear more than once when multiple processes listen on it.

## TUI Shortcuts

- `↑` / `↓` move selection
- `/` open the search bar; typing filters live, `Enter` locks it in, `Escape` clears it while the search bar is active
- `f` cycle filters between all ports, dev ports (`3000`–`9999`), and node only (commands containing `node`, `deno`, or `bun`, or any recognized framework)
- `s` cycle sorting between port ascending, memory descending, uptime descending, and project name alphabetically
- `r` refresh immediately
- `K` stop the selected PID after fresh PID/port validation; repeated presses during the same pending action are ignored
- `o` open `http://localhost:PORT` in the default browser (useful for HTTP services)
- `e` open the detected process working directory in your preferred editor
- `q` quit

Other shortcuts are disabled while the search bar is active. To clear a locked search, press `/` followed by `Escape`.

## Cross-Platform Backends

`ports` uses a shared data model with OS-specific backends underneath it.

- macOS and Linux use:
  - `lsof -iTCP -sTCP:LISTEN -P -n`
  - `lsof -a -p <pid> -d cwd -Fn`
  - `ps -o comm=,args=,rss=,etime= -p <pid>`
- Windows uses PowerShell built-ins:
  - `Get-NetTCPConnection -State Listen`
  - `Get-Process` for process name, memory, and start time
  - `Get-CimInstance Win32_Process` for missing command-line and executable-path metadata

The CLI, TUI, JSON output, filters, sorting, and search share the same implementation across platforms. On Windows, working-directory detection is best effort: it derives a directory from a path in the command line or the executable path, which may not be the project directory. Project/framework detection and editor opening depend on that result.

On Windows, `ports` has been tuned to keep the live experience practical, but it still does more work through PowerShell than the macOS/Linux backend does through native Unix tools. In day-to-day use that means Windows may feel a little heavier during refreshes, even though the feature set is the same.

## Editor Selection

When you press `e` in the TUI, `ports` opens the detected working directory, which can be below the directory containing `package.json`. It chooses the editor command using this precedence:

1. `PORTS_EDITOR`
2. `VISUAL`
3. `EDITOR`
4. detected `code`

Examples for macOS/Linux shells:

```bash
PORTS_EDITOR="cursor" ports
PORTS_EDITOR="windsurf" ports
PORTS_EDITOR="code -n" ports
```

In Windows PowerShell:

```powershell
$env:PORTS_EDITOR = "code -n"
ports
```

The first defined editor environment variable takes precedence. A blank value falls back to detecting `code`; an invalid configured command does not cause a retry with a lower-priority editor. If the editor cannot be launched, or no working directory is detected, the TUI displays an error.

## Visual Styling

- Processes whose command contains `node`, `deno`, or `bun`, or that have a recognized framework, stay at normal brightness
- Other processes are dimmed in both the TUI and `ports list`, except for the selected TUI row
- Memory values at or above `200 MB` are highlighted in orange
- Memory values at or above `500 MB` are highlighted in red

Memory is divided by 1024 for the displayed `MB`/`GB` values. Color output depends on terminal color support.

## Display Notes

- Framework shows `-` when no framework is detected or it is not relevant
- Project name comes from the nearest `package.json` name, falling back to a directory name; it is `-` when no working directory is available
- Framework detection checks dependencies, dev dependencies, peer dependencies, and optional dependencies in that `package.json`; the first matching framework wins
- Command prefers the short process name from system process data, with a fallback for generic values like `MainThread`
- The TUI and static list share column widths, though their spacing differs; long text values may be truncated

## Reliability and verification

Discovery failures exit with status 1 and diagnostics on stderr; they never produce an empty JSON array or a free-port result. Successful JSON keeps its existing schema, with optional metadata warnings on stderr. A genuine empty result is still `[]`. Results remain subject to OS process-visibility permissions.

The TUI retains the last successful snapshot after a failed refresh, labels it `STALE`, and shows its refresh time and error. Initial failure shows unavailable data. Selection follows the PID/port across refreshes and sorting; filters and search can reset it. Refreshes and action validation are serialized, and active collection has a 15-second budget. Optional enrichment that exceeds the budget produces fallback details and a warning.

`ports list` accepts exact `--port` and `--pid` filters plus a case-insensitive literal `--project` substring; multiple filters combine with AND and each may be used once. `--addresses` opts into a complete bindings column, or an extended JSON `addresses` field when used with `--json`. Bind addresses identify local interfaces and wildcards but do not prove external reachability. Metadata uses a 30-second TTL and refreshes on the first successful collection after expiry. PID/port validation still cannot eliminate PID reuse or races between checking and signaling. Browser opening still targets `http://localhost:PORT` and cannot select a particular process sharing it.

Development checks: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:integration`, and `npm run test:native`. Native checks start and clean up only their own test servers. The completed v2.0.1 platform evidence is retained in the [v2.0.1 release execution report](docs/verification/v2.0.1-release-execution-report.md). v2.0.2 macOS and Windows checks remain pending; see the [v2.0.2 implementation and verification report](docs/verification/v2.0.2-implementation-verification-report.md).

## Version

Current application version: `v2.0.2` (platform acceptance pending).

## Local test output capture

`npm test` checks command results and launcher environments using fixtures that write their diagnostics directly to file descriptors. `node scripts/stdio-preflight.mjs` separately verifies asynchronous Node stdout/stderr over pipes. The default `npm run test:integration` requires that preflight to pass.

If a restricted local environment cannot capture piped Node output, run `npm run test:integration -- --file-capture` to verify the built CLI with stdout/stderr redirected to temporary files. This mode retains the integration assertions but does not verify pipes. It is explicit, is rejected in CI, and does not change application output handling.

Windows and macOS checks run on GitHub Actions hosted runners. The existing four-job matrix retains normal piped integration capture, native discovery, and Node 24 Unix PTY/Windows ConPTY scenarios. Passing local file capture does not replace those checks.
