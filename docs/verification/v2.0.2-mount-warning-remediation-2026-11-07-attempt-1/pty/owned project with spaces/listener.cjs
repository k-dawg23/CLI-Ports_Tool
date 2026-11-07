const net = require('node:net');
const token = process.env.PORTS_FIXTURE_TOKEN;
process.on('disconnect', () => process.exit(0));
const server = net.createServer();
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  process.send({ type: 'ports-native-ready', token, pid: process.pid, port: server.address().port });
});
server.on('error', error => { console.error(error); process.exit(1); });
