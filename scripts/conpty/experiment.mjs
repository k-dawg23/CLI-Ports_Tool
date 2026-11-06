import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = process.env.PORTS_CONPTY_OUTPUT_DIR;
assert.ok(directory, 'A fresh explicit evidence directory is required');
await fs.mkdir(directory, { recursive: true });
const report = { stage1: 'NOT ATTEMPTED', stage2: 'NOT ATTEMPTED', sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, os: os.release(), platform: process.platform, node: process.version, dimensions: { columns: 160, rows: 60 }, sessions: [] };
const live = [];

export async function session(name, args, env = {}) {
  const command = ['dotnet', path.join(directory, 'host', 'ConPtyHost.dll'), process.execPath, ...args];
  const child = spawn(command[0], command.slice(1), { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  live.push({ child, exited });
  const data = { name, command, events: [], input: [], output: '', stderr: '' };
  report.sessions.push(data);
  child.stderr.on('data', chunk => { data.stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const event = JSON.parse(line); data.events.push(event);
      if (event.type === 'output') data.output += Buffer.from(event.data, 'base64').toString('utf8');
    } catch (error) { data.events.push({ type: 'parse-error', line, error: error.message }); }
  });
  const input = text => {
    data.input.push({ at: Date.now(), text });
    child.stdin.write(JSON.stringify({ type: 'input', data: Buffer.from(text).toString('base64') }) + '\n');
  };
  const wait = async (label, predicate, ms = 30000) => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, `Timed out: ${name}: ${label}`);
      assert.ok(!data.events.some(e => e.type === 'error'), JSON.stringify(data.events));
      assert.ok(!data.events.some(e => !e.type), 'Unexpected child output bypassed the ConPTY channel');
      assert.ok(!data.events.some(e => e.type === 'exit' && e.exitCode !== 0), JSON.stringify(data.events));
      assert.equal(child.exitCode, null, `Host exited before ${label}: ${JSON.stringify(data)}`);
      await delay(50);
    }
  };
  const finish = async () => {
    const [code, signal] = await exited;
    data.hostExit = { code, signal };
    assert.equal(code, 0, JSON.stringify(data.events));
    assert.ok(data.events.some(e => e.type === 'exit' && e.exitCode === 0));
    assert.ok(data.events.some(e => e.type === 'child-cleanup' && e.exited));
    assert.ok(data.events.some(e => e.type === 'cleanup' && e.pseudoconsoleClosed && e.outputDrained && e.handlesClosed && e.ownedJobClosed && e.normalExit));
    assert.ok(!data.events.some(e => /error/.test(e.type)));
    child.stdin.end();
  };
  return { data, input, wait, finish };
}

try {
  assert.equal(process.platform, 'win32', 'ConPTY requires native Windows');
  report.stage1 = 'FAIL';
  const probe = await session('feasibility', [path.join(here, 'keyboard-probe.cjs')]);
  await probe.wait('raw-ready', () => probe.data.output.includes('raw-ready'));
  // Use raw captured native output, not a synthetic TTY property override.
  assert.match(probe.data.output, /"stdinTTY":true,"stdoutTTY":true,"rawAvailable":true/);
  assert.match(probe.data.output, /"marker":"raw-ready","raw":true/);
  for (const [text, name] of [['a', 'a'], ['\x1b[A', 'up'], ['b', 'b'], ['q', 'q']]) {
    probe.input(text);
    await probe.wait(`keyboard ${name}`, () => probe.data.output.includes(`"name":"${name}"`));
  }
  await probe.finish();
  assert.match(probe.data.output, /"marker":"probe-complete","raw":false/);
  report.stage1 = 'PASS';
  console.log('Stage 1 PASS: native ConPTY, TTY/raw input, a/up/b/q events, captured output, normal exit and handle cleanup');
} catch (error) {
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const { child, exited } of live) {
    if (child.exitCode === null && child.signalCode === null) child.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');
    await exited.catch(error => { report.cleanupError = error.message; });
  }
  for (const data of report.sessions) {
    await fs.writeFile(path.join(directory, `${data.name}-terminal.txt`), data.output);
  }
  await fs.writeFile(path.join(directory, 'experiment.json'), JSON.stringify(report, null, 2) + '\n');
}
