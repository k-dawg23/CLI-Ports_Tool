import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { writeSync } from 'node:fs';

// Keep asynchronous Node stream output exercised independently of the fixtures
// that use synchronous writes to isolate command/locale behavior.
export async function assertPipeCapture() {
  const probe = await execa(process.execPath, ['-e', "require('node:fs').writeSync(1, 'descriptor;'); process.stdout.write('stream;'); console.error('diagnostic');"], { reject: false, timeout: 5000 });
  if (probe.exitCode !== 0 || probe.stdout !== 'descriptor;stream;' || probe.stderr !== 'diagnostic') {
    throw new Error(`Piped Node output is unavailable or incorrect: ${JSON.stringify({ exitCode: probe.exitCode, stdout: probe.stdout, stderr: probe.stderr })}. This blocks pipe verification. For local redirected-output integration checks, use npm run test:integration -- --file-capture. CI must pass piped capture.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await assertPipeCapture(); writeSync(1, 'Piped Node stdout/stderr capture passed.\n'); }
  catch (error) { writeSync(2, `${error.message}\n`); process.exitCode = 1; }
}
