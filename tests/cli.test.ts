import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/commands.js";
import type { PortService } from "../src/ports.js";
import type { PortProcess } from "../src/types.js";

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
  for (const args of [[], ["list"], ["list", "--json"], ["list", "--port", "3000"], ["check", "3000"], ["kill", "3000"]]) {
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

test("list filters validate before discovery, combine with AND and preserve default schema", async () => {
  const rows: PortProcess[] = [
    { port: 3000, pid: 0, addresses: [{ address: "127.0.0.1", family: "IPv4" }, { address: "::1", family: "IPv6" }], command: "node", projectName: "Alpha-App", framework: "Vite" },
    { port: 3001, pid: 4294967295, addresses: [{ address: "::", family: "IPv6" }], command: "node", projectName: "Beta", framework: "-" }
  ];
  const service = { snapshot: async () => ({ processes: rows, warnings: [], completedAt: 0 }) };
  const match = await invoke(["list", "--port", "03000", "--pid", "0", "--project", " alpha- ", "--json"], service);
  assert.equal(match.code, 0);
  assert.deepEqual(JSON.parse(match.stdout), [{ port: 3000, pid: 0, command: "node", projectName: "Alpha-App", framework: "Vite", memoryKB: null, uptime: null }]);
  const extended = await invoke(["list", "--json", "--addresses", "--pid", "0004294967295"], service);
  assert.deepEqual(JSON.parse(extended.stdout)[0].addresses, [{ address: "::", family: "IPv6" }]);
  const empty = await invoke(["list", "--project", "missing"], service);
  assert.equal(empty.code, 0); assert.equal(empty.stdout, "No listening TCP ports match the supplied filters.\n");
  const table = await invoke(["list", "--addresses"], service);
  assert.match(table.stdout, /BINDINGS/); assert.match(table.stdout, /127\.0\.0\.1:3000, \[::1\]:3000/);
  const defaultTable = await invoke(["list"], service);
  assert.match(defaultTable.stdout, /PORT\s+PROJECT\s+FRAMEWORK\s+PID\s+MEM\s+UPTIME\s+COMMAND/);
  assert.doesNotMatch(defaultTable.stdout, /BINDINGS/);
  const noMatchJson = await invoke(["list", "--json", "--port", "1234"], service);
  assert.deepEqual(JSON.parse(noMatchJson.stdout), []);
  const detail = await invoke(["check", "3000"], { snapshot: async () => ({ processes: rows, warnings: [], completedAt: 0 }) });
  assert.match(detail.stdout, /Bindings: 127\.0\.0\.1:3000, \[::1\]:3000/);

  for (const args of [["list", "--port", "3000", "--port", "3001"], ["list", "--pid", "0", "--pid", "1"], ["list", "--project", "a", "--project", "b"], ...["-1", "+1", "4294967296", "1e2", "1.0", "1x", " 1", "1 ", "١"].map(value => ["list", "--pid", value]), ["list", "--project", "  "], ["list", "--port"], ["list", "--wat"]]) {
    const invalid = await invoke(args, service);
    assert.equal(invalid.code, 1, args.join(" ")); assert.equal(invalid.constructed, 0); assert.equal(invalid.stdout, "");
  }
});
