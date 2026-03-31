import fs from "node:fs/promises";
import path from "node:path";
import { detectFramework } from "./frameworks.js";
import type { PackageContext } from "./types.js";

const packageCache = new Map<string, PackageContext>();

export async function getPackageContext(cwd?: string): Promise<PackageContext> {
  if (!cwd) {
    return {
      projectName: "-",
      framework: "Unknown"
    };
  }

  const packageJsonPath = await findPackageJson(cwd);
  if (!packageJsonPath) {
    return {
      projectName: path.basename(cwd),
      framework: "Unknown"
    };
  }

  const cached = packageCache.get(packageJsonPath);
  if (cached) {
    return cached;
  }

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const context: PackageContext = {
      packageJsonPath,
      projectName: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : path.basename(path.dirname(packageJsonPath)),
      framework: detectFramework(parsed)
    };
    packageCache.set(packageJsonPath, context);
    return context;
  } catch {
    return {
      packageJsonPath,
      projectName: path.basename(path.dirname(packageJsonPath)),
      framework: "Unknown"
    };
  }
}

async function findPackageJson(startDir: string): Promise<string | undefined> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, "package.json");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        return undefined;
      }
      currentDir = parent;
    }
  }
}
