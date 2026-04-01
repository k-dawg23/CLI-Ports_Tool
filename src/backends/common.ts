import path from "node:path";
import { commandExists, splitCommandString } from "../system.js";

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
