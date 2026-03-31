import path from "node:path";
import { getPackageContext } from "./project.js";
import { runCommand, runCommandOrUndefined, runCommandWithExitCode } from "./system.js";
import type { PortProcess } from "./types.js";

interface LsofRecord {
  command: string;
  pid: number;
  port: number;
}

export async function getListeningPorts(): Promise<PortProcess[]> {
  const records = await getListeningRecords();
  const enriched = await Promise.all(records.map(enrichRecord));

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

  const result = await runCommandWithExitCode(["kill", "-15", String(process.pid)]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      message: `Failed to kill PID ${process.pid} on port ${port}.`
    };
  }

  return {
    success: true,
    message: `Sent SIGTERM to PID ${process.pid} on port ${port}.`
  };
}

async function getListeningRecords(): Promise<LsofRecord[]> {
  const output = await runCommand(["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const records = new Map<string, LsofRecord>();

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

async function enrichRecord(record: LsofRecord): Promise<PortProcess | undefined> {
  const [cwd, stats] = await Promise.all([
    getWorkingDirectory(record.pid),
    getProcessStats(record.pid)
  ]);
  const packageContext = await getPackageContext(cwd);

  return {
    port: record.port,
    pid: record.pid,
    command: record.command,
    cwd,
    memoryKb: stats?.memoryKb,
    uptime: stats?.uptime,
    projectName: packageContext.projectName,
    framework: packageContext.framework
  };
}

async function getWorkingDirectory(pid: number): Promise<string | undefined> {
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

async function getProcessStats(pid: number): Promise<{ memoryKb?: number; uptime?: string } | undefined> {
  const output = await runCommandOrUndefined(["ps", "-o", "rss=,etime=", "-p", String(pid)]);
  if (!output) {
    return undefined;
  }

  const trimmed = output.trim();
  const match = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return undefined;
  }

  return {
    memoryKb: Number(match[1]),
    uptime: match[2].trim()
  };
}
