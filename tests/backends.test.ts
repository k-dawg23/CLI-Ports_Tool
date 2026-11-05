import assert from "node:assert/strict";
import { test } from "node:test";
import { CollectionContext, DiscoveryError } from "../src/discovery.js";
import { UnixPortBackend } from "../src/backends/unix.js";
import { WindowsPortBackend } from "../src/backends/windows.js";
import { PortService } from "../src/ports.js";
import { readFile } from "node:fs/promises";
import type { PlatformPortBackend } from "../src/backends/types.js";
import type { CommandResult, CommandRunner } from "../src/system.js";

export const result = (stdout = "", exitCode = 0, stderr = "", failure?: CommandResult["failure"]): CommandResult => ({ stdout, exitCode, stderr, failure });
const header = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME";
const line = (pid = 11, port = 3000, family = "IPv4") => `node ${pid} user 20u ${family} 123 0t0 TCP *:${port} (LISTEN)`;
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function collectUnix(output: CommandResult) {
  const context = new CollectionContext("test");
  try { return await new UnixPortBackend(async () => output).getListeningPorts(context); }
  finally { context.finish(); }
}

test("Unix enumeration checks empty outcomes and deduplicates IPv4/IPv6", async () => {
  for (const output of [result(), result(header), result("", 1)]) assert.deepEqual(await collectUnix(output), []);
  assert.deepEqual(await collectUnix(result([header, line(), line(11, 3000, "IPv6"), line(22)].join("\n"))), [
    { command: "node", pid: 11, port: 3000 }, { command: "node", pid: 22, port: 3000 }
  ]);
});

test("Unix required query errors never become empty success", async () => {
  for (const output of [result("", 1, "permission denied"), result("", 1, "", "missing"), result("", 1, "", "timeout"), result("garbage"), result(`${header}\n${line()}\nbad record`), result(`${header}\n${line(2, 65536)}`)]) {
    await assert.rejects(collectUnix(output), DiscoveryError);
  }
});

test("captured native Linux fixtures replay on any host without hiding unknown errors", async () => {
  const captured = JSON.parse(await readFile(new URL("./fixtures/linux-lsof.json", import.meta.url), "utf8"));
  for (const fixture of captured.fixtures) {
    const context = new CollectionContext("fixture");
    try {
      const backend = new UnixPortBackend(async () => fixture, undefined, undefined, "linux");
      if (fixture.name === "invalid-option") await assert.rejects(backend.getListeningPorts(context), DiscoveryError);
      else {
        const rows = await backend.getListeningPorts(context);
        assert.equal(rows.length, fixture.name === "controlled-no-match" ? 0 : 2);
        if (fixture.stderr) assert.ok(context.warnings.size);
      }
    } finally { context.finish(); }
  }
  const noMatch = captured.fixtures.find((item: any) => item.name === "controlled-no-match");
  const warning = "lsof: WARNING: can't stat() overlay file system /test\n      Output information may be incomplete.";
  for (const stderr of [noMatch.stderr || warning, warning + "\npermission denied"]) {
    for (const platform of ["linux", "darwin"] as const) {
      const context = new CollectionContext("fixture");
      try {
        const backend = new UnixPortBackend(async () => result("", 1, stderr), undefined, undefined, platform);
        if (platform === "darwin" || stderr.includes("permission denied")) await assert.rejects(backend.getListeningPorts(context), DiscoveryError);
        else assert.deepEqual(await backend.getListeningPorts(context), []);
      } finally { context.finish(); }
    }
  }
});

test("Unix metadata errors are best effort, with one broad warning", async () => {
  const backend = new UnixPortBackend(async args => args[0] === "ps" ? result("", 1, "", "missing") : result(`${header}\n${line()}`));
  const service = new PortService(() => backend);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.processes.length, 1);
  assert.equal(snapshot.processes[0]?.memoryKb, undefined);
  assert.equal(snapshot.warnings.length, 1);
  const exited = new UnixPortBackend(async () => result("", 1));
  const context = new CollectionContext("test");
  try { assert.equal(await exited.getProcessStats(11, context), undefined); assert.equal(context.warnings.size, 0); }
  finally { context.finish(); }
});

function windowsRunner(payload: unknown, metadataError = false): CommandRunner {
  return async args => {
    if (args[0] === "where") return result("powershell");
    const command = args.at(-1)!;
    if (command.includes("Get-NetTCPConnection")) {
      assert.match(command, /Get-NetTCPConnection -State Listen -ErrorAction Stop/);
      return result(JSON.stringify(payload));
    }
    if (metadataError) return result("", 1, "access denied");
    if (command.includes("Get-CimInstance")) return result(JSON.stringify([{ ProcessId: 11, CommandLine: '"C:\\Program Files\\node.exe" "C:\\app\\server.js"' }]));
    return result(JSON.stringify([{ Id: 11, ProcessName: "node", WorkingSet64: 1048576, StartTime: "2026-01-01T00:00:00Z" }]));
  };
}

test("Windows validates payload and retains PID 0 system listeners", async () => {
  const backend = new WindowsPortBackend(windowsRunner({ Listeners: [{ LocalPort: 3000, OwningProcess: 11 }, { LocalPort: 3000, OwningProcess: 11 }, { LocalPort: 80, OwningProcess: 0 }] }));
  const context = new CollectionContext("test");
  try {
    const rows = await backend.getListeningPorts(context);
    assert.deepEqual(rows, [{ port: 3000, pid: 11 }, { port: 80, pid: 0 }]);
    await backend.prepareProcesses(rows, context);
    assert.equal((await backend.getProcessStats(11, context))?.memoryKb, 1024);
  } finally { context.finish(); }
  for (const payload of [null, {}, { Listeners: null }, { Listeners: {} }, { Listeners: [null] }, { Listeners: [{ LocalPort: 3.5, OwningProcess: 1 }] }, { Listeners: [{ LocalPort: "3000", OwningProcess: 1 }] }, { Listeners: [{ LocalPort: 80, OwningProcess: -1 }] }]) {
    const c = new CollectionContext("test");
    try { await assert.rejects(new WindowsPortBackend(windowsRunner(payload)).getListeningPorts(c), DiscoveryError); }
    finally { c.finish(false); }
  }
});

test("Windows missing shells, cmdlet failure, invalid JSON and timeout fail discovery", async () => {
  for (const output of [result("", 1, "Get-NetTCPConnection failed"), result("bad JSON"), result("", 1, "", "timeout")]) {
    const context = new CollectionContext("test");
    try { await assert.rejects(new WindowsPortBackend(async args => args[0] === "where" ? result("powershell") : output).getListeningPorts(context), DiscoveryError); }
    finally { context.finish(false); }
  }
  const context = new CollectionContext("test");
  try { await assert.rejects(new WindowsPortBackend(async () => result("", 1)).getListeningPorts(context), /powershell or pwsh was not found/); }
  finally { context.finish(false); }
});

test("Windows optional query failure retains listeners and empty snapshots succeed", async () => {
  const service = new PortService(() => new WindowsPortBackend(windowsRunner({ Listeners: [{ LocalPort: 3000, OwningProcess: 11 }] }, true)));
  const snapshot = await service.snapshot();
  assert.equal(snapshot.processes.length, 1);
  assert.match(snapshot.warnings.join(), /access denied/);
  assert.deepEqual((await new PortService(() => new WindowsPortBackend(windowsRunner({ Listeners: [] }))).snapshot()).processes, []);
});

function fakeBackend(overrides: Partial<PlatformPortBackend> = {}): PlatformPortBackend {
  return {
    getListeningPorts: async () => [{ pid: 11, port: 3000, command: "node" }], getWorkingDirectory: async () => undefined,
    getProcessStats: async () => undefined, killProcess: async () => ({ success: true, message: "mock" }),
    isProcessAlive: async () => ({ state: "alive" }), openInBrowser: async () => ({ success: true, message: "mock" }), openInEditor: async () => ({ success: true, message: "mock" }), ...overrides
  };
}

test("service snapshots are isolated, validation is fresh, and queued work gets priority", async () => {
  let calls = 0;
  let release!: () => void;
  const backend = fakeBackend({ getListeningPorts: async () => {
    const number = ++calls;
    if (number === 1) await new Promise<void>(resolve => { release = resolve; });
    return [{ pid: 11, port: number === 3 ? 4000 : 3000 }];
  } });
  const service = new PortService(() => backend);
  const first = service.snapshot(); await tick();
  const routine = service.snapshot();
  const validation = service.validateTarget({ pid: 11, port: 3000 });
  assert.equal(calls, 1);
  release();
  const original = await first;
  assert.ok(await validation);
  const later = await routine;
  assert.equal(calls, 3);
  assert.equal(original.processes[0]?.port, 3000);
  assert.equal(later.processes[0]?.port, 4000);
  assert.throws(() => { (original.processes[0] as any).port = 9; }, TypeError);
});

for (const phase of ["getListeningPorts", "prepareProcesses", "getProcessStats", "getWorkingDirectory", "package"] as const) {
  test(`collection budget bounds hung ${phase} and queue proceeds`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let release!: (value?: any) => void;
    const hang = () => new Promise<any>(resolve => { release = resolve; });
    let first = true;
    const backend = fakeBackend(phase === "package" ? { getWorkingDirectory: async () => "/test" } : { [phase]: () => first ? hang() : Promise.resolve(phase === "getListeningPorts" ? [] : undefined) });
    const service = new PortService(() => backend, 15, phase === "package" ? hang : undefined);
    const pending = service.snapshot();
    const failure = phase === "getListeningPorts" ? assert.rejects(pending, /deadline/) : undefined;
    await tick();
    t.mock.timers.tick(15);
    await tick();
    if (failure) await failure;
    else {
      const snapshot = await pending;
      assert.equal(snapshot.processes.length, 1);
      assert.match(snapshot.warnings.join(), /deadline/);
    }
    first = false;
    release(undefined);
    await tick();
    if (phase !== "package") await service.snapshot();
  });
}
