import { UnixPortBackend } from "./unix.js";
import { WindowsPortBackend } from "./windows.js";
import type { PlatformPortBackend } from "./types.js";

let cachedBackend: PlatformPortBackend | undefined;

export function getPlatformPortBackend(): PlatformPortBackend {
  if (cachedBackend) {
    return cachedBackend;
  }

  cachedBackend = process.platform === "win32" ? new WindowsPortBackend() : new UnixPortBackend();
  return cachedBackend;
}
