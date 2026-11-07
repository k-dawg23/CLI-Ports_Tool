// Read-only terminal/query observation plus narrowly controlled browser launch.
// This preload runs before the unmodified compiled CLI; it never fakes isTTY/raw mode.
const fs = require('node:fs');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const log = data => fs.appendFileSync(process.env.PORTS_OBSERVE_LOG, JSON.stringify({ at: Date.now(), pid: process.pid, ...data }) + '\n');
log({ type: 'terminal', stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY, rawAvailable: typeof process.stdin.setRawMode === 'function', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdin.on('data', bytes => log({ type: 'terminal-input', data: Buffer.from(bytes).toString('base64') }));
if (process.stdin.setRawMode) {
  const setRawMode = process.stdin.setRawMode.bind(process.stdin);
  process.stdin.setRawMode = mode => { const result = setRawMode(mode); log({ type: 'raw', requested: mode, actual: process.stdin.isRaw }); return result; };
}
const interval = global.setInterval;
global.setInterval = (callback, ms, ...args) => interval(ms === 3000 ? (...values) => { log({ type: 'refresh-timer' }); callback(...values); } : callback, ms, ...args);
const spawn = cp.spawn;
cp.spawn = function(command, args, options) {
  const script = args?.at(-1);
  // Never allow a mistaken interaction test to exercise a stop shortcut.
  if (/^(kill|taskkill)(\.exe)?$/i.test(command) || args?.some(arg => /Stop-Process/.test(arg))) throw new Error('Stop commands forbidden in terminal interaction experiment');
  let actualCommand = command, actualArgs = args;
  if (/^(powershell|pwsh)(\.exe)?$/i.test(command) && typeof script === 'string' && script.startsWith('Start-Process')) {
    const match = /^Start-Process "(http:\/\/localhost:[0-9]+)"$/.exec(script);
    if (!match) throw new Error('Unrecognized launch refused');
    log({ type: 'browser-intercept', command, args });
    actualCommand = process.execPath;
    actualArgs = [process.env.PORTS_LAUNCH_PROBE, 'browser', match[1]];
  }
  const isDiscovery = typeof script === 'string' && script.includes('Get-NetTCPConnection');
  if (isDiscovery) log({ type: 'discovery-start', command, args });
  const child = spawn.call(this, actualCommand, actualArgs, options);
  if (isDiscovery) child.once('exit', (code, signal) => log({ type: 'discovery-exit', code, signal }));
  return child;
};
syncBuiltinESMExports();
process.on('exit', code => log({ type: 'cli-exit', code, raw: process.stdin.isRaw }));
