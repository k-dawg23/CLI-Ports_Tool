import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertPipeCapture } from "./stdio-preflight.mjs";

const integration = process.argv.includes("--integration");
const fileCapture = process.argv.includes("--file-capture");
if (fileCapture && (!integration || process.env.CI === "true")) throw new Error("File capture is restricted to explicit local integration runs; CI must verify pipes.");
if (integration && !fileCapture) await assertPipeCapture();
if (fileCapture) console.log("Local file-backed integration capture: redirected-output verification only; piped-output acceptance remains pending.");
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter(name => integration ? name.endsWith(".integration.test.ts") : name.endsWith(".test.ts") && !name.endsWith(".integration.test.ts"))
  .map(name => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));
if (!files.length) throw new Error("No tests found for the requested test phase.");
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", env: { ...process.env, PORTS_TEST_CAPTURE: fileCapture ? "file" : "pipe" } });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
