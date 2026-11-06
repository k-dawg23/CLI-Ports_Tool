// Private parent-owned control pipe: fail closed without signalling any PID.
const net = require('node:net');
const fd = Number(process.env.PORTS_PTY_CONTROL_FD);
if (!Number.isInteger(fd) || fd < 0) throw new Error('Missing PTY lifetime channel');
const control = new net.Socket({ fd, readable: true, writable: false });
control.on('end', () => process.exit(1));
control.on('error', () => process.exit(1));
control.resume();
control.unref(); // A normal q exit must not wait for this parent's control pipe.
