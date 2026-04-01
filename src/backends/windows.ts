import path from "node:path";
import { buildEditorErrorMessage, derivePathFromCommandLine, resolveEditorCommand } from "./common.js";
import { findAvailableCommand, runCommandOrUndefined, runCommandWithExitCode } from "../system.js";
import type { BackendActionResult, PlatformPortBackend, ProcessStats, RawListener } from "./types.js";

interface WindowsListener {
  LocalPort?: number | string;
  OwningProcess?: number | string;
}

interface WindowsProcessSnapshot {
  Id?: number | string;
  ProcessName?: string;
  WorkingSet64?: number | string;
  StartTime?: string;
}

interface WindowsProcessMetadata {
  ProcessId?: number | string;
  CommandLine?: string;
  ExecutablePath?: string;
}

interface WindowsSnapshotPayload {
  Listeners?: WindowsListener[] | WindowsListener;
  Processes?: WindowsProcessSnapshot[] | WindowsProcessSnapshot;
}

interface CachedWindowsProcess {
  pid: number;
  name?: string;
  workingSetSize?: number;
  startTime?: string;
  commandLine?: string;
  executablePath?: string;
}

export class WindowsPortBackend implements PlatformPortBackend {
  private readonly shellPromise = findAvailableCommand(["powershell", "pwsh"]);
  private processCache = new Map<number, CachedWindowsProcess>();

  async getListeningPorts(): Promise<RawListener[]> {
    const snapshot = await this.getSnapshotPayload();
    const listeners = normalizeArray(snapshot?.Listeners);
    const fastProcesses = normalizeArray(snapshot?.Processes);

    this.refreshFastProcessCache(fastProcesses);

    const records = new Map<string, RawListener>();
    for (const listener of listeners) {
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

    await this.primeMetadataCache([...new Set([...records.values()].map((record) => record.pid))]);
    return [...records.values()];
  }

  async getWorkingDirectory(pid: number): Promise<string | undefined> {
    const process = await this.getWindowsProcess(pid);
    if (!process) {
      return undefined;
    }

    const fromArgs = derivePathFromCommandLine(process.commandLine);
    if (fromArgs) {
      return path.dirname(fromArgs);
    }

    if (process.executablePath) {
      return path.dirname(process.executablePath);
    }

    return undefined;
  }

  async getProcessStats(pid: number): Promise<ProcessStats | undefined> {
    const process = await this.getWindowsProcess(pid);
    if (!process) {
      return undefined;
    }

    const memoryKb = process.workingSetSize ? Math.round(process.workingSetSize / 1024) : undefined;

    return {
      command: process.name?.trim(),
      args: process.commandLine?.trim(),
      memoryKb,
      uptime: formatWindowsElapsedTime(process.startTime)
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

  private refreshFastProcessCache(processes: WindowsProcessSnapshot[]): void {
    const nextCache = new Map<number, CachedWindowsProcess>();

    for (const process of processes) {
      const pid = Number(process.Id);
      if (Number.isNaN(pid)) {
        continue;
      }

      const previous = this.processCache.get(pid);
      nextCache.set(pid, {
        pid,
        name: process.ProcessName?.trim() ?? previous?.name,
        workingSetSize: numberOrUndefined(process.WorkingSet64) ?? previous?.workingSetSize,
        startTime: process.StartTime ?? previous?.startTime,
        commandLine: previous?.commandLine,
        executablePath: previous?.executablePath
      });
    }

    this.processCache = nextCache;
  }

  private async primeMetadataCache(pids: number[]): Promise<void> {
    const missingMetadata = pids.filter((pid) => {
      const cached = this.processCache.get(pid);
      return cached && !cached.commandLine && !cached.executablePath;
    });

    if (missingMetadata.length === 0) {
      return;
    }

    const metadata = await this.runPowerShellJson<WindowsProcessMetadata | WindowsProcessMetadata[]>(
      `Get-CimInstance Win32_Process -Filter "${missingMetadata.map((pid) => `ProcessId = ${pid}`).join(" OR ")}" | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Depth 4`
    );

    for (const process of normalizeArray(metadata)) {
      const pid = Number(process.ProcessId);
      if (Number.isNaN(pid)) {
        continue;
      }

      const cached = this.processCache.get(pid);
      if (!cached) {
        continue;
      }

      this.processCache.set(pid, {
        ...cached,
        commandLine: process.CommandLine?.trim() || cached.commandLine,
        executablePath: process.ExecutablePath?.trim() || cached.executablePath
      });
    }
  }

  private async getWindowsProcess(pid: number): Promise<CachedWindowsProcess | undefined> {
    return this.processCache.get(pid);
  }

  private async getSnapshotPayload(): Promise<WindowsSnapshotPayload | undefined> {
    return this.runPowerShellJson<WindowsSnapshotPayload>(
      [
        "$listeners = @(Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess)",
        "$pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)",
        "$processes = @()",
        "if ($pids.Count -gt 0) {",
        "  $processes = @(Get-Process -Id $pids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,StartTime)",
        "}",
        "[pscustomobject]@{ Listeners = $listeners; Processes = $processes } | ConvertTo-Json -Depth 5"
      ].join("; ")
    );
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

function numberOrUndefined(value?: number | string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function formatWindowsElapsedTime(startTime?: string): string | undefined {
  if (!startTime) {
    return undefined;
  }

  const startedAt = new Date(startTime);
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
