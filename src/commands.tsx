import React from "react";
import { render } from "ink";
import { Command, CommanderError } from "commander";
import chalk from "chalk";
import { renderPortDetails, renderTable } from "./format.js";
import { PortService } from "./ports.js";
import { PortsApp } from "./tui.js";
import { parsePid, parsePort, parseProjectQuery } from "./validation.js";
import { filterListRows } from "./list-filter.js";
import type { PortProcess } from "./types.js";

import { APP_VERSION } from "./version.js";

export interface CliOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  serviceFactory?: () => PortService;
  interactive?: boolean;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<number> {
  const out = options.stdout ?? (text => process.stdout.write(text));
  const err = options.stderr ?? (text => process.stderr.write(text));
  const serviceFactory = options.serviceFactory ?? (() => new PortService(undefined, undefined, undefined, warnings => {
    for (const warning of warnings) err(`Warning: ${warning}\n`);
  }));
  let exitCode = 0;
  const program = new Command().name("ports").description("Inspect and manage listening ports on your machine.").version(APP_VERSION)
    .configureOutput({ writeOut: out, writeErr: err }).exitOverride();
  program.command("list").description("Print a static table of all listening ports.")
    .option("--json", "Output listening ports as a JSON array.")
    .option("--addresses", "Include listener addresses (extends JSON entries when --json is used).")
    .option("--port <port>", "Filter to an exact TCP port.", uniqueOption(parsePort))
    .option("--pid <pid>", "Filter to an exact process ID.", uniqueOption(parsePid))
    .option("--project <text>", "Filter by a literal project name substring.", uniqueOption(parseProjectQuery))
    .action(async (args: { json?: boolean; addresses?: boolean; port?: number; pid?: number; project?: string }) => {
      const snapshot = await serviceFactory().snapshot();
      const rows = filterListRows(snapshot.processes, { port: args.port, pid: args.pid, project: args.project });
      const filtered = args.port !== undefined || args.pid !== undefined || args.project !== undefined;
      if (!args.json && filtered && rows.length === 0) out("No listening TCP ports match the supplied filters.\n");
      else out(`${args.json ? JSON.stringify(rows.map(row => toJsonEntry(row, args.addresses)), null, 2) : renderTable(rows, args.addresses)}\n`);
    });
  program.command("check").description("Show detailed info about what is on a port.")
    .argument("<port>", "TCP port to inspect (1–65535)", parsePort)
    .action(async (port: number) => {
      const snapshot = await serviceFactory().snapshot();
      out(`${renderPortDetails(snapshot.processes.find(row => row.port === port))}\n`);
    });
  program.command("kill").description("Stop the first discovered listener on a port.")
    .argument("<port>", "TCP port to stop (1–65535)", parsePort)
    .action(async (port: number) => {
      const result = await serviceFactory().killPort(port);
      if (result.success) out(`${chalk.green(result.message)}\n`);
      else { err(`${chalk.yellow(result.message)}\n`); exitCode = 1; }
    });
  try {
    if (argv.length <= 2) {
      if (options.interactive ?? (process.stdin.isTTY && typeof process.stdin.setRawMode === "function")) {
        // The TUI renders snapshot warnings itself; avoid interleaved stderr.
        await render(<PortsApp service={options.serviceFactory ? serviceFactory() : new PortService()} />).waitUntilExit();
      } else {
        err("Interactive mode requires a TTY. Falling back to a static port list.\n");
        const snapshot = await serviceFactory().snapshot();
        out(`${renderTable([...snapshot.processes])}\n`);
      }
    } else {
      await program.parseAsync(argv);
    }
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    err(`${chalk.red(error instanceof Error ? error.message : "Unexpected error.")}\n`);
    return 1;
  }
}

function toJsonEntry(row: PortProcess, addresses = false) {
  return { port: row.port, pid: row.pid, command: row.command, projectName: row.projectName, framework: row.framework, memoryKB: row.memoryKb ?? null, uptime: row.uptime ?? null, ...(addresses ? { addresses: row.addresses.map(item => ({ ...item })) } : {}) };
}

function uniqueOption<T>(parser: (value: string) => T): (value: string, previous?: T) => T {
  return (value, previous) => {
    if (previous !== undefined) throw new Error("Each list filter option may be specified only once.");
    return parser(value);
  };
}
