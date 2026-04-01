import { execa } from "execa";

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
