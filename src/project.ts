import fs from "node:fs/promises";
import path from "node:path";
import { detectFramework } from "./frameworks.js";
import type { PackageContext } from "./types.js";
import type { CollectionContext } from "./discovery.js";

interface PackageCacheEntry { context: PackageContext; acquiredAt: number }
const packageCache = new Map<string, PackageCacheEntry>();
const PACKAGE_TTL_MS = 30_000;
const PACKAGE_CACHE_LIMIT = 256;

export async function getPackageContext(cwd?: string, collection?: CollectionContext, now: () => number = Date.now): Promise<PackageContext> {
  const currentTime = now();
  const expiredKeys = [...packageCache].filter(([, entry]) => currentTime - entry.acquiredAt >= PACKAGE_TTL_MS).map(([key]) => key);
  if (expiredKeys.length) {
    const prune = () => { for (const key of expiredKeys) packageCache.delete(key); };
    if (collection) collection.stage(prune); else prune();
  }
  if (!cwd) {
    return {
      projectName: "-",
      framework: "-"
    };
  }

  const packageJsonPath = await findPackageJson(cwd);
  if (!packageJsonPath) {
    return {
      projectName: path.basename(cwd),
      framework: "-"
    };
  }

  const cached = packageCache.get(packageJsonPath);
  if (cached && currentTime - cached.acquiredAt < PACKAGE_TTL_MS) return cached.context;

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const context: PackageContext = {
      packageJsonPath,
      projectName: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : path.basename(path.dirname(packageJsonPath)),
      framework: detectFramework(parsed)
    };
    const entry = { context, acquiredAt: now() };
    const publish = () => {
      packageCache.set(packageJsonPath, entry);
      while (packageCache.size > PACKAGE_CACHE_LIMIT) {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        for (const [key, value] of packageCache) if (value.acquiredAt < oldestTime) { oldestKey = key; oldestTime = value.acquiredAt; }
        if (oldestKey === undefined) break;
        packageCache.delete(oldestKey);
      }
    };
    if (collection) collection.stage(publish);
    else publish();
    return context;
  } catch {
    return {
      packageJsonPath,
      projectName: path.basename(path.dirname(packageJsonPath)),
      framework: "-"
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
