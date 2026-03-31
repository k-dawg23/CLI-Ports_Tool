import chalk from "chalk";
import type { PortProcess } from "./types.js";

export function renderTable(processes: PortProcess[]): string {
  if (processes.length === 0) {
    return chalk.yellow("No listening TCP ports found.");
  }

  const rows = processes.map((process) => [
    String(process.port),
    process.projectName,
    colorFramework(process.framework),
    String(process.pid),
    formatMemory(process.memoryKb),
    process.uptime ?? "-",
    process.command
  ]);

  const headers = ["PORT", "PROJECT", "FRAMEWORK", "PID", "MEM", "UPTIME", "COMMAND"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? "").length))
  );

  const headerLine = headers
    .map((header, index) => chalk.bold(pad(header, widths[index]!)))
    .join("  ");

  const body = rows
    .map((row) => row.map((value, index) => pad(value, widths[index]!)).join("  "))
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
      return chalk.gray(framework);
  }
}

function pad(value: string, width: number): string {
  const visibleLength = stripAnsi(value).length;
  const gap = Math.max(0, width - visibleLength);
  return `${value}${" ".repeat(gap)}`;
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001B\[[0-9;]*m/g, "");
}
