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

  const termResult = await runCommandWithExitCode(["kill", "-15", String(process.pid)]);
  if (termResult.exitCode !== 0) {
    return {
      success: false,
      message: `Failed to kill PID ${process.pid} on port ${port}.`
    };
  }

  await wait(1000);

  if (!(await isProcessAlive(process.pid))) {
    return {
      success: true,
      message: `Stopped PID ${process.pid} on port ${port} with SIGTERM.`
    };
  }

  const killResult = await runCommandWithExitCode(["kill", "-9", String(process.pid)]);
  if (killResult.exitCode !== 0) {
    return {
      success: false,
      message: `SIGTERM was sent to PID ${process.pid}, but SIGKILL failed and the process is still alive.`
    };
  }

  return {
    success: true,
    message: `Stopped stubborn PID ${process.pid} on port ${port} with SIGKILL after waiting 1s for SIGTERM.`
  };
}

export async function openPortInBrowser(port: number): Promise<{ success: boolean; message: string }> {
  const process = await getPortDetails(port);
  if (!process) {
    return {
      success: false,
      message: `Port ${port} is free.`
    };
  }

  const url = `http://localhost:${port}`;
  const command = getBrowserOpenCommand(url);
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

  const result = await runCommandWithExitCode(["code", process.cwd]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      message: "VS Code could not be launched. Make sure the `code` command is installed."
    };
  }

  return {
    success: true,
    message: `Opened ${process.cwd} in VS Code.`
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

async function isProcessAlive(pid: number): Promise<boolean> {
  const result = await runCommandWithExitCode(["kill", "-0", String(pid)]);
  return result.exitCode === 0;
}

function getBrowserOpenCommand(url: string): string[] {
  if (process.platform === "darwin") {
    return ["open", url];
  }

  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", url];
  }

  return ["xdg-open", url];
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
