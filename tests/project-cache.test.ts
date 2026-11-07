import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPackageContext } from "../src/project.js";
import { PortService } from "../src/ports.js";
import { CollectionContext } from "../src/discovery.js";
import type { PlatformPortBackend } from "../src/backends/types.js";

test("package context refreshes at TTL, rediscovers nearer packages and recovers from malformed files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ports-package-cache-"));
  try {
    const app = path.join(root, "app");
    await mkdir(app);
    const rootPackage = path.join(root, "package.json");
    await writeFile(rootPackage, JSON.stringify({ name: "root-old" }));
    let now = 100;
    assert.equal((await getPackageContext(app, undefined, () => now)).projectName, "root-old");
    await writeFile(rootPackage, JSON.stringify({ name: "root-new", dependencies: { vite: "1" } }));
    assert.equal((await getPackageContext(app, undefined, () => now + 29_999)).projectName, "root-old");
    now += 30_000;
    assert.deepEqual(await getPackageContext(app, undefined, () => now), { packageJsonPath: rootPackage, projectName: "root-new", framework: "Vite" });
    await mkdir(path.join(app, "nested"));
    const nearer = path.join(app, "package.json");
    await writeFile(nearer, JSON.stringify({ name: "near" }));
    now += 30_000;
    assert.equal((await getPackageContext(path.join(app, "nested"), undefined, () => now)).projectName, "near");
    await rm(nearer);
    now += 30_000;
    assert.equal((await getPackageContext(app, undefined, () => now)).projectName, "root-new");
    await writeFile(rootPackage, "{");
    now += 30_000;
    assert.equal((await getPackageContext(app, undefined, () => now)).projectName, path.basename(root));
    await writeFile(rootPackage, JSON.stringify({ name: "repaired" }));
    assert.equal((await getPackageContext(app, undefined, () => now)).projectName, "repaired");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("package cache stays bounded and evicts the oldest acquired entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ports-package-bound-"));
  try {
    const dirs = await Promise.all(Array.from({ length: 257 }, async (_, index) => {
      const dir = path.join(root, `p${index}`);
      await mkdir(dir);
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: `before-${index}` }));
      return dir;
    }));
    let now = 0;
    for (let index = 0; index < dirs.length; index++) await getPackageContext(dirs[index], undefined, () => now++);
    await writeFile(path.join(dirs[0]!, "package.json"), JSON.stringify({ name: "after-eviction" }));
    assert.equal((await getPackageContext(dirs[0], undefined, () => now++)).projectName, "after-eviction");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aborted collection does not publish newly read package metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ports-package-cancel-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "staged-only" }));
    const context = new CollectionContext("test");
    assert.equal((await getPackageContext(root, context, () => 0)).projectName, "staged-only");
    context.finish(false);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "published-next-time" }));
    assert.equal((await getPackageContext(root, undefined, () => 0)).projectName, "published-next-time");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stable PID snapshot observes real package edits at expiry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ports-service-package-"));
  try {
    const file = path.join(root, "package.json");
    await writeFile(file, JSON.stringify({ name: "before" }));
    let now = 1_000_000;
    const backend: PlatformPortBackend = {
      getListeningPorts: async () => [{ pid: 9, port: 3000, addresses: [{ address: "127.0.0.1", family: "IPv4" }] }],
      getWorkingDirectory: async () => root, getProcessStats: async () => undefined,
      killProcess: async () => ({ success: true, message: "ok" }), isProcessAlive: async () => ({ state: "alive" }),
      openInBrowser: async () => ({ success: true, message: "ok" }), openInEditor: async () => ({ success: true, message: "ok" })
    };
    const service = new PortService(() => backend, 15_000, getPackageContext, () => {}, () => now);
    assert.equal((await service.snapshot()).processes[0]?.projectName, "before");
    await writeFile(file, JSON.stringify({ name: "after", dependencies: { vite: "1" } }));
    now = 1_029_999; assert.equal((await service.snapshot()).processes[0]?.projectName, "before");
    now = 1_030_000; const row = (await service.snapshot()).processes[0];
    assert.equal(row?.projectName, "after"); assert.equal(row?.framework, "Vite");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PortService refreshes cwd after TTL, resolves project context every collection, and freezes bindings", async () => {
  let now = 0, cwdCalls = 0, projectCalls = 0;
  const backend: PlatformPortBackend = {
    getListeningPorts: async () => [
      { pid: 9, port: 3000, addresses: [{ address: "::1", family: "IPv6" as const }] },
      { pid: 9, port: 3001, addresses: [{ address: "127.0.0.1", family: "IPv4" as const }] }
    ],
    getWorkingDirectory: async () => { cwdCalls++; return `/project-${cwdCalls}`; },
    getProcessStats: async () => undefined, killProcess: async () => ({ success: true, message: "ok" }),
    isProcessAlive: async () => ({ state: "alive" }), openInBrowser: async () => ({ success: true, message: "ok" }), openInEditor: async () => ({ success: true, message: "ok" })
  };
  const service = new PortService(() => backend, 15_000, async cwd => {
    projectCalls++;
    return { projectName: `${cwd}-project-${projectCalls}`, framework: "-" };
  }, () => {}, () => now);
  const first = await service.snapshot();
  assert.equal(cwdCalls, 1); assert.equal(projectCalls, 1);
  assert.equal(first.processes[0]?.projectName, "/project-1-project-1");
  assert.equal(Object.isFrozen(first.processes[0]?.addresses), true);
  assert.equal(Object.isFrozen(first.processes[0]?.addresses[0]), true);
  now = 29_999;
  await service.snapshot();
  assert.equal(cwdCalls, 1); assert.equal(projectCalls, 2);
  now = 30_000;
  await service.snapshot();
  assert.equal(cwdCalls, 2); assert.equal(projectCalls, 3);
});

test("expired service metadata is unavailable on enrichment failure while listener bindings survive", async () => {
  let now = 0, fail = false;
  const backend: PlatformPortBackend = {
    getListeningPorts: async () => [{ pid: 9, port: 3000, addresses: [{ address: "::1", family: "IPv6" }] }],
    getWorkingDirectory: async () => { if (fail) throw new Error("cwd refresh failed"); return "/fresh"; },
    getProcessStats: async () => undefined, killProcess: async () => ({ success: true, message: "ok" }),
    isProcessAlive: async () => ({ state: "alive" }), openInBrowser: async () => ({ success: true, message: "ok" }), openInEditor: async () => ({ success: true, message: "ok" })
  };
  const service = new PortService(() => backend, 15_000, async cwd => ({ projectName: cwd ?? "-", framework: "-" }), () => {}, () => now);
  await service.snapshot();
  now = 30_000; fail = true;
  const snapshot = await service.snapshot();
  assert.equal(snapshot.processes[0]?.cwd, undefined);
  assert.equal(snapshot.processes[0]?.projectName, "-");
  assert.deepEqual(snapshot.processes[0]?.addresses, [{ address: "::1", family: "IPv6" }]);
  assert.match(snapshot.warnings.join(), /cwd refresh failed/);
});
