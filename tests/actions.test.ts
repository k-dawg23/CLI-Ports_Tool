import assert from "node:assert/strict";
import { test } from "node:test";
import { stopValidatedProcess } from "../src/backends/common.js";
import { UnixPortBackend, unixProcessLiveness } from "../src/backends/unix.js";
import { WindowsPortBackend } from "../src/backends/windows.js";
import { PortService } from "../src/ports.js";
import type { PlatformPortBackend, ProcessLiveness } from "../src/backends/types.js";

const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });

test("Unix liveness distinguishes kernel absence, permission, and unknown errors without signaling", t => {
  for (const [code, state] of [["ESRCH", "exited"], ["EPERM", "alive"], ["EIO", "unknown"]]) {
    const probe = t.mock.method(process, "kill", () => { throw Object.assign(new Error(code), { code }); });
    assert.equal(unixProcessLiveness(22).state, state);
    assert.deepEqual(probe.mock.calls[0]?.arguments, [22, 0]);
    probe.mock.restore();
  }
});

test("browser/editor command arguments preserve paths with spaces without opening applications", async () => {
  const commands: string[][] = [];
  const prior = process.env.PORTS_EDITOR;
  process.env.PORTS_EDITOR = '"mock editor" --new';
  try {
    const unix = new UnixPortBackend(async (args, options) => {
      assert.equal(options?.timeoutMs, 0, "GUI launcher lifetime must not be bounded by discovery's timeout");
      assert.equal(options?.inheritLocale, true);
      commands.push(args); return ok();
    });
    assert.equal((await unix.openInEditor("/a project/with spaces")).success, true);
    assert.equal((await unix.openInBrowser("http://localhost:3000")).success, true);
    assert.deepEqual(commands[0], ["mock editor", "--new", "/a project/with spaces"]);
    assert.equal(commands[1]?.at(-1), "http://localhost:3000");
    const windows = new WindowsPortBackend(async (args, options) => {
      if (args[0] !== "where") { assert.equal(options?.timeoutMs, 0); assert.equal(options?.inheritLocale, true); }
      commands.push(args); return ok(args[0] === "where" ? "powershell" : "");
    });
    assert.equal((await windows.openInEditor("C:\\a project\\with spaces")).success, true);
    assert.deepEqual(commands.at(-1), ["mock editor", "--new", "C:\\a project\\with spaces"]);
    assert.equal((await windows.openInBrowser("http://localhost:3000")).success, true);
    assert.match(commands.at(-1)!.at(-1)!, /Start-Process "http:\/\/localhost:3000"/);
  } finally { if (prior === undefined) delete process.env.PORTS_EDITOR; else process.env.PORTS_EDITOR = prior; }
});

test("stop state machine preserves interval and validates both signal phases", async () => {
  const events: string[] = [];
  let probes = 0;
  const result = await stopValidatedProcess(22, 3000, async () => { events.push("validate"); return true; }, async force => { events.push(force ? "force" : "term"); }, async () => ({ state: ++probes === 1 ? "alive" : "exited" }), async ms => { events.push(`wait:${ms}`); });
  assert.equal(result.success, true);
  assert.deepEqual(events, ["validate", "term", "wait:1000", "validate", "force"]);
});

test("no target, released listener, unknown liveness, and failed validation never escalate", async () => {
  for (const scenario of ["absent", "released", "unknown", "validation-failure", "probe-failure", "term-failure"] as const) {
    const signals: boolean[] = [];
    let validations = 0;
    const result = await stopValidatedProcess(22, 3000, async () => {
      validations++;
      if (scenario === "validation-failure" && validations > 1) throw new Error("discovery failed");
      return scenario !== "absent" && !(scenario === "released" && validations > 1);
    }, async force => { signals.push(force); if (scenario === "term-failure") throw new Error("access denied"); }, async () => {
      if (scenario === "probe-failure") throw new Error("probe failed");
      return scenario === "unknown" ? { state: "unknown", reason: "timeout" } : { state: "alive" };
    }, async () => {});
    assert.equal(result.success, false, scenario);
    assert.ok(!signals.includes(true), scenario);
    if (scenario === "absent") assert.deepEqual(signals, []);
    if (scenario === "released") assert.match(result.message, /Listener released; process still running/);
  }
});

test("only confirmed exit reports success, including after forced termination", async () => {
  for (const final of [{ state: "alive" }, { state: "unknown", reason: "permission denied" }, { state: "exited" }] as ProcessLiveness[]) {
    let probes = 0;
    const result = await stopValidatedProcess(22, 3000, async () => true, async () => {}, async () => ++probes === 1 ? { state: "alive" } : final, async () => {});
    assert.equal(result.success, final.state === "exited");
    if (!result.success) assert.match(result.message, /exit not confirmed/);
  }
  for (const pid of [0, -1, NaN, 3.5]) {
    const result = await stopValidatedProcess(pid, 3000, async () => { throw new Error("must not validate"); }, async () => { throw new Error("must not signal"); }, async () => ({ state: "exited" }));
    assert.equal(result.success, false);
  }
});

test("a failed forced stop reports failure without another signal", async () => {
  const signals: boolean[] = [];
  const result = await stopValidatedProcess(22, 3000, async () => true, async force => {
    signals.push(force); if (force) throw new Error("forced stop denied");
  }, async () => ({ state: "alive" }), async () => {});
  assert.equal(result.success, false); assert.match(result.message, /forced stop denied/); assert.deepEqual(signals, [false, true]);
});

test("Unix and Windows send their original command sequence to the captured PID only", async () => {
  const unixCommands: string[][] = [];
  let unixProbes = 0;
  const unix = new UnixPortBackend(async (args, options) => { assert.equal(options?.timeoutMs, 15_000); assert.equal(options?.inheritLocale, undefined); unixCommands.push(args); return ok(); }, () => ({ state: ++unixProbes === 1 ? "alive" : "exited" }), async ms => { assert.equal(ms, 1000); });
  assert.equal((await unix.killProcess(22, 3000, async () => true)).success, true);
  assert.deepEqual(unixCommands, [["kill", "-15", "22"], ["kill", "-9", "22"]]);

  const windowsCommands: string[] = [];
  let probes = 0;
  const windows = new WindowsPortBackend(async (args, options) => {
    if (args[0] === "where") return ok("powershell");
    const command = args.at(-1)!;
    if (command.includes("Stop-Process")) { assert.equal(options?.timeoutMs, 15_000); assert.equal(options?.inheritLocale, undefined); windowsCommands.push(command); return ok(); }
    return ok(JSON.stringify({ State: ++probes === 1 ? "alive" : "exited" }));
  }, async ms => { assert.equal(ms, 1000); });
  assert.equal((await windows.killProcess(22, 3000, async () => true)).success, true);
  assert.deepEqual(windowsCommands, ["Stop-Process -Id 22 -ErrorAction Stop", "Stop-Process -Id 22 -Force -ErrorAction Stop"]);
});

test("Windows liveness command failures and invalid output remain unknown", async () => {
  for (const output of [{ stdout: "", stderr: "access denied", exitCode: 1 }, { stdout: "garbage", stderr: "", exitCode: 0 }, { stdout: "{}", stderr: "", exitCode: 0 }, { stdout: "", stderr: "", exitCode: 1, failure: "timeout" as const }]) {
    const backend = new WindowsPortBackend(async args => args[0] === "where" ? ok("powershell") : output);
    assert.equal((await backend.isProcessAlive(22)).state, "unknown");
  }
});

test("shared-port actions use the selected PID in either enumeration order and capture it immutably", async () => {
  for (const pids of [[11, 22], [22, 11]]) {
    const actions: string[] = [];
    const backend: PlatformPortBackend = {
      getListeningPorts: async () => pids.map(pid => ({ pid, port: 3000 })),
      getProcessStats: async () => undefined,
      getWorkingDirectory: async pid => `/project ${pid}`,
      killProcess: async (pid, port, validate) => {
        assert.equal(await validate(), true); actions.push(`kill:${pid}:${port}`); return { success: true, message: "mock" };
      },
      isProcessAlive: async () => ({ state: "exited" }),
      openInEditor: async path => { actions.push(`editor:${path}`); return { success: true, message: "mock" }; },
      openInBrowser: async url => { actions.push(`url:${url}`); return { success: true, message: "mock" }; }
    };
    const service = new PortService(() => backend, 15000, async cwd => ({ projectName: cwd!, framework: "-" }));
    const target = { pid: 22, port: 3000 };
    const pending = service.killTarget(target);
    target.pid = 11;
    await pending;
    await service.openEditor({ pid: 22, port: 3000 });
    await service.openBrowser({ pid: 22, port: 3000 });
    assert.deepEqual(actions, ["kill:22:3000", "editor:/project 22", "url:http://localhost:3000"]);
    await service.killPort(3000);
    assert.equal(actions.at(-1), `kill:${pids[0]}:3000`);
    pids.splice(pids.indexOf(22), 1);
    assert.equal((await service.openEditor({ pid: 22, port: 3000 })).success, false);
    assert.equal((await service.openBrowser({ pid: 22, port: 3000 })).success, false);
    assert.equal(actions.length, 4);
    backend.getListeningPorts = async () => { throw new Error("discovery failed"); };
    await assert.rejects(service.openEditor({ pid: 11, port: 3000 }), /discovery failed/);
    await assert.rejects(service.openBrowser({ pid: 11, port: 3000 }), /discovery failed/);
    assert.equal(actions.length, 4);
  }
});
