const fs = require('node:fs');
const keys = ['LC_ALL', 'LANG', 'LC_MESSAGES', 'LANGUAGE', 'PORTS_CONPTY_MARKER'];
fs.appendFileSync(process.env.PORTS_LAUNCH_LOG, JSON.stringify({ at: Date.now(), kind: process.argv[2], args: process.argv.slice(3), env: Object.fromEntries(keys.map(key => [key, process.env[key] ?? null])) }) + '\n');
