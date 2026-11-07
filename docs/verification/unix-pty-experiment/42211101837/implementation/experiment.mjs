import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { StringDecoder } from 'node:string_decoder';

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = process.env.PORTS_PTY_OUTPUT_DIR;
assert.ok(directory, 'A fresh explicit evidence directory is required');
await fs.mkdir(directory, { recursive: true });
const report = { stage1: 'NOT ATTEMPTED', stage2: 'NOT ATTEMPTED', sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, platform: process.platform, os: os.release(), node: process.version, dimensions: { columns: 160, rows: 60 }, sessions: [] };
const live = [];
async function session(name, args, env = {}) {
  const command = ['python3', path.join(here, 'host.py'), process.execPath, '--require', path.join(here, 'lifetime.cjs'), ...args];
  const child = spawn(command[0], command.slice(1), { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  live.push({ child, closed });
  const data = { name, command, events: [], input: [], output: '', stderr: '' };
  report.sessions.push(data);
  const decoder = new StringDecoder('utf8');
  child.stderr.on('data', chunk => { data.stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const event = JSON.parse(line); data.events.push(event);
      if (event.type === 'output') data.output += decoder.write(Buffer.from(event.data, 'base64'));
    } catch (error) { data.events.push({ type: 'protocol-error', line, error: error.message }); }
  });
  child.stdin.on('error', () => {}); // A failed host may already have closed input.
  const input = text => {
    data.input.push({ at: Date.now(), text });
    child.stdin.write(JSON.stringify({ type: 'input', data: Buffer.from(text).toString('base64') }) + '\n');
  };
  const wait = async (label, predicate, ms = 30000) => {
    console.log(`PTY waiting: ${label}`);
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      assert.ok(Date.now() < deadline, `Timed out: ${name}: ${label}`);
      assert.ok(!data.events.some(e => /error/.test(e.type)), JSON.stringify(data));
      assert.equal(child.exitCode, null, JSON.stringify(data));
      await delay(50);
    }
    console.log(`PTY observed: ${label}`);
  };
  const finish = async (failure = false) => {
    const [code, signal] = await closed; data.hostExit = { code, signal };
    if (failure) assert.notEqual(code, 0); else assert.equal(code, 0, JSON.stringify(data));
    const cleanup = data.events.find(e => e.type === 'cleanup');
    assert.ok(cleanup?.descriptorsClosed && cleanup.childReaped, JSON.stringify(data));
    if (!failure) assert.ok(cleanup.normalExit && cleanup.outputDrained && cleanup.terminalRestoredByChild !== false, JSON.stringify(data));
    child.stdin.end();
  };
  return { data, input, wait, finish, abort: () => child.stdin.write('{"type":"abort"}\n'), disconnect: () => child.stdin.end() };
}
try {
  assert.ok(['linux', 'darwin'].includes(process.platform));
  report.stage1 = 'FAIL';
  const probe = await session('feasibility', [path.join(here, 'keyboard-probe.cjs')]);
  await probe.wait('raw-ready', () => probe.data.output.includes('raw-ready'));
  assert.match(probe.data.output, /"stdinTTY":true,"stdoutTTY":true,"rawAvailable":true/);
  assert.match(probe.data.output, /"columns":160,"rows":60/);
  const native = probe.data.events.find(e => e.type === 'pty');
  assert.equal(native.sessionId, native.pid);
  assert.match(probe.data.output, new RegExp(`"foregroundGroup": ${native.pid}, "pid": ${native.pid}`));
  for (const [text, name] of [['a', 'a'], ['\x1b[A', 'up'], ['b', 'b'], ['q', 'q']]) {
    probe.input(text); await probe.wait(`key ${name}`, () => probe.data.output.includes(`"name":"${name}"`));
  }
  await probe.finish();
  assert.match(probe.data.output, /"marker":"probe-complete","raw":false/);
  for (const method of ['abort', 'disconnect']) {
    const failure = await session(`failure-${method}`, [path.join(here, 'keyboard-probe.cjs')]);
    await failure.wait('raw-ready', () => failure.data.output.includes('raw-ready'));
    failure[method](); await failure.finish(true);
  }
  report.stage1 = 'PASS';
  console.log('Stage 1 PASS: actual Unix PTY, TTY/raw input, keyboard, output, dimensions, normal exit and abort/disconnect cleanup');
  if (process.argv.includes('--cli')) {
    const { verifyCli } = await import('./cli-stage.mjs');
    await verifyCli({ session, report, directory, here });
  }
} catch (error) {
  report.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  for (const { child, closed } of live) {
    if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end();
    await closed.catch(error => { report.cleanupError = error.message; });
  }
  for (const data of report.sessions) await fs.writeFile(path.join(directory, `${data.name}-terminal.txt`), data.output);
  await fs.writeFile(path.join(directory, 'experiment.json'), JSON.stringify(report, null, 2) + '\n');
}
