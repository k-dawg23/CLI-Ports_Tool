import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/commands.js";
import type { PortService } from "../src/ports.js";

async function invoke(args: string[], service: any = {}, interactive = false) {
  let stdout = "", stderr = "", constructed = 0;
  const code = await runCli(["node", "ports", ...args], { stdout: text => { stdout += text; }, stderr: text => { stderr += text; }, interactive,
    serviceFactory: () => { constructed++; return service as PortService; } });
  return { code, stdout, stderr, constructed };
}

test("CLI validates before constructing the backend, for both commands", async () => {
  for (const command of ["check", "kill"]) {
    for (const value of ["0", "65536", "999999999999999999999", "3000abc", "3000.5", "3e3", "0xBB8", "+3000", "-1", "", " ", " 3000", "3000 ", "3000\n", "3000\r", "\t3000", "٣٠٠٠"]) {
      const r = await invoke([command, value]);
      assert.equal(r.code, 1, `${command} ${value}`); assert.equal(r.stdout, ""); assert.equal(r.constructed, 0);
      assert.match(r.stderr, /1 to 65535/);
    }
    const missing = await invoke([command]);
    assert.equal(missing.code, 1); assert.equal(missing.constructed, 0);
  }
});

test("CLI discovery failures have no success payload in all invocation paths", async () => {
  const service = { snapshot: async () => { throw new Error("required query failed"); }, killPort: async () => { throw new Error("required query failed"); } };
  for (const args of [[], ["list"], ["list", "--json"], ["check", "3000"], ["kill", "3000"]]) {
    const r = await invoke(args, service);
    assert.equal(r.code, 1); assert.equal(r.stdout, ""); assert.match(r.stderr, /required query failed/);
  }
});

test("CLI empty discovery, kill failures, and help/version follow stream contracts", async () => {
  const service = { snapshot: async () => ({ processes: [], warnings: [], completedAt: 0 }), killPort: async () => ({ success: false, message: "Port 3000 is free." }) };
  const json = await invoke(["list", "--json"], service);
  assert.equal(json.code, 0); assert.deepEqual(JSON.parse(json.stdout), []); assert.equal(json.stderr, "");
  const free = await invoke(["check", "003000"], service);
  assert.equal(free.code, 0); assert.match(free.stdout, /free/);
  for (const message of ["Port 3000 is free.", "Listener released; process still running", "Forced stop requested; process exit not confirmed"]) {
    const r = await invoke(["kill", "3000"], { killPort: async () => ({ success: false, message }) });
    assert.equal(r.code, 1); assert.equal(r.stdout, ""); assert.ok(r.stderr.includes(message));
  }
  const success = await invoke(["kill", "3000"], { killPort: async () => ({ success: true, message: "Stopped PID 22." }) });
  assert.equal(success.code, 0); assert.match(success.stdout, /Stopped/); assert.equal(success.stderr, "");
  for (const args of [["--help"], ["--version"], ["check", "--help"]]) {
    const r = await invoke(args); assert.equal(r.code, 0); assert.equal(r.constructed, 0); assert.ok(r.stdout.length);
  }
});
