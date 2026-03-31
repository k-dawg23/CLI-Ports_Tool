#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { renderPortDetails, renderTable } from "./format.js";
import { getListeningPorts, getPortDetails, killPortProcess } from "./ports.js";
import { PortsApp } from "./tui.js";
import type { PortProcess } from "./types.js";

const program = new Command();
const APP_VERSION = "1.0.6";

program
  .name("ports")
  .description("Inspect and manage listening ports on your machine.")
  .version(APP_VERSION);

program
  .command("list")
  .description("Print a static table of all listening ports.")
  .option("--json", "Output listening ports as a JSON array.")
  .action(async (options: { json?: boolean }) => {
    const processes = await getListeningPorts();
    if (options.json) {
      console.log(JSON.stringify(processes.map(toJsonEntry), null, 2));
      return;
    }

    console.log(renderTable(processes));
  });

program
  .command("check")
  .description("Show detailed info about what is on a port.")
  .argument("<port>", "TCP port to inspect", parsePort)
  .action(async (port: number) => {
    const process = await getPortDetails(port);
    console.log(renderPortDetails(process));
  });

program
  .command("kill")
  .description("Kill whatever is listening on a port.")
  .argument("<port>", "TCP port to kill", parsePort)
  .action(async (port: number) => {
    const result = await killPortProcess(port);
    if (result.success) {
      console.log(chalk.green(result.message));
      return;
    }

    console.log(chalk.yellow(result.message));
    process.exitCode = 1;
  });

void main();

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function toJsonEntry(process: PortProcess) {
  return {
    port: process.port,
    pid: process.pid,
    command: process.command,
    projectName: process.projectName,
    framework: process.framework,
    memoryKB: process.memoryKb ?? null,
    uptime: process.uptime ?? null
  };
}

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      render(<PortsApp />);
      return;
    }

    console.log(chalk.yellow("Interactive mode requires a TTY. Falling back to a static port list.\n"));
    const processes = await getListeningPorts();
    console.log(renderTable(processes));
    return;
  }

  await program.parseAsync(process.argv).catch((error: unknown) => {
    console.error(chalk.red(error instanceof Error ? error.message : "Unexpected error."));
    process.exit(1);
  });
}
