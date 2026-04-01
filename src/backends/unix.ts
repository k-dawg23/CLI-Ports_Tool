import path from "node:path";
import { buildEditorErrorMessage, resolveEditorCommand } from "./common.js";
import { runCommand, runCommandOrUndefined, runCommandWithExitCode } from "../system.js";
import type { BackendActionResult, PlatformPortBackend, ProcessStats, RawListener } from "./types.js";

export class UnixPortBackend implements PlatformPortBackend {
  async getListeningPorts(): Promise<RawListener[]> {
    const output = await runCommand(["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
    const lines = output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    if (lines.length <= 1) {
      return [];
    }

    const records = new Map<string, RawListener>();

    for (const line of lines.slice(1)) {
      const match = line.match(/^(\S+)\s+(\d+)\s+.+\sTCP\s+.+:(\d+)\s+\(LISTEN\)$/);
      if (!match) {
        continue;
      }

      const [, command, pidText, portText] = match;
      const pid = Number(pidText);
      const port = Number(portText);
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

  async getWorkingDirectory(pid: number): Promise<string | undefined> {
    const output = await runCommandOrUndefined(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
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

  async getProcessStats(pid: number): Promise<ProcessStats | undefined> {
    const output = await runCommandOrUndefined(["ps", "-o", "comm=,args=,rss=,etime=", "-p", String(pid)]);
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

  async killProcess(pid: number, port: number): Promise<BackendActionResult> {
    const termResult = await runCommandWithExitCode(["kill", "-15", String(pid)]);
    if (termResult.exitCode !== 0) {
      return {
        success: false,
        message: `Failed to kill PID ${pid} on port ${port}.`
      };
    }

    await wait(1000);

    if (!(await this.isProcessAlive(pid))) {
      return {
        success: true,
        message: `Stopped PID ${pid} on port ${port} with SIGTERM.`
      };
    }

    const killResult = await runCommandWithExitCode(["kill", "-9", String(pid)]);
    if (killResult.exitCode !== 0) {
      return {
        success: false,
        message: `SIGTERM was sent to PID ${pid}, but SIGKILL failed and the process is still alive.`
      };
    }

    return {
      success: true,
      message: `Stopped stubborn PID ${pid} on port ${port} with SIGKILL after waiting 1s for SIGTERM.`
    };
  }

  async isProcessAlive(pid: number): Promise<boolean> {
    const result = await runCommandWithExitCode(["kill", "-0", String(pid)]);
    return result.exitCode === 0;
  }

  async openInBrowser(url: string): Promise<BackendActionResult> {
    const command = process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
    const result = await runCommandWithExitCode(command);
    if (result.exitCode !== 0) {
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

    const result = await runCommandWithExitCode([...editorCommand, targetPath]);
    if (result.exitCode !== 0) {
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

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
