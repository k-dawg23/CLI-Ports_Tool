const fs = require('node:fs');
const keys = ['LC_ALL', 'LANG', 'LC_MESSAGES', 'LANGUAGE', 'PORTS_PTY_MARKER'];
const start = Date.now();
const record = phase => fs.appendFileSync(process.env.PORTS_LAUNCH_LOG, JSON.stringify({ at: Date.now(), elapsedMs: Date.now() - start, pid: process.pid, kind: process.argv[2], phase, args: process.argv.slice(3), env: Object.fromEntries(keys.map(key => [key, process.env[key] ?? null])) }) + '\n');
record('started');
if (process.argv[2] === 'editor') setTimeout(() => record('completed'), 16100);
else record('completed');
