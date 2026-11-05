import { execa } from "execa";
import { DiscoveryError, type CollectionContext } from "./discovery.js";

export interface CommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  // Application launchers inherit locale; system queries keep normalized output.
  inheritLocale?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failure?: "missing" | "timeout" | "launch";
}

export type CommandRunner = (args: string[], options?: CommandOptions) => Promise<CommandResult>;

export const runCheckedCommand: CommandRunner = async (args, options = {}) => {
  try {
    const result = await execa(args[0]!, args.slice(1), {
      reject: false,
      cancelSignal: options.signal,
      timeout: options.timeoutMs ?? 15_000,
      forceKillAfterDelay: 100,
      env: options.inheritLocale ? undefined : { LC_ALL: "C" }
    });
    return {
      stdout: result.stdout.trimEnd(),
      stderr: result.stderr.trimEnd(),
      exitCode: result.exitCode ?? 1,
      failure: result.timedOut || result.isCanceled ? "timeout" : result.code === "ENOENT" ? "missing" : result.failed && result.exitCode === undefined ? "launch" : undefined
    };
  } catch (error) {
    const details = error as { code?: string; timedOut?: boolean; isCanceled?: boolean; message?: string };
    return { stdout: "", stderr: details.message ?? "Command could not be launched.", exitCode: 1,
      failure: details.timedOut || details.isCanceled || options.signal?.aborted ? "timeout" : details.code === "ENOENT" ? "missing" : "launch" };
  }
};

export function requireCommand(result: CommandResult, backend: string, command: string): string {
  if (result.failure || result.exitCode !== 0) {
    const code = result.failure === "missing" ? "missing-prerequisite" : result.failure === "timeout" ? "timeout" : "command-failure";
    throw new DiscoveryError(code, backend, result.failure === "missing"
      ? `${command} was not found. Install it and check PATH.`
      : `${command} ${result.failure === "timeout" ? "timed out" : "failed"}${result.stderr ? `: ${result.stderr}` : ". Check permissions and prerequisites."}`);
  }
  return result.stdout;
}

export async function findCheckedCommand(commands: string[], context: CollectionContext, run: CommandRunner = runCheckedCommand, platform = process.platform): Promise<string> {
  for (const command of commands) {
    context.check();
    const result = await run([platform === "win32" ? "where" : "which", command], { signal: context.signal, timeoutMs: context.remainingMs });
    if (!result.failure && result.exitCode === 0) return command;
    if (result.failure === "timeout") requireCommand(result, context.backend, command);
  }
  throw new DiscoveryError("missing-prerequisite", context.backend, `${commands.join(" or ")} was not found. Install it and check PATH.`);
}

export async function runCommand(args: string[]): Promise<string> {
  const { stdout } = await execa(args[0]!, args.slice(1), {
    reject: false,
    stderr: "ignore"
  });

  return stdout.trimEnd();
}

export async function runCommandOrUndefined(args: string[]): Promise<string | undefined> {
  try {
    const output = await runCommand(args);
    return output || undefined;
  } catch {
    return undefined;
  }
}

export async function runCommandWithExitCode(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa(args[0]!, args.slice(1), {
    reject: false,
    stderr: "ignore"
  });

  return {
    stdout: result.stdout.trimEnd(),
    exitCode: result.exitCode ?? 1
  };
}

export async function commandExists(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = await runCommandWithExitCode([checker, command]);
  return result.exitCode === 0;
}

export async function findAvailableCommand(commands: string[]): Promise<string | undefined> {
  for (const command of commands) {
    if (await commandExists(command)) {
      return command;
    }
  }

  return undefined;
}

export function splitCommandString(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
