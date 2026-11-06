import path from "node:path";
import { buildEditorErrorMessage, resolveEditorCommand, stopValidatedProcess } from "./common.js";
import { requireCommand, runCheckedCommand, type CommandRunner } from "../system.js";
import { DiscoveryError, type CollectionContext } from "../discovery.js";
import type { BackendActionResult, PlatformPortBackend, ProcessStats, RawListener, ProcessLiveness, ValidateTarget } from "./types.js";

export class UnixPortBackend implements PlatformPortBackend {
  constructor(
    private readonly run: CommandRunner = runCheckedCommand,
    private readonly probe: (pid: number) => ProcessLiveness = unixProcessLiveness,
    private readonly wait?: (ms: number) => Promise<void>,
    private readonly platform = process.platform
  ) {}

  async getListeningPorts(context: CollectionContext): Promise<RawListener[]> {
    const result = await this.run(["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n"], { signal: context.signal, timeoutMs: context.remainingMs });
    if (!result.failure && result.exitCode === 1 && !result.stdout && (!result.stderr || (this.platform === "linux" && isLinuxMountWarning(result.stderr)))) {
      if (result.stderr) context.warn(listenerWarning(result.stderr));
      return [];
    }
    const output = requireCommand(result, "Unix", "lsof");
    if (result.stderr) context.warn(listenerWarning(result.stderr));
    const lines = output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    if (lines.length === 0) return [];
    if (!/^COMMAND\s+PID\s+.*\bNAME\s*$/.test(lines[0]!)) throw new DiscoveryError("invalid-output", "Unix", "Unrecognized lsof listener header.");

    const records = new Map<string, RawListener>();

    for (const line of lines.slice(1)) {
      const match = line.match(/^(\S+)\s+(\d+)\s+.+\sTCP\s+.+:(\d+)\s+\(LISTEN\)$/);
      if (!match) {
        throw new DiscoveryError("invalid-output", "Unix", "Unrecognized lsof listener record; collection may be incomplete.");
      }

      const [, command, pidText, portText] = match;
      const pid = Number(pidText);
      const port = Number(portText);
      if (!Number.isSafeInteger(pid) || pid < 0 || !Number.isInteger(port) || port < 1 || port > 65535) throw new DiscoveryError("invalid-output", "Unix", "Invalid lsof listener PID or port.");
      const key = `${pid}:${port}`;

      if (!records.has(key)) {
        records.set(key, {
          command,
          pid,
          port
        });
      }
    }

    return [...records.values()];
  }

  async getWorkingDirectory(pid: number, context: CollectionContext): Promise<string | undefined> {
    const result = await this.run(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], { signal: context.signal, timeoutMs: context.remainingMs });
    if (result.failure || (result.exitCode !== 0 && result.stderr)) context.warn("Some process details are unavailable: cwd query failed.");
    const output = result.exitCode === 0 && !result.failure ? result.stdout : undefined;
    if (!output) {
      return undefined;
    }

    const line = output
      .split("\n")
      .find((entry) => entry.startsWith("n"));

    if (!line) {
      return undefined;
    }

    const cwd = line.slice(1).trim();
    return cwd ? path.resolve(cwd) : undefined;
  }

  async getProcessStats(pid: number, context: CollectionContext): Promise<ProcessStats | undefined> {
    const result = await this.run(["ps", "-o", "comm=,args=,rss=,etime=", "-p", String(pid)], { signal: context.signal, timeoutMs: context.remainingMs });
    if (result.failure || (result.exitCode !== 0 && result.stderr)) context.warn("Some process details are unavailable: ps query failed. Check that ps is installed and on PATH.");
    const output = result.exitCode === 0 && !result.failure ? result.stdout : undefined;
    if (!output) {
      return undefined;
    }

    const trimmed = output.trim();
    const match = trimmed.match(/^(\S+)\s+(.+)\s+(\d+)\s+([0-9:-]+)$/);
    if (!match) {
      return undefined;
    }

    return {
      command: match[1].trim(),
      args: match[2].trim(),
      memoryKb: Number(match[3]),
      uptime: match[4].trim()
    };
  }

  async killProcess(pid: number, port: number, validate: ValidateTarget): Promise<BackendActionResult> {
    return stopValidatedProcess(pid, port, validate, async force => {
      requireCommand(await this.run(["kill", force ? "-9" : "-15", String(pid)], { timeoutMs: 15_000 }), "Unix", "kill");
    }, () => this.isProcessAlive(pid), this.wait);
  }

  async isProcessAlive(pid: number): Promise<ProcessLiveness> {
    return this.probe(pid);
  }

  async openInBrowser(url: string): Promise<BackendActionResult> {
    const command = process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
    // Launchers may remain attached for the lifetime of the user's application.
    const result = await this.run(command, { timeoutMs: 0, inheritLocale: true });
    if (result.failure || result.exitCode !== 0) {
      return {
        success: false,
        message: `Failed to open ${url} in your default browser.`
      };
    }

    return {
      success: true,
      message: `Opened ${url} in your default browser.`
    };
  }

  async openInEditor(targetPath: string): Promise<BackendActionResult> {
    const editorCommand = await resolveEditorCommand();
    if (!editorCommand) {
      return {
        success: false,
        message: buildEditorErrorMessage()
      };
    }

    const result = await this.run([...editorCommand, targetPath], { timeoutMs: 0, inheritLocale: true });
    if (result.failure || result.exitCode !== 0) {
      return {
        success: false,
        message: buildEditorErrorMessage(editorCommand)
      };
    }

    return {
      success: true,
      message: `Opened ${targetPath} in ${editorCommand[0]}.`
    };
  }
}

export function unixProcessLiveness(pid: number): ProcessLiveness {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "unknown", reason: "Invalid process PID." };
  try {
    process.kill(pid, 0);
    return { state: "alive" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { state: "exited" };
    if (code === "EPERM") return { state: "alive" };
    return { state: "unknown", reason: error instanceof Error ? error.message : "Liveness query failed." };
  }
}

// Native Linux fixtures verify these mount warnings with both populated and
// controlled no-match queries. Never swallow additional/unknown diagnostics.
export function isLinuxMountWarning(stderr: string): boolean {
  const lines = stderr.trimEnd().split("\n");
  return lines.length > 0 && lines.length % 2 === 0 && lines.every((line, index) => index % 2 === 0
    ? /^lsof: WARNING: can't stat\(\) (overlay|nsfs) file system .+$/.test(line)
    : /^\s+Output information may be incomplete\.$/.test(line));
}

function listenerWarning(stderr: string): string {
  return isLinuxMountWarning(stderr)
    ? "lsof reported filesystem visibility warnings; results may be incomplete."
    : `lsof reported a visibility warning: ${stderr}`;
}
