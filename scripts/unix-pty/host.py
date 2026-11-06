"""Test-only, single-threaded Unix PTY host; no numeric-PID signalling.

The child owns a new session/controlling terminal. Closing our master causes
kernel terminal hangup in that session only. A private pipe also makes the
test-only Node lifetime preload exit itself on abort or host disappearance.
"""
import base64
import errno
import fcntl
import json
import os
import platform
import pty
import select
import struct
import subprocess
import sys
import termios
import time


def emit(**value):
    print(json.dumps(value), flush=True)


master, slave = pty.openpty()
control_read, control_write = os.pipe()
original = termios.tcgetattr(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 160, 0, 0))
child = None
normal = False
drained = False
result = 1


def attach_terminal():
    # Popen performs setsid() before this preexec callback. This isolated Python
    # helper has no threads, networking or macOS higher-level framework imports.
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.write(1, (json.dumps(dict(marker='controlling-terminal', foregroundGroup=os.tcgetpgrp(0), pid=os.getpid())) + '\n').encode())


try:
    env = dict(os.environ, PORTS_PTY_CONTROL_FD=str(control_read))
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave,
                             start_new_session=True, preexec_fn=attach_terminal,
                             pass_fds=(control_read,), env=env)
    os.close(control_read)
    control_read = -1
    emit(type='pty', api='pty.openpty + setsid + TIOCSCTTY', pid=child.pid,
         command=sys.argv[1:], python=sys.version, os=platform.platform(),
         columns=160, rows=60, slave=os.ttyname(slave),
         sessionId=os.getsid(child.pid))
    os.set_blocking(master, False)
    buffer = b''
    deadline = time.monotonic() + 240
    while True:
        if time.monotonic() > deadline:
            raise TimeoutError('Owned terminal session deadline exceeded')
        ready, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.1)
        if master in ready:
            try:
                data = os.read(master, 16384)
                if data:
                    emit(type='output', data=base64.b64encode(data).decode('ascii'))
                else:
                    drained = True
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                drained = True  # Linux PTY EOF; macOS may return zero bytes.
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                raise RuntimeError('Controller disconnected')
            buffer += data
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                event = json.loads(line)
                if event['type'] == 'abort':
                    raise RuntimeError('Requested owned-session abort')
                payload = base64.b64decode(event['data'])
                while payload:
                    written = os.write(master, payload)
                    payload = payload[written:]
        # poll() reaps only our direct child; no PID lookups or signal fallback.
        if child.poll() is not None:
            # Drain remaining output after child exit, while retaining slave to
            # inspect actual terminal settings (therefore EOF is not required).
            while select.select([master], [], [], 0)[0]:
                try:
                    data = os.read(master, 16384)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not data:
                    break
                emit(type='output', data=base64.b64encode(data).decode('ascii'))
            drained = True
            normal = child.returncode == 0
            result = 0 if normal else 1
            emit(type='exit', exitCode=child.returncode)
            break
except Exception as error:
    emit(type='error', error=repr(error))
finally:
    restored = False
    if child is not None and child.poll() is not None:
        current = termios.tcgetattr(slave)
        mask = termios.ECHO | termios.ICANON
        restored = current[3] & mask == original[3] & mask
    # Terminal hangup targets only the session created above; EOF on this pipe
    # also reaches only the child with its explicitly inherited private fd.
    os.close(master)
    os.close(control_write)
    if control_read >= 0:
        os.close(control_read)
    if child is not None:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            emit(type='cleanup-error', error='Owned child did not exit on terminal/control closure; no unsafe signal fallback')
            result = 1
    # A hung-up slave may reject termios calls. It is about to be closed; normal
    # restoration was inspected before hangup, rather than fabricated by host.
    os.close(slave)
    emit(type='cleanup', descriptorsClosed=True, childReaped=child is not None and child.returncode is not None,
         exitCode=None if child is None else child.returncode, normalExit=normal,
         outputDrained=drained, terminalRestoredByChild=restored)
sys.exit(result)
