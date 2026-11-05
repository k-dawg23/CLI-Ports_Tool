import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePort } from "../src/validation.js";
import { CollectionContext, DiscoveryCoordinator, DiscoveryError } from "../src/discovery.js";
import { runCheckedCommand } from "../src/system.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("ports require complete ASCII decimal integers", () => {
  for (const [value, expected] of [["1", 1], ["3000", 3000], ["65535", 65535], ["003000", 3000]] as const) assert.equal(parsePort(value), expected);
  for (const value of ["0", "65536", "999999999999999999999", "3000abc", "3000.5", "3e3", "0xBB8", "+3000", "-1", "", " ", " 3000", "3000 ", "3000\n", "3000\r", "\t3000", "٣٠٠٠"]) assert.throws(() => parsePort(value), /1 to 65535/);
});

test("checked commands retain failures and stderr, and bound owned subprocesses", async () => {
  const failed = await runCheckedCommand([process.execPath, "-e", "console.error('diagnostic'); process.exitCode = 7"]);
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.stderr, "diagnostic");
  assert.equal((await runCheckedCommand(["ports-nonexistent-test-executable"])).failure, "missing");
  assert.equal((await runCheckedCommand([process.execPath, "-e", "setInterval(()=>{},1000)"], { timeoutMs: 30 })).failure, "timeout");
  const controller = new AbortController();
  controller.abort();
  assert.equal((await runCheckedCommand([process.execPath, "-e", "setInterval(()=>{},1000)"], { signal: controller.signal })).failure, "timeout");
});

test("missing executables remain distinct from existing commands returning nonzero", async () => {
  const missing = await runCheckedCommand(["ports-nonexistent-test-executable"]);
  assert.equal(missing.failure, "missing");
  assert.notEqual(missing.exitCode, 0);
  for (const status of [1, 7, 9009]) {
    const result = await runCheckedCommand([process.execPath, "-e", `console.error('existing command'); process.exitCode = ${status}`]);
    assert.equal(result.failure, undefined);
    assert.equal(result.exitCode, process.platform === "win32" ? status : status % 256);
    assert.equal(result.stderr, "existing command");
  }
});

test("Windows PATH/PATHEXT lookup and explicit paths preserve arguments and nonzero statuses", { skip: process.platform !== "win32" }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ports executable lookup "));
  const savedPath = process.env.PATH;
  const savedPathExt = process.env.PATHEXT;
  const previousDirectory = process.cwd();
  try {
    const probe = path.join(directory, "argument probe.cjs");
    await fs.writeFile(probe, "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 1;\n");
    for (const extension of ["CMD", "BAT"]) {
      await fs.writeFile(path.join(directory, `ports-test-${extension.toLowerCase()}.${extension}`), `@"${process.execPath}" "${probe}" %*\r\n`);
    }
    process.env.PATH = `"${directory}";${savedPath ?? ""}`;
    process.env.PATHEXT = ".CMD;.BAT;.EXE;.COM";
    const args = ["path with spaces", "ampersand&value", 'embedded"quote', "trailing\\"];
    for (const command of ["ports-test-cmd", "ports-test-bat", path.join(directory, "ports-test-cmd.CMD")]) {
      const result = await runCheckedCommand([command, ...args]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.failure, undefined);
      assert.deepEqual(JSON.parse(result.stdout), args);
    }
    // The working directory precedes PATH, and explicit relative paths work too.
    process.chdir(directory);
    process.env.PATH = savedPath;
    for (const command of ["ports-test-cmd", ".\\ports-test-cmd.CMD"]) {
      const result = await runCheckedCommand([command, ...args]);
      assert.equal(result.failure, undefined);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(JSON.parse(result.stdout), args);
    }
    assert.equal((await runCheckedCommand([path.join(directory, "absent executable.EXE")])).failure, "missing");
    // A resolved shell whose script fails is an ordinary command failure.
    const shellFailure = await runCheckedCommand([process.env.ComSpec || "cmd.exe", "/d", "/c", "ports-nonexistent-test-executable"]);
    assert.equal(shellFailure.failure, undefined);
    assert.notEqual(shellFailure.exitCode, 0);
  } finally {
    process.chdir(previousDirectory);
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedPathExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = savedPathExt;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("collection expires, returns optional fallback, and rejects late cache publication", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const context = new CollectionContext("test", 15);
  let complete!: () => void;
  let published = false;
  const pending = context.optional(async () => {
    await new Promise<void>(resolve => { complete = resolve; });
    context.stage(() => { published = true; });
  });
  await Promise.resolve();
  t.mock.timers.tick(15);
  assert.equal(await pending, undefined);
  context.finish();
  complete();
  await Promise.resolve();
  assert.equal(published, false);
  assert.match([...context.warnings].join(), /deadline/);
  const required = new CollectionContext("test", 15);
  const failure = assert.rejects(required.required(() => new Promise(() => {})), DiscoveryError);
  t.mock.timers.tick(15);
  await failure;
  required.finish(false);
});

test("discovery serializes collections, prioritizes fresh validation, and recovers after failure", async () => {
  const queue = new DiscoveryCoordinator();
  let release!: () => void;
  const order: string[] = [];
  const first = queue.collect(async () => { order.push("first"); await new Promise<void>(resolve => { release = resolve; }); });
  await Promise.resolve();
  const refresh = queue.collect(async () => { order.push("refresh"); });
  const action = queue.collect(async () => { order.push("action"); throw new Error("failed"); }, "action");
  const rejected = assert.rejects(action, /failed/);
  assert.deepEqual(order, ["first"]);
  release();
  await Promise.all([first, refresh, rejected]);
  assert.deepEqual(order, ["first", "action", "refresh"]);
});
