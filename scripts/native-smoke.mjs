import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { createOwnedStopGuard, createOwnedSignalRunner } from "./native-ownership.mjs";
import { runCli } from "../src/commands.tsx";
import { PortService } from "../src/ports.ts";
import { UnixPortBackend } from "../src/backends/unix.ts";
import { WindowsPortBackend } from "../src/backends/windows.ts";
import { runCheckedCommand } from "../src/system.ts";
import { CollectionContext } from "../src/discovery.ts";

const linuxMountWarnings = text => {
  const lines = text.trimEnd().split("\n");
  return lines.length % 2 === 0 && lines.every((line, index) => index % 2 === 0
    ? /^lsof: WARNING: can't stat\(\) (overlay|nsfs) file system .+$/.test(line)
    : /^\s+Output information may be incomplete\.$/.test(line));
};

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const directory = process.env.PORTS_NATIVE_OUTPUT_DIR || fileURLToPath(new URL("../docs/verification/", import.meta.url));
const capture = { platform: process.platform, os: os.release(), node: process.version,
  github: { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB, runner: process.env.RUNNER_NAME },
  terminationMechanism: "authenticated IPC request; fixture signals itself", checks: [], fixtures: [], commands: [] };
const children = [];
const checked = async (name, work) => { await work(); capture.checks.push({ name, status: "passed" }); console.log(`PASS: ${name}`); };
const command = async (executable, args, timeoutMs = 15000) => {
  const startedAt = Date.now();
  const r = await execa(executable, args, { reject: false, timeout: timeoutMs, env: { LC_ALL: "C", NO_COLOR: "1" } });
  capture.commands.push({ command: [executable, ...args], timeoutMs, durationMs: Date.now() - startedAt,
    exitCode: r.exitCode, timedOut: r.timedOut, stdout: r.stdout, stderr: r.stderr });
  if (r.failed && r.exitCode === undefined) throw r;
  return { command: [executable, ...args], stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
};
// Observe the CLI's own 15-second active collection budget plus startup/output
// and subprocess cleanup. Never preempt that budget with an equal outer timer.
const run = args => command(process.execPath, [cli, ...args], 30000);
const assertOwnedAlive = child => {
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(child.connected, true);
};

async function server(hosts) {
  const token = randomUUID();
  const code = `const net=require('node:net'); const token=${JSON.stringify(token)};
    process.on('disconnect',()=>process.exit(0));
    process.on('message',message=>{
      if(message?.type==='ports-native-stop' && message.token===token && message.pid===process.pid && ['SIGTERM','SIGKILL'].includes(message.signal)) process.kill(process.pid,message.signal);
    });
    Promise.all(${JSON.stringify(hosts)}.map(host=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen({port:0,host,exclusive:true},()=>resolve({host,port:server.address().port}));}))).then(ports=>process.send({type:'ports-native-ready',token,pid:process.pid,ports}),error=>{console.error(error.message);process.exit(1);});`;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const owner = createOwnedStopGuard(child, token);
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = once(child, "exit");
  const ready = new Promise((resolve, reject) => {
    child.once("message", message => {
      try { resolve(owner.acceptReady(message)); } catch (error) { reject(error); }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Owned server exited before readiness (${code}): ${stderr}`)));
  });
  children.push({ child, exited, owner });
  return { child, exited, owner, ...(await ready) };
}

try {
  await fs.mkdir(directory, { recursive: true });
  const target = await server(process.platform === "win32" ? ["127.0.0.1"] : ["127.0.0.1", "::1"]);
  const sentinel = await server(["127.0.0.1"]);
  const port = target.ports[0].port;
  await checked("owned listener appears in JSON, table, and check", async () => {
    const json = await run(["list", "--json"]);
    assert.equal(json.exitCode, 0, json.stderr);
    const rows = JSON.parse(json.stdout).filter(row => row.port === port);
    assert.ok(rows.length > 0);
    // Refuse the port-based stop if any listener on the port is not ours.
    assert.ok(rows.every(row => row.pid === target.pid), "Port is shared with a process the test does not own; refusing termination.");
    for (const args of [["list"], ["check", String(port)]]) {
      const r = await run(args); assert.equal(r.exitCode, 0, r.stderr); assert.match(r.stdout, new RegExp(String(target.pid)));
    }
  });
  if (process.platform === "win32") {
    await checked("production backend-selected PowerShell executable and version verified with native discovery", async () => {
      const nonce = randomUUID();
      const identityFile = path.join(directory, `powershell-observed-${nonce}.json`);
      const identityExpression = "[pscustomobject]@{Executable=[System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName; Version=$PSVersionTable.PSVersion.ToString(); Edition=$PSVersionTable.PSEdition; ProcessId=$PID}";
      const evidence = capture.windowsShell = { lookup: [], discovery: undefined, identity: undefined, versionQuery: undefined };
      const observe = async (args, options) => {
        if (args[0] === "where") {
          const result = await runCheckedCommand(args, options);
          evidence.lookup.push({ command: args, result });
          return result;
        }
        assert.ok(["powershell", "pwsh"].includes(args[0]), "Observe the backend's selected executable, never choose another shell");
        assert.ok(args.at(-1).includes("Get-NetTCPConnection"));
        const original = [...args];
        // Record identity INSIDE the process running the original native query.
        // File output only: preserve discovery stdout, argv prefix and options.
        const script = `${args.at(-1)}; ${identityExpression} | Add-Member -NotePropertyName Nonce -NotePropertyValue '${nonce}' -PassThru | ConvertTo-Json -Compress | Set-Content -LiteralPath '${identityFile.replaceAll("'", "''")}' -Encoding UTF8`;
        const observedCommand = [...args.slice(0, -1), script];
        const result = await runCheckedCommand(observedCommand, options);
        evidence.discovery = { selectedCommand: args[0], originalCommand: original, observedCommand, result };
        return result;
      };
      const context = new CollectionContext("Windows");
      let listeners;
      try { listeners = await new WindowsPortBackend(observe).getListeningPorts(context); }
      finally { context.finish(false); }
      assert.ok(listeners.some(row => row.pid === target.pid && row.port === port));
      evidence.ownedListener = { pid: target.pid, port, found: true };
      evidence.identity = JSON.parse((await fs.readFile(identityFile, "utf8")).replace(/^\uFEFF/, ""));
      assert.equal(evidence.identity.Nonce, nonce);
      assert.ok(path.isAbsolute(evidence.identity.Executable));
      assert.match(path.basename(evidence.identity.Executable), /^(powershell|pwsh)\.exe$/i);
      assert.ok((await fs.stat(evidence.identity.Executable)).isFile());
      assert.ok(Number.isSafeInteger(evidence.identity.ProcessId) && evidence.identity.ProcessId > 0);
      assert.match(evidence.identity.Version, /^\d+\.\d+/);
      evidence.versionQuery = await command(evidence.identity.Executable, ["-NoProfile", "-NonInteractive", "-Command", `${identityExpression} | ConvertTo-Json -Compress`]);
      assert.equal(evidence.versionQuery.exitCode, 0, evidence.versionQuery.stderr);
      const version = JSON.parse(evidence.versionQuery.stdout);
      assert.equal(version.Executable.toLowerCase(), evidence.identity.Executable.toLowerCase());
      assert.equal(version.Version, evidence.identity.Version);
      assert.equal(version.Edition, evidence.identity.Edition);
      await fs.unlink(identityFile);
    });
  }
  if (process.platform !== "win32") {
    capture.tool = await command("lsof", ["-v"]);
    for (const [name, args] of [
      ["owned-ipv4-ipv6", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-a", "-p", String(target.pid)]],
      ["controlled-no-match", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-a", "-p", String(process.pid)]],
      ["invalid-option", ["--ports-invalid-option"]]
    ]) capture.fixtures.push({ name, ...(await command("lsof", args)) });
    await checked("native lsof no-match and error signatures", async () => {
      const empty = capture.fixtures.find(item => item.name === "controlled-no-match");
      assert.equal(empty.exitCode, 1); assert.equal(empty.stdout, "");
      assert.ok(!empty.stderr || (process.platform === "linux" && linuxMountWarnings(empty.stderr)), empty.stderr);
      const invalid = capture.fixtures.find(item => item.name === "invalid-option");
      assert.notEqual(invalid.exitCode, 0); assert.ok(invalid.stderr);
      const valid = capture.fixtures.find(item => item.name === "owned-ipv4-ipv6");
      assert.equal(valid.exitCode, 0); assert.match(valid.stdout, /IPv4/); assert.match(valid.stdout, /IPv6/);
    });
  }
  await checked("native stop refuses unknown identity and a different process PID", async () => {
    await assert.rejects(target.owner.requestStop(sentinel.pid, "SIGTERM"), /Refusing/);
    const unverified = createOwnedStopGuard(target.child, randomUUID());
    await assert.rejects(unverified.requestStop(target.pid, "SIGTERM"), /Refusing/);
    assertOwnedAlive(target.child);
    assertOwnedAlive(sentinel.child);
  });
  await checked("production stop flow requests a signal only from the authenticated owned fixture", async () => {
    // Use the real CLI handler, native enumeration, and native liveness. The
    // test-only signal boundary can never forward kill/Stop-Process to the OS.
    const runner = createOwnedSignalRunner(target.owner, runCheckedCommand);
    const backend = process.platform === "win32" ? new WindowsPortBackend(runner) : new UnixPortBackend(runner);
    let stdout = "", stderr = "";
    const exitCode = await runCli(["node", "ports", "kill", String(port)], {
      serviceFactory: () => new PortService(() => backend, undefined, undefined, warnings => { for (const warning of warnings) stderr += `${warning}\n`; }),
      stdout: text => { stdout += text; }, stderr: text => { stderr += text; }
    });
    assert.equal(exitCode, 0, stderr); assert.match(stdout, /Stopped/);
    await target.exited;
    if (process.platform === "linux") assert.equal(target.child.signalCode, "SIGTERM");
    assertOwnedAlive(sentinel.child);
  });
  await checked("released port is free after successful discovery; owned sentinel survives", async () => {
    const r = await run(["check", String(port)]); assert.equal(r.exitCode, 0, r.stderr); assert.match(r.stdout, /free/);
    const json = await run(["list", "--json"]); assert.equal(json.exitCode, 0, json.stderr);
    const rows = JSON.parse(json.stdout);
    assert.ok(!rows.some(row => row.pid === target.pid));
    assert.ok(rows.some(row => row.pid === sentinel.pid && row.port === sentinel.ports[0].port));
  });
} catch (error) {
  capture.checks.push({ name: "native smoke", status: "failed", error: error.message });
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const { owner, exited } of children) {
    owner.close();
    await exited.catch(() => {});
  }
  await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, `native-${process.platform}.json`);
  await fs.writeFile(output, JSON.stringify(capture, null, 2) + "\n");
  console.log(`Native verification recorded in ${output}`);
}
