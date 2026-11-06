const readline = require('node:readline');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
emit({ marker: 'probe-start', stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY, rawAvailable: typeof process.stdin.setRawMode === 'function', node: process.version });
if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) process.exit(1);
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
emit({ marker: 'raw-ready', raw: process.stdin.isRaw });
process.stdin.on('keypress', (text, key) => {
  emit({ marker: 'key', name: key.name, sequence: key.sequence });
  if (key.name === 'q') {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    emit({ marker: 'probe-complete', raw: process.stdin.isRaw });
  }
});
