import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePort } from "../src/validation.js";
import { CollectionContext, DiscoveryCoordinator, DiscoveryError } from "../src/discovery.js";
import { runCheckedCommand } from "../src/system.js";

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
