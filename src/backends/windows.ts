import path from "node:path";
import { buildEditorErrorMessage, derivePathFromCommandLine, resolveEditorCommand } from "./common.js";
import { findAvailableCommand, runCommandOrUndefined, runCommandWithExitCode } from "../system.js";
import type { BackendActionResult, PlatformPortBackend, ProcessStats, RawListener } from "./types.js";

interface WindowsListener {
  LocalPort?: number | string;
  OwningProcess?: number | string;
}

interface WindowsProcess {
  ProcessId?: number | string;
  Name?: string;
  CommandLine?: string;
  WorkingSetSize?: number | string;
  CreationDate?: string;
  ExecutablePath?: string;
}

export class WindowsPortBackend implements PlatformPortBackend {
  private readonly shellPromise = findAvailableCommand(["powershell", "pwsh"]);

  async getListeningPorts(): Promise<RawListener[]> {
    const listeners = await this.runPowerShellJson<WindowsListener[]>(
      "Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Depth 3"
    );

    const records = new Map<string, RawListener>();
    for (const listener of normalizeArray(listeners)) {
      const port = Number(listener.LocalPort);
      const pid = Number(listener.OwningProcess);
      if (Number.isNaN(port) || Number.isNaN(pid)) {
        continue;
      }

      const key = `${pid}:${port}`;
      if (!records.has(key)) {
        records.set(key, { port, pid });
      }
    }

    return [...records.values()];
  }

  async getWorkingDirectory(pid: number): Promise<string | undefined> {
    const process = await this.getWindowsProcess(pid);
    if (!process) {
      return undefined;
    }

    const fromArgs = derivePathFromCommandLine(process.CommandLine);
    if (fromArgs) {
      return path.dirname(fromArgs);
    }

    if (process.ExecutablePath) {
      return path.dirname(process.ExecutablePath);
    }

    return undefined;
  }

  async getProcessStats(pid: number): Promise<ProcessStats | undefined> {
    const process = await this.getWindowsProcess(pid);
    if (!process) {
      return undefined;
    }

    const memoryKb = process.WorkingSetSize ? Math.round(Number(process.WorkingSetSize) / 1024) : undefined;

    return {
      command: process.Name?.trim(),
      args: process.CommandLine?.trim(),
      memoryKb,
      uptime: formatWindowsElapsedTime(process.CreationDate)
    };
  }

  async killProcess(pid: number, port: number): Promise<BackendActionResult> {
    const shell = await this.getPowerShellShell();
    if (!shell) {
      return {
        success: false,
        message: "PowerShell was not found, so the process could not be stopped on Windows."
      };
    }

    const termResult = await runCommandWithExitCode([shell, "-NoProfile", "-Command", `Stop-Process -Id ${pid} -ErrorAction Stop`]);
    if (termResult.exitCode !== 0) {
      return {
        success: false,
        message: `Failed to stop PID ${pid} on port ${port}.`
      };
    }

    await wait(1000);

    if (!(await this.isProcessAlive(pid))) {
      return {
        success: true,
        message: `Stopped PID ${pid} on port ${port}.`
      };
    }

    const killResult = await runCommandWithExitCode([shell, "-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction Stop`]);
    if (killResult.exitCode !== 0) {
      return {
        success: false,
        message: `Stop-Process was sent to PID ${pid}, but the forced stop failed.`
      };
    }

    return {
      success: true,
      message: `Stopped stubborn PID ${pid} on port ${port} with a forced stop after waiting 1s.`
    };
  }

  async isProcessAlive(pid: number): Promise<boolean> {
    const shell = await this.getPowerShellShell();
    if (!shell) {
      return false;
    }

    const result = await runCommandWithExitCode([
      shell,
      "-NoProfile",
      "-Command",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { exit 0 } else { exit 1 }`
    ]);

    return result.exitCode === 0;
  }

  async openInBrowser(url: string): Promise<BackendActionResult> {
    const shell = await this.getPowerShellShell();
    if (!shell) {
      return {
        success: false,
        message: "PowerShell was not found, so the browser could not be opened on Windows."
      };
    }

    const result = await runCommandWithExitCode([shell, "-NoProfile", "-Command", `Start-Process "${escapePowerShellString(url)}"`]);
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

  private async getWindowsProcess(pid: number): Promise<WindowsProcess | undefined> {
    const process = await this.runPowerShellJson<WindowsProcess | WindowsProcess[]>(
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,Name,CommandLine,WorkingSetSize,CreationDate,ExecutablePath | ConvertTo-Json -Depth 4`
    );

    return normalizeArray(process)[0];
  }

  private async runPowerShellJson<T>(command: string): Promise<T | undefined> {
    const shell = await this.getPowerShellShell();
    if (!shell) {
      return undefined;
    }

    const output = await runCommandOrUndefined([shell, "-NoProfile", "-Command", command]);
    if (!output) {
      return undefined;
    }

    try {
      return JSON.parse(output) as T;
    } catch {
      return undefined;
    }
  }

  private async getPowerShellShell(): Promise<string | undefined> {
    return this.shellPromise;
  }
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function formatWindowsElapsedTime(creationDate?: string): string | undefined {
  if (!creationDate) {
    return undefined;
  }

  const startedAt = new Date(creationDate);
  if (Number.isNaN(startedAt.getTime())) {
    return undefined;
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  if (elapsedMs < 0) {
    return undefined;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hhmmss = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}-${hhmmss}` : hhmmss;
}

function escapePowerShellString(value: string): string {
  return value.replaceAll('"', '`"');
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
