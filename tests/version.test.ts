import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { APP_VERSION } from "../src/version.js";
import { runCli } from "../src/commands.js";

test("application manifests, CLI version, and current-release documents agree on 2.0.2", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(APP_VERSION, "2.0.2");
  assert.equal(manifest.version, APP_VERSION); assert.equal(lock.version, APP_VERSION); assert.equal(lock.packages[""].version, APP_VERSION);
  let output = "";
  assert.equal(await runCli(["node", "ports", "--version"], { stdout: text => { output += text; } }), 0);
  assert.equal(output.trim(), APP_VERSION);
  assert.match(await readFile(new URL("../src/tui.tsx", import.meta.url), "utf8"), /import \{ APP_VERSION \}/);
  for (const file of ["README.md", "USER_MANUAL.md", "index.html", "PROJECT_HISTORY.md"]) assert.ok((await readFile(new URL(`../${file}`, import.meta.url), "utf8")).includes("2.0.2"));
  assert.equal((await readFile(new URL("../scripts/unix-pty/cli-stage.mjs", import.meta.url), "utf8")).includes("ports v2.0.1"), false);
  assert.match(await readFile(new URL("../PROJECT_HISTORY.md", import.meta.url), "utf8"), /## v2\.0\.0 - 2026-04-01/);
});
