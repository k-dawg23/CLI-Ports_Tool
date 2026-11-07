import { execa } from "execa";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function captureCli(command: string, args: string[], options: { env: NodeJS.ProcessEnv; reject: false }) {
  // Fixtures supply a complete environment. Execa's default merge would
  // restore parent variables deliberately removed by the fixture.
  if (process.env.PORTS_TEST_CAPTURE !== "file") return execa(command, args, { ...options, extendEnv: false });
  if (process.env.CI === "true") throw new Error("CI must use piped CLI capture.");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ports-cli-capture-"));
  let stdout: Awaited<ReturnType<typeof fs.open>> | undefined;
  let stderr: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    stdout = await fs.open(path.join(directory, "stdout"), "w");
    stderr = await fs.open(path.join(directory, "stderr"), "w");
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, { env: options.env, stdio: ["ignore", stdout!.fd, stderr!.fd], timeout: 35_000 });
      child.once("error", reject);
      child.once("close", (code, signal) => signal ? reject(new Error(`Owned CLI exited on signal ${signal}`)) : resolve(code ?? 1));
    });
    await stdout.close(); await stderr.close();
    return { exitCode, stdout: (await fs.readFile(path.join(directory, "stdout"), "utf8")).trimEnd(), stderr: (await fs.readFile(path.join(directory, "stderr"), "utf8")).trimEnd() };
  } finally {
    await stdout?.close().catch(() => {}); await stderr?.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
}
