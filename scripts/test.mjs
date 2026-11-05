import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const integration = process.argv.includes("--integration");
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter(name => integration ? name.endsWith(".integration.test.ts") : name.endsWith(".test.ts") && !name.endsWith(".integration.test.ts"))
  .map(name => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));
if (!files.length) throw new Error("No tests found for the requested test phase.");
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
