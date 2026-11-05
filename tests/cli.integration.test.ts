import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/command.cjs", import.meta.url));
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

async function environment(mode: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ports cli fixture "));
  const calls = path.join(directory, "calls.jsonl");
  await fs.writeFile(path.join(directory, "package.json"), '{"name":"fixture-project"}');
  await fs.writeFile(calls, "");
  for (const command of ["lsof", "ps", "kill", "where", "powershell", "pwsh"]) {
    if (mode === "metadata-error" && command === "ps") continue;
    const target = path.join(directory, command + (process.platform === "win32" ? ".cmd" : ""));
    await fs.writeFile(target, process.platform === "win32"
      ? `@"${process.execPath}" "${fixture}" ${command} %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${quote(command)} "$@"\n`, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: directory, PORTS_TEST_MODE: mode, PORTS_TEST_CALLS: calls, PORTS_TEST_PROJECT: directory, NO_COLOR: "1" };
  // Windows environment keys are case insensitive; avoid keeping both Path/PATH.
  if (process.platform === "win32") for (const key of Object.keys(env)) if (key.toLowerCase() === "path" && key !== "PATH") delete (env as any)[key];
  return { directory, calls, env, close: () => fs.rm(directory, { recursive: true, force: true }) };
}

test("built CLI preserves JSON schema, table/details output, and warning separation", async () => {
  for (const mode of ["success", "metadata-error", "empty"]) {
    const setup = await environment(mode);
    try {
      const r = await execa(process.execPath, [cli, "list", "--json"], { env: setup.env, reject: false });
      assert.equal(r.exitCode, 0, r.stderr);
      const rows = JSON.parse(r.stdout);
      if (mode === "empty") assert.deepEqual(rows, []);
      else {
        assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]), ["port", "pid", "command", "projectName", "framework", "memoryKB", "uptime"]);
        assert.equal(rows[0].port, 3000); assert.equal(rows[0].pid, 987654321);
      }
      if (mode === "metadata-error") assert.match(r.stderr, /Warning:/);
      else assert.equal(r.stderr, "");
      const check = await execa(process.execPath, [cli, "check", "003000"], { env: setup.env, reject: false });
      assert.equal(check.exitCode, 0); assert.match(check.stdout, mode === "empty" ? /free/ : /987654321/);
      const table = await execa(process.execPath, [cli, "list"], { env: setup.env, reject: false });
      assert.equal(table.exitCode, 0); assert.match(table.stdout, mode === "empty" ? /No listening/ : /PORT/);
      if (mode === "success") {
        // Positive built-CLI stop coverage uses only fake signal executables.
        const stopped = await execa(process.execPath, [cli, "kill", "3000"], { env: setup.env, reject: false });
        assert.equal(stopped.exitCode, 0, stopped.stderr); assert.match(stopped.stdout, /Stopped PID 987654321/);
        const calls = (await fs.readFile(setup.calls, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        assert.ok(calls.some(call => process.platform === "win32"
          ? call.command === "powershell" && call.args.at(-1).includes("Stop-Process -Id 987654321")
          : call.command === "kill" && call.args.join(" ") === "-15 987654321"));
      }
      const killFree = mode === "empty" ? await execa(process.execPath, [cli, "kill", "3000"], { env: setup.env, reject: false }) : undefined;
      if (killFree) { assert.equal(killFree.exitCode, 1); assert.equal(killFree.stdout, ""); assert.match(killFree.stderr, /free/); }
    } finally { await setup.close(); }
  }
});

test("built CLI fails discovery consistently without printing success data", async () => {
  for (const mode of ["error", "malformed"]) {
    const setup = await environment(mode);
    try {
      for (const args of [[], ["list"], ["list", "--json"], ["check", "3000"], ["kill", "3000"]]) {
        const r = await execa(process.execPath, [cli, ...args], { env: setup.env, reject: false });
        assert.equal(r.exitCode, 1); assert.equal(r.stdout, ""); assert.ok(r.stderr.length);
        assert.doesNotMatch(r.stderr, /port is free|Port 3000 is free/i);
      }
    } finally { await setup.close(); }
  }
});

test("built CLI help/version and rejected arguments never invoke platform tools", async () => {
  const setup = await environment("error");
  try {
    for (const args of [["--help"], ["--version"], ["list", "--help"]]) {
      const r = await execa(process.execPath, [cli, ...args], { env: setup.env, reject: false }); assert.equal(r.exitCode, 0); assert.ok(r.stdout.length);
      if (args[0] === "--version") assert.equal(r.stdout, "2.0.1");
    }
    for (const command of ["check", "kill"]) {
      for (const value of ["3000abc", "3000.5", "3e3", "0", "65536", " 3000", "3000 ", "3000\n", "3000\r", "\t3000", "٣٠٠٠"]) {
        const r = await execa(process.execPath, [cli, command, value], { env: setup.env, reject: false }); assert.equal(r.exitCode, 1); assert.equal(r.stdout, ""); assert.match(r.stderr, /1 to 65535/);
      }
    }
    assert.equal(await fs.readFile(setup.calls, "utf8"), "");
    for (const name of process.platform === "win32" ? ["where.cmd", "powershell.cmd", "pwsh.cmd"] : ["lsof"]) {
      await fs.rm(path.join(setup.directory, name));
    }
    const missing = await execa(process.execPath, [cli, "list", "--json"], { env: setup.env, reject: false });
    assert.equal(missing.exitCode, 1); assert.equal(missing.stdout, ""); assert.match(missing.stderr, /not found|PATH/);
  } finally { await setup.close(); }
});
