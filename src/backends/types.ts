import type { CollectionContext } from "../discovery.js";

export interface RawListener {
  port: number;
  pid: number;
  addresses: readonly ListenerAddress[];
  command?: string;
}

export interface ListenerAddress {
  readonly address: string;
  readonly family: "IPv4" | "IPv6";
}

export interface ProcessStats {
  command?: string;
  args?: string;
  memoryKb?: number;
  uptime?: string;
}

export interface BackendActionResult {
  success: boolean;
  message: string;
}

export type ProcessLiveness = { state: "alive" | "exited" } | { state: "unknown"; reason: string };
export type ValidateTarget = () => Promise<boolean>;

export interface PlatformPortBackend {
  getListeningPorts(context: CollectionContext): Promise<RawListener[]>;
  prepareProcesses?(records: RawListener[], context: CollectionContext): Promise<void>;
  invalidatedProcessIds?(context: CollectionContext): ReadonlySet<number>;
  getWorkingDirectory(pid: number, context: CollectionContext): Promise<string | undefined>;
  getProcessStats(pid: number, context: CollectionContext): Promise<ProcessStats | undefined>;
  killProcess(pid: number, port: number, validate: ValidateTarget): Promise<BackendActionResult>;
  isProcessAlive(pid: number): Promise<ProcessLiveness>;
  openInBrowser(url: string): Promise<BackendActionResult>;
  openInEditor(path: string): Promise<BackendActionResult>;
}
