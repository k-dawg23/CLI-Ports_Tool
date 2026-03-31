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
