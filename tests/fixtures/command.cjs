// Test-only platform executables. They never signal a process or launch a GUI.
const fs = require("node:fs");
const path = require("node:path");
const [command, ...args] = process.argv.slice(2);
const mode = process.env.PORTS_TEST_MODE;
fs.appendFileSync(process.env.PORTS_TEST_CALLS, JSON.stringify({ command, args }) + "\n");
const emit = (stdout, code = 0, stderr = "") => {
  fs.writeSync(1, stdout); fs.writeSync(2, stderr); process.exitCode = code;
};
const header = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n";
const pid = 987654321;
if (command === "where") emit("powershell\n");
else if (command === "ps") emit("node node server.js 1024 01:00\n");
else if (command === "kill") emit("");
else if (command === "lsof" && args.includes("-d")) emit(`p${pid}\nn${process.env.PORTS_TEST_PROJECT}\n`);
else if (command === "lsof") {
  if (mode === "error") emit("", 2, "fixture required query failed\n");
  else if (mode === "malformed") emit("unexpected output\n");
  else if (mode === "empty") emit("", 1);
  else emit(`${header}node ${pid} user 20u IPv4 123 0t0 TCP *:3000 (LISTEN)\n`);
} else {
  const script = args.at(-1);
  if (script.includes("Get-NetTCPConnection")) {
    if (mode === "error") emit("", 1, "fixture required query failed\n");
    else if (mode === "malformed") emit("unexpected output\n");
    else emit(JSON.stringify({ Listeners: mode === "empty" ? [] : [{ LocalAddress: "127.0.0.1", LocalPort: 3000, OwningProcess: pid }] }));
  } else if (mode === "metadata-error") emit("", 1, "fixture optional metadata failed\n");
  else if (script.includes("Stop-Process")) emit("");
  else if (script.includes("$ids")) emit(JSON.stringify({ State: "exited" }));
  else if (script.includes("Get-CimInstance")) emit(JSON.stringify([{ ProcessId: pid, CommandLine: JSON.stringify(path.join(process.env.PORTS_TEST_PROJECT, "server.js")) }]));
  else emit(JSON.stringify([{ Id: pid, ProcessName: "node", WorkingSet64: 1048576, StartTime: "2026-01-01T00:00:00Z" }]));
}
