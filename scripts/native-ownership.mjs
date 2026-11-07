// The smoke test may request a signal only through its own spawned fixture's
// authenticated IPC channel. No numeric-PID signal or external stop fallback.
export function createOwnedStopGuard(child, token) {
  const pid = child.pid;
  let verified = false;
  const invalidate = () => { verified = false; };
  for (const event of ["exit", "disconnect", "error"]) child.once(event, invalidate);

  return {
    acceptReady(message) {
      invalidate();
      if (!Number.isSafeInteger(pid) || pid <= 0 || child.pid !== pid || typeof token !== "string" || !token || message?.type !== "ports-native-ready" || message.token !== token || message.pid !== pid) {
        throw new Error("Native fixture ownership/identity could not be established.");
      }
      verified = true;
      return message;
    },
    async requestStop(requestedPid, signal) {
      if (!verified || child.pid !== pid || requestedPid !== pid || child.connected !== true || child.exitCode !== null || child.signalCode !== null || !["SIGTERM", "SIGKILL"].includes(signal)) {
        throw new Error("Refusing native stop: fixture ownership/identity is unknown, changed, or exited.");
      }
      await new Promise((resolve, reject) => {
        try {
          child.send({ type: "ports-native-stop", token, pid, signal }, error => {
            if (error) { invalidate(); reject(error); }
            else resolve();
          });
        } catch (error) { invalidate(); reject(error); }
      });
    },
    close() {
      invalidate();
      // The fixture exits itself on disconnect, even if readiness was unknown.
      // Closing a spawn-owned pipe never targets a process by PID.
      if (child.connected) {
        try { child.disconnect(); } catch { /* Already disconnected. */ }
      }
    }
  };
}

export function createOwnedSignalRunner(owner, runReadOnly) {
  return async (args, options) => {
    const failure = message => ({ stdout: "", stderr: message, exitCode: 1 });
    let match;
    let signal;
    if (args[0] === "kill") {
      if (args.length !== 3 || !["-15", "-9"].includes(args[1]) || !/^[1-9][0-9]*$/.test(args[2])) return failure("Refusing unrecognized native stop command.");
      match = args[2];
      signal = args[1] === "-15" ? "SIGTERM" : "SIGKILL";
    } else if (["powershell", "pwsh"].includes(args[0]) && args.at(-1)?.includes("Stop-Process")) {
      const stop = /^Stop-Process -Id ([1-9][0-9]*)( -Force)? -ErrorAction Stop$/.exec(args.at(-1));
      if (!stop) return failure("Refusing unrecognized native stop command.");
      match = stop[1]; signal = stop[2] ? "SIGKILL" : "SIGTERM";
    }
    if (match !== undefined) {
      try {
        await owner.requestStop(Number(match), signal);
        return { stdout: "", stderr: "", exitCode: 0 };
      } catch (error) { return failure(error instanceof Error ? error.message : "Native stop refused."); }
    }
    const readOnlyPowerShell = ["powershell", "pwsh"].includes(args[0]) && isReadOnlyPowerShell(args.at(-1));
    if (!["lsof", "ps", "where", "which"].includes(args[0]) && !readOnlyPowerShell) return failure("Refusing command outside native read-only discovery allowlist.");
    return runReadOnly(args, options);
  };
}

function isReadOnlyPowerShell(script) {
  // Match whole production query forms: a known prefix alone must not permit
  // an appended mutating command to bypass the test's stop boundary.
  if (typeof script !== "string") return false;
  if (script === "$ErrorActionPreference = 'Stop'; $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess); [pscustomobject]@{ Listeners = $listeners } | ConvertTo-Json -Depth 5") return true;
  const pids = /Get-Process -Id @\(([0-9]+(?:,[0-9]+)*)\)/.exec(script)?.[1];
  if (pids && script === `$ErrorActionPreference = 'Stop'; $items = @(Get-Process -Id @(${pids}) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,@{Name='StartTime';Expression={try {$_.StartTime.ToUniversalTime().ToString('o')} catch {$null}}}); ConvertTo-Json -InputObject $items -Depth 4`) return true;
  const filter = /Get-CimInstance Win32_Process -Filter "(ProcessId = [0-9]+(?: OR ProcessId = [0-9]+)*)"/.exec(script)?.[1];
  if (filter && script === `$ErrorActionPreference = 'Stop'; $items = @(Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction Stop | Select-Object ProcessId,CommandLine,ExecutablePath); ConvertTo-Json -InputObject $items -Depth 4`) return true;
  const pid = /if \(\$ids -contains ([0-9]+)\)/.exec(script)?.[1];
  return Boolean(pid && script === `$ErrorActionPreference = 'Stop'; $ids = @(Get-Process -ErrorAction Stop | Select-Object -ExpandProperty Id); if ($ids -contains ${pid}) { @{State='alive'} | ConvertTo-Json } else { @{State='exited'} | ConvertTo-Json }`);
}
