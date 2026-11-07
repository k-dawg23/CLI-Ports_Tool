import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { UnixPortBackend } from "../src/backends/unix.js";
import { WindowsPortBackend } from "../src/backends/windows.js";
import { runCheckedCommand, type CommandOptions, type CommandRunner } from "../src/system.js";

const keys = ["LC_ALL", "LANG", "LC_MESSAGES", "LANGUAGE", "PORTS_LAUNCHER_TEST_MARKER"] as const;
const probe = `require('node:fs').writeSync(1, JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key] ?? null]))))`;
const environment = { LANG: "fr_FR.UTF-8", LC_MESSAGES: "de_DE.UTF-8", LANGUAGE: "fr:en", PORTS_LAUNCHER_TEST_MARKER: "inherited unchanged" };

async function withEnvironment(values: Record<string, string | undefined>, work: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function readChildEnvironment(options?: CommandOptions) {
  const result = await runCheckedCommand([process.execPath, "-e", probe], options);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.failure, undefined);
  return JSON.parse(result.stdout);
}

for (const locale of ["en_GB.UTF-8", undefined, ""]) {
  test(`Unix and Windows editor/browser launchers preserve ${locale === undefined ? "absent" : locale === "" ? "empty" : "explicit"} LC_ALL and inherited environment`, async () => {
    await withEnvironment({ ...environment, LC_ALL: locale, PORTS_EDITOR: '"mock editor" --new' }, async () => {
      const expected = { ...environment, LC_ALL: locale ?? null };
      const launches: string[][] = [];
      const run: CommandRunner = async (args, options) => {
        if (args[0] === "where") {
          assert.equal(options?.inheritLocale, undefined, "PowerShell lookup remains a system query");
          return { stdout: "powershell", stderr: "", exitCode: 0 };
        }
        // Replace only the GUI executable with a harmless Node environment probe.
        assert.deepEqual(await readChildEnvironment(options), expected);
        assert.equal(options?.inheritLocale, true);
        assert.equal(options?.timeoutMs, 0);
        launches.push(args);
        return { stdout: "", stderr: "", exitCode: 0 };
      };
      const unix = new UnixPortBackend(run);
      const windows = new WindowsPortBackend(run);
      assert.equal((await unix.openInEditor("/a project with spaces")).success, true);
      assert.equal((await unix.openInBrowser("http://localhost:3000")).success, true);
      assert.equal((await windows.openInEditor("C:\\a project with spaces")).success, true);
      assert.equal((await windows.openInBrowser("http://localhost:3000")).success, true);
      assert.equal(launches.length, 4);
      assert.deepEqual(launches[0], ["mock editor", "--new", "/a project with spaces"]);
      assert.deepEqual(launches[2], ["mock editor", "--new", "C:\\a project with spaces"]);
      assert.equal(process.env.LC_ALL, locale, "The runner must not mutate its parent's environment");
    });
  });
}

test("system commands still normalize only LC_ALL, without mutating the inherited environment", async () => {
  await withEnvironment({ ...environment, LC_ALL: "en_GB.UTF-8" }, async () => {
    assert.deepEqual(await readChildEnvironment(), { ...environment, LC_ALL: "C" });
    assert.deepEqual(await readChildEnvironment({ inheritLocale: true }), { ...environment, LC_ALL: "en_GB.UTF-8" });
    assert.equal(process.env.LC_ALL, "en_GB.UTF-8");
  });
});

test("locale inheritance does not change explicit timeouts or cancellation", async () => {
  for (const inheritLocale of [false, true]) {
    const timedOut = await runCheckedCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 30, inheritLocale });
    assert.equal(timedOut.failure, "timeout");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runCheckedCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], { signal: controller.signal, inheritLocale });
    assert.equal(cancelled.failure, "timeout");
  }
});

test("running commands remain cancellable with either locale policy", async () => {
  for (const inheritLocale of [false, true]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ports-locale-cancel-"));
    const ready = path.join(directory, "ready");
    const controller = new AbortController();
    const pending = runCheckedCommand([process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000)", ready], {
      signal: controller.signal, timeoutMs: 10_000, inheritLocale
    });
    try {
      const deadline = Date.now() + 5_000;
      while (true) {
        const marker = await readFile(ready, "utf8").catch(() => undefined);
        if (marker === "ready") break;
        assert.ok(Date.now() < deadline, "The owned fixture must confirm startup before cancellation");
        await delay(5);
      }
      controller.abort();
      assert.equal((await pending).failure, "timeout");
    } finally {
      controller.abort();
      await pending;
      await rm(directory, { recursive: true, force: true });
    }
  }
});
