import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { render } from "ink";
import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { PortsApp, sortProcesses } from "../src/tui.js";
import { RefreshController, selectedIndex } from "../src/tui-state.js";
import type { PortProcess, PortSnapshot } from "../src/types.js";
import { PortService } from "../src/ports.js";
import type { PlatformPortBackend } from "../src/backends/types.js";

const row = (pid: number, extra = {}): PortProcess => ({ pid, port: 3000 + pid, command: "node", projectName: `project-${pid}`, framework: "-", ...extra });
const snapshot = (rows = [row(11), row(22)]): PortSnapshot => ({ processes: rows, warnings: [], completedAt: 1000 });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("selection survives reordered/inserted rows and sort changes; absent targets clamp", () => {
  const selection = { target: { pid: 22, port: 3022 }, index: 1 };
  assert.equal(selectedIndex([row(22), row(11)], selection), 0);
  assert.equal(selectedIndex([row(1), row(11), row(22)], selection), 2);
  assert.equal(selectedIndex([row(11)], selection), 0);
  assert.equal(selectedIndex([], selection), -1);
  assert.equal(selectedIndex([row(11)], { index: -1 }), 0);
  const rows = [row(11, { memoryKb: 99, uptime: "01:00" }), row(22, { memoryKb: 200, uptime: "02:00" })];
  for (const sort of ["port", "memory", "uptime", "project"] as const) assert.equal(sortProcesses(rows, sort)[selectedIndex(sortProcesses(rows, sort), selection)]?.pid, 22);
});

test("refresh requests coalesce and dispose suppresses pending updates", async () => {
  let resolve!: (value: PortSnapshot) => void;
  let calls = 0;
  const events: string[] = [];
  const controller = new RefreshController(() => { calls++; return new Promise(r => { resolve = r; }); }, () => events.push("start"), () => events.push("success"), () => events.push("error"), () => events.push("end"));
  controller.request();
  for (let i = 0; i < 10; i++) controller.request();
  assert.equal(calls, 1);
  resolve(snapshot()); await flush();
  assert.equal(calls, 2);
  controller.dispose();
  const before = [...events];
  resolve(snapshot()); await flush();
  controller.request();
  assert.deepEqual(events, before);
  assert.equal(calls, 2);
});

function harness(service: Parameters<typeof PortsApp>[0]["service"]) {
  let frame = "";
  const stdout = new Writable({ write(chunk, _encoding, done) { const text = stripVTControlCharacters(chunk.toString()); if (text.includes("ports v")) frame = text; done(); } });
  Object.assign(stdout, { columns: 160, rows: 60, isTTY: false });
  const stdin = new PassThrough();
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const instance = render(React.createElement(PortsApp, { service }), { stdin: stdin as any, stdout: stdout as any, stderr: stdout as any, debug: true, patchConsole: false, exitOnCtrlC: false });
  return { frame: () => frame, key: (key: string) => stdin.write(key), close: () => { instance.unmount(); instance.cleanup(); stdin.end(); } };
}

async function settled() { await new Promise(resolve => setTimeout(resolve, 35)); }

test("rendered TUI retains stale data/errors through controls and recovers to genuine empty", async () => {
  let state = "success";
  const service = {
    snapshot: async () => { if (state === "failure") throw new Error("required query failed"); return snapshot(state === "empty" ? [] : undefined); },
    killTarget: async () => ({ success: false, message: "Stop could not be verified" }),
    openBrowser: async () => ({ success: true, message: "mock" }), openEditor: async () => ({ success: true, message: "mock" })
  };
  const app = harness(service);
  try {
    await settled();
    assert.match(app.frame(), /project-11/);
    app.key("K"); await settled();
    assert.match(app.frame(), /Stop could not be verified/);
    state = "failure"; app.key("r"); await settled();
    assert.match(app.frame(), /STALE.*Last successful refresh/);
    assert.match(app.frame(), /project-11/);
    for (const key of ["f", "s", "/", "x", "\u001b"]) { app.key(key); await settled(); assert.match(app.frame(), /required query failed/); }
    state = "empty"; app.key("r"); await settled();
    assert.doesNotMatch(app.frame(), /STALE|required query failed|project-11/);
    assert.match(app.frame(), /No ports match/);
    assert.match(app.frame(), /Stop could not be verified/);
  } finally { app.close(); }
});

test("rendered TUI initial failure is unavailable rather than empty", async () => {
  const app = harness({ snapshot: async () => { throw new Error("missing tool"); }, killTarget: async () => ({ success: false, message: "mock" }), openBrowser: async () => ({ success: false, message: "mock" }), openEditor: async () => ({ success: false, message: "mock" }) });
  try { await settled(); assert.match(app.frame(), /Discovery unavailable/); assert.doesNotMatch(app.frame(), /No ports match/); }
  finally { app.close(); }
});

test("rendered TUI captures selected targets, blocks duplicate actions, and ignores late action after unmount", async () => {
  let complete!: (value: { success: boolean; message: string }) => void;
  const targets: number[] = [];
  let rows = [row(11), row(22)];
  const app = harness({
    snapshot: async () => snapshot(rows),
    killTarget: async target => { targets.push(target.pid); return new Promise(resolve => { complete = resolve; }); },
    openBrowser: async () => ({ success: true, message: "mock" }), openEditor: async () => ({ success: true, message: "mock" })
  });
  try {
  await settled();
  app.key("\u001b[B"); await settled();
  rows = [row(1), row(11), row(22)]; app.key("r"); await settled();
  app.key("s"); await settled();
  app.key("K"); await settled(); app.key("K"); await settled();
  assert.deepEqual(targets, [22]);
  app.key("\u001b[A"); await settled();
  assert.deepEqual(targets, [22]);
  app.close();
  const before = app.frame();
  complete({ success: false, message: "must not render after unmount" }); await settled();
  assert.equal(app.frame(), before);
  } finally { app.close(); }
});

test("older action success or rejection cannot erase a newer action failure", async () => {
  for (const outcome of ["success", "rejection"]) {
    let complete!: (result: { success: boolean; message: string }) => void;
    let reject!: (error: Error) => void;
    const app = harness({
      snapshot: async () => snapshot(),
      openBrowser: () => new Promise((resolve, fail) => { complete = resolve; reject = fail; }),
      openEditor: async () => ({ success: true, message: "editor" }),
      killTarget: async () => ({ success: false, message: "NEWER_STOP_FAILED" })
    });
    try {
      await settled(); app.key("o"); await settled(); app.key("K"); await settled();
      assert.match(app.frame(), /NEWER_STOP_FAILED/);
      if (outcome === "success") complete({ success: true, message: "OLDER_BROWSER_SUCCESS" });
      else reject(new Error("OLDER_BROWSER_FAILURE"));
      await settled();
      assert.match(app.frame(), /NEWER_STOP_FAILED/);
      assert.doesNotMatch(app.frame(), /OLDER_BROWSER/);
    } finally { app.close(); }
  }
});

test("warnings from real target validation reach the TUI for browser, editor, and kill actions", async () => {
  for (const key of ["o", "e", "K", "browser-failure"]) {
    let calls = 0;
    let finishRefresh: (() => void) | undefined;
    const backend: PlatformPortBackend = {
      getListeningPorts: async context => {
        calls++;
        if (calls === 2) context.warn("VALIDATION_METADATA_UNAVAILABLE");
        if (calls === 3 && key === "K") await new Promise<void>(resolve => { finishRefresh = resolve; });
        return [{ pid: 11, port: 3011, command: "node" }];
      },
      getProcessStats: async () => undefined, getWorkingDirectory: async () => "/a project",
      isProcessAlive: async () => ({ state: "alive" }),
      killProcess: async (_pid, _port, validate) => ({ success: await validate(), message: "MOCK_ACTION_FINISHED" }),
      openInEditor: async () => ({ success: true, message: "MOCK_ACTION_FINISHED" }),
      openInBrowser: async () => {
        if (key === "browser-failure") throw new Error("MOCK_LAUNCH_FAILED");
        return { success: true, message: "MOCK_ACTION_FINISHED" };
      }
    };
    const service = new PortService(() => backend, 15_000, async () => ({ projectName: "review", framework: "-" }));
    const app = harness(service);
    try {
      await settled(); assert.doesNotMatch(app.frame(), /VALIDATION_METADATA_UNAVAILABLE/);
      app.key(key === "browser-failure" ? "o" : key); await settled();
      assert.match(app.frame(), /VALIDATION_METADATA_UNAVAILABLE/);
      assert.match(app.frame(), key === "browser-failure" ? /MOCK_LAUNCH_FAILED/ : /MOCK_ACTION_FINISHED/);
      if (key === "K") { finishRefresh?.(); await settled(); assert.doesNotMatch(app.frame(), /VALIDATION_METADATA_UNAVAILABLE/); }
    } finally { finishRefresh?.(); app.close(); }
  }
});
