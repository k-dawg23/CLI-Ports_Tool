import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalScreen } from '../scripts/conpty/terminal-screen.mjs';

test('ConPTY transcript decoder applies cursor rewrites rather than matching stale text', () => {
  const frame = terminalScreen('Port 100 PID 10\r\nold row\x1b[1;6H200\x1b[2;1H\x1b[2Knew row');
  assert.match(frame, /Port 200 PID 10/);
  assert.ok(!frame.includes('Port 100'));
  assert.ok(!frame.includes('old row'));
});
test('ConPTY decoder handles cleared frames, title sequences, attributes and incomplete final escape', () => {
  assert.equal(terminalScreen('stale\x1b[2J\x1b[H\x1b]0;title\x07\x1b[32mSelected\x1b[m\x1b['), 'Selected');
  assert.throws(() => terminalScreen('\x1b[1L'), /Unsupported terminal control/);
});
