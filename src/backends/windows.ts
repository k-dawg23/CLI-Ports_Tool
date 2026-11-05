import path from "node:path";
import { buildEditorErrorMessage, derivePathFromCommandLine, resolveEditorCommand, stopValidatedProcess } from "./common.js";
import { findCheckedCommand, requireCommand, runCheckedCommand, type CommandRunner } from "../system.js";
import { DiscoveryError, CollectionContext } from "../discovery.js";
import type { BackendActionResult, PlatformPortBackend, ProcessStats, RawListener, ProcessLiveness, ValidateTarget } from "./types.js";

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
  private processCache = new Map<number, CachedWindowsProcess>();
  private readonly snapshots = new WeakMap<CollectionContext, Map<number, CachedWindowsProcess>>();

  constructor(private readonly run: CommandRunner = runCheckedCommand, private readonly wait?: (ms: number) => Promise<void>) {}

  async getListeningPorts(context: CollectionContext): Promise<RawListener[]> {
    const snapshot = await this.query<WindowsSnapshotPayload>(
      "$ErrorActionPreference = 'Stop'; $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object LocalPort,OwningProcess); [pscustomobject]@{ Listeners = $listeners } | ConvertTo-Json -Depth 5", context);
    if (!snapshot || !Array.isArray(snapshot.Listeners)) throw new DiscoveryError("invalid-output", "Windows", "PowerShell returned an invalid listener snapshot.");
    const records = new Map<string, RawListener>();
    for (const listener of snapshot.Listeners) {
      if (!listener || typeof listener !== "object") throw new DiscoveryError("invalid-output", "Windows", "Invalid listener record.");
      const port = listener.LocalPort;
      const pid = listener.OwningProcess;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535 || typeof pid !== "number" || !Number.isInteger(pid) || pid < 0 || pid > 0xffffffff) {
        throw new DiscoveryError("invalid-output", "Windows", "Invalid listener PID or port.");
      }
      records.set(`${pid}:${port}`, { pid, port });
    }
    return [...records.values()];
  }

  async prepareProcesses(records: RawListener[], context: CollectionContext): Promise<void> {
    const pids = [...new Set(records.map(record => record.pid))];
    const cache = new Map<number, CachedWindowsProcess>();
    this.snapshots.set(context, cache);
    if (pids.length === 0) {
      context.stage(() => { this.processCache = cache; });
      return;
    }
    const processes = await context.optional(() => this.query<WindowsProcessSnapshot[]>(
      `$ErrorActionPreference = 'Stop'; $items = @(Get-Process -Id @(${pids.join(",")}) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,@{Name='StartTime';Expression={try {$_.StartTime.ToUniversalTime().ToString('o')} catch {$null}}}); ConvertTo-Json -InputObject $items -Depth 4`, context));
    context.check();
    for (const process of Array.isArray(processes) ? processes : []) {
      const pid = Number(process.Id);
      if (!Number.isSafeInteger(pid) || !pids.includes(pid)) continue;
      const previous = this.processCache.get(pid);
      cache.set(pid, {
        pid, name: process.ProcessName?.trim(), workingSetSize: numberOrUndefined(process.WorkingSet64), startTime: process.StartTime,
        commandLine: previous?.commandLine, executablePath: previous?.executablePath
      });
    }
    const missing = pids.filter(pid => !cache.get(pid)?.commandLine && !cache.get(pid)?.executablePath);
    if (missing.length) {
      const metadata = await context.optional(() => this.query<WindowsProcessMetadata[]>(
        `$ErrorActionPreference = 'Stop'; $items = @(Get-CimInstance Win32_Process -Filter "${missing.map(pid => `ProcessId = ${pid}`).join(" OR ")}" -ErrorAction Stop | Select-Object ProcessId,CommandLine,ExecutablePath); ConvertTo-Json -InputObject $items -Depth 4`, context));
      context.check();
      for (const item of Array.isArray(metadata) ? metadata : []) {
        const pid = Number(item.ProcessId);
        if (!pids.includes(pid)) continue;
        cache.set(pid, { ...cache.get(pid), pid, commandLine: item.CommandLine?.trim(), executablePath: item.ExecutablePath?.trim() });
      }
    }
    const published = new Map(cache);
    context.stage(() => { this.processCache = published; });
  }

  async getWorkingDirectory(pid: number, context: CollectionContext): Promise<string | undefined> {
    const process = this.snapshots.get(context)?.get(pid);
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

  async getProcessStats(pid: number, context: CollectionContext): Promise<ProcessStats | undefined> {
    const process = this.snapshots.get(context)?.get(pid);
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

  async killProcess(pid: number, port: number, validate: ValidateTarget): Promise<BackendActionResult> {
    return stopValidatedProcess(pid, port, validate, async force => {
      const shell = await this.getPowerShellShell();
      if (!shell) throw new Error("PowerShell was not found or could not be queried. Check PATH.");
      requireCommand(await this.run([shell, "-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${pid}${force ? " -Force" : ""} -ErrorAction Stop`], { timeoutMs: 15_000 }), "Windows", "Stop-Process");
    }, () => this.isProcessAlive(pid), this.wait);
  }

  async isProcessAlive(pid: number): Promise<ProcessLiveness> {
    const context = new CollectionContext("Windows");
    try {
      return await context.required(async () => {
        // Enumerating IDs distinguishes absence from an error querying one ID.
        const state = await this.query<{ State: string }>(`$ErrorActionPreference = 'Stop'; $ids = @(Get-Process -ErrorAction Stop | Select-Object -ExpandProperty Id); if ($ids -contains ${pid}) { @{State='alive'} | ConvertTo-Json } else { @{State='exited'} | ConvertTo-Json }`, context);
        if (state?.State !== "alive" && state?.State !== "exited") throw new Error("Invalid process liveness result.");
        return { state: state.State };
      });
    } catch (error) { return { state: "unknown", reason: error instanceof Error ? error.message : "Liveness query failed." }; }
    finally { context.finish(false); }
  }

  async openInBrowser(url: string): Promise<BackendActionResult> {
    const shell = await this.getPowerShellShell();
    if (!shell) {
      return {
        success: false,
        message: "PowerShell was not found, so the browser could not be opened on Windows."
      };
    }

    const result = await this.run([shell, "-NoProfile", "-Command", `Start-Process "${escapePowerShellString(url)}"`], { timeoutMs: 0, inheritLocale: true });
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

  private async query<T>(command: string, context: CollectionContext): Promise<T> {
    const shell = await findCheckedCommand(["powershell", "pwsh"], context, this.run, "win32");
    const result = await this.run([shell, "-NoProfile", "-NonInteractive", "-Command", command], { signal: context.signal, timeoutMs: context.remainingMs });
    const output = requireCommand(result, "Windows", "PowerShell");
    try { return JSON.parse(output) as T; }
    catch { throw new DiscoveryError("invalid-output", "Windows", "PowerShell returned invalid JSON."); }
  }

  private async getPowerShellShell(): Promise<string | undefined> {
    const context = new CollectionContext("Windows");
    try { return await context.required(() => findCheckedCommand(["powershell", "pwsh"], context, this.run, "win32")); }
    catch { return undefined; }
    finally { context.finish(false); }
  }

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
