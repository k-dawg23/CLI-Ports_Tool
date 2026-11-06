import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createOwnedStopGuard, createOwnedSignalRunner } from "../scripts/native-ownership.mjs";
import { PortService } from "../src/ports.js";
import { UnixPortBackend } from "../src/backends/unix.js";
import { WindowsPortBackend } from "../src/backends/windows.js";
import { CollectionContext } from "../src/discovery.js";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 11 as number | undefined, connected: true, exitCode: null as number | null, signalCode: null as string | null,
    send(message: unknown, callback: (error?: Error) => void) { sent.push(message); callback(); },
    disconnect() { child.connected = false; child.emit("disconnect"); },
    kill() { throw new Error("Numeric-PID signaling must never be used by the harness"); }
  });
  const sent: unknown[] = [];
  const owner = createOwnedStopGuard(child, "private-token");
  const ready = () => owner.acceptReady({ type: "ports-native-ready", token: "private-token", pid: 11 });
  return { child, owner, ready, sent };
}

test("native guard accepts only the authenticated spawn-owned channel and captures its identity", async () => {
  const f = fixture(); f.ready();
  await f.owner.requestStop(11, "SIGTERM");
  await f.owner.requestStop(11, "SIGKILL");
  assert.deepEqual(f.sent, [
    { type: "ports-native-stop", token: "private-token", pid: 11, signal: "SIGTERM" },
    { type: "ports-native-stop", token: "private-token", pid: 11, signal: "SIGKILL" }
  ]);
  f.owner.close();
  await assert.rejects(f.owner.requestStop(11, "SIGTERM"), /Refusing/);
});

test("unknown, mismatched, disconnected, exited, or reused identity never receives a stop request", async () => {
  for (const scenario of ["not-ready", "wrong-token", "wrong-ready-pid", "missing-pid", "changed-pid", "wrong-target", "disconnected", "exited", "signaled", "reused-pid", "unknown-signal"]) {
    const f = fixture();
    if (scenario === "wrong-token" || scenario === "wrong-ready-pid") {
      assert.throws(() => f.owner.acceptReady({ type: "ports-native-ready", token: scenario === "wrong-token" ? "wrong" : "private-token", pid: scenario === "wrong-ready-pid" ? 22 : 11 }), /could not be established/);
    } else if (scenario === "missing-pid") {
      f.child.pid = undefined;
      assert.throws(f.ready, /could not be established/);
    } else if (scenario !== "not-ready") f.ready();
    if (scenario === "changed-pid") f.child.pid = 22;
    if (scenario === "disconnected") f.child.disconnect();
    if (scenario === "exited") f.child.exitCode = 0;
    if (scenario === "signaled") f.child.signalCode = "SIGTERM";
    if (scenario === "reused-pid") { f.child.emit("exit"); f.child.exitCode = null; f.child.connected = true; }
    await assert.rejects(f.owner.requestStop(scenario === "wrong-target" ? 22 : 11, scenario === "unknown-signal" ? "SIGUSR1" : "SIGTERM"), /Refusing/, scenario);
    assert.deepEqual(f.sent, [], scenario);
    f.owner.close();
    assert.deepEqual(f.sent, [], "Unknown identity cleanup must not send a stop request");
  }
});

test("IPC send errors invalidate ownership without any OS-signal fallback", async () => {
  for (const synchronous of [false, true]) {
    const f = fixture(); f.ready();
    let attempts = 0;
    f.child.send = (_message, callback) => {
      attempts++;
      if (synchronous) throw new Error("IPC closed");
      callback(new Error("IPC closed"));
    };
    await assert.rejects(f.owner.requestStop(11, "SIGTERM"), /IPC closed/);
    await assert.rejects(f.owner.requestStop(11, "SIGKILL"), /Refusing/);
    assert.equal(attempts, 1);
    assert.deepEqual(f.sent, []);
    f.owner.close();
  }
});

test("an unknown spawn PID or authentication token can never establish stop authority", async () => {
  for (const pid of [undefined, 0, -1, NaN, 1.5]) {
    const f = fixture(); f.child.pid = pid;
    const unknown = createOwnedStopGuard(f.child, "private-token");
    assert.throws(() => unknown.acceptReady({ type: "ports-native-ready", token: "private-token", pid }), /could not be established/);
    await assert.rejects(unknown.requestStop(pid, "SIGTERM"), /Refusing/);
    unknown.close();
    assert.deepEqual(f.sent, []);
  }
  for (const token of [undefined, "", 1, {}, false]) {
    const f = fixture();
    const unknown = createOwnedStopGuard(f.child, token);
    assert.throws(() => unknown.acceptReady({ type: "ports-native-ready", token, pid: 11 }), /could not be established/);
    await assert.rejects(unknown.requestStop(11, "SIGTERM"), /Refusing/);
    unknown.close(); assert.deepEqual(f.sent, []);
  }
});

test("every native stop form is intercepted and unknown commands never reach the OS runner", async () => {
  const f = fixture(); f.ready();
  const forwarded: string[][] = [];
  const run = createOwnedSignalRunner(f.owner, async args => { forwarded.push(args); return { stdout: "", stderr: "", exitCode: 0 }; });
  for (const args of [["kill", "-15", "11"], ["kill", "-9", "11"], ["powershell", "-Command", "Stop-Process -Id 11 -ErrorAction Stop"], ["pwsh", "-Command", "Stop-Process -Id 11 -Force -ErrorAction Stop"]]) {
    assert.equal((await run(args)).exitCode, 0);
  }
  for (const args of [["kill", "-15", "22"], ["kill", "-15", "0"], ["kill", "-15", "-1"], ["/bin/kill", "-15", "11"], ["sh", "-c", "kill 11"], ["powershell", "-Command", "Stop-Process -Id 22 -ErrorAction Stop"], ["pwsh", "-Command", "Stop-Process -Id 11 -Force"], ["pwsh", "-Command", "$ErrorActionPreference = 'Stop'; $ids = @(Get-Process); spps 22"]]) {
    assert.equal((await run(args)).exitCode, 1, args.join(" "));
  }
  assert.equal(f.sent.length, 4);
  assert.deepEqual(forwarded, []);
  await run(["lsof", "-iTCP"]);
  assert.equal(forwarded.length, 1);
  f.owner.close();
});

test("port replacement after the initial snapshot refuses the replacement PID at the actual stop boundary", async () => {
  const f = fixture(); f.ready();
  let pid = 11;
  let forwardedStop = false;
  const runner = createOwnedSignalRunner(f.owner, async args => {
    if (args[0] === "kill") { forwardedStop = true; throw new Error("Must not send an OS signal"); }
    throw new Error("Unexpected query");
  });
  const backend = new UnixPortBackend(runner, () => ({ state: "alive" }), async () => {});
  backend.getListeningPorts = async () => [{ pid, port: 3000 }];
  backend.getProcessStats = async () => undefined;
  backend.getWorkingDirectory = async () => undefined;
  const service = new PortService(() => backend);
  assert.equal((await service.snapshot()).processes[0]?.pid, 11);
  pid = 22; f.child.emit("exit");
  const result = await service.killPort(3000);
  assert.equal(result.success, false);
  assert.match(result.message, /ownership\/identity/);
  assert.equal(forwardedStop, false);
  assert.deepEqual(f.sent, []);
  f.owner.close();
});

test("the native PowerShell allowlist admits actual read-only backend queries and rejects appended commands", async () => {
  const f = fixture(); f.ready();
  const queries: string[][] = [];
  const runner = createOwnedSignalRunner(f.owner, async args => {
    queries.push(args);
    if (args[0] === "where") return { stdout: "powershell", stderr: "", exitCode: 0 };
    const script = args.at(-1)!;
    const payload = script.includes("Get-NetTCPConnection") ? { Listeners: [{ LocalPort: 3000, OwningProcess: 11 }] }
      : script.includes("Get-CimInstance") ? [{ ProcessId: 11, CommandLine: "C:/app/server.js" }]
      : script.includes("$ids") ? { State: "alive" } : [{ Id: 11, ProcessName: "node" }];
    return { stdout: JSON.stringify(payload), stderr: "", exitCode: 0 };
  });
  const backend = new WindowsPortBackend(runner);
  const context = new CollectionContext("Windows fixture");
  try {
    const rows = await backend.getListeningPorts(context);
    await backend.prepareProcesses(rows, context);
    assert.equal((await backend.isProcessAlive(11)).state, "alive");
    const scripts = queries.filter(args => args[0] === "powershell");
    assert.equal(scripts.length, 4);
    const before = queries.length;
    for (const args of scripts) assert.equal((await runner([...args.slice(0, -1), args.at(-1) + "; spps 22"])).exitCode, 1);
    assert.equal(queries.length, before);
  } finally { context.finish(); f.owner.close(); }
});
