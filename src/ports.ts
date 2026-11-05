import { getPlatformPortBackend } from "./backends/index.js";
import { getPackageContext } from "./project.js";
import type { ListenerTarget, PortProcess, PortSnapshot } from "./types.js";
import type { BackendActionResult, PlatformPortBackend } from "./backends/types.js";
import { CollectionContext, DiscoveryCoordinator } from "./discovery.js";

interface ListenerRecord {
  command?: string;
  pid: number;
  port: number;
}

interface StableProcessCacheEntry {
  command?: string;
  cwd?: string;
  framework: PortProcess["framework"];
  projectName: string;
}

type WarningHandler = (warnings: readonly string[]) => void;

export class PortService {
  private readonly stableProcessCache = new Map<number, StableProcessCacheEntry>();
  private readonly coordinator = new DiscoveryCoordinator();

  constructor(
    private readonly backendFactory: () => PlatformPortBackend = getPlatformPortBackend,
    private readonly timeoutMs = 15_000,
    private readonly packageContext = getPackageContext,
    private readonly onWarnings: (warnings: readonly string[]) => void = () => {}
  ) {}

  snapshot(priority: "refresh" | "action" = "refresh"): Promise<PortSnapshot> {
    return this.coordinator.collect(() => this.collect(), priority);
  }

  async validateTarget(target: ListenerTarget, onWarnings?: WarningHandler): Promise<PortProcess | undefined> {
    const snapshot = await this.snapshot("action");
    onWarnings?.(snapshot.warnings);
    return snapshot.processes.find(row => row.pid === target.pid && row.port === target.port);
  }

  async killPort(port: number): Promise<BackendActionResult> {
    const snapshot = await this.snapshot("action");
    const target = snapshot.processes.find(row => row.port === port);
    return target ? this.killTarget(target) : { success: false, message: `Port ${port} is free.` };
  }

  killTarget(target: ListenerTarget, onWarnings?: WarningHandler): Promise<BackendActionResult> {
    const captured = { pid: target.pid, port: target.port };
    return this.backendFactory().killProcess(captured.pid, captured.port, async () => Boolean(await this.validateTarget(captured, onWarnings)));
  }

  async openBrowser(target: ListenerTarget, onWarnings?: WarningHandler): Promise<BackendActionResult> {
    const captured = { pid: target.pid, port: target.port };
    if (!(await this.validateTarget(captured, onWarnings))) return this.unavailable(captured);
    return this.backendFactory().openInBrowser(`http://localhost:${captured.port}`);
  }

  async openEditor(target: ListenerTarget, onWarnings?: WarningHandler): Promise<BackendActionResult> {
    const captured = { pid: target.pid, port: target.port };
    const row = await this.validateTarget(captured, onWarnings);
    if (!row) return this.unavailable(captured);
    if (!row.cwd) return { success: false, message: `No working directory was detected for PID ${captured.pid}.` };
    return this.backendFactory().openInEditor(row.cwd);
  }

  private unavailable(target: ListenerTarget): BackendActionResult {
    return { success: false, message: `Selected listener PID ${target.pid} on port ${target.port} is no longer available.` };
  }

  private async collect(): Promise<PortSnapshot> {
    const context = new CollectionContext(process.platform, this.timeoutMs);
    try {
      const backend = this.backendFactory();
      const records = await context.required(() => backend.getListeningPorts(context));
      context.check();
      if (backend.prepareProcesses) await context.optional(() => backend.prepareProcesses!(records, context));
      const enriched = await Promise.all(records.map(async record => {
        const completed = await context.optional(() => this.enrichRecord(record, backend, context));
        return Object.freeze(completed ?? this.fallback(record));
      }));
      const activePids = new Set(records.map(record => record.pid));
      // This synchronous publication cannot race with later optional completions.
      for (const pid of this.stableProcessCache.keys()) if (!activePids.has(pid)) this.stableProcessCache.delete(pid);
      const snapshot = Object.freeze({ processes: Object.freeze(enriched.sort((a, b) => a.port - b.port)), warnings: Object.freeze([...context.warnings]), completedAt: Date.now() });
      context.finish();
      this.onWarnings(snapshot.warnings);
      return snapshot;
    } catch (error) {
      context.finish(false);
      throw error;
    }
  }

  private fallback(record: ListenerRecord): PortProcess {
    const stable = this.stableProcessCache.get(record.pid);
    return { ...record, command: stable?.command ?? record.command ?? "-", cwd: stable?.cwd, projectName: stable?.projectName ?? "-", framework: stable?.framework ?? "-" };
  }

  private async enrichRecord(record: ListenerRecord, backend: PlatformPortBackend, context: CollectionContext): Promise<PortProcess> {
    let stable = this.stableProcessCache.get(record.pid);
    const stats = await backend.getProcessStats(record.pid, context);
    context.check();
    if (!stable) {
      const cwd = await backend.getWorkingDirectory(record.pid, context);
      context.check();
      const packageContext = await this.packageContext(cwd, context);
      context.check();
      stable = { command: record.command, cwd, framework: packageContext.framework, projectName: packageContext.projectName };
      const entry = stable;
      context.stage(() => this.stableProcessCache.set(record.pid, entry));
    }
    return { port: record.port, pid: record.pid, command: getDisplayCommand(stats?.command, stats?.args) ?? stable.command ?? record.command ?? "-", cwd: stable.cwd, memoryKb: stats?.memoryKb, uptime: stats?.uptime, projectName: stable.projectName, framework: stable.framework };
  }
}

export const portService = new PortService();
export const getPortSnapshot = () => portService.snapshot();
export async function getListeningPorts(): Promise<PortProcess[]> {
  return [...(await portService.snapshot()).processes];
}

export async function getPortDetails(port: number): Promise<PortProcess | undefined> {
  const processes = await getListeningPorts();
  return processes.find((process) => process.port === port);
}

export async function killPortProcess(port: number): Promise<{ success: boolean; message: string }> {
  return portService.killPort(port);
}

export async function openPortInBrowser(target: ListenerTarget): Promise<BackendActionResult> {
  return portService.openBrowser(target);
}

export async function openProjectInEditor(target: ListenerTarget): Promise<BackendActionResult> {
  return portService.openEditor(target);
}

function getDisplayCommand(command?: string, args?: string): string | undefined {
  const normalizedCommand = command?.trim();
  if (!normalizedCommand) {
    return undefined;
  }

  if (normalizedCommand !== "MainThread") {
    return normalizedCommand;
  }

  const fallback = getMainThreadFallback(args);
  return fallback ?? normalizedCommand;
}

function getMainThreadFallback(args?: string): string | undefined {
  if (!args) {
    return undefined;
  }

  const tokens = args
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  for (const token of tokens) {
    const candidate = token.split(/[\\/]/).pop() ?? token;
    if (!candidate || candidate === "MainThread") {
      continue;
    }

    if (looksUseful(candidate)) {
      return candidate;
    }
  }

  const firstToken = tokens[0];
  if (!firstToken) {
    return undefined;
  }

  return firstToken.split(/[\\/]/).pop() ?? firstToken;
}

function looksUseful(token: string): boolean {
  if (token.startsWith("-")) {
    return false;
  }

  if (token.includes("=")) {
    return false;
  }

  return true;
}
