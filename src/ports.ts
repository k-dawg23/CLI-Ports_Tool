import { getPlatformPortBackend } from "./backends/index.js";
import { getPackageContext } from "./project.js";
import type { PortProcess } from "./types.js";

interface ListenerRecord {
  command?: string;
  pid: number;
  port: number;
}

export async function getListeningPorts(): Promise<PortProcess[]> {
  const backend = getPlatformPortBackend();
  const records = await backend.getListeningPorts();
  const enriched = await Promise.all(records.map((record) => enrichRecord(record, backend)));

  return enriched
    .filter((record): record is PortProcess => record !== undefined)
    .sort((left, right) => left.port - right.port);
}

export async function getPortDetails(port: number): Promise<PortProcess | undefined> {
  const processes = await getListeningPorts();
  return processes.find((process) => process.port === port);
}

export async function killPortProcess(port: number): Promise<{ success: boolean; message: string }> {
  const process = await getPortDetails(port);
  if (!process) {
    return {
      success: false,
      message: `Port ${port} is free.`
    };
  }

  return getPlatformPortBackend().killProcess(process.pid, port);
}

export async function openPortInBrowser(port: number): Promise<{ success: boolean; message: string }> {
  const process = await getPortDetails(port);
  if (!process) {
    return {
      success: false,
      message: `Port ${port} is free.`
    };
  }

  return getPlatformPortBackend().openInBrowser(`http://localhost:${port}`);
}

export async function openProjectInEditor(port: number): Promise<{ success: boolean; message: string }> {
  const process = await getPortDetails(port);
  if (!process) {
    return {
      success: false,
      message: `Port ${port} is free.`
    };
  }

  if (!process.cwd) {
    return {
      success: false,
      message: `No working directory was detected for PID ${process.pid}.`
    };
  }

  return getPlatformPortBackend().openInEditor(process.cwd);
}

async function enrichRecord(record: ListenerRecord, backend = getPlatformPortBackend()): Promise<PortProcess | undefined> {
  const [cwd, stats] = await Promise.all([
    backend.getWorkingDirectory(record.pid),
    backend.getProcessStats(record.pid)
  ]);
  const packageContext = await getPackageContext(cwd);

  return {
    port: record.port,
    pid: record.pid,
    command: getDisplayCommand(stats?.command, stats?.args) ?? record.command ?? "-",
    cwd,
    memoryKb: stats?.memoryKb,
    uptime: stats?.uptime,
    projectName: packageContext.projectName,
    framework: packageContext.framework
  };
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
