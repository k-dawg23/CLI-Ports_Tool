import test from "node:test";
import assert from "node:assert/strict";
import { waitForRawModeReady } from "../scripts/terminal-readiness.mjs";

test("raw readiness waits through header and delayed observer publication", async () => {
  const observed: Array<{ type: string; actual?: boolean }> = [];
  let polls = 0;
  let inputStarted = false;
  const wait = async (_label: string, predicate: () => Promise<boolean>) => {
    while (!(await predicate())) { assert.equal(inputStarted, false); await Promise.resolve(); }
  };
  await waitForRawModeReady(wait, async () => {
    polls++;
    if (polls === 3) observed.push({ type: "raw", actual: true });
  }, observed);
  inputStarted = true;
  assert.equal(polls, 3);
  assert.equal(inputStarted, true);
});

test("raw readiness returns immediately when already observed and propagates bounded wait failure", async () => {
  const ready = [{ type: "raw", actual: true }];
  let polls = 0;
  await waitForRawModeReady(async (_label, predicate) => { polls++; assert.equal(await predicate(), true); }, async () => {}, ready);
  assert.equal(polls, 1);
  let fakeTime = 0, cleaned = false, inputStarted = false;
  await assert.rejects(async () => {
    try {
      await waitForRawModeReady(async (label, predicate) => {
        while (!(await predicate())) {
          assert.equal(inputStarted, false);
          fakeTime += 50;
          if (fakeTime >= 30_000) throw new Error(`Timed out: ${label}`);
        }
      }, async () => {}, []);
      inputStarted = true;
    } finally { cleaned = true; }
  }, /Timed out: raw-mode readiness/);
  assert.equal(fakeTime, 30_000); assert.equal(cleaned, true); assert.equal(inputStarted, false);
});
