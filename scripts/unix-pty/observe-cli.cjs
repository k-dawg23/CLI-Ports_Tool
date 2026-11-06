// Native observations only; browser interception is confined to the launcher.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const log = data => fs.appendFileSync(process.env.PORTS_OBSERVE_LOG, JSON.stringify({ at: Date.now(), pid: process.pid, ...data }) + '\n');
log({ type: 'terminal', stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY, rawAvailable: typeof process.stdin.setRawMode === 'function', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdin.on('data', bytes => log({ type: 'terminal-input', data: Buffer.from(bytes).toString('base64') }));
const setRaw = process.stdin.setRawMode.bind(process.stdin);
process.stdin.setRawMode = mode => { const result = setRaw(mode); log({ type: 'raw', requested: mode, actual: process.stdin.isRaw }); return result; };
const interval = global.setInterval;
global.setInterval = (callback, ms, ...args) => interval(ms === 3000 ? (...values) => { log({ type: 'refresh-timer' }); callback(...values); } : callback, ms, ...args);
const spawn = cp.spawn;
cp.spawn = function(command, args, options) {
  if (['kill', 'pkill', 'killall'].includes(path.basename(command))) throw new Error('Stop commands forbidden in PTY interaction experiment');
  const enumeration = path.basename(command) === 'lsof' && args?.includes('-iTCP');
  let actualCommand = command, actualArgs = args;
  if (['xdg-open', 'open'].includes(path.basename(command))) {
    if (args.length !== 1 || !/^http:\/\/localhost:[0-9]+$/.test(args[0])) throw new Error('Unrecognized launcher refused');
    log({ type: 'browser-intercept', command, args });
    actualCommand = process.execPath; actualArgs = [process.env.PORTS_LAUNCH_PROBE, 'browser', ...args];
  }
  if (enumeration) log({ type: 'discovery-start', command, args });
  const child = spawn.call(this, actualCommand, actualArgs, options);
  if (enumeration) child.once('close', (code, signal) => log({ type: 'discovery-exit', code, signal }));
  return child;
};
syncBuiltinESMExports();
process.on('exit', code => log({ type: 'cli-exit', code, raw: process.stdin.isRaw }));
