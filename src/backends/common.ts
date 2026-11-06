import path from "node:path";
import { commandExists, splitCommandString } from "../system.js";
import type { BackendActionResult, ProcessLiveness, ValidateTarget } from "./types.js";

export async function stopValidatedProcess(
  pid: number,
  port: number,
  validate: ValidateTarget,
  send: (force: boolean) => Promise<void>,
  probe: () => Promise<ProcessLiveness>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<BackendActionResult> {
  const fail = (message: string): BackendActionResult => ({ success: false, message });
  // PID 0 and negative values have process-group semantics on Unix.
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail(`PID ${pid} cannot be stopped by ports.`);
  try {
    if (!(await validate())) return fail(`Selected listener PID ${pid} on port ${port} is no longer available.`);
    await send(false);
    await wait(1000);
    const initial = await probe();
    if (initial.state === "exited") return { success: true, message: `Stopped PID ${pid} on port ${port}.` };
    if (initial.state === "unknown") return fail(`Stop could not be verified for PID ${pid}: ${initial.reason}`);
    if (!(await validate())) return fail(`Listener released; process still running (PID ${pid}, port ${port}).`);
    await send(true);
    const final = await probe();
    if (final.state !== "exited") return fail(`Forced stop requested for PID ${pid}; process exit not confirmed${final.state === "unknown" ? `: ${final.reason}` : "."}`);
    return { success: true, message: `Stopped PID ${pid} on port ${port} with forced termination after waiting 1s.` };
  } catch (error) {
    return fail(`Stop failed or could not be verified for PID ${pid} on port ${port}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

const DEFAULT_EDITOR_COMMANDS = ["code"];

export async function resolveEditorCommand(): Promise<string[] | undefined> {
  const envCandidate = process.env.PORTS_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
  if (envCandidate?.trim()) {
    const parts = splitCommandString(envCandidate);
    if (parts.length > 0) {
      return parts;
    }
  }

  for (const candidate of DEFAULT_EDITOR_COMMANDS) {
    if (await commandExists(candidate)) {
      return [candidate];
    }
  }

  return undefined;
}

export function buildEditorErrorMessage(editorCommand?: string[]): string {
  if (editorCommand && editorCommand.length > 0) {
    return `Could not launch the preferred editor (${editorCommand.join(" ")}). Set PORTS_EDITOR to a working command or install code.`;
  }

  return "No supported editor command was found. Install code or set PORTS_EDITOR to your preferred editor.";
}

export function derivePathFromCommandLine(args?: string): string | undefined {
  if (!args) {
    return undefined;
  }

  const tokens = splitCommandString(args);
  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    if (looksLikePath(token)) {
      return path.resolve(token);
    }
  }

  return undefined;
}

function looksLikePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /\.(js|cjs|mjs|ts|tsx|jsx|exe|cmd|bat)$/i.test(value)
  );
}
