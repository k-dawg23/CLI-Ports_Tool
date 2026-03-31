import chalk from "chalk";
import type { PortProcess } from "./types.js";

export const TABLE_HEADERS = ["PORT", "PROJECT", "FRAMEWORK", "PID", "MEM", "UPTIME", "COMMAND"] as const;
export const TABLE_WIDTHS = [6, 22, 12, 8, 10, 12, 20] as const;

export function renderTable(processes: PortProcess[]): string {
  if (processes.length === 0) {
    return chalk.yellow("No listening TCP ports found.");
  }

  const rows = processes.map((process) => {
    const isDimmed = shouldDimProcess(process);
    const dim = isDimmed ? chalk.dim : identity;

    return [
      dim(padEndVisible(String(process.port), TABLE_WIDTHS[0])),
      dim(padEndVisible(process.projectName, TABLE_WIDTHS[1])),
      isDimmed ? dim(process.framework) : colorFramework(process.framework),
      dim(padEndVisible(String(process.pid), TABLE_WIDTHS[3])),
      colorMemory(process.memoryKb),
      dim(padEndVisible(process.uptime ?? "-", TABLE_WIDTHS[5])),
      dim(padEndVisible(process.command, TABLE_WIDTHS[6]))
    ];
  });

  const headerLine = TABLE_HEADERS
    .map((header, index) => chalk.bold(padEndVisible(header, TABLE_WIDTHS[index]!)))
    .join("  ");

  const body = rows
    .map((row) => row.map((value, index) => padAnsiCell(value, TABLE_WIDTHS[index]!)).join("  "))
    .join("\n");

  return `${headerLine}\n${body}`;
}

export function renderPortDetails(process?: PortProcess): string {
  if (!process) {
    return chalk.green("That port is free.");
  }

  return [
    `${chalk.bold("Port")}: ${process.port}`,
    `${chalk.bold("Project")}: ${process.projectName}`,
    `${chalk.bold("Framework")}: ${process.framework}`,
    `${chalk.bold("PID")}: ${process.pid}`,
    `${chalk.bold("Memory")}: ${formatMemory(process.memoryKb)}`,
    `${chalk.bold("Uptime")}: ${process.uptime ?? "-"}`,
    `${chalk.bold("Command")}: ${process.command}`,
    `${chalk.bold("Working Dir")}: ${process.cwd ?? "-"}`
  ].join("\n");
}

export function formatMemory(memoryKb?: number): string {
  if (!memoryKb || Number.isNaN(memoryKb)) {
    return "-";
  }

  if (memoryKb >= 1024 * 1024) {
    return `${(memoryKb / (1024 * 1024)).toFixed(1)} GB`;
  }

  return `${(memoryKb / 1024).toFixed(1)} MB`;
}

export function colorMemory(memoryKb?: number): string {
  const formatted = formatMemory(memoryKb);
  if (!memoryKb || Number.isNaN(memoryKb)) {
    return formatted;
  }

  if (memoryKb >= 500 * 1024) {
    return chalk.red(formatted);
  }

  if (memoryKb >= 200 * 1024) {
    return chalk.hex("#ff8c00")(formatted);
  }

  return formatted;
}

export function colorFramework(framework: string): string {
  switch (framework) {
    case "Next.js":
      return chalk.cyan(framework);
    case "Astro":
      return chalk.magenta(framework);
    case "Vite":
      return chalk.yellow(framework);
    case "Remix":
      return chalk.blue(framework);
    case "Nuxt":
      return chalk.green(framework);
    case "SvelteKit":
      return chalk.red(framework);
    case "Angular":
      return chalk.hex("#dd0031")(framework);
    default:
      return framework;
  }
}

export function shouldDimProcess(process: PortProcess): boolean {
  return !isDevProcess(process);
}

export function isDevProcess(process: PortProcess): boolean {
  return process.framework !== "-" || isNodeLikeCommand(process.command);
}

export function isNodeLikeCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.includes("node") || normalized.includes("deno") || normalized.includes("bun");
}

function padAnsiCell(value: string, width: number): string {
  const visibleLength = stripAnsi(value).length;
  const gap = Math.max(0, width - visibleLength);
  return `${value}${" ".repeat(gap)}`;
}

export function padAnsiEndVisible(value: string, width: number): string {
  return padAnsiCell(value, width);
}

export function truncateVisible(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  return `${value.slice(0, width - 1)}…`;
}

export function padEndVisible(value: string, width: number): string {
  const truncated = truncateVisible(value, width);
  return `${truncated}${" ".repeat(Math.max(0, width - truncated.length))}`;
}

function identity(value: string): string {
  return value;
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001B\[[0-9;]*m/g, "");
}
