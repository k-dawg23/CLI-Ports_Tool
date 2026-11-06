import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOwnedStopGuard } from '../native-ownership.mjs';
import { terminalScreen } from './terminal-screen.mjs';

export async function verifyCli({ session, report, directory, here }) {
  report.stage2 = 'FAIL';
  const fixtures = [];
  // Ink otherwise suppresses interactive frame updates under its CI renderer.
  // isTTY/raw-mode values still come exclusively from the native console.
  report.cli = { frames: [], assertions: [], fixtures: [], environmentOverrides: { CI: 'false' } };
  const project = path.join(directory, 'owned project with spaces');
  await fs.mkdir(project);
  const executable = path.join(project, 'node fixture.exe');
  await fs.copyFile(process.execPath, executable);
  await fs.copyFile(path.join(here, 'owned-listener.cjs'), path.join(project, 'listener.cjs'));
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'conpty-owned', version: '1.0.0' }));
  const listener = async () => {
    const token = randomUUID();
    const child = spawn(executable, [path.join(project, 'listener.cjs')], { cwd: project, env: { ...process.env, PORTS_FIXTURE_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const owner = createOwnedStopGuard(child, token);
    const exited = once(child, 'exit');
    const record = { child, owner, exited, identity: null };
    fixtures.push(record);
    const [message] = await once(child, 'message');
    const identity = owner.acceptReady(message);
    assert.ok(Number.isInteger(identity.port) && identity.port > 0);
    record.identity = { pid: identity.pid, port: identity.port, command: [executable, path.join(project, 'listener.cjs')] };
    report.cli.fixtures.push(record.identity);
    return record;
  };
  const observeLog = path.join(directory, 'cli-observation.jsonl');
  const launchLog = path.join(directory, 'launcher.jsonl');
  const records = async file => (await fs.readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const observed = [];
  const refreshRecords = async () => { observed.splice(0, observed.length, ...(await records(observeLog))); };
  let cli;
  try {
    const first = await listener();
    const second = await listener();
    const target = [first, second].sort((a, b) => a.identity.port - b.identity.port)[1];
    report.cli.target = target.identity;
    const environment = { LC_ALL: 'en_GB.UTF-8', LANG: 'en_GB.UTF-8', LC_MESSAGES: 'de_DE.UTF-8', LANGUAGE: 'en:de', PORTS_CONPTY_MARKER: 'inherited marker with spaces' };
    const launcher = path.join(here, 'launcher-probe.cjs');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    cli = await session('compiled-cli', ['--require', path.join(here, 'observe-cli.cjs'), path.join(root, 'dist', 'cli.js')], {
      ...report.cli.environmentOverrides, ...environment,
      PORTS_OBSERVE_LOG: observeLog, PORTS_LAUNCH_LOG: launchLog, PORTS_LAUNCH_PROBE: launcher,
      PORTS_EDITOR: `"${process.execPath}" "${launcher}" editor "editor argument with spaces"`,
      FORCE_COLOR: '1', TERM: 'xterm-256color'
    });
    const frame = label => {
      const text = terminalScreen(cli.data.output);
      if (label) report.cli.frames.push({ label, at: Date.now(), text });
      return text;
    };
    const selected = text => {
      const match = /Port (\d+) · .* · PID (\d+)/.exec(text);
      return match ? { pid: Number(match[2]), port: Number(match[1]) } : undefined;
    };
    const isTarget = text => selected(text)?.pid === target.identity.pid && selected(text)?.port === target.identity.port;
    await cli.wait('native TUI header', () => frame().includes('ports v2.0.1'));
    await refreshRecords();
    assert.ok(observed.some(e => e.type === 'terminal' && e.stdinTTY && e.stdoutTTY && e.rawAvailable && e.columns === 160 && e.rows === 60));
    assert.ok(observed.some(e => e.type === 'raw' && e.actual === true));
    assert.ok(!cli.data.output.includes('Falling back to a static port list'));
    report.cli.assertions.push('native TTY and actual raw mode, compiled TUI header');
    cli.input('/'); await cli.wait('search mode', () => frame().includes('Enter lock'));
    cli.input('conpty-owned'); await cli.wait('owned rows', () => frame().includes('conpty-owned') && frame().includes(String(first.identity.port)) && frame().includes(String(second.identity.port)), 60000);
    cli.input('\r'); await cli.wait('locked search', () => !frame().includes('Enter lock'));
    await cli.wait('owned row selected', () => [first.identity.pid, second.identity.pid].includes(selected(frame())?.pid));
    if (!isTarget(frame())) { cli.input('\x1b[B'); await cli.wait('target arrow selection', () => isTarget(frame())); }
    frame('selected target');
    report.cli.assertions.push('known PID/port selected using native arrow input');

    await refreshRecords();
    let count = observed.filter(e => e.type === 'discovery-start').length;
    cli.input('r');
    await cli.wait('manual refresh query', async () => { await refreshRecords(); return observed.filter(e => e.type === 'discovery-start').length > count; }, 60000);
    assert.ok(observed.some(e => e.type === 'terminal-input' && e.data === Buffer.from('r').toString('base64')));
    assert.ok(isTarget(frame('manual refresh')));
    report.cli.assertions.push('manual r input received; a further native discovery query started; selected identity preserved');

    const timers = observed.filter(e => e.type === 'refresh-timer').length;
    const completions = observed.filter(e => e.type === 'discovery-exit' && e.code === 0).length;
    await cli.wait('two automatic refresh opportunities and successful native queries', async () => {
      await refreshRecords();
      return observed.filter(e => e.type === 'refresh-timer').length >= timers + 2 && observed.filter(e => e.type === 'discovery-exit' && e.code === 0).length >= completions + 2;
    }, 60000);
    assert.ok(isTarget(frame('automatic refreshes')));
    report.cli.assertions.push('two real 3-second timer callbacks and successful native discovery completions without further keyboard input');

    const extra = await listener();
    await cli.wait('new separate owned listener rendered', () => frame().includes(String(extra.identity.port)), 60000);
    assert.ok(isTarget(frame('separate listener added')));
    extra.owner.close(); await extra.exited;
    await cli.wait('removed separate listener disappears', () => !frame().includes(String(extra.identity.port)), 60000);
    assert.ok(isTarget(frame('separate listener removed')));
    cli.input('s'); await cli.wait('sort changed', () => frame().includes('[memory desc]'));
    assert.ok(isTarget(frame('sort changed')));
    report.cli.assertions.push('selection preserved by PID/port across owned listener addition/removal and memory sorting');

    cli.input('e');
    await cli.wait('editor probe', async () => (await records(launchLog)).some(e => e.kind === 'editor'), 60000);
    cli.input('o');
    await cli.wait('browser probe', async () => (await records(launchLog)).some(e => e.kind === 'browser'), 60000);
    const launches = await records(launchLog);
    assert.equal(launches.length, 2);
    assert.deepEqual(launches.find(e => e.kind === 'editor').args, ['editor argument with spaces', project]);
    assert.deepEqual(launches.find(e => e.kind === 'browser').args, [`http://localhost:${target.identity.port}`]);
    for (const launch of launches) assert.deepEqual(launch.env, environment);
    report.cli.launches = launches;
    await refreshRecords();
    assert.equal(observed.filter(e => e.type === 'browser-intercept').length, 1);
    assert.ok(isTarget(frame('shortcuts completed')));
    report.cli.assertions.push('editor executable and intercepted browser child received intact arguments, spaced directory/URL and inherited locale/marker');
    for (const record of [first, second]) {
      assert.equal(record.child.connected, true);
      assert.equal(record.child.exitCode, null);
    }
    cli.input('q'); await cli.finish();
    await refreshRecords();
    assert.ok(observed.some(e => e.type === 'raw' && e.actual === false));
    assert.ok(observed.some(e => e.type === 'cli-exit' && e.code === 0 && e.raw === false));
    report.cli.assertions.push('native q input exits compiled CLI with status 0, restores raw mode, drains/closes ConPTY and closes owned child handles');
  } finally {
    for (const record of fixtures) record.owner.close();
    for (const record of fixtures) {
      await record.exited;
      report.cli.assertions.push(`fixture ${record.identity?.pid ?? 'unknown'} exited on owned IPC disconnect`);
    }
  }
  report.stage2 = 'PASS';
  console.log('Stage 2 PASS: compiled CLI native terminal interaction, refresh/selection, harmless launchers and cleanup');
}
