import { getPlatformPortBackend } from "./backends/index.js";
import { getPackageContext } from "./project.js";
import type { ListenerTarget, PortProcess, PortSnapshot } from "./types.js";
import type { BackendActionResult, PlatformPortBackend } from "./backends/types.js";
import { CollectionContext, DiscoveryCoordinator } from "./discovery.js";

interface ListenerRecord {
  command?: string;
  pid: number;
  port: number;
  addresses: PortProcess["addresses"];
}

interface StableProcessCacheEntry {
  cwd?: string;
  acquiredAt: number;
}

const METADATA_TTL_MS = 30_000;

type WarningHandler = (warnings: readonly string[]) => void;

export class PortService {
  private readonly stableProcessCache = new Map<number, StableProcessCacheEntry>();
  private readonly coordinator = new DiscoveryCoordinator();

  constructor(
    private readonly backendFactory: () => PlatformPortBackend = getPlatformPortBackend,
    private readonly timeoutMs = 15_000,
    private readonly packageContext = getPackageContext,
    private readonly onWarnings: (warnings: readonly string[]) => void = () => {},
    private readonly now: () => number = Date.now
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
      // Register before optional work: a later enrichment deadline must not
      // prevent successful identity invalidations from being published.
      context.stage(() => {
        for (const pid of backend.invalidatedProcessIds?.(context) ?? []) this.stableProcessCache.delete(pid);
      });
      if (backend.prepareProcesses) await context.optional(() => backend.prepareProcesses!(records, context));
      const invalidated = backend.invalidatedProcessIds?.(context) ?? new Set<number>();
      const metadataByPid = new Map<number, Promise<{ stable: StableProcessCacheEntry; projectName: string; framework: PortProcess["framework"] }>>();
      const enriched = await Promise.all(records.map(async record => {
        const completed = await context.optional(() => this.enrichRecord(record, backend, context, metadataByPid, invalidated));
        return Object.freeze(completed ?? this.fallback(record, invalidated));
      }));
      const activePids = new Set(records.map(record => record.pid));
      // This synchronous publication cannot race with later optional completions.
      for (const pid of this.stableProcessCache.keys()) if (!activePids.has(pid)) this.stableProcessCache.delete(pid);
      const snapshot = Object.freeze({ processes: Object.freeze(enriched.sort((a, b) => a.port - b.port)), warnings: Object.freeze([...context.warnings]), completedAt: this.now() });
      context.finish();
      this.onWarnings(snapshot.warnings);
      return snapshot;
    } catch (error) {
      context.finish(false);
      throw error;
    }
  }

  private fallback(record: ListenerRecord, invalidated: ReadonlySet<number>): PortProcess {
    const stable = this.stableProcessCache.get(record.pid);
    const usable = stable && !invalidated.has(record.pid) && this.now() - stable.acquiredAt < METADATA_TTL_MS ? stable : undefined;
    return { ...record, addresses: freezeAddresses(record.addresses), command: record.command ?? "-", cwd: usable?.cwd, projectName: "-", framework: "-" };
  }

  private async enrichRecord(record: ListenerRecord, backend: PlatformPortBackend, context: CollectionContext, metadataByPid: Map<number, Promise<{ stable: StableProcessCacheEntry; projectName: string; framework: PortProcess["framework"] }>>, invalidated: ReadonlySet<number>): Promise<PortProcess> {
    const stats = await backend.getProcessStats(record.pid, context);
    context.check();
    let metadata = metadataByPid.get(record.pid);
    if (!metadata) {
      metadata = (async () => {
        let stable = invalidated.has(record.pid) ? undefined : this.stableProcessCache.get(record.pid);
        if (!stable || this.now() - stable.acquiredAt >= METADATA_TTL_MS) {
          const cwd = await backend.getWorkingDirectory(record.pid, context);
          context.check();
          stable = { cwd, acquiredAt: this.now() };
          if (cwd !== undefined) {
            const entry = stable;
            context.stage(() => this.stableProcessCache.set(record.pid, entry));
          }
        }
        const packageContext = await this.packageContext(stable.cwd, context, this.now);
        context.check();
        return { stable, projectName: packageContext.projectName, framework: packageContext.framework };
      })();
      metadataByPid.set(record.pid, metadata);
    }
    const { stable, projectName, framework } = await metadata;
    context.check();
    return { port: record.port, pid: record.pid, addresses: freezeAddresses(record.addresses), command: getDisplayCommand(stats?.command, stats?.args) ?? record.command ?? "-", cwd: stable.cwd, memoryKb: stats?.memoryKb, uptime: stats?.uptime, projectName, framework };
  }
}

function freezeAddresses(addresses: PortProcess["addresses"]): PortProcess["addresses"] {
  return Object.freeze(addresses.map(address => Object.freeze({ ...address })));
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
